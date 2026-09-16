"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const MAX_FILES = 12;
const MAX_FILE_BYTES = 200_000;
const MAX_TOTAL_BYTES = 600_000;
const DENY = [
  /^\.env(?:\.|$)/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)node_modules(\/|$)/i,
  /(^|\/)(id_rsa|id_ed25519|credentials|secrets?)(\.|\/|$)/i
];
const ALLOWED_TESTS = new Set([
  "npm test",
  "node --check server.js",
  "node --check dual-ai.js",
  "node --check github-agent.js",
  "node --check github-agent-worker.js",
  "node --check github-agent-patcher.js"
]);

function normalizePatch(input) {
  if (!input || typeof input !== "object") throw new Error("Patch must be an object");
  const patches = Array.isArray(input.patches) ? input.patches : [];
  if (!patches.length) throw new Error("No patches supplied");
  if (patches.length > MAX_FILES) throw new Error(`Too many patched files (max ${MAX_FILES})`);
  let total = 0;
  const seen = new Set();
  const normalized = patches.map((item) => {
    const rel = String(item?.path || "").replace(/\\/g, "/");
    if (!rel || path.posix.isAbsolute(rel) || rel.includes("..")) throw new Error(`Unsafe patch path: ${rel}`);
    if (DENY.some((rx) => rx.test(rel))) throw new Error(`Denied patch path: ${rel}`);
    if (seen.has(rel)) throw new Error(`Duplicate patch path: ${rel}`);
    seen.add(rel);
    const content = String(item?.content ?? "");
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > MAX_FILE_BYTES) throw new Error(`Patch file too large: ${rel}`);
    total += bytes;
    return { path: rel, content };
  });
  if (total > MAX_TOTAL_BYTES) throw new Error(`Total patch too large (max ${MAX_TOTAL_BYTES} bytes)`);
  return normalized;
}

function safeTestCommands(commands) {
  if (!Array.isArray(commands)) throw new Error("tests_to_run must be an array");
  if (commands.length > 8) throw new Error("Too many test commands");
  for (const command of commands) {
    if (!ALLOWED_TESTS.has(String(command))) throw new Error(`Test command is not allowlisted: ${command}`);
  }
  return commands.map(String);
}

async function runSandbox({ repoDir, patches, tests }) {
  const normalized = normalizePatch({ patches });
  const commands = safeTestCommands(tests || ["npm test"]);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-x18-") );
  try {
    await execFileAsync("git", ["-C", repoDir, "archive", "HEAD", "-o", path.join(temp, "source.tar")]);
    await execFileAsync("tar", ["-xf", path.join(temp, "source.tar"), "-C", temp]);
    for (const patch of normalized) {
      const target = path.join(temp, patch.path);
      const resolved = path.resolve(target);
      if (!resolved.startsWith(path.resolve(temp) + path.sep)) throw new Error(`Sandbox escape: ${patch.path}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, patch.content, "utf8");
    }
    const results = [];
    for (const command of commands) {
      const [bin, ...args] = command.split(" ");
      try {
        const result = await execFileAsync(bin, args, { cwd: temp, timeout: 120_000, maxBuffer: 2_000_000 });
        results.push({ command, ok: true, stdout: result.stdout.slice(-12000), stderr: result.stderr.slice(-12000) });
      } catch (error) {
        results.push({ command, ok: false, stdout: String(error.stdout || "").slice(-12000), stderr: String(error.stderr || error.message).slice(-12000) });
        return { ok: false, temp, results };
      }
    }
    return { ok: true, temp, results };
  } catch (error) {
    return { ok: false, temp, results: [], error: error.message };
  }
}

function repairBranchName(jobId) {
  const suffix = crypto.createHash("sha256").update(String(jobId)).digest("hex").slice(0, 12);
  return `repair/x18-${suffix}`;
}

module.exports = { normalizePatch, safeTestCommands, runSandbox, repairBranchName, ALLOWED_TESTS };
