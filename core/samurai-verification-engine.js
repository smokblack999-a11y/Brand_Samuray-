"use strict";

const crypto = require("node:crypto");

const FAILURE_TAXONOMY = Object.freeze([
  "MISSED_REQUIREMENT",
  "INTEGRATION_ERROR",
  "REGRESSION",
  "WRONG_LOGIC",
  "SYNTAX_ERROR",
  "WRONG_FILE",
  "UNVERIFIED_ASSUMPTION",
  "KNOWLEDGE_GAP",
  "MISUNDERSTOOD_TASK",
  "TRIAL_INCOMPLETE",
  "API_FAILURE"
]);

function text(v, max=2000){ return String(v == null ? "" : v).trim().slice(0,max); }
function hash(v){ return crypto.createHash("sha256").update(String(v)).digest("hex").slice(0,24); }

function normalizeRequirements(requirements=[]){
  return requirements.map((r,i)=>({
    id:text(r.id || `REQ-${i+1}`,128),
    mandatory:r.mandatory !== false,
    behavior:text(r.behavior || r.observableBehavior || "",1000),
    acceptance:text(r.acceptance || r.acceptanceCriteria || "",1000),
    evidenceRequired:r.evidenceRequired !== false,
    tests:Array.isArray(r.tests) ? r.tests.map(t=>text(t,512)).filter(Boolean) : []
  }));
}

function buildContract(input={}){
  const requirements=normalizeRequirements(input.requirements || []);
  if(!requirements.length) throw Object.assign(new Error("verification contract requires at least one requirement"),{code:"CONTRACT_EMPTY"});
  return {
    contractId:text(input.contractId || "contract_"+hash(JSON.stringify(requirements)),128),
    task:text(input.task || "",2000),
    requirements,
    risk:text(input.risk || "medium",64).toLowerCase(),
    acceptanceMode:text(input.acceptanceMode || "behavioral",64)
  };
}

function runRequirementCoverage(contract, evidence=[]){
  const byReq=new Map();
  for(const e of evidence){
    const id=text(e.requirementId || e.id,128);
    if(!id) continue;
    byReq.set(id,{...e,requirementId:id});
  }
  const results=contract.requirements.map(r=>{
    const e=byReq.get(r.id);
    const verified=Boolean(e && e.passed && (!r.evidenceRequired || text(e.evidence,4000)));
    return {requirementId:r.id,mandatory:r.mandatory,verified,evidence:text(e?.evidence || "",4000),reason:verified?"EVIDENCE_PRESENT":"MISSING_OR_FAILED_EVIDENCE"};
  });
  const missingMandatory=results.filter(x=>x.mandatory && !x.verified);
  return {passed:missingMandatory.length===0,results,missingMandatory};
}

async function runBehavioralVerification(contract, evidence=[], verifier){
  if(typeof verifier !== "function") return {passed:false,executed:false,reason:"VERIFIER_NOT_PROVIDED",results:[]};
  const results=[];
  for(const r of contract.requirements){
    if(!r.mandatory && !r.tests.length) continue;
    try{
      const result=await verifier({requirement:r,contract});
      results.push({
        requirementId:r.id,
        passed:Boolean(result?.passed),
        evidence:text(result?.evidence || "",4000),
        observed:text(result?.observed || "",2000)
      });
    }catch(error){
      results.push({requirementId:r.id,passed:false,evidence:"",observed:"",error:text(error.message,1000)});
    }
  }
  return {passed:results.every(x=>x.passed),executed:true,results};
}

function runRegression(results=[]){
  const normalized=results.map(r=>({name:text(r.name || r.test || "",256),passed:Boolean(r.passed)}));
  return {passed:normalized.length>0 && normalized.every(x=>x.passed),results:normalized};
}

function classifyFailure(input={}){
  const s=(text(input.error || input.reason || input.observed || "")+" "+text(input.stage || "")).toLowerCase();
  if(/syntax|parse/.test(s)) return "SYNTAX_ERROR";
  if(/regression|existing test|previously passing/.test(s)) return "REGRESSION";
  if(/integration|connection|dependency/.test(s)) return "INTEGRATION_ERROR";
  if(/api|http|timeout|rate limit/.test(s)) return "API_FAILURE";
  if(/wrong file|wrong path/.test(s)) return "WRONG_FILE";
  if(/assumption|unverified/.test(s)) return "UNVERIFIED_ASSUMPTION";
  if(/requirement|acceptance|missing behavior/.test(s)) return "MISSED_REQUIREMENT";
  if(/logic|expected .* got|calculation/.test(s)) return "WRONG_LOGIC";
  if(/understand|misunderstood/.test(s)) return "MISUNDERSTOOD_TASK";
  return "TRIAL_INCOMPLETE";
}

function critiqueTrajectory(trajectory=[], contract){
  const actions=Array.isArray(trajectory)?trajectory:[];
  const joined=JSON.stringify(actions).toLowerCase();
  const findings=[];
  for(const r of contract.requirements){
    if(r.mandatory && !joined.includes(r.id.toLowerCase())){
      findings.push({type:"UNVERIFIED_ASSUMPTION",requirementId:r.id,message:"Requirement is absent from the recorded trajectory."});
    }
  }
  if(!actions.some(a=>/test|verify|check/i.test(text(a?.action || a?.type || a)))){
    findings.push({type:"TRIAL_INCOMPLETE",message:"No explicit verification action is present."});
  }
  return {passed:findings.length===0,findings};
}

async function verify(input={}){
  const contract=buildContract(input);
  const behavioral=await runBehavioralVerification(contract,input.evidence,input.verifier);
  const coverage=runRequirementCoverage(contract,[
    ...(input.evidence || []),
    ...behavioral.results.map(r=>({requirementId:r.requirementId,passed:r.passed,evidence:r.evidence}))
  ]);
  const regression=runRegression(input.regressionResults || []);
  const trajectory=critiqueTrajectory(input.trajectory || [],contract);
  const failures=[];
  for(const x of coverage.missingMandatory) failures.push({type:"MISSED_REQUIREMENT",requirementId:x.requirementId});
  for(const x of behavioral.results.filter(r=>!r.passed)) failures.push({type:classifyFailure({stage:"behavioral verification",reason:x.error || "behavior failed"}),requirementId:x.requirementId});
  if(!regression.passed) failures.push({type:"REGRESSION"});
  failures.push(...trajectory.findings);
  const passed=coverage.passed && behavioral.passed && regression.passed && trajectory.passed;
  return {
    passed,
    contract,
    gates:{coverage,behavioral,regression,trajectory},
    failures,
    mergeDecision:passed?"ALLOW":"BLOCK",
    evidenceId:"verify_"+hash(JSON.stringify({contract,coverage,behavioral,regression,trajectory}))
  };
}

module.exports={FAILURE_TAXONOMY,buildContract,runRequirementCoverage,runBehavioralVerification,runRegression,classifyFailure,critiqueTrajectory,verify};
