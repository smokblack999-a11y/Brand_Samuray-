#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');

const token = process.env.GITHUB_TOKEN;
const repository = process.env.REPOSITORY;
const prNumber = Number(process.env.PR_NUMBER);

if (!token || !repository || !Number.isInteger(prNumber)) {
  throw new Error('Missing required GitHub environment');
}

const [owner, repo] = repository.split('/');
if (!owner || !repo) throw new Error('Invalid REPOSITORY');

const api = async (path) => {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'repoowl-kill-critic'
    }
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${body.slice(0, 500)}`);
  }
  return JSON.parse(body);
};

const criticalPath = (filename) => {
  return /(^|\/)(\.github\/workflows\/|auth|security|permissions|secrets?|iam|rbac|middleware|infra|deploy|docker|terraform|k8s|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)/i.test(filename);
};

const inspectPatch = (filename, patch) => {
  const findings = [];
  const added = patch
    .split('\n')
    .filter(line => line.startsWith('+') && !line.startsWith('+++'))
    .join('\n');

  const rules = [
    {
      code: 'COMMAND_INJECTION_PATTERN',
      severity: 'critical',
      re: /child_process|execSync\s*\(|spawnSync\s*\(|eval\s*\(|new Function\s*\(/i
    },
    {
      code: 'DYNAMIC_GITHUB_ACTION',
      severity: 'critical',
      re: /uses:\s*[^\s@]+@(main|master|latest|HEAD)\b/i
    },
    {
      code: 'PRIVILEGED_CHECKOUT',
      severity: 'critical',
      re: /pull_request_target|workflow_run[\s\S]{0,300}(actions\/checkout|git fetch|gh pr checkout)/i
    },
    {
      code: 'SECRET_IN_RUN_CONTEXT',
      severity: 'critical',
      re: /run:\s*[\s\S]{0,300}\$\{\{\s*github\.event\.[^}]+\.(body|title|message)\s*\}\}/i
    },
    {
      code: 'UNTRUSTED_PR_CHECKOUT',
      severity: 'critical',
      re: /ref:\s*\$\{\{\s*github\.event\.pull_request\.(head\.sha|merge_commit_sha)\s*\}\}/i
    },
    {
      code: 'CURL_PIPE_SHELL',
      severity: 'critical',
      re: /curl\s+[^\n|]*\|\s*(sh|bash)\b/i
    }
  ];

  for (const rule of rules) {
    if (rule.re.test(added)) {
      findings.push({ code: rule.code, severity: rule.severity, file: filename });
    }
  }

  return findings;
};

const pr = await api(`/repos/${owner}/${repo}/pulls/${prNumber}`);
const files = [];
for (let page = 1; page <= 10; page += 1) {
  const batch = await api(`/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`);
  files.push(...batch);
  if (batch.length < 100) break;
}

const findings = [];

for (const file of files) {
  const criticalPathFinding = criticalPath(file.filename);
  const patchFindings = inspectPatch(file.filename, file.patch || '');

  if (criticalPathFinding && !file.patch) {
    findings.push({
      code: 'CRITICAL_PATH_PATCH_UNAVAILABLE',
      severity: 'high',
      file: file.filename
    });
  }

  findings.push(...patchFindings);
}

const critical = findings.some(finding => finding.severity === 'critical');
const manualReview = findings.some(
  finding => finding.code === 'CRITICAL_PATH_PATCH_UNAVAILABLE'
);

const decision =
  critical ? 'BLOCK' :
  manualReview ? 'REVIEW' :
  'ALLOW';

const receipt = {
  schema: 'repoowl.kill-critic.receipt/v2',
  repository,
  pull_request: pr.number,
  base_sha: pr.base.sha,
  head_sha: pr.head.sha,
  findings,
  decision,
  timestamp: new Date().toISOString(),
  scanner_workflow_sha: process.env.WORKFLOW_SHA || null
};

const canonicalReceipt = JSON.stringify({
  schema: receipt.schema,
  repository: receipt.repository,
  pull_request: receipt.pull_request,
  base_sha: receipt.base_sha,
  head_sha: receipt.head_sha,
  findings: receipt.findings,
  decision: receipt.decision
});

receipt.receipt_sha256 = crypto
  .createHash('sha256')
  .update(canonicalReceipt)
  .digest('hex');

fs.writeFileSync(
  'kill-critic-receipt.json',
  JSON.stringify(receipt, null, 2) + '\n'
);

console.log(`KILL_CRITIC_DECISION=${decision}`);
console.log(`KILL_CRITIC_RECEIPT=${receipt.receipt_sha256}`);

if (decision === 'BLOCK') process.exitCode = 1;
else if (decision === 'REVIEW') process.exitCode = 1;
