import json
import os
import uuid
from contextlib import asynccontextmanager

import asyncpg
import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from policy import evaluate
from proof import create_receipt

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://samurai:change-me@postgres:5432/samuraios")
SANDBOX_URL = os.getenv("SANDBOX_URL", "http://sandbox:8891")
MAX_ATTEMPTS = int(os.getenv("X10_MAX_ATTEMPTS", "3"))

pool = None
http = None

@asynccontextmanager
async def lifespan(app):
    global pool, http
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=10)
    async with pool.acquire() as conn:
        with open("schema.sql", "r", encoding="utf-8") as f:
            await conn.execute(f.read())
    http = httpx.AsyncClient(timeout=30.0)
    yield
    await http.aclose()
    await pool.close()

app = FastAPI(title="SamuraiOS X10 Control Plane", version="1.0.0", lifespan=lifespan)

class IncidentIn(BaseModel):
    event_id: str = Field(min_length=1, max_length=128)
    repository: str = Field(min_length=1, max_length=255)
    commit_sha: str = Field(min_length=7, max_length=64)
    failure_fingerprint: str = Field(min_length=1, max_length=128)
    risk: str = "HIGH"
    attempt: int = Field(default=1, ge=1, le=100)
    proposal: dict | None = None
    changed_files: list[str] = []
    workspace_path: str | None = None
    test_command: str | None = None
    sandbox_image: str | None = None

class KillIn(BaseModel):
    reason: str = Field(min_length=1, max_length=500)
    actor: str = Field(min_length=1, max_length=128)

async def _is_killed():
    async with pool.acquire() as conn:
        return bool(await conn.fetchval("SELECT active FROM x10_kill_switch WHERE singleton=TRUE"))

async def transition(incident_id, expected, target, actor, reason, payload=None):
    async with pool.acquire() as conn:
        try:
            row = await conn.fetchrow(
                "SELECT * FROM x10_transition($1,$2::x10_incident_state,$3::x10_incident_state,$4,$5,$6::jsonb)",
                incident_id, expected, target, actor, reason, json.dumps(payload or {})
            )
        except asyncpg.PostgresError as e:
            raise HTTPException(409, detail=str(e))
        return {"version": row["new_version"], "entry_hash": row["entry_hash"]}

@app.get("/health")
async def health():
    return {"ok": True, "service": "samuraios-x10", "version": "1.0.0"}

@app.get("/ready")
async def ready():
    try:
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        return {"ok": True, "ready": True}
    except Exception as e:
        raise HTTPException(503, detail=f"not_ready:{type(e).__name__}")

@app.post("/v1/kill")
async def activate_kill(body: KillIn):
    async with pool.acquire() as conn:
        await conn.execute(
            """UPDATE x10_kill_switch
            SET active=TRUE,reason=$1,actor=$2,version=version+1,activated_at=now(),updated_at=now()
            WHERE singleton=TRUE""", body.reason, body.actor
        )
    cancelled = None
    try:
        response = await http.post(f"{SANDBOX_URL}/v1/cancel-all", timeout=5)
        cancelled = response.json()
    except Exception:
        cancelled = {"ok":False,"error":"sandbox_cancel_unavailable"}
    return {"ok": True, "active": True, "sandbox": cancelled}

@app.post("/v1/resume")
async def resume(body: KillIn):
    async with pool.acquire() as conn:
        await conn.execute(
            """UPDATE x10_kill_switch
            SET active=FALSE,reason=$1,actor=$2,version=version+1,updated_at=now()
            WHERE singleton=TRUE""", body.reason, body.actor
        )
    return {"ok": True, "active": False}

@app.get("/v1/control")
async def control():
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM x10_kill_switch WHERE singleton=TRUE")
    return {"ok": True, "kill_switch": dict(row)}

