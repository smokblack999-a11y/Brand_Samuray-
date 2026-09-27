import asyncio, os, time, aiohttp
from aiogram import Bot, Dispatcher
from aiogram.filters import Command
from aiogram.types import Message

BOT_TOKEN=os.environ["BOT_TOKEN"]
HUB_URL=os.environ["HUB_URL"].rstrip("/")
ADMIN_TOKEN=os.environ["X10_ADMIN_TOKEN"]
ALLOWED={int(x) for x in os.environ.get("X10_ALLOWED_CHAT_IDS","").split(",") if x.strip()}
bot=Bot(BOT_TOKEN); dp=Dispatcher()

def ok(m): return not ALLOWED or (m.chat and m.chat.id in ALLOWED)

async def call(method,path):
    async with aiohttp.ClientSession(headers={"Authorization":f"Bearer {ADMIN_TOKEN}"}) as s:
        async with s.request(method,HUB_URL+path) as r:
            return r.status,await r.json()

@dp.message(Command("status"))
async def status(m:Message):
    if not ok(m): return
    code,data=await call("GET","/v1/agents")
    if code!=200:return await m.answer("Hub error")
    if not data:return await m.answer("No agents registered.")
    out=[]
    for a in data:
        age=(time.time()*1000-(a.get("last_seen") or 0))/1000
        out.append(f"{a['id']}: {a.get('status','unknown')} | {age:.0f}s")
    await m.answer("\n".join(out))

@dp.message(Command("restart"))
async def restart(m:Message):
    if not ok(m): return
    args=m.text.split()
    if len(args)!=2:return await m.answer("Usage: /restart <agent_id>")
    code,data=await call("POST",f"/v1/agents/{args[1]}/restart")
    await m.answer(f"Queued: {data.get('command_id')}" if code==202 else f"Failed: {data}")

async def main(): await dp.start_polling(bot)
if __name__=="__main__": asyncio.run(main())