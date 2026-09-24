"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { list, update } = require("./recovery-store");
const { transition, STATES } = require("./x10thinc/recovery-state");
const { validateUnifiedDiff } = require("./interop/patch-candidate");
const { sha256 } = require("./x10thinc/kill-critic");

const exec = promisify(execFile);
const POLL_MS = Math.max(1000, Number(process.env.RECOVERY_POLL_MS || 5000));
const REPO_DIR = path.resolve(process.env.RECOVERY_REPO_DIR || path.join(__dirname, ".."));
const BASE_BRANCH = String(process.env.RECOVERY_BASE_BRANCH || "main");
const AUTO_PR = String(process.env.RECOVERY_AUTO_PR || "").toLowerCase() === "true";
const TEST_COMMAND = parseCommand(process.env.RECOVERY_TEST_COMMAND, ["npm", "test", "--prefix", "core"]);
const GITHUB_TOKEN = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "");

function parseCommand(value, fallback) {
  if (!value) return fallback;
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.length || parsed.some(x => typeof x !== "string")) throw new Error("RECOVERY_TEST_COMMAND must be a JSON array");
  return parsed;
}
async function git(args, cwd) {
  const auth = GITHUB_TOKEN && ["fetch","push"].includes(args[0])
    ? ["-c", "http.extraheader=AUTHORIZATION: bearer " + GITHUB_TOKEN] : [];
  return exec("git", [...auth, ...args], {cwd, timeout:120000, maxBuffer:4*1024*1024});
}
async function run(cmd,cwd) {
  return exec(cmd[0],cmd.slice(1),{cwd,timeout:10*60*1000,maxBuffer:8*1024*1024});
}
async function cleanup(wt) {
  try { await git(["worktree","remove","--force",wt],REPO_DIR); } catch {}
  try { fs.rmSync(wt,{recursive:true,force:true}); } catch {}
}
async function createDraftPr(cwd, branchName) {
  if (!GITHUB_TOKEN) throw new Error("GITHUB_TOKEN_REQUIRED_FOR_AUTO_PR");
  const remote=String((await git(["remote","get-url","origin"],cwd)).stdout||"").trim();
  const m=remote.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/i);
  if(!m) throw new Error("GITHUB_ORIGIN_NOT_RESOLVED");
  const body=JSON.stringify({
    title:"fix: automated X10THINC recovery",
    head:branchName, base:BASE_BRANCH, draft:true,
    body:"Automated recovery proposal. Kill Critic remains the trust gate; merge is not automated."
  });
  const r=await exec("curl",["-fsS","--connect-timeout","5","--max-time","30","-X","POST",
    `https://api.github.com/repos/${m[1]}/${m[2]}/pulls`,
    "-H","Accept: application/vnd.github+json","-H","Authorization: Bearer "+GITHUB_TOKEN,
    "-H","X-GitHub-Api-Version: 2022-11-28","-H","Content-Type: application/json","--data-binary",body],
    {cwd,timeout:60000,maxBuffer:1024*1024});
  return JSON.parse(String(r.stdout||"{}"));
}

async function processJob(job) {
  if (job.status !== "sandbox_pending" || !job.patch?.diff) return false;
  if (Number(job.attempts || 0) >= Number(job.maxAttempts || 3)) {
    update(job.id,{status:"human_review",state:STATES.HUMAN_REVIEW,workerError:"RECOVERY_ATTEMPT_BUDGET_EXCEEDED"});
    return true;
  }
  const validation=validateUnifiedDiff(job.patch.diff);
  const worktree=fs.mkdtempSync(path.join(os.tmpdir(),"x10think-recovery-"));
  const patchFile=path.join(worktree,"recovery.patch");
  try {
    update(job.id,{attempts:Number(job.attempts||0)+1});
    await git(["worktree","add","--detach",worktree,job.headSha || BASE_BRANCH],REPO_DIR);

    let baselinePassed=false;
    try { await run(TEST_COMMAND,worktree); baselinePassed=true; } catch {}
    if (baselinePassed) {
      update(job.id,{status:"stopped",state:STATES.FROZEN,workerError:"BASELINE_DID_NOT_REPRODUCE"});
      return true;
    }

    fs.writeFileSync(patchFile,validation.diff,"utf8");
    await git(["apply","--check",patchFile],worktree);
    await git(["apply","--whitespace=error",patchFile],worktree);
    await git(["diff","--check"],worktree);

    let testPassed=false, testEvidence={};
    try {
      const r=await run(TEST_COMMAND,worktree);
      testPassed=true; testEvidence={pass:true,exitCode:0,stdout:String(r.stdout||"").slice(-12000),stderr:String(r.stderr||"").slice(-12000)};
    } catch(error) {
      testEvidence={pass:false,exitCode:Number.isInteger(error.code)?error.code:1,stdout:String(error.stdout||"").slice(-12000),stderr:String(error.stderr||error.message||"").slice(-12000)};
    }
    if(!testPassed){
      update(job.id,{status:"retryable",state:STATES.RETRYABLE,sandbox:{pass:false,test:testEvidence},workerError:"SANDBOX_TESTS_FAILED"});
      return true;
    }

    await git(["switch","-c",`recovery/${job.id}`],worktree);
    await git(["add","--all"],worktree);
    await git(["commit","-m",`fix: X10THINC recovery ${job.id}`],worktree);
    const repairHeadSha=String((await git(["rev-parse","HEAD"],worktree)).stdout||"").trim();
    let prUrl=null;
    if(AUTO_PR){
      await git(["push","-u","origin",`recovery/${job.id}`],worktree);
      const pr=await createDraftPr(worktree,`recovery/${job.id}`);
      prUrl=String(pr.html_url||"").trim()||null;
    }

    const next=transition(
      {...job,state:STATES.SANDBOXED,headSha:repairHeadSha,diffHash:job.diffHash||sha256(job.patch.diff)},
      STATES.PR_READY,{});
    if(!next.ok) throw new Error(next.code);
    update(job.id,{
      status:"pr_ready",state:STATES.PR_READY,repairBranch:`recovery/${job.id}`,
      repairHeadSha,prUrl,sandbox:{pass:true,test:testEvidence,files:validation.files},
      proofReady:false
    });
    return true;
  } catch(error) {
    update(job.id,{status:"human_review",state:STATES.HUMAN_REVIEW,workerError:String(error?.message||error)});
    return true;
  } finally { await cleanup(worktree); }
}

async function tick() {
  for(const job of list(100)) {
    try { await processJob(job); } catch(error) {
      update(job.id,{status:"human_review",state:STATES.HUMAN_REVIEW,workerError:String(error?.message||error)});
    }
  }
}
if(require.main===module){
  console.log(JSON.stringify({event:"x10think_recovery_worker_started",repo:REPO_DIR,pollMs:POLL_MS,autoPr:AUTO_PR}));
  let busy=false;
  const loop=async()=>{if(busy)return;busy=true;try{await tick()}finally{busy=false}};
  loop(); setInterval(loop,POLL_MS);
}
module.exports={processJob,tick};