@app.post("/v1/incidents")
async def create_incident(body: IncidentIn):
    incident_id = "inc_" + uuid.uuid4().hex
    initial = "AUTONOMY_KILLED" if await _is_killed() else "DETECTED"
    data = {
        "proposal": body.proposal,
        "changed_files": body.changed_files,
        "workspace_path": body.workspace_path,
        "test_command": body.test_command,
        "sandbox_image": body.sandbox_image,
    }
    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO x10_incidents
            (incident_id,event_id,repository,commit_sha,failure_fingerprint,state,risk,attempt,max_attempts,data)
            VALUES($1,$2,$3,$4,$5,$6::x10_incident_state,$7::x10_risk_level,$8,$9,$10::jsonb)""",
            incident_id, body.event_id, body.repository, body.commit_sha,
            body.failure_fingerprint, initial, body.risk.upper(), body.attempt,
            MAX_ATTEMPTS, json.dumps(data),
        )
    return {"ok": True, "incident_id": incident_id, "state": initial}

@app.get("/v1/incidents/{incident_id}")
async def get_incident(incident_id: str):
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM x10_incidents WHERE incident_id=$1", incident_id)
        if not row: raise HTTPException(404, "incident_not_found")
        ledger = await conn.fetch("SELECT * FROM x10_state_ledger WHERE incident_id=$1 ORDER BY ledger_id", incident_id)
        proofs = await conn.fetch("SELECT proof_receipt_id,run_id,proof_hash,created_at FROM x10_proof_receipts WHERE incident_id=$1 ORDER BY created_at", incident_id)
    return {"ok": True, "incident": dict(row), "ledger":[dict(x) for x in ledger], "proofs":[dict(x) for x in proofs]}

@app.post("/v1/incidents/{incident_id}/run")
async def run_incident(incident_id: str):
    async with pool.acquire() as conn:
        inc = await conn.fetchrow("SELECT * FROM x10_incidents WHERE incident_id=$1", incident_id)
        if not inc: raise HTTPException(404, "incident_not_found")
        if await _is_killed():
            if inc["state"] == "DETECTED":
                await conn.execute(
                    "SELECT * FROM x10_transition($1,$2::x10_incident_state,$3::x10_incident_state,$4,$5,$6::jsonb)",
                    incident_id,"DETECTED","AUTONOMY_KILLED","KillSwitch","kill_before_run","{}"
                )
            return {"ok": True, "state": "AUTONOMY_KILLED"}

    if inc["state"] != "DETECTED":
        raise HTTPException(409, f"incident_state={inc['state']}")

    data = dict(inc["data"] or {})
    proposal = data.get("proposal") or {}
    diff = str(proposal.get("diff") or "")
    files = data.get("changed_files") or proposal.get("files") or []

    await transition(incident_id,"DETECTED","PROPOSING_PATCH","RecoveryEngine","incident accepted")
    await transition(incident_id,"PROPOSING_PATCH","POLICY_CHECKING","AIProposer","candidate supplied",{"proposal":proposal})

    policy = evaluate(files,diff,"POLICY_CHECKING","SANDBOX_PENDING",f"github://{inc['repository']}@{inc['commit_sha']}")
    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO x10_policy_decisions(incident_id,decision,policy_version,evaluation_hash,details)
            VALUES($1,$2,$3,$4,$5::jsonb)""",
            incident_id,policy["decision"],policy["policy_version"],policy["evaluation_hash"],json.dumps(policy)
        )

    if policy["decision"] != "ALLOW":
        await transition(incident_id,"POLICY_CHECKING","REJECTED","PolicyEngine","policy_denied",{"policy":policy})
        return {"ok": True, "state": "REJECTED", "policy": policy}

    await transition(incident_id,"POLICY_CHECKING","SANDBOX_PENDING","PolicyEngine","sandbox_authorized",{"policy":policy})
    if await _is_killed():
        await transition(incident_id,"SANDBOX_PENDING","AUTONOMY_KILLED","KillSwitch","kill_before_sandbox")
        return {"ok": True, "state": "AUTONOMY_KILLED"}

    await transition(incident_id,"SANDBOX_PENDING","SANDBOX_RUNNING","ControlPlane","sandbox_dispatched")
    sandbox_payload = {
        "run_id":"run_"+uuid.uuid4().hex,
        "incident_id":incident_id,
        "repository":inc["repository"],
        "commit_sha":inc["commit_sha"],
        "patch_diff":diff,
        "workspace_path":data.get("workspace_path"),
        "test_command":data.get("test_command"),
        "image":data.get("sandbox_image"),
    }
    try:
        response = await http.post(f"{SANDBOX_URL}/v1/run",json=sandbox_payload,timeout=45)
        response.raise_for_status()
        sandbox = response.json()
    except Exception as e:
        await transition(incident_id,"SANDBOX_RUNNING","FAILED_RECOVERY","Sandbox",f"sandbox_unavailable:{type(e).__name__}")
        raise HTTPException(502,"sandbox_unavailable")

    if await _is_killed():
        await transition(incident_id,"SANDBOX_RUNNING","SANDBOX_CANCELLED","KillSwitch","kill_after_sandbox_response",{"sandbox":sandbox})
        await transition(incident_id,"SANDBOX_CANCELLED","AUTONOMY_KILLED","KillSwitch","autonomy_remains_stopped")
        return {"ok":True,"state":"AUTONOMY_KILLED","sandbox":sandbox}

    if sandbox.get("status") != "PASSED":
        await transition(incident_id,"SANDBOX_RUNNING","FAILED_RECOVERY","Sandbox","sandbox_failed",{"sandbox":sandbox})
        return {"ok":True,"state":"FAILED_RECOVERY","sandbox":sandbox}

    await transition(incident_id,"SANDBOX_RUNNING","SANDBOX_VERIFIED","Sandbox","sandbox_passed",{"sandbox":sandbox})
    await transition(incident_id,"SANDBOX_VERIFIED","CRITIC_EVALUATION","KillCritic","deterministic_critic_passed",{"critics":{"kill_critic":{"pass":True,"findings":policy["dangerous_findings"]}}})
    await transition(incident_id,"CRITIC_EVALUATION","PROOF_GENERATION","DecisionEngine","verification_gates_passed")

    async with pool.acquire() as conn:
        proof = await create_receipt(conn,incident_id,sandbox_payload["run_id"],{
            "commit_sha":inc["commit_sha"],
            "patch_sha256":sandbox.get("patch_sha256"),
            "environment_hash":sandbox.get("environment_hash"),
            "sandbox":sandbox,
            "policy":policy,
            "critics":{"kill_critic":"PASS"},
        })

    await transition(incident_id,"PROOF_GENERATION","HUMAN_APPROVAL_REQUIRED","ProofLedger","proof_generated",{"proof":proof})
    return {"ok":True,"state":"HUMAN_APPROVAL_REQUIRED","policy":policy,"sandbox":sandbox,"proof":proof}
