#!/usr/bin/env python3
import json, os, subprocess, time, urllib.request

HUB=os.environ["X10_HUB"].rstrip("/")
AGENT_ID=os.environ["X10_AGENT_ID"]
TOKEN=os.environ["X10_AGENT_TOKEN"]
TARGET=os.getenv("X10_TARGET_PACKAGE","com.pas.webcam")
INTERVAL=int(os.getenv("X10_HEARTBEAT_SECONDS","60"))

def call(path, method="GET", payload=None):
    data=None if payload is None else json.dumps(payload).encode()
    req=urllib.request.Request(HUB+path,data=data,method=method,
      headers={"Content-Type":"application/json","X-X10-Agent":TOKEN})
    with urllib.request.urlopen(req,timeout=10) as r:
        return json.loads(r.read().decode())

def restart_target():
    cmds=[
      ["am","force-stop",TARGET],
      ["am","start","-n",f"{TARGET}/.MainActivity","--user","0","-f","0x10000000"]
    ]
    for cmd in cmds:
        subprocess.run(cmd,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=False)
    return "restart requested"

def main():
    while True:
        try:
            call(f"/v1/agents/{AGENT_ID}/heartbeat","POST",{"status":"ok","meta":{"target":TARGET}})
            data=call(f"/v1/agents/{AGENT_ID}/commands")
            for cmd in data.get("commands",[]):
                try:
                    result=restart_target() if cmd["command"]=="restart_target" else "unsupported command"
                    call(f"/v1/agents/{AGENT_ID}/commands/{cmd['id']}/result","POST",
                         {"ok":cmd["command"]=="restart_target","result":result})
                except Exception as e:
                    call(f"/v1/agents/{AGENT_ID}/commands/{cmd['id']}/result","POST",
                         {"ok":False,"result":str(e)})
        except Exception:
            pass
        time.sleep(INTERVAL)

if __name__=="__main__": main()
