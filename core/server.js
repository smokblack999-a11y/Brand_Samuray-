"use strict";

require("dotenv").config();

const express = require("express");
const cors = require("cors");

const {
  connectTelegram,
  telegramStatus,
  getMe,
  getDialogs,
  getMessages,
  sendMessage,
} = require("./telegram");

const { evaluate } = require("./kill-critic/policy-engine");
const { appendDecision, readDecisions } = require("./kill-critic/decision-ledger");

const app = express();

const HOST = "127.0.0.1";
const PORT = 8787;

app.use(cors());

app.use(
  express.json({
    limit: "25mb",
  })
);

// ================================
// STATUS
// ================================

app.get("/api/status", async (req, res) => {
  res.json({
    ok: true,
    service: "SamuraiOS Core",
    version: "1.2.0",
    openai: Boolean(process.env.OPENAI_API_KEY),
    telegram: await telegramStatus(),
    killCritic: {
      enabled: true,
      policyVersion: "kc-policy-1.0.0",
    },
    time: new Date().toISOString(),
  });
});

// ================================
// KILL CRITIC POLICY
// ================================

app.post("/api/kill-critic/evaluate", (req, res) => {
  try {
    const { diff, jobId, commit } = req.body || {};

    if (!diff || !String(diff).trim()) {
      return res.status(400).json({
        ok: false,
        error: "diff обязателен",
      });
    }

    const decision = evaluate({
      diff,
      jobId,
      commit,
    });

    appendDecision(decision);

    res.status(decision.decision === "BLOCK" ? 422 : 200).json({
      ok: true,
      enforcement: decision,
    });
  } catch (error) {
    console.error("Kill Critic evaluate error:", error);
    res.status(500).json({
      ok: false,
      error: "Kill Critic evaluation failed",
    });
  }
});

app.get("/api/kill-critic/decisions", (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const decisions = readDecisions().slice(-limit).reverse();

    res.json({
      ok: true,
      count: decisions.length,
      decisions,
    });
  } catch (error) {
    console.error("Kill Critic decisions error:", error);
    res.status(500).json({
      ok: false,
      error: "Decision ledger unavailable",
    });
  }
});

// ================================
// TELEGRAM ACCOUNT
// ================================

app.get("/api/telegram/me", async (req, res) => {
  try {
    res.json({
      ok: true,
      telegram: await getMe(),
    });
  } catch (error) {
    console.error("Telegram /me error:", error);

    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// ================================
// TELEGRAM DIALOGS
// ================================

app.get("/api/telegram/dialogs", async (req, res) => {
  try {
    const limit = req.query.limit || 20;

    res.json({
      ok: true,
      dialogs: await getDialogs(limit),
    });
  } catch (error) {
    console.error("Telegram dialogs error:", error);

    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// ================================
// TELEGRAM MESSAGES
// ================================

app.get("/api/telegram/messages", async (req, res) => {
  try {
    const { chatId } = req.query;
    const limit = req.query.limit || 20;

    if (!chatId) {
      return res.status(400).json({
        ok: false,
        error: "chatId обязателен",
      });
    }

    const messages = await getMessages(chatId, limit);

    res.json({
      ok: true,
      chatId: String(chatId),
      count: messages.length,
      messages,
    });
  } catch (error) {
    console.error("Telegram messages error:", error);

    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// ================================
// TELEGRAM SEND
// ================================

app.post("/api/telegram/send", async (req, res) => {
  try {
    const { chatId, message } = req.body;

    if (!chatId) {
      return res.status(400).json({
        ok: false,
        error: "chatId обязателен",
      });
    }

    if (!message || !String(message).trim()) {
      return res.status(400).json({
        ok: false,
        error: "message обязателен",
      });
    }

    const result = await sendMessage(chatId, message);

    res.json({
      ok: true,
      result,
    });
  } catch (error) {
    console.error("Telegram send error:", error);

    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// ================================
// 404
// ================================

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Endpoint not found",
    method: req.method,
    path: req.path,
  });
});

// ================================
// START
// ================================

app.listen(PORT, HOST, async () => {
  console.log("");
  console.log("================================");
  console.log("       SAMURAIOS CORE");
  console.log("================================");
  console.log(`http://${HOST}:${PORT}`);
  console.log("Version: 1.2.0");
  console.log("Kill Critic Policy: ENABLED");
  console.log("================================");
  console.log("");

  try {
    await connectTelegram();
  } catch (error) {
    console.error("");
    console.error("Telegram connection error:");
    console.error(error.message);
    console.error("");
  }
});
