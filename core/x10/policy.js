"use strict";

const crypto=require("crypto");
const nexus=require("../nexus-resource-policy");
const HARD_BLOCK_CATEGORIES=new Set(["github_actions","docker","dependencies","infrastructure","authentication","cryptography","tls","acl","policy","database"]);
const SECRET_PATTERNS=[/BEGIN (?:RSA|OPENSSH|EC|DSA) PRIVATE KEY/i,/AKIA[0-9A-Z]{16}/,/gh[pousr]_[A-Za-z0-9_]{20,}/,/sk-[A-Za-z0-9]{20,}/];
function evaluate(input={}){
  const files=Array.isArray(input.changedFiles)?input.changedFiles:[], diff=String(input.diff||"");
  const base=nexus.evaluate({resource:input.repository,fromState:"CI_FAILED",toState:"REPAIR_PROPOSED",files,diff,actor:input.actor||"PolicyEngine"});
  const reasons=[...(base.reasons||[])]; let decision="ALLOW";
  const risk=String(input.risk||"HIGH").toUpperCase();
  if(!input.repository||!input.commitSha){decision="BLOCK";reasons.push("identity_missing");}
  if(SECRET_PATTERNS.some(re=>re.test(diff))){decision="BLOCK";reasons.push("secret_pattern_detected");}
  if(base.dangerousFindings?.length){decision="BLOCK";reasons.push("dangerous_diff");}
  if((base.categories||[]).some(x=>HARD_BLOCK_CATEGORIES.has(x))){decision="BLOCK";reasons.push("high_risk_path_requires_human");}
  if(Number(input.attempt||1)>3){decision="BLOCK";reasons.push("attempt_limit_exceeded");}
  const policy={autonomous_execution:decision==="ALLOW",production_mutation:false,merge:"HUMAN_REQUIRED",risk,decision,reasons:[...new Set(reasons)],categories:base.categories||[],required_checks:["sandbox","critics","proof","ci"]};
  return {...policy,policy_hash:crypto.createHash("sha256").update(JSON.stringify(policy)).digest("hex")};
}
module.exports={evaluate};
