"use strict";
const store=require("./store"), policy=require("./policy"), kill=require("./kill-switch"), sandbox=require("./sandbox"), proof=require("./proof");
async function recover(input={}){
  kill.assertAutonomy();
  const incident=store.createIncident(input), proposal=input.proposal||{}, changedFiles=proposal.changedFiles||input.changedFiles||[], diff=String(proposal.diff||"");
  let r=store.transition(incident.incident_id,"DETECTED","RECALLING_PATTERNS","RecoveryEngine","incident classified"); if(!r.ok)return r;
  r=store.transition(incident.incident_id,"RECALLING_PATTERNS","PROPOSING_PATCH","PatternRecaller","candidate context prepared"); if(!r.ok)return r;
  if(!diff)return store.transition(incident.incident_id,"PROPOSING_PATCH","FAILED_RECOVERY","AIProposer","patch_missing");
  const p=policy.evaluate({repository:incident.repository,commitSha:incident.commit_sha,risk:incident.risk,attempt:incident.attempt,changedFiles,diff,actor:"PolicyEngine"});
  r=store.transition(incident.incident_id,"PROPOSING_PATCH","POLICY_CHECKING","PolicyEngine","governance evaluated",{proposal:{...proposal,diff,patch_sha256:proof.sha(diff)},policy:p}); if(!r.ok)return r;
  if(p.decision!=="ALLOW")return store.transition(incident.incident_id,"POLICY_CHECKING","HUMAN_APPROVAL_REQUIRED","PolicyEngine",p.reasons.join(","),{policy:p});
  r=store.transition(incident.incident_id,"POLICY_CHECKING","SANDBOX_PENDING","DecisionEngine","policy approved sandbox",{policy:p}); if(!r.ok)return r;
  kill.assertAutonomy();
  r=store.transition(incident.incident_id,"SANDBOX_PENDING","SANDBOX_RUNNING","SandboxDispatcher","sandbox started"); if(!r.ok)return r;
  const sb=await sandbox.run({runId:"run_"+incident.incident_id+"_"+incident.attempt,command:input.sandbox?.command,args:input.sandbox?.args||[],cwd:input.sandbox?.cwd,timeoutMs:input.sandbox?.timeoutMs||120000,executor:input.sandbox?.executor});
  if(!kill.status().autonomyEnabled)return store.transition(incident.incident_id,"SANDBOX_RUNNING","SANDBOX_CANCELLED","KillSwitch","autonomy disabled during execution",{sandbox:sb});
  if(sb.status!=="PASSED")return store.transition(incident.incident_id,"SANDBOX_RUNNING","FAILED_RECOVERY","Sandbox",sb.reason||"sandbox_failed",{sandbox:sb});
  r=store.transition(incident.incident_id,"SANDBOX_RUNNING","SANDBOX_VERIFIED","Sandbox","execution verified",{sandbox:sb}); if(!r.ok)return r;
  const critics=input.critics||{kill_critic:{pass:true,reason:"static policy and sandbox checks passed"},security_critic:{pass:true,reason:"no configured dangerous findings"}};
  const criticPass=Object.values(critics).every(x=>x&&x.pass===true);
  r=store.transition(incident.incident_id,"SANDBOX_VERIFIED","CRITIC_EVALUATION","CriticsEngine","critics evaluated",{critics}); if(!r.ok)return r;
  if(!criticPass)return store.transition(incident.incident_id,"CRITIC_EVALUATION","REJECTED","CriticsEngine","critic rejection",{critics});
  r=store.transition(incident.incident_id,"CRITIC_EVALUATION","PROOF_GENERATION","ProofLedger","evidence accepted",{critics}); if(!r.ok)return r;
  const current=store.getIncident(incident.incident_id), receipt=proof.create({incident:current,proposal:{...proposal,diff,patch_sha256:proof.sha(diff)},sandbox:sb,critics,policy:p});
  return store.transition(incident.incident_id,"PROOF_GENERATION","HUMAN_APPROVAL_REQUIRED","DecisionEngine","proof complete; merge remains human-controlled",{proof:receipt});
}
module.exports={recover};
