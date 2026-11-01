import threading
from contextlib import asynccontextmanager
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.responses import JSONResponse
from .config import settings
from .db import init_db, record_event, list_events, get_event, get_proof, metrics, verify_proof_chain
from .kz_validator import validate_kz_plate
from .schemas import EventIn

stop_event=threading.Event()
worker_thread=None
worker_error=None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global worker_thread
    init_db()
    if settings.enable_rtsp:
        if not settings.rtsp_url:
            raise RuntimeError("ENABLE_RTSP=true but RTSP_URL is empty")
        def worker():
            global worker_error
            try:
                from .pipeline import run_rtsp
                run_rtsp(stop_event)
            except Exception as exc:
                worker_error=str(exc)
    if settings.enable_rtsp:
        worker_thread=threading.Thread(target=worker, daemon=True, name="vdi-rtsp")
        worker_thread.start()
    yield
    stop_event.set()
    if worker_thread and worker_thread.is_alive():
        worker_thread.join(timeout=5)

app=FastAPI(title="SAMURAI VDI Backend", version="0.1.0", lifespan=lifespan)

def auth(x_api_key: str | None):
    if not settings.api_key or not settings.token_secret:
        raise HTTPException(503, "API key/token secret is not configured")
    if x_api_key is None or not __import__("hmac").compare_digest(x_api_key, settings.api_key):
        raise HTTPException(401, "Unauthorized")

@app.get("/health")
def health():
    return {"ok":True,"service":"samurai-vdi-backend","version":"0.1.0"}

@app.get("/ready")
def ready():
    import os
    db_ok=os.path.exists(settings.database_path)
    model_ok=(not settings.enable_rtsp) or os.path.isfile(settings.yolo_model_path)
    ok=bool(settings.api_key and settings.token_secret and db_ok and model_ok and not worker_error)
    return JSONResponse(status_code=200 if ok else 503, content={"ok":ok,"database":db_ok,"rtsp_enabled":settings.enable_rtsp,"model_available":model_ok,"worker_error":worker_error})

@app.post("/v1/events")
def ingest_event(payload: EventIn, x_api_key: str | None = Header(default=None)):
    auth(x_api_key)
    data=payload.model_dump()
    data["occurred_at"]=payload.occurred_at.isoformat()
    validation=validate_kz_plate(payload.plate_text, payload.ocr_confidence, settings.min_ocr_confidence)
    event,decision,proof,duplicate=record_event(data,validation,payload.crop_sha256)
    return {"ok":True,"duplicate":duplicate,"event":event,"decision":decision,"proof_hash":proof["receipt_hash"] if proof else None}

@app.get("/v1/events")
def events(limit: int=Query(default=50,ge=1,le=200), x_api_key: str | None=Header(default=None)):
    auth(x_api_key)
    return {"ok":True,"events":list_events(limit)}

@app.get("/v1/events/{event_id}")
def event_detail(event_id: str, x_api_key: str | None=Header(default=None)):
    auth(x_api_key)
    result=get_event(event_id)
    if not result: raise HTTPException(404,"Event not found")
    return {"ok":True,**result}

@app.get("/v1/decisions/{decision_id}")
def decision_detail(decision_id: str, x_api_key: str | None=Header(default=None)):
    auth(x_api_key)
    from .db import connect
    with connect() as c:
        row=c.execute("SELECT * FROM decisions WHERE decision_id=?",(decision_id,)).fetchone()
    if not row: raise HTTPException(404,"Decision not found")
    return {"ok":True,"decision":dict(row)}

@app.get("/v1/proof-chain/verify")
def proof_chain_verify(x_api_key: str | None = Header(default=None)):
    auth(x_api_key)
    result = verify_proof_chain()
    return JSONResponse(status_code=200 if result["ok"] else 409, content=result)

@app.get("/v1/proofs/{event_id}")
def proof_detail(event_id: str, x_api_key: str | None=Header(default=None)):
    auth(x_api_key)
    proof=get_proof(event_id)
    if not proof: raise HTTPException(404,"Proof not found")
    return {"ok":True,"proof":proof}

@app.get("/v1/metrics")
def get_metrics(x_api_key: str | None=Header(default=None)):
    auth(x_api_key)
    return {"ok":True,"metrics":metrics(),"mode":"shadow-only"}
