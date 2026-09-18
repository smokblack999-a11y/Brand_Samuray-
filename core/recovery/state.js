"use strict";

const STATES = Object.freeze([
  "queued","running","retryable","failed","human_review","recovered","frozen"
]);

const TERMINAL_STATES = new Set(["recovered","failed","human_review","frozen"]);

const TRANSITIONS = {
  queued: new Set(["running","frozen"]),
  running: new Set(["retryable","failed","human_review","recovered","frozen"]),
  retryable: new Set(["running","human_review","frozen"]),
  failed: new Set(["running","human_review","frozen"]),
  human_review: new Set(["running","frozen"]),
  recovered: new Set([]),
  frozen: new Set([])
};

function assertState(state) {
  if (!STATES.includes(state)) throw new Error(`Invalid recovery state: ${state}`);
  return state;
}

function canTransition(from, to) {
  assertState(from); assertState(to);
  return TRANSITIONS[from].has(to);
}

function transition(job, to, patch = {}) {
  const from = assertState(job.status);
  if (!canTransition(from, to)) throw new Error(`Invalid recovery transition: ${from} -> ${to}`);
  return { ...job, ...patch, status: to, updatedAt: new Date().toISOString() };
}

function isTerminal(state) {
  return TERMINAL_STATES.has(assertState(state));
}

module.exports = { STATES, TERMINAL_STATES, TRANSITIONS, assertState, canTransition, transition, isTerminal };
