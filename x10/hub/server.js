const http=require("http");
const fs=require("fs");
const crypto=require("crypto");
const path=require("path");

const PORT=Number(process.env.PORT||8080);
const ADMIN_TOKEN=process.env.X10_ADMIN_TOKEN||"";
const DATA_DIR=process.env.X10_DATA_DIR||"/data";
const AGENTS_FILE=path.join(DATA_DIR,"agents.json");
const AUDIT_FILE=path.join(DATA_DIR,"audit.jsonl");
const MAX_BODY=64*1024;
fs.mkdirSync(DATA_DIR,{recursive:true});
if(!fs.existsSync(AGENTS_FILE)) fs.writeFileSync(AGENTS_FILE,"{}");

function readAgents(){try{return JSON.parse(fs.readFileSync(AGENTS_FILE,"utf8"))}catch{return {}}}
function writeAgents(x){fs.writeFileSync(AGENTS_FILE,JSON.stringify(x,null,2)+"\n")}
function token(req){const h=req.headers.authorization||"";return h.startsWith("Bearer ")?h.slice(7):""}
function timingSafe(a,b){if(!a||!b)return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y)}
function json(res,status,data){const body=JSON.stringify(data);res.writeHead(status,{"content-type":"application/json","content-length":Buffer.byteLength(body)});res.end(body)}
function audit(event){let prev="GENESIS";try{const lines=fs.readFileSync(AUDIT_FILE,"utf8").trim().split("\n").filter(Boolean);if(lines.length)prev=JSON.parse(lines.at(-1)).hash}catch{}const rec={ts:new Date().toISOString(),...event,prev_hash:prev};rec.hash=crypto.createHash("sha256").update(JSON.stringify(rec)).digest("hex");fs.appendFileSync(AUDIT_FILE,JSON.stringify(rec)+"\n")}
function readBody(req){return new Promise((resolve,reject)=>{let s="";req.on("data",c=>{s+=c;if(s.length>MAX_BODY){req.destroy();reject(new Error("body too large"))}});req.on("end",()=>resolve(s));req.on("error",reject)})}
function requireAdmin(req,res){if(!timingSafe(token(req),ADMIN_TOKEN)){json(res,401,{error:"unauthorized"});return false}return true}

async function handler(req,res){
 try{
  const u=new URL(req.url,"http://localhost");
  const parts=u.pathname.split("/").filter(Boolean);
  if(req.method==="GET"&&u.pathname==="/health")return json(res,200,{ok:true,service:"x10-hub",time:new Date().toISOString()});
  if(req.method==="GET"&&u.pathname==="/v1/agents"){
   if(!requireAdmin(req,res))return;
   const a=readAgents();return json(res,200,Object.values(a).map(x=>({...x,token:undefined})));
  }
  if(parts[0]!=="v1"||parts[1]!=="agents")return json(res,404,{error:"not_found"});
  const id=parts[2]; const action=parts[3];
  if(!id)return json(res,400,{error:"agent_id_required"});
  const agents=readAgents();
  if(req.method==="POST"&&action==="heartbeat"){
   const supplied=token(req), agent=agents[id];
   if(!agent||!timingSafe(supplied,agent.token))return json(res,401,{error:"unauthorized"});
   const body=await readBody(req);let payload={};try{payload=body?JSON.parse(body):{}}catch{return json(res,400,{error:"invalid_json"})}
   agent.last_seen=Date.now();agent.status=payload.status||"online";agent.meta=payload.meta||{};agents[id]=agent;writeAgents(agents);
   audit({type:"heartbeat",agent_id:id,status:agent.status});
   return json(res,200,{ok:true,server_time:Date.now()});
  }
  if(req.method==="GET"&&action==="commands"){
   const agent=agents[id];
   if(!agent||!timingSafe(token(req),agent.token))return json(res,401,{error:"unauthorized"});
   const pending=(agent.commands||[]).filter(c=>c.state==="queued").map(c=>({...c}));
   pending.forEach(c=>{c.state="delivered";c.delivered_at=new Date().toISOString()});
   agent.commands=(agent.commands||[]).map(c=>pending.find(p=>p.id===c.id)||c);agents[id]=agent;writeAgents(agents);
   return json(res,200,{commands:pending});
  }
  if(req.method==="POST"&&action==="result"){
   const agent=agents[id];
   if(!agent||!timingSafe(token(req),agent.token))return json(res,401,{error:"unauthorized"});
   const body=await readBody(req);let p;try{p=JSON.parse(body)}catch{return json(res,400,{error:"invalid_json"})}
   const c=(agent.commands||[]).find(x=>x.id===p.command_id);if(!c)return json(res,404,{error:"command_not_found"});
   c.state=p.ok?"succeeded":"failed";c.result=p.result||null;c.finished_at=new Date().toISOString();agents[id]=agent;writeAgents(agents);
   audit({type:"command_result",agent_id:id,command_id:c.id,state:c.state});return json(res,200,{ok:true});
  }
  if(req.method==="GET"&&action==="status"){
   if(!requireAdmin(req,res))return;const a=agents[id];if(!a)return json(res,404,{error:"agent_not_found"});
   return json(res,200,{id:a.id,last_seen:a.last_seen,status:a.status,meta:a.meta||{},pending:(a.commands||[]).filter(c=>c.state==="queued").length});
  }
  if(req.method==="POST"&&action==="restart"){
   if(!requireAdmin(req,res))return;const a=agents[id];if(!a)return json(res,404,{error:"agent_not_found"});
   const c={id:crypto.randomUUID(),type:"restart_target",state:"queued",created_at:new Date().toISOString()};a.commands=[...(a.commands||[]),c];agents[id]=a;writeAgents(agents);audit({type:"command_created",agent_id:id,command_id:c.id,command_type:c.type});
   return json(res,202,{accepted:true,command_id:c.id});
  }
  return json(res,404,{error:"not_found"});
 }catch(e){return json(res,500,{error:"internal_error"})}
}
http.createServer(handler).listen(PORT,"0.0.0.0",()=>console.log("X10 Hub listening on "+PORT));