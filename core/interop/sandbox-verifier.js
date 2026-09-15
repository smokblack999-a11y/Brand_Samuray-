"use strict";

const { spawn } = require("node:child_process");

const DEFAULT_TIMEOUT_MS = 120000;

function verifyCommand(command, args = [], options = {}) {
  if (!Array.isArray(args)) throw new TypeError("args must be an array");
  if (!command || typeof command !== "string") throw new TypeError("command is required");
  const timeoutMs = Math.max(1000, Math.min(Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS, 600000));
  const cwd = options.cwd;
  if (!cwd) throw new TypeError("sandbox cwd is required");

  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", error => {
      clearTimeout(timer);
      resolve({ passed: false, timedOut, exitCode: null, signal: null, stdout: stdout.slice(-12000), stderr: `${stderr}${error.message}`.slice(-12000) });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ passed: !timedOut && exitCode === 0, timedOut, exitCode, signal, stdout: stdout.slice(-12000), stderr: stderr.slice(-12000) });
    });
  });
}

function verificationGate(result) {
  return Boolean(result && result.passed === true && result.timedOut === false && result.exitCode === 0);
}

module.exports = { verifyCommand, verificationGate, DEFAULT_TIMEOUT_MS };
