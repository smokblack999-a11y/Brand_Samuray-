"use strict";

const REQUIRED=["patchApplied","sandboxPassed","testsPassed","ciPassed"];

function evaluate(input={}){
  const failed=REQUIRED.filter(k=>input[k]!==true);
  const filesChanged=Array.isArray(input.filesChanged)?input.filesChanged:[];
  const maxFilesChanged=Number(input.maxFilesChanged||10);
  const attempts=Number(input.attempts||0);
  const maxAttempts=Number(input.maxAttempts||3);
  const runtimeSeconds=Number(input.runtimeSeconds||0);
  const maxRuntimeSeconds=Number(input.maxRuntimeSeconds||900);

  if(attempts>maxAttempts||runtimeSeconds>maxRuntimeSeconds)
    return {decision:"frozen",reason:"recovery_budget_exceeded",failed};

  if(filesChanged.length>maxFilesChanged)
    return {decision:"human_review",reason:"too_many_files_changed",failed};

  if(input.regressionDetected===true)
    return {decision:"retryable",reason:"regression_detected",failed};

  if(input.patchApplied===true&&input.sandboxPassed!==true)
    return {decision:"retryable",reason:"sandbox_failed",failed};

  if(input.sandboxPassed===true&&input.testsPassed!==true)
    return {decision:"retryable",reason:"tests_failed",failed};

  if(input.ciVerified!==true)
    return {decision:"human_review",reason:"ci_not_independently_verified",failed:["ciPassed"]};

  if(failed.length===0)
    return {decision:"recovered",reason:"independent_verification_passed",failed:[]};

  return {decision:"human_review",reason:"verification_incomplete",failed};
}

module.exports={REQUIRED,evaluate};
