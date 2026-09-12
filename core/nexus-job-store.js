"use strict";

const fs = require("fs");
const path = require("path");

function createStore(filePath = process.env.NEXUS_JOB_STORE || path.join(__dirname, ".nexus", "jobs.json")) {
  const resolved = path.resolve(filePath);
  function ensure() {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    if (!fs.existsSync(resolved)) fs.writeFileSync(resolved, "[]\n", "utf8");
  }
  function read() {
    ensure();
    const raw = fs.readFileSync(resolved, "utf8");
    const value = JSON.parse(raw || "[]");
    if (!Array.isArray(value)) throw new Error("NEXUS job store must contain an array");
    return value;
  }
  function write(jobs) {
    ensure();
    const temp = `${resolved}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(jobs, null, 2)}\n`, "utf8");
    fs.renameSync(temp, resolved);
  }
  function enqueue(job) {
    const jobs = read();
    if (jobs.some((item) => item.jobId === job.jobId)) return jobs.find((item) => item.jobId === job.jobId);
    const record = { ...job, queuedAt: new Date().toISOString(), status: "QUEUED" };
    write([...jobs, record]);
    return record;
  }
  function get(jobId) { return read().find((job) => job.jobId === jobId) || null; }
  function update(jobId, patch) {
    const jobs = read();
    const index = jobs.findIndex((job) => job.jobId === jobId);
    if (index < 0) return null;
    jobs[index] = { ...jobs[index], ...patch, updatedAt: new Date().toISOString() };
    write(jobs);
    return jobs[index];
  }
  function list({ status } = {}) { return read().filter((job) => !status || job.status === status); }
  return { enqueue, get, update, list, filePath: resolved };
}

module.exports = { createStore };
