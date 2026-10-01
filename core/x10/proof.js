"use strict";
const crypto=require("crypto");
function sha(value){return crypto.createHash("sha256").update(String(value)).digest("hex");}
function create({incident,proposal,sandbox,critics,policy,previousHash=null}){
  if(!incident||!proposal||!sandbox||!critics||!policy) throw new Error("PROOF_INPUT_INCOMPLETE");
  const body={schema:"samuraios-proof-receipt/v1",incident_id:incident.incident_id,commit_sha:incident.commit_sha,patch_sha256:proposal.patch_sha256||sha(proposal.diff||""),sandbox_run_id:sandbox.run_id,sandbox_status:sandbox.status,critic_hash:sha(JSON.stringify(critics)),policy_hash:policy.policy_hash,previous_proof_hash:previousHash,created_at:new Date().toISOString()};
  return {...body,proof_hash:sha(JSON.stringify(body))};
}
module.exports={sha,create};
