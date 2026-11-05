"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

class JsonLeadStore {
  constructor(dataDir = "./data/lead-outreach") {
    this.dataDir = path.resolve(dataDir || "./data/lead-outreach");
    this.filePath = path.join(this.dataDir, "leads.json");
    this.writeQueue = Promise.resolve();
  }

  async _read() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async _write(leads) {
    await fs.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const temp = `${this.filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    await fs.writeFile(temp, JSON.stringify(leads, null, 2), { mode: 0o600 });
    await fs.rename(temp, this.filePath);
  }

  async _mutate(fn) {
    const operation = this.writeQueue.then(async () => {
      const leads = await this._read();
      const result = await fn(leads);
      await this._write(leads);
      return result;
    });
    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  async list() {
    await this.writeQueue;
    return this._read();
  }

  async upsert(candidate) {
    return this._mutate((leads) => {
      const key = candidate.sourceId ? `${candidate.source}:${candidate.sourceId}` : candidate.email ? `email:${candidate.email.toLowerCase()}` : null;
      let existing = key ? leads.find((lead) => lead.dedupeKey === key) : null;
      if (!existing && candidate.email) existing = leads.find((lead) => lead.email && lead.email.toLowerCase() === candidate.email.toLowerCase());
      const now = new Date().toISOString();
      if (existing) {
        Object.assign(existing, candidate, { updatedAt: now });
        return existing;
      }
      const lead = {
        id: crypto.randomUUID(),
        ...candidate,
        dedupeKey: key,
        stage: "new",
        draft: null,
        createdAt: now,
        updatedAt: now
      };
      leads.push(lead);
      return lead;
    });
  }

  async update(id, updater) {
    return this._mutate((leads) => {
      const lead = leads.find((item) => item.id === id);
      if (!lead) return null;
      updater(lead);
      lead.updatedAt = new Date().toISOString();
      return lead;
    });
  }
}

module.exports = { JsonLeadStore };
