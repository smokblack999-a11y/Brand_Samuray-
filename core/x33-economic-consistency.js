"use strict";
const crypto = require("node:crypto");

const MAX_INT64 = 9223372036854775807n;
const MIN_INT64 = -9223372036854775808n;
const MODE = Object.freeze({ACTIVE:"ACTIVE",TRIPPED:"TRIPPED",MANUAL_REVIEW:"MANUAL_REVIEW",ARMED:"ARMED"});
const STATUS = Object.freeze({ACTIVE:"ACTIVE",SETTLED:"SETTLED",SETTLED_WITH_OVERAGE:"SETTLED_WITH_OVERAGE",SETTLED_AFTER_EXPIRY:"SETTLED_AFTER_EXPIRY",EXPIRED:"EXPIRED",OVERFLOW_REJECTED:"OVERFLOW_REJECTED"});
const OP = Object.freeze({RESERVE:"RESERVE",SETTLE:"SETTLE",SETTLE_OVERAGE:"SETTLE_OVERAGE",SETTLE_AFTER_EXPIRY:"SETTLE_AFTER_EXPIRY",EXPIRE_RELEASE:"EXPIRE_RELEASE",WINDOW_ROLLOVER:"WINDOW_ROLLOVER",RECONCILE_ADJUSTMENT:"RECONCILE_ADJUSTMENT"});
const Err = Object.freeze({INVALID_INPUT:"INVALID_INPUT_PARAMETERS",AUTONOMY_TRIPPED:"DISTRIBUTED_CIRCUIT_BREAKER_TRIPPED",BUDGET_EXCEEDED:"BUDGET_EXCEEDED",BUDGET_WINDOW_EXPIRED:"BUDGET_WINDOW_EXPIRED",IDEMPOTENCY_CONFLICT:"IDEMPOTENCY_CONFLICT",RESERVATION_NOT_FOUND:"RESERVATION_NOT_FOUND",INVARIANT_VIOLATION:"CRITICAL_INVARIANT_VIOLATION",STORAGE_DOWN:"STORAGE_UNAVAILABLE",INVALID_STATE_TRANSITION:"INVALID_STATE_TRANSITION"});
const TRANSITIONS = Object.freeze({ACTIVE:new Set(["TRIPPED"]),TRIPPED:new Set(["MANUAL_REVIEW"]),MANUAL_REVIEW:new Set(["ARMED"]),ARMED:new Set(["ACTIVE"])});

