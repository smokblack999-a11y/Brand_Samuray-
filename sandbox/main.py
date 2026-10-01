import asyncio
import hashlib
import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

ROOT = Path(os.getenv("SANDBOX_WORKSPACE_ROOT","/workspaces")).resolve()
DEFAULT_IMAGE = os.getenv("SANDBOX_IMAGE","node:22-bookworm-slim")
MAX_TIMEOUT = int(os.getenv("SANDBOX_TIMEOUT_SECONDS","300"))
ALLOWED_IMAGES = {x.strip() for x in os.getenv("SANDBOX_ALLOWED_IMAGES",DEFAULT_IMAGE).split(",") if x.strip()}

app=FastAPI(title="SamuraiOS X10 Sandbox",version="1.0.0")

class RunIn(BaseModel):
    run_id: str
    incident_id: str
    repository: str
    commit_sha: str
    patch_diff: str = Field(max_length=2_000_000)
    workspace_path: str
    test_command: str | None = None
    image: str | None = None

def safe_workspace(value):
    p=Path(value).resolve()
    if p == ROOT or ROOT not in p.parents:
        raise HTTPException(400,"workspace_outside_sandbox_root")
    return p

async def run_cmd(cmd,cwd,timeout):
    proc=await asyncio.create_subprocess_exec(*cmd,cwd=str(cwd),stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
    try:
        out,err=await asyncio.wait_for(proc.communicate(),timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return 124,"","sandbox_timeout"
    return proc.returncode,out.decode(errors="replace")[-20000:],err.decode(errors="replace")[-20000:]

@app.get("/health")
async def health(): return {"ok":True,"service":"sandbox"}

@app.post("/v1/run")
async def run(body: RunIn):
    workspace=safe_workspace(body.workspace_path)
    if not workspace.is_dir(): raise HTTPException(400,"workspace_not_found")
    image=body.image or DEFAULT_IMAGE
    if image not in ALLOWED_IMAGES: raise HTTPException(403,"sandbox_image_not_allowed")

    code,out,err=await run_cmd(["git","-C",str(workspace),"rev-parse","HEAD"],workspace,10)
    if code != 0 or out.strip() != body.commit_sha: raise HTTPException(409,"workspace_commit_mismatch")

    with tempfile.TemporaryDirectory(prefix=f"x10-{body.run_id}-",dir=str(ROOT)) as td:
        stage=Path(td)/"repo"
        code,out,err=await run_cmd(["cp","-a",str(workspace),str(stage)],workspace,60)
        if code != 0: raise HTTPException(500,"workspace_copy_failed")

        patch=Path(td)/"candidate.patch"
        patch.write_text(body.patch_diff,encoding="utf-8")
        code,out,err=await run_cmd(["git","-C",str(stage),"apply","--check",str(patch)],stage,30)
        if code != 0:
            return {"run_id":body.run_id,"status":"FAILED","exit_code":code,"stderr":err,"reason":"patch_check_failed"}

        code,out,err=await run_cmd(["git","-C",str(stage),"apply","--whitespace=error-all",str(patch)],stage,30)
        if code != 0:
            return {"run_id":body.run_id,"status":"FAILED","exit_code":code,"stderr":err,"reason":"patch_apply_failed"}

        patch_sha=hashlib.sha256(body.patch_diff.encode()).hexdigest()
        command=body.test_command or "npm test"
        docker_cmd=[
            "docker","run","--rm","--network","none",
            "--read-only","--tmpfs","/tmp:rw,nosuid,size=256m",
            "--cap-drop","ALL","--security-opt","no-new-privileges",
            "--pids-limit","128","--cpus","2","--memory","2g",
            "-v",f"{stage}:/workspace:rw",
            image,"sh","-lc",f"cd /workspace && {command}"
        ]
        code,out,err=await run_cmd(docker_cmd,stage,MAX_TIMEOUT)
        return {
            "run_id":body.run_id,
            "status":"PASSED" if code==0 else "FAILED",
            "exit_code":code,
            "timeout":code==124,
            "stdout":out,
            "stderr":err,
            "patch_sha256":patch_sha,
            "environment_hash":hashlib.sha256(image.encode()).hexdigest(),
            "network_access":False,
            "resource_limits":{"cpus":2,"memory":"2g","pids":128}
        }
