"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { validateUnifiedDiff } = require("./patch-candidate");

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 120000;
const MAX_OUTPUT_BYTES = 50000;
const SAFE_COMMANDS = new Set(["node", "npm", "npx"]);

function commandParts(command) {
  if (Array.isArray(command)) return command.map(String);
  const value = String(command || "").trim();
  if (!value) throw new TypeError("verification command is required");
  return value.split(/\s+/);
}

function validateCommand(command) {
  const parts = commandParts(command);
  const executable = path.basename(parts[0]);
  if (!SAFE_COMMANDS.has(executable)) throw new Error(`sandbox command is not allowed: ${executable}`);
  if (parts.some(part => /(?:^|\/)\.\.(?:\/|$)/.test(part))) throw new Error("sandbox command contains an unsafe path");
  return parts;
}

async function copyWorkspace(source, target) {
  await fs.cp(source, target, {
    recursive: true,
    force: true,
    filter: (entry) => !entry.includes(`${path.sep}.git${path.sep}`) && !entry.endsWith(`${path.sep}.git`)
  });
}

async function runSandbox(options = {}) {
  const source = path.resolve(String(options.workspace || ""));
  if (!source || source === path.parse(source).root) throw new TypeError("workspace is required");
  const command = validateCommand(options.command || ["npm", "test"]);
  const timeoutMs = Math.max(1000, Math.min(Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS));
  const patch = options.patch ? validateUnifiedDiff(options.patch) : null;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "samurai-sandbox-"));
  const sandboxDir = path.join(tempRoot, "workspace");

  try {
    await copyWorkspace(source, sandboxDir);
    if (patch) {
      await execFileAsync("git", ["apply", "--check", "--whitespace=error-all", "-"], {
        cwd: sandboxDir,
        input: patch.diff,
        maxBuffer: MAX_OUTPUT_BYTES
      }).catch(error => {
        throw new Error(`PATCH_CHECK_FAILED: ${String(error?.stderr || error?.message || error).slice(0, 1000)}`);
      });
      await execFileAsync("git", ["apply", "--whitespace=error-all", "-"], {
        cwd: sandboxDir,
        input: patch.diff,
        maxBuffer: MAX_OUTPUT_BYTES
      });
    }

    const result = await execFileAsync(command[0], command.slice(1), {
      cwd: sandboxDir,
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT_BYTES,
      env: {
        ...process.env,
        CI: "1",
        GIT_TERMINAL_PROMPT: "0",
        npm_config_audit: "false",
        npm_config_fund: "false"
      }
    }).then(value => ({ ok: true, code: 0, stdout: String(value.stdout || "").slice(0, MAX_OUTPUT_BYTES), stderr: String(value.stderr || "").slice(0, MAX_OUTPUT_BYTES) }))
      .catch(error => ({ ok: false, code: Number.isInteger(error?.code) ? error.code : null, signal: error?.signal || null, stdout: String(error?.stdout || "").slice(0, MAX_OUTPUT_BYTES), stderr: String(error?.stderr || error?.message || "").slice(0, MAX_OUTPUT_BYTES) }));

    return {
      verified: result.ok,
      command,
      patchApplied: Boolean(patch),
      isolated: true,
      networkPolicy: "process-level network access not guaranteed; production runner must enforce OS/container egress policy",
      result
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

module.exports = { runSandbox, validateCommand, commandParts };
