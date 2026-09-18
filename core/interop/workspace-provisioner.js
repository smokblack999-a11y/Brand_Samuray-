"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const GITHUB_HOST = "github.com";
const DEFAULT_TIMEOUT_MS = 120000;

function parseRepository(value) {
  const raw = String(value || "").trim();
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(raw);
  if (!match) throw new TypeError("repository must be owner/name");
  return { owner: match[1], name: match[2] };
}

function validateSha(value) {
  const sha = String(value || "").trim();
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new TypeError("exact 40-character commit SHA is required");
  return sha;
}

function githubUrl(repository) {
  const { owner, name } = parseRepository(repository);
  return `https://${GITHUB_HOST}/${owner}/${name}.git`;
}

function runGit(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("git command timed out"));
    }, Math.max(1000, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)));
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`git exited ${code}: ${stderr.trim().slice(0, 500)}`));
      resolve({ stdout, stderr });
    });
  });
}

function gitEnv(token) {
  const env = { ...process.env };
  if (!token) return env;
  const auth = Buffer.from(`x-access-token:${token}`).toString("base64");
  const count = Number(env.GIT_CONFIG_COUNT || 0);
  env.GIT_CONFIG_COUNT = String(count + 1);
  env[`GIT_CONFIG_KEY_${count}`] = `http.https://${GITHUB_HOST}/.extraheader`;
  env[`GIT_CONFIG_VALUE_${count}`] = `AUTHORIZATION: basic ${auth}`;
  return env;
}

async function provisionWorkspace(options = {}) {
  const repository = String(options.repository || "").trim();
  const sha = validateSha(options.headSha || options.commitSha);
  parseRepository(repository);
  const token = String(options.githubToken || process.env.GITHUB_TOKEN || "").trim();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "samurai-interop-"));
  await fs.chmod(root, 0o700);
  const repoDir = path.join(root, "repo");

  try {
    await runGit(["init", "--quiet", repoDir], { env: gitEnv(token), timeoutMs: options.timeoutMs });
    await runGit(["-C", repoDir, "remote", "add", "origin", githubUrl(repository)], { env: gitEnv(token), timeoutMs: options.timeoutMs });
    await runGit(["-C", repoDir, "-c", "fetch.prune=true", "fetch", "--depth=1", "origin", sha], {
      env: gitEnv(token), timeoutMs: options.timeoutMs
    });
    await runGit(["-C", repoDir, "checkout", "--detach", "--quiet", sha], {
      env: gitEnv(token), timeoutMs: options.timeoutMs
    });
    const verified = await runGit(["-C", repoDir, "rev-parse", "HEAD"], {
      env: gitEnv(token), timeoutMs: options.timeoutMs
    });
    if (verified.stdout.trim().toLowerCase() !== sha.toLowerCase()) {
      throw new Error("workspace HEAD does not match requested commit SHA");
    }
    return {
      workspace: repoDir,
      headSha: sha,
      repository,
      isolated: true,
      cleanup: async () => fs.rm(root, { recursive: true, force: true })
    };
  } catch (error) {
    await fs.rm(root, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { provisionWorkspace, parseRepository, validateSha, githubUrl, runGit };
