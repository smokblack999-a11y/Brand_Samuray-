"use strict";

const SAFE_ACTIONS = new Set([
  "inspect_package_manifests_and_lockfile",
  "inspect_failing_test_and_nearest_source",
  "inspect_reported_file_and_syntax",
  "inspect_long_running_step_and_external_waits",
  "inspect_non_secret_auth_configuration_and_permissions",
  "inspect_endpoint_and_retry_policy",
  "inspect_memory_growth_and_process_limits",
  "inspect_image_build_and_runtime_context",
  "inspect_conflicted_files_and_base_sha",
  "inspect_workspace_and_artifact_usage",
  "collect_more_ci_evidence"
]);

function buildPatchPlan(hypotheses=[], budget={}) {
  const maxFiles=Number(budget.maxFilesChanged||10);
  const selected=hypotheses.filter(h=>SAFE_ACTIONS.has(h.action)).slice(0,3);
  return selected.map((h,index)=>({
    attempt:index+1,
    hypothesis:h.type,
    objective:h.action,
    maxFilesChanged:maxFiles,
    requiresSandbox:true,
    requiresTests:true,
    requiresCi:true,
    status:"planned"
  }));
}

module.exports={SAFE_ACTIONS,buildPatchPlan};
