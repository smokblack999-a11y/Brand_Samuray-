const fs = require('node:fs');
const path = require('node:path');
const policy = require('./policy.json');

function inspect({ files = [], testsPassed = false, failureSignature = '', patchLines = 0 }) {
  const violations = [];
  const blocked = files.filter(file => policy.blockedPaths.some(pattern => {
    if (pattern.startsWith('*')) return file.endsWith(pattern.slice(1));
    return file === pattern || file.startsWith(`${pattern}/`);
  }));

  if (policy.killCritic.rejectIfTestsMissing && !testsPassed) violations.push('tests_missing_or_failed');
  if (policy.killCritic.rejectIfSecretsTouched && blocked.length) violations.push(`sensitive_files:${blocked.join(',')}`);
  if (policy.killCritic.rejectIfScopeExpands && files.length > policy.riskRules.maxChangedFiles) violations.push('too_many_changed_files');
  if (patchLines > policy.riskRules.maxChangedLines) violations.push('too_many_changed_lines');
  if (!failureSignature) violations.push('missing_failure_signature');

  return {
    verdict: violations.length ? 'REJECT' : 'PASS',
    violations,
    constraints: {
      autoMerge: false,
      autoDeploy: false,
      humanApprovalRequired: true
    }
  };
}

if (require.main === module) {
  const input = JSON.parse(fs.readFileSync(process.argv[2] || path.join(process.cwd(), 'kill-critic-input.json'), 'utf8'));
  process.stdout.write(`${JSON.stringify(inspect(input), null, 2)}\n`);
}

module.exports = { inspect };