function codeError(code,message){const e=new Error(message||code);e.code=code;return e;}
function asMicro(value,field){let n;if(typeof value==="bigint")n=value;else if(typeof value==="number"){if(!Number.isSafeInteger(value))throw codeError(Err.INVALID_INPUT,(field||"micro")+" must be an integer");n=BigInt(value);}else if(typeof value==="string"&&/^-?\d+$/.test(value.trim()))n=BigInt(value.trim());else throw codeError(Err.INVALID_INPUT,(field||"micro")+" must be an integer micro-KZT value");if(n<MIN_INT64||n>MAX_INT64)throw codeError(Err.INVALID_INPUT,(field||"micro")+" is outside PostgreSQL BIGINT range");return n;}
function assertNonNegative(value,field){const n=asMicro(value,field);if(n<0n)throw codeError(Err.INVALID_INPUT,field+" must be >= 0");return n;}
function canonical(value){if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";if(value&&typeof value==="object")return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+canonical(value[k])).join(",")+"}";return JSON.stringify(value);}
function fingerprint(value){return crypto.createHash("sha256").update(canonical(value)).digest("hex");}
function ledgerHash(packet,previousHash){return crypto.createHash("sha256").update(String(previousHash||"")+"\n"+canonical(packet)).digest("hex");}
function allocateSettlement(input){
  let limit=asMicro(input.limit,"limit"),spent=asMicro(input.spent,"spent"),committed=asMicro(input.committed,"committed"),reserved=asMicro(input.reserved,"reserved"),actual=asMicro(input.actual,"actual");
  if([limit,spent,committed,reserved,actual].some(n=>n<0n))throw codeError(Err.INVARIANT_VIOLATION,"negative settlement input");
  const committedAfterRelease=committed-(input.wasExpired?0n:reserved);
  if(committedAfterRelease<0n)throw codeError(Err.INVARIANT_VIOLATION,"committed underflow");
  const availableAuthorized=limit-spent-committedAfterRelease;
  if(availableAuthorized<0n)throw codeError(Err.INVARIANT_VIOLATION,"available authorized budget is negative");
  let authorizedSpend=0n,unbudgetedDelta=0n,status=STATUS.SETTLED,operation=OP.SETTLE;
  if(input.wasExpired){status=STATUS.SETTLED_AFTER_EXPIRY;operation=OP.SETTLE_AFTER_EXPIRY;unbudgetedDelta=actual;}
  else{authorizedSpend=actual<=availableAuthorized?actual:availableAuthorized;unbudgetedDelta=actual-authorizedSpend;if(unbudgetedDelta>0n){status=STATUS.OVERFLOW_REJECTED;operation=OP.SETTLE_OVERAGE;}else if(actual>reserved){status=STATUS.SETTLED_WITH_OVERAGE;operation=OP.SETTLE_OVERAGE;}}
  return {authorizedSpend,unbudgetedDelta,newSpent:spent+authorizedSpend,newCommitted:committedAfterRelease,status,operation,overage:actual>reserved?actual-reserved:0n};
}
function rowResult(row,replay){return {reservationId:String(row.reservation_id),tenantId:String(row.tenant_id),eventId:String(row.event_id),status:String(row.status),reservedAmountMicro:String(row.reserved_amount_micro),actualAmountMicro:row.actual_amount_micro==null?null:String(row.actual_amount_micro),overageMicro:String(row.overage_micro==null?"0":row.overage_micro),expiresAt:row.expires_at,idempotentReplay:Boolean(replay)};}

