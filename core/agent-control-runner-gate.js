"use strict";

function rejectUnverifiedEvidence(req, res) {
  return res.status(503).json({
    ok: false,
    error: {
      code: "TRUSTED_RUNNER_ADAPTER_NOT_CONFIGURED",
      message: "NEXUS sandbox, CI, and proof transitions are disabled until signed runner evidence is integrated.",
      requestId: req.requestId || null
    }
  });
}

module.exports = { rejectUnverifiedEvidence };
