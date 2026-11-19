"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const { Pool } = require("pg");
const WebSocket = require("ws");
const { createApp, attachRealtime } = require("../src/server");

test("two-account chat, privacy receipts, realtime and refresh rotation", {
  skip: !process.env.DATABASE_URL
}, async (t) => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const jwtSecret = crypto.randomBytes(48).toString("hex");
  const app = createApp({ pool, jwtSecret });
  const server = http.createServer(app);
  const wss = attachRealtime(server, { jwtSecret });
  app.locals.broadcastToUser = (userId, payload) => {
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN && client.userId === userId) {
        client.send(JSON.stringify(payload));
      }
    }
  };

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const ids = [];
  let recipientSocket;

  t.after(async () => {
    if (recipientSocket) recipientSocket.close();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
    if (ids.length) {
      // Messages deliberately retain sender_id with ON DELETE RESTRICT for
      // audit integrity. Remove test-owned conversations first so their
      // messages/receipts cascade, then remove the test accounts.
      await pool.query(
        "DELETE FROM messenger_conversations WHERE id IN (SELECT conversation_id FROM messenger_memberships WHERE user_id = ANY($1::uuid[]))",
        [ids]
      );
      await pool.query("DELETE FROM messenger_users WHERE id = ANY($1::uuid[])", [ids]);
    }
    await pool.end();
  });

  async function request(path, token, method = "GET", body) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const json = await response.json();
    return { status: response.status, json };
  }

  async function register(prefix) {
    const username = prefix + "_" + crypto.randomBytes(5).toString("hex");
    const result = await request("/v1/auth/register", null, "POST", {
      username, displayName: username, password: "correct horse battery staple"
    });
    assert.equal(result.status, 201);
    ids.push(result.json.user.id);
    return { ...result.json, username };
  }

  const sender = await register("sender");
  const recipient = await register("recipient");
  const outsider = await register("outsider");

  const direct = await request("/v1/conversations/direct", sender.accessToken, "POST", {
    username: recipient.username
  });
  assert.equal(direct.status, 201);
  const conversationId = direct.json.conversation.id;

  const wsUrl = "ws://127.0.0.1:" + server.address().port + "/v1/realtime";
  recipientSocket = new WebSocket(wsUrl, { headers: { Authorization: "Bearer " + recipient.accessToken } });
  const socketEvents = [];
  recipientSocket.on("message", (data) => socketEvents.push(JSON.parse(data.toString())));
  await new Promise((resolve, reject) => {
    recipientSocket.once("open", resolve);
    recipientSocket.once("error", reject);
  });
  await new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (socketEvents.some((event) => event.type === "connected")) return resolve();
      if (Date.now() - started > 3000) return reject(new Error("WebSocket did not announce connected"));
      setTimeout(poll, 20);
    };
    poll();
  });

  const encryptedBytes = crypto.randomBytes(48);
  const nonceBytes = crypto.randomBytes(12);
  const sent = await request("/v1/conversations/" + conversationId + "/messages", sender.accessToken, "POST", {
    clientMessageId: crypto.randomUUID(),
    ciphertext: encryptedBytes.toString("base64"),
    nonce: nonceBytes.toString("base64"),
    protocolVersion: 1
  });
  assert.equal(sent.status, 201);
  const messageId = sent.json.message.id;

  await new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (socketEvents.some((event) => event.type === "message_available" && event.messageId === messageId)) return resolve();
      if (Date.now() - started > 3000) return reject(new Error("Message notification did not reach the recipient WebSocket"));
      setTimeout(poll, 20);
    };
    poll();
  });

  const received = await request("/v1/conversations/" + conversationId + "/messages", recipient.accessToken);
  assert.equal(received.status, 200);
  assert.equal(received.json.messages.length, 1);
  assert.equal(received.json.messages[0].payload_ciphertext, encryptedBytes.toString("base64"));

  const privacyOff = await request("/v1/privacy", recipient.accessToken, "PATCH", {
    send_delivery_receipts: false, send_read_receipts: false
  });
  assert.equal(privacyOff.status, 200);
  const hiddenDelivered = await request("/v1/messages/" + messageId + "/delivered", recipient.accessToken, "POST", {});
  const hiddenRead = await request("/v1/messages/" + messageId + "/read", recipient.accessToken, "POST", {});
  assert.equal(hiddenDelivered.json.acknowledged, false);
  assert.equal(hiddenRead.json.acknowledged, false);

  await request("/v1/privacy", recipient.accessToken, "PATCH", {
    send_delivery_receipts: true, send_read_receipts: true
  });
  const delivered = await request("/v1/messages/" + messageId + "/delivered", recipient.accessToken, "POST", {});
  const read = await request("/v1/messages/" + messageId + "/read", recipient.accessToken, "POST", {});
  assert.equal(delivered.json.acknowledged, true);
  assert.equal(read.json.acknowledged, true);

  const senderView = await request("/v1/conversations/" + conversationId + "/messages", sender.accessToken);
  assert.ok(senderView.json.messages[0].delivered_at);
  assert.ok(senderView.json.messages[0].read_at);

  const forbidden = await request("/v1/conversations/" + conversationId + "/messages", outsider.accessToken);
  assert.equal(forbidden.status, 404);

  const rotated = await request("/v1/auth/refresh", null, "POST", { refreshToken: sender.refreshToken });
  assert.equal(rotated.status, 200);
  const oldRefresh = await request("/v1/auth/refresh", null, "POST", { refreshToken: sender.refreshToken });
  assert.equal(oldRefresh.status, 401);
  const me = await request("/v1/me", rotated.json.accessToken);
  assert.equal(me.status, 200);
  assert.equal(me.json.user.id, sender.user.id);
});
