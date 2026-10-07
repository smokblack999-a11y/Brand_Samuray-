"use strict";

const FILE_SCOPE = Object.freeze({
  authentication: /(?:^|\/)(auth|authentication|token|session)(?:\/|$)|(?:^|\/)[^/]*(auth|token|session)[^/]*\.(js|ts|go|py|java|kt)$/i,
  authorization: /(?:^|\/)(acl|rbac|permissions?|authorization)(?:\/|$)|(?:^|\/)[^/]*(permission|role|rbac|acl)[^/]*\.(js|ts|go|py|java|kt)$/i,
  billing: /(?:^|\/)(billing|payments?|checkout|invoices?)(?:\/|$)|(?:^|\/)[^/]*(billing|payment|invoice)[^/]*\.(js|ts|go|py|java|kt)$/i,
  security: /(?:^|\/)(security|crypto|tls|secrets?)(?:\/|$)|(?:^|\/)[^/]*(crypto|tls|secret|security)[^/]*\.(js|ts|go|py|java|kt)$/i,
  ci: /^\.github\/workflows\//i,
  tests: /(?:^|\/)(test|tests|__tests__)(?:\/|$)|(?:^|\/)[^/]+\.test\.[^/]+$/i
});

const INTENT_WORDS = Object.freeze({
  authentication: /\b(login|log in|authentication|auth|token|session)\b/i,
  authorization: /\b(permission|permissions|authorization|rbac|role|access control)\b/i,
  billing: /\b(billing|payment|payments|invoice|checkout)\b/i,
  security: /\b(security|crypto|cryptography|tls|secret|secrets)\b/i,
  ci: /\b(ci|workflow|pipeline|build|lint)\b/i,
  tests: /\b(test|tests|testing|spec|assertion)\b/i
});

function scopesFromText(text) {
  const source = String(text || "");
  return Object.keys(INTENT_WORDS).filter(scope => INTENT_WORDS[scope].test(source));
}

function scopesFromFiles(files) {
  const normalized = (Array.isArray(files) ? files : []).map(x => String(x).replace(/^\.\//, "").replace(/\\/g, "/").trim()).filter(Boolean);
  return {
    files: normalized,
    scopes: Object.keys(FILE_SCOPE).filter(scope => normalized.some(file => FILE_SCOPE[scope].test(file)))
  };
}

function analyze({intent, changedFiles = []} = {}) {
  const declared = scopesFromText(intent);
  const observed = scopesFromFiles(changedFiles).scopes;
  const undeclared = observed.filter(scope => !declared.includes(scope) && scope !== "tests");
  const taskEmpty = declared.length === 0;
  const actionEmpty = observed.length === 0;
  const mismatch = taskEmpty || undeclared.length > 0;
  return {
    declaredScopes: declared,
    observedScopes: observed,
    undeclaredScopes: undeclared,
    taskEmpty,
    actionEmpty,
    mismatch,
    decision: mismatch ? "BLOCK" : "ALLOW",
    reason: taskEmpty ? "declared_intent_unrecognized" : undeclared.length ? "action_scope_exceeds_intent" : "intent_action_scope_match"
  };
}

module.exports = { scopesFromText, scopesFromFiles, analyze };