class X33EconomicConsistency{
  constructor(pool,options){options=options||{};if(!pool||typeof pool.connect!=="function")throw new TypeError("PostgreSQL pool is required");this.pool=pool;this.maxReservationTtlMs=options.maxReservationTtlMs||900000;}
  async reserve(ctx,input){
    if(!input||!input.tenantId||!input.eventId)throw codeError(Err.INVALID_INPUT,"tenantId and eventId are required");
    const estimate=asMicro(input.estimateMicro,"estimateMicro");if(estimate<=0n)throw codeError(Err.INVALID_INPUT,"estimateMicro must be > 0");
    if(!Number.isSafeInteger(input.ttlMs)||input.ttlMs<=0||input.ttlMs>this.maxReservationTtlMs)throw codeError(Err.INVALID_INPUT,"ttlMs is outside allowed range");
    const fp=fingerprint({tenantId:String(input.tenantId),eventId:String(input.eventId),estimateMicro:String(estimate),ttlMs:input.ttlMs});
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      const budget=await this.lockBudget(client,input.tenantId);
      if(budget.window_expired)throw codeError(Err.BUDGET_WINDOW_EXPIRED,"budget window expired; roll it explicitly");
      const control=await this.lockControl(client,input.tenantId);
      if(control.autonomy_mode!==MODE.ACTIVE)throw codeError(Err.AUTONOMY_TRIPPED,"tenant autonomy mode is "+control.autonomy_mode);
      const old=await client.query("SELECT reservation_id,tenant_id,event_id,reserved_amount_micro,actual_amount_micro,overage_micro,status::text AS status,expires_at,request_fingerprint FROM tenant_reservations WHERE tenant_id=$1 AND event_id=$2 FOR UPDATE",[input.tenantId,input.eventId]);
      if(old.rowCount){const row=old.rows[0];if(String(row.request_fingerprint)!==fp)throw codeError(Err.IDEMPOTENCY_CONFLICT,"same event was used with different reservation parameters");await client.query("COMMIT");return rowResult(row,true);}
      const limit=BigInt(budget.budget_limit_micro_kzt),spent=BigInt(budget.spent_micro_kzt),committed=BigInt(budget.committed_micro_kzt),unbudgeted=BigInt(budget.unbudgeted_actual_micro_kzt);
      if(limit<0n||spent<0n||committed<0n||unbudgeted<0n||spent+committed>limit)return this.tripAndThrow(client,input.tenantId,"BUDGET_STATE_INVALID",Err.INVARIANT_VIOLATION);
      if(limit-spent-committed<estimate)throw codeError(Err.BUDGET_EXCEEDED,"reservation would exceed available budget");
      const reservationId=crypto.randomUUID();
      const ins=await client.query("INSERT INTO tenant_reservations (reservation_id,tenant_id,event_id,reserved_amount_micro,status,expires_at,request_fingerprint) VALUES ($1,$2,$3,$4,'ACTIVE',NOW()+($5::bigint*INTERVAL '1 millisecond'),$6) RETURNING reservation_id,tenant_id,event_id,reserved_amount_micro,actual_amount_micro,overage_micro,status::text AS status,expires_at",[reservationId,input.tenantId,input.eventId,estimate.toString(),input.ttlMs,fp]);
      const newCommitted=committed+estimate;
      await client.query("UPDATE tenant_budgets SET committed_micro_kzt=$1,version=version+1,updated_at=NOW() WHERE tenant_id=$2",[newCommitted.toString(),input.tenantId]);
      await this.appendLedger(client,{tenantId:input.tenantId,reservationId,eventId:input.eventId,operation:OP.RESERVE,operationKey:"reserve:"+fp,deltaSpent:0n,deltaCommitted:estimate,deltaUnbudgeted:0n,previousSpent:spent,newSpent:spent,previousCommitted:committed,newCommitted,previousUnbudgeted:unbudgeted,newUnbudgeted:unbudgeted});
      await client.query("COMMIT");return rowResult(ins.rows[0],false);
    }catch(e){await client.query("ROLLBACK").catch(()=>{});throw normalizePgError(e);}finally{client.release();}
  }
  async settle(ctx,reservationId,actualMicro){
    if(!reservationId)throw codeError(Err.INVALID_INPUT,"reservationId is required");
    const actual=assertNonNegative(actualMicro,"actualMicro"),client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      const owner=await client.query("SELECT tenant_id FROM tenant_reservations WHERE reservation_id=$1",[reservationId]);
      if(!owner.rowCount)throw codeError(Err.RESERVATION_NOT_FOUND,"reservation not found");
      const tenantId=owner.rows[0].tenant_id,budget=await this.lockBudget(client,tenantId);
      const rr=await client.query("SELECT reservation_id,tenant_id,event_id,reserved_amount_micro,actual_amount_micro,overage_micro,status::text AS status,expires_at FROM tenant_reservations WHERE reservation_id=$1 FOR UPDATE",[reservationId]);
      if(!rr.rowCount)throw codeError(Err.RESERVATION_NOT_FOUND,"reservation not found");
      const row=rr.rows[0];
      if(String(row.tenant_id)!==String(tenantId))return this.tripAndThrow(client,tenantId,"RESERVATION_TENANT_MISMATCH",Err.INVARIANT_VIOLATION);
      if([STATUS.SETTLED,STATUS.SETTLED_WITH_OVERAGE,STATUS.SETTLED_AFTER_EXPIRY,STATUS.OVERFLOW_REJECTED].includes(String(row.status))){await client.query("COMMIT");return rowResult(row,true);}
      const allocation=allocateSettlement({limit:budget.budget_limit_micro_kzt,spent:budget.spent_micro_kzt,committed:budget.committed_micro_kzt,reserved:row.reserved_amount_micro,actual,wasExpired:String(row.status)===STATUS.EXPIRED});
      const previousSpent=BigInt(budget.spent_micro_kzt),previousCommitted=BigInt(budget.committed_micro_kzt),previousUnbudgeted=BigInt(budget.unbudgeted_actual_micro_kzt),newUnbudgeted=previousUnbudgeted+allocation.unbudgetedDelta;
      await client.query("UPDATE tenant_reservations SET actual_amount_micro=$1,overage_micro=$2,status=$3,settled_at=NOW(),finalized_at=NOW() WHERE reservation_id=$4",[actual.toString(),allocation.overage.toString(),allocation.status,reservationId]);
      await client.query("UPDATE tenant_budgets SET spent_micro_kzt=$1,committed_micro_kzt=$2,unbudgeted_actual_micro_kzt=$3,version=version+1,updated_at=NOW() WHERE tenant_id=$4",[allocation.newSpent.toString(),allocation.newCommitted.toString(),newUnbudgeted.toString(),tenantId]);
      await this.appendLedger(client,{tenantId,reservationId,eventId:row.event_id,operation:allocation.operation,operationKey:allocation.operation.toLowerCase()+":"+reservationId+":"+actual.toString(),deltaSpent:allocation.authorizedSpend,deltaCommitted:allocation.newCommitted-previousCommitted,deltaUnbudgeted:allocation.unbudgetedDelta,previousSpent,newSpent:allocation.newSpent,previousCommitted,newCommitted:allocation.newCommitted,previousUnbudgeted,newUnbudgeted});
      if(allocation.unbudgetedDelta>0n)await this.trip(client,tenantId,String(row.status)===STATUS.EXPIRED?"SETTLEMENT_AFTER_EXPIRY":"BUDGET_OVERFLOW_ACTUAL_COST");
      await client.query("COMMIT");
      return {reservationId:String(reservationId),tenantId:String(tenantId),eventId:String(row.event_id),status:allocation.status,actualAmountMicro:actual.toString(),authorizedAmountMicro:allocation.authorizedSpend.toString(),overageMicro:allocation.overage.toString(),unbudgetedMicro:allocation.unbudgetedDelta.toString(),idempotentReplay:false};
    }catch(e){await client.query("ROLLBACK").catch(()=>{});throw normalizePgError(e);}finally{client.release();}
  }
  async expireSweep(ctx,options){
    options=options||{};const limit=options.limit===undefined?100:options.limit;if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw codeError(Err.INVALID_INPUT,"limit must be 1..1000");
    const candidates=await this.pool.query("SELECT reservation_id FROM tenant_reservations WHERE status='ACTIVE' AND expires_at<=NOW() ORDER BY expires_at LIMIT $1",[limit]);let expired=0;
    for(const c of candidates.rows){
      const client=await this.pool.connect();
      try{
        await client.query("BEGIN");
        const owner=await client.query("SELECT tenant_id FROM tenant_reservations WHERE reservation_id=$1",[c.reservation_id]);if(!owner.rowCount){await client.query("COMMIT");continue;}
        const tenantId=owner.rows[0].tenant_id,budget=await this.lockBudget(client,tenantId);
        const rr=await client.query("SELECT reservation_id,tenant_id,event_id,reserved_amount_micro,status::text AS status FROM tenant_reservations WHERE reservation_id=$1 AND status='ACTIVE' AND expires_at<=NOW() FOR UPDATE",[c.reservation_id]);if(!rr.rowCount){await client.query("COMMIT");continue;}
        const row=rr.rows[0],reserved=BigInt(row.reserved_amount_micro),committed=BigInt(budget.committed_micro_kzt);if(committed<reserved)return this.tripAndThrow(client,tenantId,"EXPIRE_COMMITTED_UNDERFLOW",Err.INVARIANT_VIOLATION);
        const newCommitted=committed-reserved,spent=BigInt(budget.spent_micro_kzt),unbudgeted=BigInt(budget.unbudgeted_actual_micro_kzt);
        await client.query("UPDATE tenant_reservations SET status='EXPIRED',finalized_at=NOW() WHERE reservation_id=$1",[c.reservation_id]);
        await client.query("UPDATE tenant_budgets SET committed_micro_kzt=$1,version=version+1,updated_at=NOW() WHERE tenant_id=$2",[newCommitted.toString(),tenantId]);
        await this.appendLedger(client,{tenantId,reservationId:c.reservation_id,eventId:row.event_id,operation:OP.EXPIRE_RELEASE,operationKey:"expire:"+c.reservation_id,deltaSpent:0n,deltaCommitted:-reserved,deltaUnbudgeted:0n,previousSpent:spent,newSpent:spent,previousCommitted:committed,newCommitted,previousUnbudgeted:unbudgeted,newUnbudgeted:unbudgeted});
        await client.query("COMMIT");expired++;
      }catch(e){await client.query("ROLLBACK").catch(()=>{});throw normalizePgError(e);}finally{client.release();}
    }
    return {expired};
  }
  async rollWindow(ctx,tenantId){
    if(!tenantId)throw codeError(Err.INVALID_INPUT,"tenantId is required");const client=await this.pool.connect();
    try{
      await client.query("BEGIN");const budget=await this.lockBudget(client,tenantId);await this.lockControl(client,tenantId);
      if(!budget.window_expired)throw codeError(Err.INVALID_INPUT,"budget window has not expired");
      const active=await client.query("SELECT reservation_id FROM tenant_reservations WHERE tenant_id=$1 AND status='ACTIVE' FOR UPDATE",[tenantId]);if(active.rowCount||BigInt(budget.committed_micro_kzt)!==0n)return this.tripAndThrow(client,tenantId,"WINDOW_ROLLOVER_WITH_ACTIVE_COMMITMENTS",Err.INVARIANT_VIOLATION);
      const previousSpent=BigInt(budget.spent_micro_kzt),previousUnbudgeted=BigInt(budget.unbudgeted_actual_micro_kzt),rolloverId=crypto.randomUUID();
      await client.query("UPDATE tenant_budgets SET window_start_at=NOW(),window_reset_at=NOW()+(window_seconds*INTERVAL '1 second'),spent_micro_kzt=0,committed_micro_kzt=0,unbudgeted_actual_micro_kzt=0,version=version+1,updated_at=NOW() WHERE tenant_id=$1",[tenantId]);
      await this.appendLedger(client,{tenantId,reservationId:rolloverId,eventId:"window:"+tenantId+":"+rolloverId,operation:OP.WINDOW_ROLLOVER,operationKey:"window:"+tenantId+":"+rolloverId,deltaSpent:-previousSpent,deltaCommitted:0n,deltaUnbudgeted:-previousUnbudgeted,previousSpent,newSpent:0n,previousCommitted:0n,newCommitted:0n,previousUnbudgeted,newUnbudgeted:0n});
      await client.query("COMMIT");return {tenantId,rolled:true};
    }catch(e){await client.query("ROLLBACK").catch(()=>{});throw normalizePgError(e);}finally{client.release();}
  }
  async transitionAutonomy(ctx,tenantId,fromMode,toMode,reason){
    if(!tenantId||!TRANSITIONS[fromMode]||!TRANSITIONS[fromMode].has(toMode))throw codeError(Err.INVALID_STATE_TRANSITION,"unsupported autonomy transition");
    const r=await this.pool.query("UPDATE tenant_control_state SET autonomy_mode=$1,trip_reason=CASE WHEN $1='TRIPPED' THEN $3 ELSE trip_reason END,tripped_at=CASE WHEN $1='TRIPPED' THEN NOW() ELSE tripped_at END,repaired_at=CASE WHEN $1='ACTIVE' THEN NOW() ELSE repaired_at END,version=version+1 WHERE tenant_id=$2 AND autonomy_mode=$4",[toMode,tenantId,reason||null,fromMode]);
    if(r.rowCount!==1)throw codeError(Err.INVALID_STATE_TRANSITION,"state transition lost race or source mode mismatch");
    return {tenantId,fromMode,toMode};
  }
  async auditTenantIntegrity(ctx,tenantId){
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      const budget=await this.lockBudget(client,tenantId),active=await client.query("SELECT reservation_id,reserved_amount_micro FROM tenant_reservations WHERE tenant_id=$1 AND status='ACTIVE' FOR UPDATE",[tenantId]);
      const sumActive=active.rows.reduce((s,r)=>s+BigInt(r.reserved_amount_micro),0n),spent=BigInt(budget.spent_micro_kzt),committed=BigInt(budget.committed_micro_kzt),unbudgeted=BigInt(budget.unbudgeted_actual_micro_kzt),limit=BigInt(budget.budget_limit_micro_kzt);
      let failure=null;if([limit,spent,committed,unbudgeted].some(n=>n<0n))failure="NEGATIVE_STATE";else if(spent+committed>limit)failure="BUDGET_LIMIT_BREACH";else if(committed!==sumActive)failure="COMMITTED_ACTIVE_MISMATCH";
      const ledger=await client.query("SELECT tenant_id,reservation_id,event_id,operation::text AS operation,operation_key,delta_spent_micro,delta_committed_micro,delta_unbudgeted_micro,previous_spent_micro,new_spent_micro,previous_committed_micro,new_committed_micro,previous_unbudgeted_micro,new_unbudgeted_micro,previous_hash,record_hash,created_at FROM economic_ledger WHERE tenant_id=$1 ORDER BY ledger_id ASC",[tenantId]);
      let previousHash=null,dSpent=0n,dCommitted=0n,dUnbudgeted=0n;const seen=new Set();
      for(const row of ledger.rows){
        if(seen.has(row.operation_key)){failure||="DUPLICATE_LEDGER_OPERATION_KEY";break;}seen.add(row.operation_key);
        if((row.previous_hash||null)!==(previousHash||null)){failure||="HASH_CHAIN_PREVIOUS_MISMATCH";break;}
        const packet={tenantId:String(row.tenant_id),reservationId:String(row.reservation_id),eventId:String(row.event_id),operation:String(row.operation),operationKey:String(row.operation_key),deltaSpentMicro:String(row.delta_spent_micro),deltaCommittedMicro:String(row.delta_committed_micro),deltaUnbudgetedMicro:String(row.delta_unbudgeted_micro),previousSpentMicro:String(row.previous_spent_micro),newSpentMicro:String(row.new_spent_micro),previousCommittedMicro:String(row.previous_committed_micro),newCommittedMicro:String(row.new_committed_micro),previousUnbudgetedMicro:String(row.previous_unbudgeted_micro),newUnbudgetedMicro:String(row.new_unbudgeted_micro),createdAt:new Date(row.created_at).toISOString()};
        if(ledgerHash(packet,previousHash)!==row.record_hash){failure||="HASH_CHAIN_RECORD_MISMATCH";break;}
        dSpent+=BigInt(row.delta_spent_micro);dCommitted+=BigInt(row.delta_committed_micro);dUnbudgeted+=BigInt(row.delta_unbudgeted_micro);previousHash=row.record_hash;
      }
      if(dSpent!==spent)failure||="LEDGER_SPENT_MISMATCH";if(dCommitted!==committed)failure||="LEDGER_COMMITTED_MISMATCH";if(dUnbudgeted!==unbudgeted)failure||="LEDGER_UNBUDGETED_MISMATCH";
      if(failure){await this.trip(client,tenantId,failure);await client.query("COMMIT");throw codeError(Err.INVARIANT_VIOLATION,failure);}
      await client.query("COMMIT");return {ok:true,tenantId,ledgerRecords:ledger.rowCount,activeReservations:active.rowCount,spentMicro:spent.toString(),committedMicro:committed.toString(),unbudgetedMicro:unbudgeted.toString(),lastLedgerHash:previousHash};
    }catch(e){await client.query("ROLLBACK").catch(()=>{});throw normalizePgError(e);}finally{client.release();}
  }
  async lockControl(client,tenantId){const r=await client.query("SELECT autonomy_mode::text AS autonomy_mode,version FROM tenant_control_state WHERE tenant_id=$1 FOR UPDATE",[tenantId]);if(!r.rowCount)throw codeError(Err.STORAGE_DOWN,"tenant control state not found");return r.rows[0];}
  async lockBudget(client,tenantId){const r=await client.query("SELECT tenant_id,budget_limit_micro_kzt,spent_micro_kzt,committed_micro_kzt,unbudgeted_actual_micro_kzt,window_start_at,window_reset_at,window_seconds,version,(window_reset_at<=NOW()) AS window_expired FROM tenant_budgets WHERE tenant_id=$1 FOR UPDATE",[tenantId]);if(!r.rowCount)throw codeError(Err.STORAGE_DOWN,"tenant budget not found");return r.rows[0];}
  async appendLedger(client,record){
    const last=await client.query("SELECT record_hash FROM economic_ledger WHERE tenant_id=$1 ORDER BY ledger_id DESC LIMIT 1",[record.tenantId]),clock=await client.query("SELECT NOW() AS db_now"),previousHash=last.rows[0]?.record_hash||null,createdAt=new Date(clock.rows[0].db_now).toISOString();
    const packet={tenantId:String(record.tenantId),reservationId:String(record.reservationId),eventId:String(record.eventId),operation:String(record.operation),operationKey:String(record.operationKey),deltaSpentMicro:String(record.deltaSpent),deltaCommittedMicro:String(record.deltaCommitted),deltaUnbudgetedMicro:String(record.deltaUnbudgeted),previousSpentMicro:String(record.previousSpent),newSpentMicro:String(record.newSpent),previousCommittedMicro:String(record.previousCommitted),newCommittedMicro:String(record.newCommitted),previousUnbudgetedMicro:String(record.previousUnbudgeted),newUnbudgetedMicro:String(record.newUnbudgeted),createdAt};
    await client.query("INSERT INTO economic_ledger (tenant_id,reservation_id,event_id,operation,operation_key,delta_spent_micro,delta_committed_micro,delta_unbudgeted_micro,previous_spent_micro,new_spent_micro,previous_committed_micro,new_committed_micro,previous_unbudgeted_micro,new_unbudgeted_micro,previous_hash,record_hash,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)",[packet.tenantId,packet.reservationId,packet.eventId,packet.operation,packet.operationKey,packet.deltaSpentMicro,packet.deltaCommittedMicro,packet.deltaUnbudgetedMicro,packet.previousSpentMicro,packet.newSpentMicro,packet.previousCommittedMicro,packet.newCommittedMicro,packet.previousUnbudgetedMicro,packet.newUnbudgetedMicro,previousHash,ledgerHash(packet,previousHash),createdAt]);
  }
  async trip(client,tenantId,reason){await client.query("UPDATE tenant_control_state SET autonomy_mode='TRIPPED',trip_reason=$1,tripped_at=COALESCE(tripped_at,NOW()),version=version+1 WHERE tenant_id=$2 AND autonomy_mode<>'TRIPPED'",[reason,tenantId]);}
  async tripAndThrow(client,tenantId,reason,code){await this.trip(client,tenantId,reason);await client.query("COMMIT");throw codeError(code,reason);}
}
function normalizePgError(error){if(error?.code==="23505"&&/x33_unique_reservation_event|tenant_reservations/i.test(error.constraint||""))return codeError(Err.IDEMPOTENCY_CONFLICT,"reservation idempotency conflict");return error;}
module.exports={X33EconomicConsistency,MODE,STATUS,OP,Err,TRANSITIONS,canonical,fingerprint,ledgerHash,allocateSettlement,asMicro,codeError};
