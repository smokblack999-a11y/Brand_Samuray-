"use strict";

function buildPrRequest(job,patch){
  if(!job?.source?.repo||!job?.source?.sha) throw new Error("job source repo/sha required");
  if(!patch?.branch||!patch?.title||!patch?.body) throw new Error("patch branch/title/body required");
  const files=Array.isArray(patch.files)?patch.files:[];
  return {
    repo:job.source.repo,
    baseSha:job.source.sha,
    branch:patch.branch,
    title:patch.title,
    body:patch.body,
    files:files.map(f=>({path:f.path,content:f.content,mode:f.mode||"100644"}))
  };
}

async function openRecoveryPr(adapter,job,patch){
  if(!adapter||typeof adapter.createBranch!=="function"||typeof adapter.createPullRequest!=="function")
    throw new Error("github adapter is not configured");
  const request=buildPrRequest(job,patch);
  const branch=await adapter.createBranch(request);
  const pr=await adapter.createPullRequest({...request,branchResult:branch});
  return {branch,pr};
}

module.exports={buildPrRequest,openRecoveryPr};
