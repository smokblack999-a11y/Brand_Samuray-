"use strict";

const express = require("express");
const crypto = require("node:crypto");
const { chromium } = require("playwright");
const { validateTask } = require("./policy");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

const API_KEY = String(process.env.COMPUTER_AGENT_API_KEY || "");
const PORT = Number(process.env.PORT || 8790);
const jobs = new Map();

function auth(req, res, next) {
  const supplied = String(req.get("X-API-Key") || "");
  const a = Buffer.from(API_KEY), b = Buffer.from(supplied);
  if (!API_KEY || a.length !== b.length || !crypto.timingSafeEqual(a,b)) {
    return res.status(401).json({ ok:false, error:"UNAUTHORIZED" });
  }
  next();
}

app.get("/health", (_req,res) => res.json({ok:true, service:"SAMURAI Computer Agent", version:"0.1.0"}));

app.post("/v1/jobs", auth, async (req,res) => {
  let task;
  try { task = validateTask(req.body); }
  catch (error) { return res.status(400).json({ok:false,error:error.message}); }
  const id = crypto.randomUUID();
  const job = { id, status:"queued", createdAt:new Date().toISOString(), result:null };
  jobs.set(id,job);
  res.status(202).json({ok:true,job});
  runJob(job,task).catch(error => {
    job.status = "failed";
    job.result = { error: error.message };
    job.finishedAt = new Date().toISOString();
  });
});

app.get("/v1/jobs/:id", auth, (req,res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ok:false,error:"JOB_NOT_FOUND"});
  res.json({ok:true,job});
});

async function runJob(job,task) {
  job.status = "running";
  const browser = await chromium.launch({ headless:true });
  try {
    const context = await browser.newContext({ acceptDownloads:false });
    const page = await context.newPage();
    const journal = [];
    await page.goto(task.url,{waitUntil:"domcontentloaded",timeout:30000});
    journal.push({action:"navigate",url:page.url(),at:new Date().toISOString()});
    for (const step of task.steps) {
      if (step.action === "navigate") {
        const next = new URL(step.value, page.url());
        if (next.protocol !== "https:") throw new Error("HTTPS_ONLY");
        await page.goto(next.toString(),{waitUntil:"domcontentloaded",timeout:30000});
      } else if (step.action === "fill") {
        await page.locator(step.target).first().fill(String(step.value ?? ""));
      } else if (step.action === "click") {
        await page.locator(step.target).first().click({timeout:10000});
      } else if (step.action === "read") {
        const value = await page.locator(step.target).first().innerText({timeout:10000});
        journal.push({action:"read",target:step.target,value:value.slice(0,2000),at:new Date().toISOString()});
      }
      journal.push({action:step.action,target:step.target || null,at:new Date().toISOString()});
    }
    job.status = "completed";
    job.result = { finalUrl:page.url(), title:await page.title(), journal };
    job.finishedAt = new Date().toISOString();
    await context.close();
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  if (!API_KEY && process.env.NODE_ENV === "production") throw new Error("COMPUTER_AGENT_API_KEY_REQUIRED");
  app.listen(PORT,"0.0.0.0",() => console.log(JSON.stringify({event:"computer_agent_listening",port:PORT})));
}
module.exports = { app, validateTask };
