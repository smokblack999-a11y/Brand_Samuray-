import asyncio
import hashlib
import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import uvicorn

ROOT = Path(os.getenv("SANDBOX_WORKSPACE_ROOT","/workspaces")).resolve()
MAX_TIMEOUT = int(os.getenv("SANDBOX_TIMEOUT_SECONDS","300"))
COMMAND_TIMEOUT = max(10, min(MAX_TIMEOUT, 900))
ACTIVE = {}

app=FastAPI(title="SamuraiOS X10 Sandbox",version="1.2.0")

class RunIn(BaseModel):
    run_id: str
    incident_id: str
    repository: str
    commit_sha: str
    patch_diff: str = Field(max_length=2_000_000)
    workspace_path: str
    test_command: str | None = None

def safe_workspace(value):
    p=Path(value).resolve()
    if p == ROOT or ROOT not in p.parents:
        raise HTTPException(400,"workspace_outside_sandbox_root")
    return p

async def run_cmd(run_id,cmd,cwd,timeout):
    proc=await asyncio.create_subprocess_exec(
        *cmd,cwd=str(cwd),stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE
    )
    ACTIVE[run_id]=proc
    try:
        out,err=await asyncio.wait_for(proc.communicate(),timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return 124,"","sandbox_timeout"
    except asyncio.CancelledError:
        if proc.returncode is None:
            proc.kill()
            await proc.wait()
        raise
    finally:
        ACTIVE.pop(run_id,None)
    return proc.returncode,out.decode(errors="replace")[-20000:],err.decode(errors="replace")[-20000:]

@app.get("/health")
async def health():
    return {"ok":True,"service":"sandbox","isolation":"bubblewrap","active_runs":len(ACTIVE)}

@app.post("/v1/cancel/{run_id}")
async def cancel(run_id: str):
    proc=ACTIVE.get(run_id)
    if not proc:
        return {"ok":True,"cancelled":False,"run_id":run_id}
    if proc.returncode is None:
        proc.kill()
    return {"ok":True,"cancelled":True,"run_id":run_id}

@app.post("/v1/cancel-all")
async def cancel_all():
    ids=list(ACTIVE)
    for proc in list(ACTIVE.values()):
        if proc.returncode is None:
            proc.kill()
    return {"ok":True,"cancelled":len(ids),"run_ids":ids}

@app.post("/v1/run")
async def run(body: RunIn):
    workspace=safe_workspace(body.workspace_path)
    if not workspace.is_dir():
        raise HTTPException(400,"workspace_not_found")

    code,out,err=await run_cmd(body.run_id,["git","-C",str(workspace),"rev-parse","HEAD"],workspace,10)
    if code != 0 or out.strip() != body.commit_sha:
        raise HTTPException(409,"workspace_commit_mismatch")

    with tempfile.TemporaryDirectory(prefix=f"x10-{body.run_id}-",dir=str(ROOT)) as td:
        stage=Path(td)/"repo"
        code,out,err=await run_cmd(body.run_id,["cp","-a",str(workspace),str(stage)],workspace,60)
        if code != 0:
            raise HTTPException(500,"workspace_copy_failed")

        patch=Path(td)/"candidate.patch"
        patch.write_text(body.patch_diff,encoding="utf-8")
        code,out,err=await run_cmd(body.run_id,["git","-C",str(stage),"apply","--check",str(patch)],stage,30)
        if code != 0:
            return {"run_id":body.run_id,"status":"FAILED","exit_code":code,"stderr":err,"reason":"patch_check_failed"}

        code,out,err=await run_cmd(body.run_id,["git","-C",str(stage),"apply","--whitespace=error-all",str(patch)],stage,30)
        if code != 0:
            return {"run_id":body.run_id,"status":"FAILED","exit_code":code,"stderr":err,"reason":"patch_apply_failed"}

        patch_sha=hashlib.sha256(body.patch_diff.encode()).hexdigest()
        command=body.test_command or "npm test"

        sandbox_cmd=[
            "bwrap","--die-with-parent","--unshare-all","--new-session",
            "--ro-bind","/","/","--bind",str(stage),"/workspace",
            "--proc","/proc","--dev","/dev","--tmpfs","/tmp",
            "--chdir","/workspace","--setenv","HOME","/tmp/home",
            "--setenv","CI","true","--","sh","-lc",command
        ]
        code,out,err=await run_cmd(body.run_id,sandbox_cmd,stage,COMMAND_TIMEOUT)
        return {
            "run_id":body.run_id,
            "status":"PASSED" if code==0 else "FAILED",
            "exit_code":code,
            "timeout":code==124,
            "stdout":out,
            "stderr":err,
            "patch_sha256":patch_sha,
            "environment_hash":hashlib.sha256(b"node:22-bookworm-slim+bubblewrap").hexdigest(),
            "network_access":False,
            "resource_limits":{"timeout_seconds":COMMAND_TIMEOUT}
        }

if __name__=="__main__":
    uvicorn.run(app,host="0.0.0.0",port=8891)
