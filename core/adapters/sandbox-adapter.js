"use strict";

function createSandboxAdapter({ run, allowCommands = [] } = {}) {
  if (typeof run !== "function") throw new TypeError("run is required");
  const allowed = new Set(allowCommands);

  return async function sandbox({ mission, plan, candidate }) {
    const commands = Array.isArray(candidate?.test_commands) ? candidate.test_commands : [];
    if (!commands.length) return { passed: false, reason: "no_test_commands" };
    if (commands.some(command => !allowed.has(command))) {
      return { passed: false, reason: "command_not_allowlisted" };
    }
    return run({ mission, plan, candidate, commands });
  };
}

module.exports = { createSandboxAdapter };
