"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { validateIncident, policyFor, evaluateTransition } = require("./control-plane");

const DATA_DIR = process.env.X10_DATA_DIR || path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "state.json");

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) {
    fs.writeFileSync(FILE, JSON.stringify({
      killSwitch: false,
      incidents: {},
      ledger: []
    }, null, 2) + "\n", { mode: 0o600 });
  }
}

function read() {
  ensure();
  return JSON.parse(fs.readFileSync(FILE, "utf8"));
}

function write(state) {
  ensure();
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

function now() {
  return new Date().toISOString();
}

function createIncident(input) {
  validateIncident(input);
  const state = read();
  if (state.incidents[input.incident_id]) return state.incidents[input.incident_id];

  const incident = {
    incident_id: input.incident_id,
    event_id: input.event_id,
    repository: input.repository,
    commit_sha: input.commit_sha,
    failure_fingerprint: input.failure_fingerprint,
    state: "DETECTED",
    risk: input.risk || "HIGH",
    attempt: Number.isInteger(input.attempt) ? input.attempt : 1,
    max_attempts: Number.isInteger(input.max_attempts) ? input.max_attempts : 3,
    policy: policyFor({ risk: input.risk || "HIGH", repository: input.repository }),
    proposal: null,
    sandbox: null,
    critics: {},
    proof: null,
    created_at: now(),
    updated_at: now()
  };

  state.incidents[incident.incident_id] = incident;
  state.ledger.push({
    ledger_id: crypto.randomUUID(),
    incident_id: incident.incident_id,
    from_state: null,
    to_state: "DETECTED",
    actor: "IncidentStore",
    reason: "incident_created",
    created_at: now()
  });
  write(state);
  return incident;
}

function getIncident(id) {
  return read().incidents[id] || null;
}

function listIncidents() {
  return Object.values(read().incidents).sort((a, b) =>
    String(b.updated_at).localeCompare(String(a.updated_at))
  );
}

function transition(id, toState, actor, reason, payload = {}) {
  const state = read();
  const incident = state.incidents[id];
  if (!incident) throw new Error("incident_not_found");

  const decision = evaluateTransition({
    incident,
    toState,
    actor,
    reason,
    killSwitch: state.killSwitch
  });

  if (decision.decision !== "ALLOW") {
    return decision;
  }

  const fromState = incident.state;
  incident.state = toState;
  if (payload.proposal !== undefined) incident.proposal = payload.proposal;
  if (payload.sandbox !== undefined) incident.sandbox = payload.sandbox;
  if (payload.critics !== undefined) incident.critics = payload.critics;
  if (payload.proof !== undefined) incident.proof = payload.proof;
  incident.updated_at = now();

  state.ledger.push({
    ledger_id: crypto.randomUUID(),
    incident_id: id,
    from_state: fromState,
    to_state: toState,
    actor: actor || "ControlPlane",
    reason: reason || "state_transition",
    created_at: now()
  });
  write(state);
  return {
    decision: "ALLOW",
    incident,
    transition_hash: decision.transition_hash
  };
}

function setKillSwitch(active, actor = "KillSwitch", reason = "manual") {
  const state = read();
  state.killSwitch = Boolean(active);

  if (state.killSwitch) {
    for (const incident of Object.values(state.incidents)) {
      if ([
        "SANDBOX_RUNNING",
        "SANDBOX_PENDING",
        "POLICY_CHECKING",
        "PROPOSING_PATCH",
        "RECALLING_PATTERNS"
      ].includes(incident.state)) {
        const from = incident.state;
        incident.state = "HUMAN_APPROVAL_REQUIRED";
        incident.updated_at = now();
        state.ledger.push({
          ledger_id: crypto.randomUUID(),
          incident_id: incident.incident_id,
          from_state: from,
          to_state: "HUMAN_APPROVAL_REQUIRED",
          actor,
          reason: "kill_switch:" + reason,
          created_at: now()
        });
      }
    }
  }

  write(state);
  return {
    active: state.killSwitch,
    updated_at: now()
  };
}

function isKilled() {
  return Boolean(read().killSwitch);
}

function ledger(incidentId) {
  return read().ledger.filter(x => x.incident_id === incidentId);
}

module.exports = {
  createIncident,
  getIncident,
  listIncidents,
  transition,
  setKillSwitch,
  isKilled,
  ledger
};
