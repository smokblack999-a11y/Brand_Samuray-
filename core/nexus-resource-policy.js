"use strict";

const crypto = require("crypto");

const STATES = Object.freeze([
  "UNKNOWN","CI_FAILED","REPAIR_PROPOSED","SANDBOX_PASSED",
  "CI_PASSED","READY_FOR_REVIEW","BLOCKED"
]);

const CRITICAL_PATHS = Object.freeze([
  /^auth\//i,/^crypto\//i,/^tls\//i,/^acl\//i,/^policy\//i,
  /^\.github\/workflows\//i,/^Dockerfile(?:\.|$)/i,
  /(?:^|\/)[^/]+\.test\.[^/]+$/i,/(?:^|\/)[^/]*_test\.[^/]+$/i
]);

const DANGEROUS_PATTERNS = Object.freeze([
  /\brm\s+-rf\b/i,/\bchmod\s+777\b/i,
  /\bprivileged\s*:\s*true\b/i,/\bset-user-ID\b/i,/\b(?:sudo|su)\s+/i
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  UNKNOWN:["REPAIR_PROPOSED","BLOCKED"],
  CI_FAILED:["REPAIR_PROPOSED","BLOCKED"],
  REPAIR_PROPOSED:["SANDBOX_PASSED","BLOCKED"],
  SANDBOX_PASSED:["CI_PASSED","BLOCKED"],
  CI_PASSED:["READY_FOR_REVIEW","BLOCKED"],
  READY_FOR_REVIEW:[], BLOCKED:[]
});

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function normalizeFiles(files) {
  return [...new Set((Array.isArray(files)?files:[])
    .map(x=>String(x).replace(/^\.\//,"").replace(/\\/g,"/"))
    .filter(Boolean))];
}

function classifyFiles(files) {
  const normalized=normalizeFiles(files);
  const critical=normalized.filter(file=>CRITICAL_PATHS.some(re=>re.test(file)));
  return {files:normalized,critical,criticality:critical.length?"HIGH":"NORMAL"};
}

function scanDiff(diff) {
  const text=String(diff||"");
  const findings=DANGEROUS_PATTERNS.filter(re=>re.test(text)).map(re=>re.source);
  return {findings,dangerous:findings.length>0};
}

function canTransition(from,to) {
  return Boolean(ALLOWED_TRANSITIONS[from]?.includes(to));
}

function evaluate({resource,fromState,toState,files,diff,actor="x10think"}) {
  const target=resource||"unknown";
  const classification=classifyFiles(files);
  const scan=scanDiff(diff);
  const reasons=[],required=[];
  let decision="ALLOW";

  if(!STATES.includes(fromState)||!STATES.includes(toState)) {
    decision="BLOCK"; reasons.push("unknown_state");
  } else if(!canTransition(fromState,toState)) {
    decision="BLOCK"; reasons.push("invalid_state_transition");
  }
  if(!resource) { decision="BLOCK"; reasons.push("resource_identity_missing"); }
  if(scan.dangerous) { decision="BLOCK"; reasons.push("dangerous_change_pattern"); }

  if(classification.criticality==="HIGH") {
    required.push("sandbox","ci","proof_receipt");
    if(toState==="READY_FOR_REVIEW") required.push("human_review");
  }
  if(fromState==="REPAIR_PROPOSED"&&toState==="SANDBOX_PASSED") required.push("sandbox");
  if(fromState==="SANDBOX_PASSED"&&toState==="CI_PASSED") required.push("ci");
  if(fromState==="CI_PASSED"&&toState==="READY_FOR_REVIEW") required.push("proof_receipt");

  return {
    decision,resource:target,actor,fromState,toState,
    criticality:classification.criticality,
    changedFiles:classification.files,criticalFiles:classification.critical,
    requiredChecks:[...new Set(required)],reasons:[...new Set(reasons)],
    dangerousFindings:scan.findings,policyVersion:"nexus-policy-v1",
    evaluationHash:sha256(JSON.stringify({
      resource:target,fromState,toState,files:classification.files,diff:String(diff||""),actor
    }))
  };
}

function transition(currentState,nextState,context={}) {
  const evaluation=evaluate({...context,fromState:currentState,toState:nextState});
  return {...evaluation,state:evaluation.decision==="ALLOW"?nextState:"BLOCKED"};
}

function createProofReceipt({evaluation,beforeSha,afterSha,validations=[]}) {
  if(!evaluation||evaluation.decision!=="ALLOW") throw new Error("proof_requires_allowed_transition");
  const receipt={
    schema:"nexus-proof-receipt/v2",resource:evaluation.resource,
    transition:{from:evaluation.fromState,action:"CONTROLLED_CHANGE",to:evaluation.toState},
    before:{sha:beforeSha||null},after:{sha:afterSha||null},
    policy:evaluation.policyVersion,checks:[...new Set(validations.map(String))],
    criticality:evaluation.criticality,evaluationHash:evaluation.evaluationHash
  };
  return {...receipt,proofHash:sha256(JSON.stringify(receipt))};
}

module.exports={STATES,CRITICAL_PATHS,classifyFiles,scanDiff,canTransition,evaluate,transition,createProofReceipt};
