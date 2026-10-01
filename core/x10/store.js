"use strict";

const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const DATA_DIR=process.env.X10_DATA_DIR||path.join(__dirname,"data");
const FILE=path.join(DATA_DIR,"state.json");
function clone(v){ return JSON.parse(JSON.stringify(v)); }
function empty(){ return {version:1,control:{autonomyEnabled:true,killReason:null,updatedAt:null},incidents:{},ledger:[]}; }
function ensure(){ fs.mkdirSync(DATA_DIR,{recursive:true}); if(!fs.existsSync(FILE)) fs.writeFileSync(FILE,JSON.stringify(empty(),null,2)+"\n"); }
function read(){ ensure(); return JSON.parse(fs.readFileSync(FILE,"utf8")); }
function write(state){ ensure(); const tmp=FILE+".tmp"; fs.writeFileSync(tmp,JSON.stringify(state,null,2)+"\n"); fs.renameSync(tmp,FILE); }
function now(){return new Date().toISOString();}
function id(prefix){return prefix+"_"+crypto.randomUUID().replace(/-/g,"");}
function createIncident(input){
  const state=read(), incidentId=input.incident_id||id("inc");
  if(state.incidents[incidentId]) return clone(state.incidents[incidentId]);
  const incident={incident_id:incidentId,event_id:String(input.event_id||id("evt")),repository:String(input.repository||""),commit_sha:String(input.commit_sha||""),failure_fingerprint:String(input.failure_fingerprint||""),state:"DETECTED",risk:String(input.risk||"HIGH"),attempt:Number(input.attempt||1),version:0,policy:{autonomous_execution:false,production_mutation:false,merge:"HUMAN_REQUIRED"},proposal:null,sandbox:null,critics:{},proof:null,created_at:now(),updated_at:now()};
  if(!incident.repository||!incident.commit_sha||!incident.failure_fingerprint) throw new Error("INCIDENT_REQUIRED_FIELDS");
  state.incidents[incidentId]=incident;
  state.ledger.push({ledger_id:id("led"),incident_id:incidentId,from_state:null,to_state:"DETECTED",actor:"IncidentStore",reason:"incident_created",created_at:incident.created_at,version:0});
  write(state); return clone(incident);
}
function getIncident(id){ const s=read(); return s.incidents[id]?clone(s.incidents[id]):null; }
function listIncidents(limit=100){ const s=read(); return Object.values(s.incidents).sort((a,b)=>b.updated_at.localeCompare(a.updated_at)).slice(0,Math.max(1,Math.min(Number(limit)||100,1000))).map(clone); }
function transition(incidentId,expectedState,toState,actor,reason,payload={}){
  const s=read(), inc=s.incidents[incidentId]; if(!inc) throw new Error("INCIDENT_NOT_FOUND");
  if(inc.state!==expectedState) return {ok:false,code:"STATE_CONFLICT",currentState:inc.state,version:inc.version};
  const from=inc.state; inc.state=toState; inc.version+=1; inc.updated_at=now();
  if(payload.policy) inc.policy=clone(payload.policy);
  if(payload.proposal) inc.proposal=clone(payload.proposal);
  if(payload.sandbox) inc.sandbox=clone(payload.sandbox);
  if(payload.critics) inc.critics=clone(payload.critics);
  if(payload.proof) inc.proof=clone(payload.proof);
  if(payload.attempt!==undefined) inc.attempt=Number(payload.attempt);
  const previous_hash=s.ledger.length?s.ledger[s.ledger.length-1].entry_hash||null:null;
  const entry={ledger_id:id("led"),incident_id:incidentId,from_state:from,to_state:toState,actor,reason,created_at:inc.updated_at,version:inc.version,previous_hash};
  entry.entry_hash=crypto.createHash("sha256").update(JSON.stringify(entry)).digest("hex");
  s.ledger.push(entry); write(s); return {ok:true,incident:clone(inc),ledger:clone(entry)};
}
function setAutonomy(enabled,reason){ const s=read(); s.control={autonomyEnabled:Boolean(enabled),killReason:enabled?null:String(reason||"manual"),updatedAt:now()}; write(s); return clone(s.control); }
function autonomyEnabled(){return read().control.autonomyEnabled===true;}
function getControl(){return clone(read().control);}
function ledger(incidentId){return read().ledger.filter(x=>!incidentId||x.incident_id===incidentId).map(clone);}
module.exports={createIncident,getIncident,listIncidents,transition,setAutonomy,autonomyEnabled,getControl,ledger,FILE};
