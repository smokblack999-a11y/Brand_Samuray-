"use strict";

const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const express = require("express");
const { createRateLimiter } = require("./rate-limit");

const MAX_SOURCE_BYTES = 64 * 1024;
const MAX_CONTRACT_BYTES = 32 * 1024;
const MAX_WORKER_INPUT_BYTES = 112 * 1024;
const MAX_WORKER_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_WORKER_TIMEOUT_MS = 25000;
const DEFAULT_SANDBOX_IMAGE = "python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b";

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
       "SOURCE_REQUIRED", "VERSION_INVALID", "ACTION_INVALID", "REQUEST_INVALID",
       "SOURCE_VALIDATION_FAILED", "RUN_FUNCTION_COUNT_INVALID", "ASYNC_RUN_NOT_SUPPORTED",
       "TOP_LEVEL_EXECUTION", "STAR_IMPORT_FORBIDDEN", "IMPORT_TIME_DECORATOR",
       "IMPORT_TIME_DEFAULT_CALL", "IMPORT_TIME_ANNOTATION_CALL",
       "FORBIDDEN_DYNAMIC_OR_IO_CALL", "FORBIDDEN_OS_PROCESS_CALL",
       "FORBIDDEN_PROCESS_EXIT", "FORBIDDEN_DYNAMIC_IMPORT",
       "FORBIDDEN_DYNAMIC_EXECUTION", "FORBIDDEN_PATH_WRITE",
       "CONTRACT_INVALID", "CONTRACT_CASES_REQUIRED", "CONTRACT_CASE_LIMIT",
       "CONTRACT_CASE_INVALID", "RUN_INPUT_REQUIRED", "RUN_INPUT_INVALID"].includes(code) || code.startsWith("SOURCE_")) return 400;
  if (code === "CONTRACT_TOO_LARGE" || code === "RUN_INPUT_TOO_LARGE" || code === "REQUEST_TOO_LARGE" || code === "MODULE_OUTPUT_TOO_LARGE") return 413;
  if (code === "MODULE_OUTPUT_INVALID") return 502;
  if (["MODULE_ALREADY_EXISTS", "MODULE_HASH_MISMATCH", "MODULE_REVIEW_REQUIRED", "NO_PREVIOUS_VERSION",
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
    if (input.length > MAX_WORKER_INPUT_BYTES) {
      return Promise.reject(new FactoryBridgeError("REQUEST_TOO_LARGE", 413));
    }

    return new Promise((resolve, reject) => {
      const child = spawn(python, [workerPath], {
        cwd: __dirname,
        env: {
          PATH: process.env.PATH || "",
          HOME: process.env.HOME || "",
          TMPDIR: process.env.TMPDIR || process.env.TMP || "/tmp",
          LANG: process.env.LANG || "C.UTF-8",
          LC_ALL: process.env.LC_ALL || "",
          LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH || "",
          SAMURAI_FACTORY_ROOT: root,
          SAMURAI_FACTORY_IMAGE: process.env.SAMURAI_FACTORY_IMAGE || DEFAULT_SANDBOX_IMAGE
        },
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
  const env = options.env || process.env;
  const run = options.spawnSync || spawnSync;
  const python = options.python || env.SOFTWARE_FACTORY_PYTHON || "python3";
  const pythonCheck = run(python, ["-c", "import sys; assert sys.version_info >= (3, 10)"], {
    encoding: "utf8", timeout: 5000, stdio: ["ignore", "ignore", "ignore"]
  });
  if (pythonCheck.error || pythonCheck.status !== 0) {
    throw new Error("Software Factory is enabled but Python 3.10+ is unavailable");
  }
  const dockerCheck = run("docker", ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8", timeout: 7000, stdio: ["ignore", "ignore", "ignore"]
  });
  if (dockerCheck.error || dockerCheck.status !== 0 || !String(dockerCheck.stdout || "").trim()) {
    throw new Error("Software Factory is enabled but the Docker daemon is unavailable");
  }
  const image = env.SAMURAI_FACTORY_IMAGE || DEFAULT_SANDBOX_IMAGE;
  if (!/^[^@\s]+@sha256:[0-9a-f]{64}$/.test(image)) {
    throw new Error("Software Factory requires a digest-pinned SAMURAI_FACTORY_IMAGE");
  }
  const imageCheck = run("docker", ["image", "inspect", image], {
    encoding: "utf8", timeout: 7000, stdio: ["ignore", "ignore", "ignore"]
  });
  if (imageCheck.error || imageCheck.status !== 0) {
    throw new Error("Software Factory sandbox image is not preloaded; pull the configured digest before starting Core");
  }
}

function validateHttpContract(contract) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract) ||
      Object.keys(contract).length !== 1 || !Array.isArray(contract.cases)) {
    const error = new Error("CONTRACT_INVALID");
    error.code = error.message;
    throw error;
  }
  if (contract.cases.length === 0) {
    const error = new Error("CONTRACT_CASES_REQUIRED");
    error.code = error.message;
    throw error;
  }
  if (contract.cases.length > 20) {
    const error = new Error("CONTRACT_CASE_LIMIT");
    error.code = error.message;
    throw error;
  }
  for (const testCase of contract.cases) {
    if (!testCase || typeof testCase !== "object" || Array.isArray(testCase) ||
        Object.keys(testCase).length !== 2 ||
        !Object.hasOwn(testCase, "input") || !Object.hasOwn(testCase, "expected")) {
      const error = new Error("CONTRACT_CASE_INVALID");
      error.code = error.message;
      throw error;
    }
  }
  let encoded;
  try {
    encoded = Buffer.from(JSON.stringify(contract), "utf8");
  } catch (_error) {
    const error = new Error("CONTRACT_INVALID");
    error.code = error.message;
    throw error;
  }
  if (encoded.length > MAX_CONTRACT_BYTES) {
    const error = new Error("CONTRACT_TOO_LARGE");
    error.code = error.message;
    error.status = 413;
    throw error;
  }
  return JSON.parse(encoded.toString("utf8"));
}

function validateHttpInput(value) {
  let encoded;
  try {
    encoded = Buffer.from(JSON.stringify(value), "utf8");
  } catch (_error) {
    const error = new Error("RUN_INPUT_INVALID");
    error.code = error.message;
    throw error;
  }
  if (encoded.length > MAX_CONTRACT_BYTES) {
    const error = new Error("RUN_INPUT_TOO_LARGE");
    error.code = error.message;
    error.status = 413;
    throw error;
  }
  return JSON.parse(encoded.toString("utf8"));
}

function createSoftwareFactoryRouter(options = {}) {
  if (typeof options.requireApiKey !== "function") throw new TypeError("requireApiKey middleware is required");
  const runWorker = options.runWorker || createFactoryBridge(options);
  const router = express.Router();
  router.use(options.requireApiKey);
  router.use(createRateLimiter({ windowMs: 60_000, max: 10 }));

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
    let contract;
    if (req.body.contract !== undefined) {
      try {
        contract = validateHttpContract(req.body.contract);
      } catch (error) {
        return res.status(error.status || 400).json({
          ok: false,
          error: { code: error.code || "CONTRACT_INVALID", message: "test contract is invalid", requestId: req.requestId }
        });
      }
    }
    return dispatch(req, res, { action: "create", name, source, ...(contract ? { contract } : {}) }, 201);
  });
  router.post("/modules/:name/promote", (req, res) => {
    const source = req.body?.source;
    if (typeof source !== "string") {
      return res.status(400).json({ ok: false, error: { code: "SOURCE_REQUIRED", message: "source is required", requestId: req.requestId } });
    }
    if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
      return res.status(413).json({ ok: false, error: { code: "SOURCE_TOO_LARGE", message: "source exceeds 64 KiB", requestId: req.requestId } });
    }
    let contract;
    if (req.body?.contract !== undefined) {
      try {
        contract = validateHttpContract(req.body.contract);
      } catch (error) {
        return res.status(error.status || 400).json({
          ok: false,
          error: { code: error.code || "CONTRACT_INVALID", message: "test contract is invalid", requestId: req.requestId }
        });
      }
    }
    return dispatch(req, res, { action: "promote", name: req.params.name, source, ...(contract ? { contract } : {}) });
  });
  router.post("/modules/:name/rollback", (req, res) => {
    const version = req.body?.version;
    if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) {
      return res.status(400).json({ ok: false, error: { code: "VERSION_INVALID", message: "version must be a positive integer", requestId: req.requestId } });
    }
    return dispatch(req, res, { action: "rollback", name: req.params.name, version });
  });
  router.post("/modules/:name/run", (req, res) => {
    const body = req.body || {};
    if (!Object.hasOwn(body, "input")) {
      return res.status(400).json({
        ok: false,
        error: { code: "RUN_INPUT_REQUIRED", message: "input is required", requestId: req.requestId }
      });
    }
    let input;
    try {
      input = validateHttpInput(body.input);
    } catch (error) {
      return res.status(error.status || 400).json({
        ok: false,
        error: { code: error.code || "RUN_INPUT_INVALID", message: "module input is invalid", requestId: req.requestId }
      });
    }
    return dispatch(req, res, { action: "run", name: req.params.name, input });
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
  statusForCode,
  validateHttpContract
};
