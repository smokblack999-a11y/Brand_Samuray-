"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;

function commandSpec(command) {
  if (!Array.isArray(command) || command.length === 0) {
    throw new Error("command must be a non-empty argv array");
  }
  return command.map(String);
}

function runCommand(command, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS, maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES } = {}) {
  const argv = commandSpec(command);
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env: {
        PATH: process.env.PATH || "",
        HOME: process.env.HOME || "",
        CI: "1",
        NEXUS_SANDBOX: "1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const append = (current, chunk) => {
      const next = current + chunk.toString("utf8");
      return next.length > maxOutputBytes ? next.slice(-maxOutputBytes) : next;
    };

    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        command: argv,
        code: timedOut ? 124 : code,
        signal: signal || null,
        timedOut,
        stdout,
        stderr,
        passed: !timedOut && code === 0
      });
    });
  });
}

async function runSandbox({
  workspace,
  commands,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES
} = {}) {
  if (!workspace) throw new Error("workspace is required");
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new Error("commands are required");
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-sandbox-"));
  const checkout = path.join(root, "workspace");
  await fs.cp(workspace, checkout, {
    recursive: true,
    force: true,
    filter: (source) => {
      const normalized = source.replaceAll("\\", "/");
      return !normalized.includes("/.git/") &&
        !normalized.endsWith("/.git") &&
        !normalized.includes("/node_modules/");
    }
  });

  const results = [];
  try {
    for (const command of commands) {
      const result = await runCommand(command, {
        cwd: checkout,
        timeoutMs,
        maxOutputBytes
      });
      results.push(result);
      if (!result.passed) break;
    }

    return {
      passed: results.length === commands.length && results.every((r) => r.passed),
      workspace: checkout,
      commands: results
    };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

module.exports = { runSandbox, runCommand };