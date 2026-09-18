"use strict";
const REQUIRED=["patchApplied","sandboxPassed","testsPassed","ciPassed"];
function evaluate(input={}){const failed=REQUIRED.filter(k=>input[k]!==true),filesChanged=Array.isArray(input.filesChanged)?input.filesChanged:[],maxFilesChanged=Number(input.maxFilesChanged||10),attempts=Number(input.attempts||0),maxAttempts=Number(input.maxAttempts||3),runtimeSeconds=Number(input.runtimeSeconds||0),maxRuntimeSeconds=Number(input.maxRuntimeSeconds||900);
if(attempts>maxAttempts||runtimeSeconds>maxRuntimeSeconds)return {decision:"frozen",reason:"recovery_budget_exceeded",failed};
if(filesChanged.length>maxFilesChanged)return {decision:"human_review",reason:"too_many_files_changed",failed};
if(input.regressionDetected===true)return {decision:"retryable",reason:"regression_detected",failed};
if(failed.length===0)return {decision:"recovered",reason:"independent_verification_passed",failed:[]};
if(input.patchApplied===true&&input.sandboxPassed!==true)return {decision:"retryable",reason:"sandbox_failed",failed};
return {decision:"human_review",reason:"verification_incomplete",failed}}
module.exports={REQUIRED,evaluate};
