"use strict";

function createGithubCiVerifier({ getStatus } = {}) {
  if (typeof getStatus !== "function") throw new TypeError("getStatus is required");

  return async function verify({ mission, execution }) {
    const status = await getStatus({ mission, execution });
    return {
      passed: status?.conclusion === "success" || status?.passed === true,
      status
    };
  };
}

module.exports = { createGithubCiVerifier };
