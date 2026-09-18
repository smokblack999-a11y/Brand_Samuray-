"use strict";

const RULES = [
  { id:"dependency_error", patterns:[/npm ERR!.*(ERESOLVE|notarget|peer dep|could not resolve)/i,/yarn.*(resolution|dependency)/i], action:"inspect_package_manifests_and_lockfile" },
  { id:"test_failure", patterns:[/(FAIL|AssertionError|expected .* to|test failed)/i,/(npm test|node --test).*failed/i], action:"inspect_failing_test_and_nearest_source" },
  { id:"syntax_error", patterns:[/(SyntaxError|Unexpected token|Unexpected identifier)/i], action:"inspect_reported_file_and_syntax" },
  { id:"timeout", patterns:[/(timed out|timeout|exceeded.*time limit)/i], action:"inspect_long_running_step_and_external_waits" },
  { id:"auth_error", patterns:[/(401|403|unauthorized|forbidden|authentication failed)/i], action:"inspect_non_secret_auth_configuration_and_permissions" },
  { id:"network_error", patterns:[/(ECONNRESET|ECONNREFUSED|ETIMEDOUT|network error|fetch failed)/i], action:"inspect_endpoint_and_retry_policy" },
  { id:"out_of_memory", patterns:[/(out of memory|heap out of memory|JavaScript heap)/i], action:"inspect_memory_growth_and_process_limits" },
  { id:"docker_error", patterns:[/(docker.*(failed|error)|container.*failed)/i], action:"inspect_image_build_and_runtime_context" },
  { id:"merge_conflict", patterns:[/(CONFLICT|merge conflict|unmerged paths)/i], action:"inspect_conflicted_files_and_base_sha" },
  { id:"disk_full", patterns:[/(no space left on device|disk full|ENOSPC)/i], action:"inspect_workspace_and_artifact_usage" }
];

function flattenEvidence(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenEvidence).join("\n");
  if (typeof value === "object") return Object.entries(value).map(([k,v]) => k+"="+flattenEvidence(v)).join("\n");
  return String(value);
}

function diagnose(failure={}, evidence=[]) {
  const text=flattenEvidence({failure,evidence});
  const matches=[];
  for (const rule of RULES) {
    const hits=rule.patterns.filter(re=>re.test(text)).length;
    if (hits) matches.push({id:rule.id,score:hits,action:rule.action});
  }
  matches.sort((a,b)=>b.score-a.score || a.id.localeCompare(b.id));
  const hypotheses=(matches.length?matches:[{id:"generic",score:0,action:"collect_more_ci_evidence"}])
    .slice(0,3)
    .map((x,i)=>({rank:i+1,type:x.id,confidence:x.score?Math.min(0.95,0.5+0.2*x.score):0.2,action:x.action,status:"unverified"}));
  return {hypotheses, evidenceTextLength:text.length};
}

module.exports={RULES,diagnose,flattenEvidence};
