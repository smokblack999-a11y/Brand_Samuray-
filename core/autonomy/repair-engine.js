const DEFAULT_POLICY = require('./policy.json');

function normalizeLines(value = '') {
  return String(value).replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean);
}

function signature(log = '') {
  const lines = normalizeLines(log);
  const candidates = lines.filter(line => /error|fail|exception|fatal|timeout|enoent|eaddr|assert/i.test(line));
  return (candidates[0] || lines[lines.length - 1] || 'unknown_failure').slice(0, 300);
}

function blockedPath(path, policy = DEFAULT_POLICY) {
  return policy.blockedPaths.some(pattern => {
    if (pattern === path) return true;
    if (pattern.startsWith('*')) return path.endsWith(pattern.slice(1));
    return path === pattern || path.startsWith(`${pattern}/`);
  });
}

function planRepair({ log = '', changedFiles = [], testsPassed = false, reproduction = null, policy = DEFAULT_POLICY }) {
  const failureSignature = signature(log);
  const blocked = changedFiles.filter(file => blockedPath(file, policy));
  const tooManyFiles = changedFiles.length > policy.riskRules.maxChangedFiles;
  const hasEvidence = Boolean(failureSignature && failureSignature !== 'unknown_failure');
  const reproducible = reproduction === true;

  const reasons = [];
  if (!hasEvidence) reasons.push('missing_failure_signature');
  if (!testsPassed) reasons.push('tests_not_passing');
  if (!reproducible) reasons.push('failure_not_reproduced');
  if (blocked.length) reasons.push(`blocked_paths:${blocked.join(',')}`);
  if (tooManyFiles) reasons.push('scope_too_large');

  const verdict = reasons.length === 0 ? 'REPAIR_CANDIDATE' : 'HUMAN_REVIEW';

  return {
    version: '1.0.0',
    verdict,
    failureSignature,
    evidence: {
      reproducible,
      testsPassed,
      changedFiles,
      blockedPaths: blocked
    },
    reasons,
    nextAction: verdict === 'REPAIR_CANDIDATE'
      ? 'generate_minimal_patch_then_run_kill_critic'
      : 'collect_missing_evidence_and_stop',
    safety: {
      autoMerge: false,
      autoDeploy: false,
      autoPatch: false
    }
  };
}

module.exports = { planRepair, signature, blockedPath };
