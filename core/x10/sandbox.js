"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const DEFAULT_IMAGE = process.env.X10_SANDBOX_IMAGE || "node:22-bookworm-slim";
const DEFAULT_TIMEOUT_MS = Math.max(1000, Number(process.env.X10_SANDBOX_TIMEOUT_MS || 120000));
const DEFAULT_MEMORY = process.env.X10_SANDBOX_MEMORY || "512m";
const DEFAULT_CPUS = process.env.X10_SANDBOX_CPUS || "1";
const DEFAULT_PIDS = process.env.X10_SANDBOX_PIDS || "128";

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
      if (stdout.length > 200000) stdout = stdout.slice(-200000);
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
      if (stderr.length > 200000) stderr = stderr.slice(-200000);
    });

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, options.timeoutMs || DEFAULT_TIMEOUT_MS);

    child.on("error", reject);
    child.on("close", code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, killed });
    });
  });
}

async function execute({
  workspace,
  command,
  image = DEFAULT_IMAGE,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  memory = DEFAULT_MEMORY,
  cpus = DEFAULT_CPUS,
  pids = DEFAULT_PIDS
}) {
  if (!workspace || !path.isAbsolute(workspace)) throw new Error("sandbox_workspace_must_be_absolute");
  if (!command || typeof command !== "string") throw new Error("sandbox_command_required");
  if (!fs.existsSync(workspace)) throw new Error("sandbox_workspace_not_found");

  const runId = "run_" + crypto.randomUUID();

  const args = [
    "run", "--rm",
    "--network", "none",
    "--read-only",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--pids-limit", String(pids),
    "--memory", String(memory),
    "--cpus", String(cpus),
    "--mount", `type=bind,src=${workspace},dst=/workspace,rw`,
    "--workdir", "/workspace",
    image,
    "sh", "-lc", command
  ];

  const started = new Date().toISOString();
  let result;
  try {
    result = await run("docker", args, { timeoutMs });
  } catch (error) {
    return {
      run_id: runId,
      status: "FAILED",
      reason: "docker_unavailable",
      error: error.message,
      started_at: started,
      finished_at: new Date().toISOString()
    };
  }

  return {
    run_id: runId,
    status: result.killed ? "TIMEOUT" : result.code === 0 ? "PASSED" : "FAILED",
    exit_code: result.code,
    timed_out: result.killed,
    stdout: result.stdout,
    stderr: result.stderr,
    network_access: false,
    limits: {
      memory,
      cpus,
      pids,
      timeout_ms: timeoutMs
    },
    image,
    started_at: started,
    finished_at: new Date().toISOString()
  };
}

async function prepareWorkspace({ repositoryPath, commitSha, patch }) {
  if (!repositoryPath || !path.isAbsolute(repositoryPath)) {
    throw new Error("repository_path_must_be_absolute");
  }
  if (!/^[0-9a-f]{7,64}$/i.test(String(commitSha))) {
    throw new Error("invalid_commit_sha");
  }

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-x10-"));

  const clone = await run("git", [
    "clone", "--no-checkout", "--filter=blob:none",
    repositoryPath, workspace
  ], { timeoutMs: 120000 });

  if (clone.code !== 0) {
    fs.rmSync(workspace, { recursive: true, force: true });
    throw new Error("git_clone_failed:" + clone.stderr.slice(-2000));
  }

  const checkout = await run("git", ["checkout", "--detach", commitSha], {
    cwd: workspace,
    timeoutMs: 60000
  });
  if (checkout.code !== 0) {
    fs.rmSync(workspace, { recursive: true, force: true });
    throw new Error("git_checkout_failed:" + checkout.stderr.slice(-2000));
  }

  const patchFile = path.join(workspace, ".samurai-x10.patch");
  fs.writeFileSync(patchFile, String(patch || ""), { mode: 0o600 });

  const applied = await run("git", ["apply", "--check", patchFile], {
    cwd: workspace,
    timeoutMs: 30000
  });
  if (applied.code !== 0) {
    fs.rmSync(workspace, { recursive: true, force: true });
    throw new Error("patch_check_failed:" + applied.stderr.slice(-2000));
  }

  const apply = await run("git", ["apply", "--index", patchFile], {
    cwd: workspace,
    timeoutMs: 30000
  });
  if (apply.code !== 0) {
    fs.rmSync(workspace, { recursive: true, force: true });
    throw new Error("patch_apply_failed:" + apply.stderr.slice(-2000));
  }

  fs.rmSync(patchFile, { force: true });
  return workspace;
}

function cleanupWorkspace(workspace) {
  if (workspace) fs.rmSync(workspace, { recursive: true, force: true });
}

module.exports = {
  execute,
  prepareWorkspace,
  cleanupWorkspace
};
