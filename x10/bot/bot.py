import asyncio, os, aiohttp
from aiogram import Bot, Dispatcher
from aiogram.filters import Command
from aiogram.types import Message

BOT_TOKEN=os.environ["BOT_TOKEN"]
HUB=os.environ["X10_HUB"].rstrip("/")
ADMIN_TOKEN=os.environ["X10_ADMIN_TOKEN"]
ALLOWED_CHAT_IDS={int(x) for x in os.getenv("X10_ALLOWED_CHAT_IDS","").split(",") if x.strip()}
bot=Bot(BOT_TOKEN); dp=Dispatcher()

def allowed(m:Message): return not ALLOWED_CHAT_IDS or m.chat.id in ALLOWED_CHAT_IDS

async def hub(method,path):
    async with aiohttp.ClientSession() as s:
        async with s.request(method,HUB+path,headers={"X-X10-Admin":ADMIN_TOKEN},timeout=10) as r:
            return r.status, await r.json()

@dp.message(Command("status"))
async def status(m):
    if not allowed(m): return
    code,data=await hub("GET","/v1/agents")
    if code!=200: return await m.answer("Hub authorization/error.")
    lines=[]
    for a in data["agents"]:
        lines.append(f"{'ONLINE' if a['is_online'] else 'OFFLINE'}  {a['name']}  {a['id']}")
    await m.answer("\n".join(lines) or "No agents registered.")

@dp.message(Command("restart"))
async def restart(m):
    if not allowed(m): return
    p=m.text.split()
    if len(p)!=2: return await m.answer("Usage: /restart <agent_id>")
    code,data=await hub("POST",f"/v1/agents/{p[1]}/commands/restart")
    await m.answer(f"Command {data.get('state','error')}: {data.get('id','')}")

@dp.message(Command("audit"))
async def audit_cmd(m):
    if not allowed(m): return
    code,data=await hub("GET","/v1/audit")
    if code!=200: return await m.answer("Hub authorization/error.")
    rows=data["events"][:10]
    await m.answer("\n".join(f"{x['action']} {x.get('agent_id') or ''}" for x in rows) or "No audit events.")

async def main(): await dp.start_polling(bot)
if __name__=="__main__": asyncio.run(main())
