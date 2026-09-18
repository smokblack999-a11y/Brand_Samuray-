"use strict";

const recovery=require("./index");
const {applyPatch}=require("./patch-executor");
const {createSandbox,verifyWorkspace,cleanupSandbox}=require("./sandbox");
const {createGitHubAdapter,recoveryBranchName}=require("./github-adapter");
const {evaluatePatch}=require("./policy");
const {sandboxConfig,assertProductionSandbox}=require("./sandbox-policy");

function resolveTestOptions(result,options={}){
  return {
    command: result?.testCommand || options.testCommand || "npm",
    args: Array.isArray(result?.testArgs) ? result.testArgs : (Array.isArray(options.testArgs) ? options.testArgs : ["test"]),
    timeoutMs: Number(result?.testTimeoutMs || options.testTimeoutMs || 120000)
  };
}

async function processJob(id,executor,options={}){
  let job=recovery.startJob(id);
  const started=Date.now();
  let sandbox=null;

  try{
    job=recovery.diagnoseJob(id);
    const result=await executor(job);

    if(!result?.ok) throw new Error(result?.error || "recovery executor did not produce an executable patch");
    if(!result?.patch?.files?.length) throw new Error("recovery executor did not produce patch files");

    const sourceDir=result.sourceDir || options.sourceDir;
    if(!sourceDir) throw new Error("sourceDir is required for sandbox verification");

    const policy=evaluatePatch(result.patch.files,job.budget);
    recovery.recordAction(id,{type:"kill_critic_policy",policy});
    if(!policy.allow) return recovery.updateJob(id,{status:policy.decision,lastDecision:policy});
    const sandboxOptions=assertProductionSandbox(sandboxConfig(options.sandbox||{}));
    sandbox=await createSandbox(sourceDir);
    const applied=applyPatch(sandbox,result.patch,job.budget);
    const test=await verifyWorkspace(sandbox,{...resolveTestOptions(result,options),sandboxOptions});

    recovery.recordAction(id,{
      type:"recovery_execution",
      result:{
        ok:true,
        hypothesis:result.hypothesis||null,
        filesChanged:applied.filesChanged,
        sandbox:{workspace:sandbox,ok:test.ok,code:test.code,timedOut:test.timedOut},
        test:{ok:test.ok,code:test.code,timedOut:test.timedOut}
      }
    });

    const runtimeSeconds=Math.ceil((Date.now()-started)/1000);
    if(runtimeSeconds>job.budget.maxRuntimeSeconds){
      return recovery.updateJob(id,{status:"frozen",lastDecision:{decision:"frozen",reason:"recovery_budget_exceeded"}});
    }

    if(!test.ok){
      const verification={
        patchApplied:true,
        sandboxPassed:false,
        testsPassed:false,
        ciPassed:false,
        ciVerified:false,
        regressionDetected:false,
        filesChanged:applied.filesChanged,
        runtimeSeconds
      };
      return {job:recovery.gate(id,verification),verification,test};
    }

    const adapter=options.githubAdapter || createGitHubAdapter(options.github||{});
    const branch=recoveryBranchName(id,job.attempts);
    const patch={...result.patch,branch};
    const request={
      repo:job.source.repo,
      baseSha:job.source.sha,
      branch,
      files:patch.files,
      message:patch.commitMessage || patch.title || "fix(recovery): apply verified recovery patch",
      maxFilesChanged:job.budget.maxFilesChanged
    };

    await adapter.createBranch({repo:request.repo,branch,baseSha:request.baseSha});
    const commit=await adapter.applyPatchAndCreateCommit(request);
    await adapter.updateBranch({repo:request.repo,branch,commitSha:commit.commitSha});
    const pr=await adapter.createPullRequest({
      repo:request.repo,
      branch,
      title:patch.title || "fix(recovery): verified recovery patch",
      body:patch.body || "Automated recovery patch; CI verification required before recovery is accepted.",
      baseBranch:patch.baseBranch || "main",
      draft:patch.draft !== false
    });

    const recoveryMeta={
      branch,
      commitSha:commit.commitSha,
      treeSha:commit.treeSha,
      prNumber:pr?.number!=null?String(pr.number):null,
      prUrl:pr?.html_url||pr?.url||null
    };

    const verification={
      patchApplied:true,
      sandboxPassed:true,
      testsPassed:true,
      ciPassed:false,
      ciVerified:false,
      regressionDetected:false,
      filesChanged:applied.filesChanged,
      runtimeSeconds
    };

    const updated=recovery.updateJob(id,{
      recovery:{...(job.recovery||{}),...recoveryMeta},
      verification,
      lastDecision:{decision:"awaiting_ci",reason:"sandbox_and_tests_passed"}
    });

    recovery.recordAction(id,{type:"recovery_pr_created",recovery:recoveryMeta});
    return {job:recovery.getJob(id)||updated,verification,commit,pr};
  }catch(error){
    return recovery.updateJob(id,{status:"retryable",lastError:String(error?.message||error)});
  }finally{
    if(sandbox) cleanupSandbox(sandbox);
  }
}

module.exports={processJob,resolveTestOptions};
