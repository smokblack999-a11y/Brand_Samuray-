import hashlib, hmac, os, secrets, sqlite3, time
from flask import Flask, jsonify, request

DB = os.getenv("X10_DB", "/data/x10.db")
ADMIN_TOKEN = os.getenv("X10_ADMIN_TOKEN", "")
ONLINE_WINDOW = int(os.getenv("X10_ONLINE_WINDOW", "180"))
MAX_LOG_CHARS = 12000

app = Flask(__name__)

def db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn

def init():
    os.makedirs(os.path.dirname(DB), exist_ok=True)
    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS agents(
          id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL,
          last_seen REAL, status TEXT, version TEXT, meta TEXT DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS commands(
          id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, command TEXT NOT NULL,
          created_at REAL NOT NULL, delivered_at REAL, acknowledged_at REAL,
          result TEXT, state TEXT NOT NULL DEFAULT 'queued'
        );
        CREATE TABLE IF NOT EXISTS audit(
          id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL,
          actor TEXT NOT NULL, action TEXT NOT NULL, agent_id TEXT,
          detail TEXT
        );
        """)

def audit(actor, action, agent_id=None, detail=""):
    with db() as c:
        c.execute("INSERT INTO audit(ts,actor,action,agent_id,detail) VALUES(?,?,?,?,?)",
                  (time.time(), actor, action, agent_id, detail[:2000]))

def admin():
    supplied = request.headers.get("X-X10-Admin", "")
    return bool(ADMIN_TOKEN) and hmac.compare_digest(supplied, ADMIN_TOKEN)

def agent_auth(agent_id):
    supplied = request.headers.get("X-X10-Agent", "")
    with db() as c:
        row = c.execute("SELECT token_hash FROM agents WHERE id=?", (agent_id,)).fetchone()
    return bool(row) and hmac.compare_digest(
        row["token_hash"], hashlib.sha256(supplied.encode()).hexdigest()
    )

@app.get("/healthz")
def healthz():
    return {"ok": True, "service": "x10-hub"}

@app.post("/v1/agents/register")
def register():
    if not admin(): return jsonify(error="unauthorized"), 401
    body = request.get_json(silent=True) or {}
    agent_id = body.get("id") or secrets.token_hex(8)
    name = str(body.get("name") or agent_id)[:120]
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with db() as c:
        c.execute("INSERT OR REPLACE INTO agents(id,name,token_hash,last_seen,status,version,meta) VALUES(?,?,?,?,?,?,?)",
                  (agent_id,name,token_hash,None,"offline",body.get("version",""),"{}"))
    audit("admin","agent.register",agent_id)
    return jsonify(id=agent_id, token=token), 201

@app.post("/v1/agents/<agent_id>/heartbeat")
def heartbeat(agent_id):
    if not agent_auth(agent_id): return jsonify(error="unauthorized"), 401
    body = request.get_json(silent=True) or {}
    now = time.time()
    with db() as c:
        c.execute("UPDATE agents SET last_seen=?,status=?,version=?,meta=? WHERE id=?",
                  (now,"online",str(body.get("status","ok"))[:40],
                   str(body.get("meta","{}"))[:2000],agent_id))
    audit("agent","heartbeat",agent_id)
    return jsonify(ok=True, server_time=now)

@app.get("/v1/agents")
def agents():
    if not admin(): return jsonify(error="unauthorized"), 401
    with db() as c: rows=c.execute("SELECT id,name,last_seen,status,version,meta FROM agents ORDER BY name").fetchall()
    now=time.time()
    return jsonify(agents=[dict(r, is_online=bool(r["last_seen"] and now-r["last_seen"] < ONLINE_WINDOW)) for r in rows])

@app.get("/v1/agents/<agent_id>/commands")
def commands(agent_id):
    if not agent_auth(agent_id): return jsonify(error="unauthorized"), 401
    with db() as c:
        rows=c.execute("SELECT id,command,created_at FROM commands WHERE agent_id=? AND state='queued' ORDER BY created_at LIMIT 5",(agent_id,)).fetchall()
        if rows:
            c.executemany("UPDATE commands SET state='delivered',delivered_at=? WHERE id=?",[(time.time(),r["id"]) for r in rows])
    return jsonify(commands=[dict(r) for r in rows])

@app.post("/v1/agents/<agent_id>/commands/<command_id>/result")
def command_result(agent_id, command_id):
    if not agent_auth(agent_id): return jsonify(error="unauthorized"), 401
    body=request.get_json(silent=True) or {}
    result=str(body.get("result",""))[:4000]
    state="done" if body.get("ok",False) else "failed"
    with db() as c:
        c.execute("UPDATE commands SET state=?,acknowledged_at=?,result=? WHERE id=? AND agent_id=?",
                  (state,time.time(),result,command_id,agent_id))
    audit("agent",f"command.{state}",agent_id,f"{command_id}:{result}")
    return jsonify(ok=True)

@app.post("/v1/agents/<agent_id>/commands/restart")
def restart(agent_id):
    if not admin(): return jsonify(error="unauthorized"), 401
    command_id=secrets.token_hex(12)
    with db() as c:
        c.execute("INSERT INTO commands(id,agent_id,command,created_at,state) VALUES(?,?,?,?,?)",
                  (command_id,agent_id,"restart_target",time.time(),"queued"))
    audit("admin","command.restart",agent_id,command_id)
    return jsonify(id=command_id,state="queued")

@app.get("/v1/audit")
def audit_log():
    if not admin(): return jsonify(error="unauthorized"), 401
    with db() as c: rows=c.execute("SELECT * FROM audit ORDER BY id DESC LIMIT 100").fetchall()
    return jsonify(events=[dict(r) for r in rows])

if __name__ == "__main__":
    init()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT","8080")))
