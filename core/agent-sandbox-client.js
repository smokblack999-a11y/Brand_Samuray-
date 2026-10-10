"use strict";

function sandboxUrl() {
  const value = String(process.env.X10THINK_SANDBOX_URL || "").trim();
  if (!value) {
    const error = new Error("X10THINK_SANDBOX_NOT_CONFIGURED");
    error.code = "X10THINK_SANDBOX_NOT_CONFIGURED";
    throw error;
  }
  return value.replace(/\/$/, "");
}

async function reproduceRepair(input = {}) {
  const {
    runId,
    incidentId,
    repository,
    commitSha,
    patchDiff,
    workspacePath,
    testCommand
  } = input;
  if (!runId || !incidentId || !repository || !commitSha || !patchDiff || !workspacePath) {
    const error = new Error("SANDBOX_REPRODUCTION_INPUT_MISSING");
    error.code = "SANDBOX_REPRODUCTION_INPUT_MISSING";
    throw error;
  }

  const apiToken = String(process.env.SANDBOX_API_TOKEN || "").trim();
  if (!apiToken) {
    const error = new Error("X10THINK_SANDBOX_API_TOKEN_MISSING");
    error.code = "X10THINK_SANDBOX_API_TOKEN_MISSING";
    throw error;
  }

  const response = await fetch(sandboxUrl() + "/v1/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiToken
    },
    body: JSON.stringify({
      run_id: String(runId),
      incident_id: String(incidentId),
      repository: String(repository),
      commit_sha: String(commitSha),
      patch_diff: String(patchDiff),
      workspace_path: String(workspacePath),
      test_command: testCommand ? String(testCommand) : null
    })
  });

  const raw = await response.text().catch(() => "");
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch {}

  if (!response.ok) {
    const error = new Error("sandbox_http_" + response.status);
    error.code = "SANDBOX_HTTP_ERROR";
    error.status = response.status;
    error.detail = raw.slice(0, 500);
    throw error;
  }

  if (!payload || !["PASSED", "FAILED"].includes(String(payload.status))) {
    const error = new Error("SANDBOX_INVALID_RESULT");
    error.code = "SANDBOX_INVALID_RESULT";
    throw error;
  }

  return {
    runId: String(payload.run_id || runId),
    status: String(payload.status),
    passed: payload.status === "PASSED",
    exitCode: Number.isInteger(payload.exit_code) ? payload.exit_code : null,
    timeout: payload.timeout === true,
    patchSha256: payload.patch_sha256 || null,
    environmentHash: payload.environment_hash || null,
    networkAccess: payload.network_access === false ? false : payload.network_access,
    resourceLimits: payload.resource_limits || null,
    stdout: String(payload.stdout || "").slice(-20000),
    stderr: String(payload.stderr || "").slice(-20000),
    commitSha: String(commitSha)
  };
}

module.exports = { reproduceRepair };
