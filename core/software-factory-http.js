"use strict";

const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const express = require("express");

const MAX_SOURCE_BYTES = 64 * 1024;
const MAX_WORKER_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_WORKER_TIMEOUT_MS = 25000;

class FactoryBridgeError extends Error {
  constructor(code, status = 500) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function statusForCode(code) {
  if (["UNAUTHORIZED", "AUTH_NOT_CONFIGURED"].includes(code)) return 401;
  if (["INVALID_MODULE_NAME", "SOURCE_SYNTAX_INVALID", "SOURCE_SIZE_INVALID",
       "SOURCE_REQUIRED", "VERSION_INVALID", "ACTION_INVALID", "REQUEST_INVALID"].includes(code)) return 400;
  if (["MODULE_ALREADY_EXISTS", "MODULE_HASH_MISMATCH", "NO_PREVIOUS_VERSION",
       "TARGET_VERSION_INVALID", "ACTIVE_MODULE_MISSING_OR_INVALID"].includes(code)) return 409;
  if (["MODULE_NOT_REGISTERED", "ORDER_NOT_FOUND"].includes(code)) return 404;
  if (code.startsWith("SANDBOX_") || code === "DOCKER_SANDBOX_UNAVAILABLE" ||
      code === "WORKER_UNAVAILABLE" || code === "WORKER_TIMEOUT") return 503;
  return 500;
}

function createFactoryBridge(options = {}) {
  const python = options.python || process.env.SOFTWARE_FACTORY_PYTHON || "python3";
  const workerPath = path.join(__dirname, "software_factory_x10", "worker.py");
  const dataDir = process.env.DATA_DIR || path.join(__dirname, "data");
  const root = path.resolve(__dirname, options.root || process.env.SOFTWARE_FACTORY_ROOT || path.join(dataDir, "software-factory-x10"));
  const timeoutMs = Math.max(5000, Math.min(Number(options.timeoutMs || DEFAULT_WORKER_TIMEOUT_MS), 60000));

  return function runFactoryWorker(payload) {
    const input = Buffer.from(JSON.stringify(payload), "utf8");
    if (input.length > 96 * 1024) {
      return Promise.reject(new FactoryBridgeError("REQUEST_TOO_LARGE", 413));
    }

    return new Promise((resolve, reject) => {
      const child = spawn(python, [workerPath], {
        cwd: __dirname,
        env: { ...process.env, SAMURAI_FACTORY_ROOT: root },
        shell: false,
        stdio: ["pipe", "pipe", "ignore"]
      });
      let output = Buffer.alloc(0);
      let settled = false;
      const finishError = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finishError(new FactoryBridgeError("WORKER_TIMEOUT", 503));
      }, timeoutMs);
      timer.unref?.();

      child.stdout.on("data", chunk => {
        if (settled) return;
        output = Buffer.concat([output, chunk]);
        if (output.length > MAX_WORKER_OUTPUT_BYTES) {
          child.kill("SIGKILL");
          finishError(new FactoryBridgeError("WORKER_OUTPUT_TOO_LARGE", 502));
        }
      });
      child.stdin.on("error", () => {});
      child.on("error", () => finishError(new FactoryBridgeError("WORKER_UNAVAILABLE", 503)));
      child.on("close", code => {
        if (settled) return;
        clearTimeout(timer);
        let response;
        try {
          response = JSON.parse(output.toString("utf8"));
        } catch (_error) {
          finishError(new FactoryBridgeError("WORKER_RESPONSE_INVALID", 502));
          return;
        }
        if (code !== 0 || !response?.ok) {
          const errorCode = String(response?.error?.code || "FACTORY_OPERATION_FAILED");
          finishError(new FactoryBridgeError(errorCode, statusForCode(errorCode)));
          return;
        }
        settled = true;
        resolve(response.result);
      });
      child.stdin.end(input);
    });
  };
}

function assertFactoryWorkerReady(options = {}) {
  const python = options.python || process.env.SOFTWARE_FACTORY_PYTHON || "python3";
  const pythonCheck = spawnSync(python, ["-c", "import sys; assert sys.version_info >= (3, 10)"], {
    encoding: "utf8", timeout: 5000, stdio: ["ignore", "ignore", "ignore"]
  });
  if (pythonCheck.error || pythonCheck.status !== 0) {
    throw new Error("Software Factory is enabled but Python 3.10+ is unavailable");
  }
  const dockerCheck = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8", timeout: 7000, stdio: ["ignore", "ignore", "ignore"]
  });
  if (dockerCheck.error || dockerCheck.status !== 0 || !String(dockerCheck.stdout || "").trim()) {
    throw new Error("Software Factory is enabled but the Docker daemon is unavailable");
  }
}

function createSoftwareFactoryRouter(options = {}) {
  if (typeof options.requireApiKey !== "function") throw new TypeError("requireApiKey middleware is required");
  const runWorker = options.runWorker || createFactoryBridge(options);
  const router = express.Router();
  router.use(options.requireApiKey);

  async function dispatch(req, res, payload, successStatus = 200) {
    try {
      const result = await runWorker(payload);
      return res.status(successStatus).json({ ok: true, ...result, requestId: req.requestId });
    } catch (error) {
      const code = error instanceof FactoryBridgeError ? error.code : "FACTORY_OPERATION_FAILED";
      const status = error instanceof FactoryBridgeError ? error.status : 500;
      return res.status(status).json({
        ok: false,
        error: { code, message: "Software Factory operation failed", requestId: req.requestId }
      });
    }
  }

  router.get("/modules", (req, res) => dispatch(req, res, { action: "list" }));
  router.post("/modules", (req, res) => {
    const { name, source } = req.body || {};
    if (typeof name !== "string" || typeof source !== "string") {
      return res.status(400).json({ ok: false, error: { code: "NAME_AND_SOURCE_REQUIRED", message: "name and source are required", requestId: req.requestId } });
    }
    if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
      return res.status(413).json({ ok: false, error: { code: "SOURCE_TOO_LARGE", message: "source exceeds 64 KiB", requestId: req.requestId } });
    }
    return dispatch(req, res, { action: "create", name, source }, 201);
  });
  router.post("/modules/:name/promote", (req, res) => {
    const source = req.body?.source;
    if (typeof source !== "string") {
      return res.status(400).json({ ok: false, error: { code: "SOURCE_REQUIRED", message: "source is required", requestId: req.requestId } });
    }
    if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
      return res.status(413).json({ ok: false, error: { code: "SOURCE_TOO_LARGE", message: "source exceeds 64 KiB", requestId: req.requestId } });
    }
    return dispatch(req, res, { action: "promote", name: req.params.name, source });
  });
  router.post("/modules/:name/rollback", (req, res) => {
    const version = req.body?.version;
    if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) {
      return res.status(400).json({ ok: false, error: { code: "VERSION_INVALID", message: "version must be a positive integer", requestId: req.requestId } });
    }
    return dispatch(req, res, { action: "rollback", name: req.params.name, version });
  });
  router.delete("/modules/:name", (req, res) =>
    dispatch(req, res, { action: "destroy", name: req.params.name })
  );

  return router;
}

module.exports = {
  FactoryBridgeError,
  assertFactoryWorkerReady,
  createFactoryBridge,
  createSoftwareFactoryRouter,
  statusForCode
};
