import hashlib
import json
import re

CRITICAL = {
    "authentication": re.compile(r"(?:^|/)auth(?:/|$)", re.I),
    "cryptography": re.compile(r"(?:^|/)crypto(?:/|$)", re.I),
    "tls": re.compile(r"(?:^|/)tls(?:/|$)", re.I),
    "acl": re.compile(r"(?:^|/)acl(?:/|$)", re.I),
    "policy": re.compile(r"(?:^|/)policy(?:/|$)", re.I),
    "github_actions": re.compile(r"^\.github/workflows/", re.I),
    "docker": re.compile(r"(?:^|/)Dockerfile(?:\.|$)", re.I),
    "tests": re.compile(r"(?:^|/)[^/]+\.test\.[^/]+$", re.I),
    "tests_convention": re.compile(r"(?:^|/)[^/]*_test\.[^/]+$", re.I),
    "dependencies": re.compile(r"(?:^|/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|go\.mod|go\.sum|Cargo\.toml|Cargo\.lock|requirements\.txt|poetry\.lock)$", re.I),
    "infrastructure": re.compile(r"(?:^|/)(terraform|k8s|kubernetes|helm|charts)(?:/|$)", re.I),
    "configuration": re.compile(r"(?:^|/)(config|configs|settings|\.env\.example)(?:/|$)|(?:^|/)[^/]*config[^/]*\.(json|ya?ml|toml)$", re.I),
    "api_surface": re.compile(r"(?:^|/)(routes?|controllers?|handlers?|openapi|swagger)(?:/|$)", re.I),
    "database": re.compile(r"(?:^|/)(migrations?|schema|db)(?:/|$)|(?:^|/)[^/]*(migration|schema)[^/]*\.sql$", re.I),
}
DANGEROUS = {
    "recursive_delete": re.compile(r"\brm\s+-rf(?:\s|$)", re.I),
    "world_writable": re.compile(r"\bchmod\s+777\b", re.I),
    "privileged_container": re.compile(r"\bprivileged\s*:\s*true\b", re.I),
    "privilege_escalation": re.compile(r"\b(?:sudo|su)\s+", re.I),
}

def evaluate(files, diff, from_state, to_state, resource):
    files = sorted({str(x).replace("\\","/").lstrip("./") for x in (files or []) if str(x).strip()})
    categories = [name for name, rx in CRITICAL.items() if any(rx.search(f) for f in files)]
    if len(files) >= 20:
        categories.append("large_change")

    added = "\n".join(line for line in str(diff or "").splitlines()
                       if line.startswith("+") and not line.startswith("+++"))
    findings = [name for name, rx in DANGEROUS.items() if rx.search(added)]
    workflow_expr = "$" + "{" + "{"
    if workflow_expr in added and "github.event" in added:
        findings.append("workflow_command_injection")

    criticality = "HIGH" if categories else "NORMAL"
    allowed = {
        "DETECTED": {"RECALLING_PATTERNS","PROPOSING_PATCH","AUTONOMY_KILLED","FAILED_RECOVERY"},
        "RECALLING_PATTERNS": {"PROPOSING_PATCH","FAILED_RECOVERY","AUTONOMY_KILLED"},
        "PROPOSING_PATCH": {"POLICY_CHECKING","REJECTED","FAILED_RECOVERY","AUTONOMY_KILLED"},
        "POLICY_CHECKING": {"SANDBOX_PENDING","HUMAN_APPROVAL_REQUIRED","REJECTED","FAILED_RECOVERY","AUTONOMY_KILLED"},
        "SANDBOX_PENDING": {"SANDBOX_RUNNING","SANDBOX_CANCELLED","FAILED_RECOVERY","AUTONOMY_KILLED"},
        "SANDBOX_RUNNING": {"SANDBOX_VERIFIED","SANDBOX_CANCELLED","FAILED_RECOVERY","AUTONOMY_KILLED"},
        "SANDBOX_VERIFIED": {"CRITIC_EVALUATION","FAILED_RECOVERY","AUTONOMY_KILLED"},
        "CRITIC_EVALUATION": {"PROOF_GENERATION","REJECTED","HUMAN_APPROVAL_REQUIRED","FAILED_RECOVERY","AUTONOMY_KILLED"},
        "PROOF_GENERATION": {"HUMAN_APPROVAL_REQUIRED","PR_CREATING","FAILED_RECOVERY","AUTONOMY_KILLED"},
        "HUMAN_APPROVAL_REQUIRED": {"PR_CREATING","REJECTED","AUTONOMY_KILLED"},
        "PR_CREATING": {"CI_PENDING","FAILED_RECOVERY","AUTONOMY_KILLED"},
        "CI_PENDING": {"RESOLVED","FAILED_RECOVERY","AUTONOMY_KILLED"},
    }
    reasons = []
    if not resource: reasons.append("resource_identity_missing")
    if to_state not in allowed.get(from_state, set()): reasons.append("invalid_state_transition")
    if findings: reasons.append("dangerous_change_pattern")

    evaluation = {
        "decision": "BLOCK" if reasons else "ALLOW",
        "resource": resource,
        "from_state": from_state,
        "to_state": to_state,
        "criticality": criticality,
        "categories": sorted(set(categories)),
        "changed_files": files,
        "required_checks": sorted(set(["sandbox","ci","proof_receipt"] if criticality=="HIGH" else [])),
        "reasons": sorted(set(reasons)),
        "dangerous_findings": sorted(set(findings)),
        "policy_version": "x10-policy-v1",
    }
    evaluation["evaluation_hash"] = hashlib.sha256(
        json.dumps(evaluation, sort_keys=True, separators=(",",":")).encode()
    ).hexdigest()
    return evaluation
