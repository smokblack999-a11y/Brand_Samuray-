"use strict";
const http = require("node:http");
const crypto = require("node:crypto");
const express = require("express");
const { WebSocketServer } = require("ws");
const {
  hashToken, validateUsername, validateCiphertext, hashPassword, verifyPassword,
  issueAccessToken, verifyAccessToken, newRefreshToken
} = require("./security");

function createApp({ pool, jwtSecret, allowedOrigin = "https://localhost" }) {
  if (!pool || !jwtSecret || String(jwtSecret).length < 32) throw new Error("pool and 32+ character JWT_SECRET are required");
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.headers.origin && req.headers.origin === allowedOrigin) res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    next();
  });
  const buckets = new Map();
  function rateLimit(req, res, next) {
    const key = req.ip || "unknown";
    const now = Date.now();
    const current = buckets.get(key) || { start: now, count: 0 };
    if (now - current.start > 60000) { current.start = now; current.count = 0; }
    current.count++;
    buckets.set(key, current);
    if (current.count > 120) return res.status(429).json({ ok: false, error: "RATE_LIMITED" });
    next();
  }
  app.use(rateLimit);
  function auth(req, res, next) {
    try {
      const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(req.get("authorization") || "");
      if (!match) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
      req.user = verifyAccessToken(match[1], jwtSecret);
      next();
    } catch { return res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); }
  }
  app.get("/health", (_req, res) => res.json({ ok: true, service: "samurai-messenger-api", version: "0.1.0" }));

  app.post("/v1/auth/register", async (req, res, next) => {
    try {
      const { username, displayName, password } = req.body || {};
      if (!validateUsername(username) || typeof displayName !== "string" || !displayName.trim() || displayName.length > 80) {
        return res.status(400).json({ ok: false, error: "INVALID_PROFILE" });
      }
      const passwordHash = await hashPassword(password);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const created = await client.query(
          "INSERT INTO messenger_users(username, display_name, password_hash) VALUES($1,$2,$3) RETURNING id, username, display_name",
          [username.toLowerCase(), displayName.trim(), passwordHash]
        );
        const user = created.rows[0];
        await client.query("INSERT INTO messenger_user_privacy(user_id) VALUES($1)", [user.id]);
        const device = await client.query("INSERT INTO messenger_devices(user_id, device_label) VALUES($1,$2) RETURNING id", [user.id, "Android"]);
        const refresh = newRefreshToken();
        await client.query("INSERT INTO messenger_sessions(user_id, device_id, refresh_token_hash, expires_at) VALUES($1,$2,$3,now()+interval '30 days')", [user.id, device.rows[0].id, hashToken(refresh)]);
        await client.query("COMMIT");
        return res.status(201).json({ ok: true, user, accessToken: issueAccessToken(user, jwtSecret), refreshToken: refresh, tokenType: "Bearer", expiresIn: 900 });
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ ok: false, error: "USERNAME_TAKEN" });
      next(error);
    }
  });

  app.post("/v1/auth/login", async (req, res, next) => {
    try {
      const { username, password } = req.body || {};
      if (!validateUsername(username) || typeof password !== "string") return res.status(401).json({ ok: false, error: "INVALID_CREDENTIALS" });
      const result = await pool.query("SELECT id, username, display_name, password_hash FROM messenger_users WHERE username=$1 AND deleted_at IS NULL", [username.toLowerCase()]);
      const user = result.rows[0];
      if (!user || !(await verifyPassword(password, user.password_hash))) return res.status(401).json({ ok: false, error: "INVALID_CREDENTIALS" });
      const device = await pool.query("INSERT INTO messenger_devices(user_id, device_label) VALUES($1,$2) RETURNING id", [user.id, "Android"]);
      const refresh = newRefreshToken();
      await pool.query("INSERT INTO messenger_sessions(user_id, device_id, refresh_token_hash, expires_at) VALUES($1,$2,$3,now()+interval '30 days')", [user.id, device.rows[0].id, hashToken(refresh)]);
      const publicUser = { id: user.id, username: user.username, display_name: user.display_name };
      return res.json({ ok: true, user: publicUser, accessToken: issueAccessToken(publicUser, jwtSecret), refreshToken: refresh, tokenType: "Bearer", expiresIn: 900 });
    } catch (error) { next(error); }
  });

  app.post("/v1/auth/refresh", async (req, res, next) => {
    try {
      const token = req.body && req.body.refreshToken;
      if (typeof token !== "string" || token.length < 32) return res.status(401).json({ ok: false, error: "INVALID_REFRESH_TOKEN" });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const found = await client.query(
          "SELECT s.id AS session_id, s.device_id, u.id, u.username, u.display_name FROM messenger_sessions s JOIN messenger_users u ON u.id=s.user_id WHERE s.refresh_token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() FOR UPDATE",
          [hashToken(token)]
        );
        if (!found.rowCount) { await client.query("ROLLBACK"); return res.status(401).json({ ok: false, error: "INVALID_REFRESH_TOKEN" }); }
        const row = found.rows[0];
        const next = newRefreshToken();
        await client.query("UPDATE messenger_sessions SET revoked_at=now() WHERE id=$1", [row.session_id]);
        await client.query("INSERT INTO messenger_sessions(user_id, device_id, refresh_token_hash, expires_at) VALUES($1,$2,$3,now()+interval '30 days')", [row.id, row.device_id, hashToken(next)]);
        await client.query("COMMIT");
        const user = { id: row.id, username: row.username, display_name: row.display_name };
        return res.json({ ok: true, user, accessToken: issueAccessToken(user, jwtSecret), refreshToken: next, tokenType: "Bearer", expiresIn: 900 });
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    } catch (error) { next(error); }
  });

  app.get("/v1/me", auth, async (req, res, next) => {
    try {
      const result = await pool.query("SELECT id, username, display_name FROM messenger_users WHERE id=$1 AND deleted_at IS NULL", [req.user.sub]);
      if (!result.rowCount) return res.status(404).json({ ok: false, error: "USER_NOT_FOUND" });
      res.json({ ok: true, user: result.rows[0] });
    } catch (error) { next(error); }
  });

  app.get("/v1/privacy", auth, async (req, res, next) => {
    try {
      const result = await pool.query("SELECT share_presence, send_read_receipts, send_delivery_receipts FROM messenger_user_privacy WHERE user_id=$1", [req.user.sub]);
      if (!result.rowCount) return res.status(404).json({ ok: false, error: "PRIVACY_NOT_FOUND" });
      res.json({ ok: true, privacy: result.rows[0] });
    } catch (error) { next(error); }
  });
  app.patch("/v1/privacy", auth, async (req, res, next) => {
    try {
      const allowed = ["share_presence", "send_read_receipts", "send_delivery_receipts"];
      const entries = Object.entries(req.body || {});
      if (!entries.length || entries.some(([key, value]) => !allowed.includes(key) || typeof value !== "boolean")) return res.status(400).json({ ok: false, error: "INVALID_PRIVACY_SETTINGS" });
      const sets = entries.map(([key], i) => key + "=$" + (i + 2)).join(", ");
      const values = entries.map(([, value]) => value);
      const result = await pool.query("UPDATE messenger_user_privacy SET " + sets + ", updated_at=now() WHERE user_id=$1 RETURNING share_presence, send_read_receipts, send_delivery_receipts", [req.user.sub, ...values]);
      res.json({ ok: true, privacy: result.rows[0] });
    } catch (error) { next(error); }
  });

  app.post("/v1/conversations/direct", auth, async (req, res, next) => {
    const peer = req.body && req.body.username;
    if (!validateUsername(peer)) return res.status(400).json({ ok: false, error: "INVALID_USERNAME" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query("SELECT id, username, display_name FROM messenger_users WHERE username=$1 AND deleted_at IS NULL", [peer.toLowerCase()]);
      if (!target.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ ok: false, error: "USER_NOT_FOUND" }); }
      const peerId = target.rows[0].id;
      const existing = await client.query(
        "SELECT c.id FROM messenger_conversations c JOIN messenger_memberships a ON a.conversation_id=c.id AND a.user_id=$1 AND a.left_at IS NULL JOIN messenger_memberships b ON b.conversation_id=c.id AND b.user_id=$2 AND b.left_at IS NULL WHERE c.kind='direct' LIMIT 1",
        [req.user.sub, peerId]
      );
      let conversationId = existing.rows[0] && existing.rows[0].id;
      if (!conversationId) {
        const created = await client.query("INSERT INTO messenger_conversations(kind, created_by) VALUES('direct',$1) RETURNING id", [req.user.sub]);
        conversationId = created.rows[0].id;
        await client.query("INSERT INTO messenger_memberships(conversation_id,user_id,role) VALUES($1,$2,'member'),($1,$3,'member')", [conversationId, req.user.sub, peerId]);
      }
      await client.query("COMMIT");
      res.status(201).json({ ok: true, conversation: { id: conversationId, kind: "direct", peer: target.rows[0] } });
    } catch (error) { await client.query("ROLLBACK"); next(error); }
    finally { client.release(); }
  });

  app.get("/v1/conversations", auth, async (req, res, next) => {
    try {
      const result = await pool.query(
        "SELECT c.id,c.kind,c.title,c.created_at, m.user_id AS peer_id,u.username AS peer_username,u.display_name AS peer_name FROM messenger_conversations c JOIN messenger_memberships mine ON mine.conversation_id=c.id AND mine.user_id=$1 AND mine.left_at IS NULL LEFT JOIN messenger_memberships m ON m.conversation_id=c.id AND m.user_id<>$1 AND m.left_at IS NULL LEFT JOIN messenger_users u ON u.id=m.user_id WHERE c.archived_at IS NULL ORDER BY c.created_at DESC LIMIT 100",
        [req.user.sub]
      );
      res.json({ ok: true, conversations: result.rows });
    } catch (error) { next(error); }
  });

  app.post("/v1/conversations/:id/messages", auth, async (req, res, next) => {
    try {
      const { clientMessageId, ciphertext, nonce, protocolVersion } = req.body || {};
      if (!/^[0-9a-f-]{36}$/i.test(clientMessageId || "") || !validateCiphertext(ciphertext) || typeof nonce !== "string" || Buffer.from(nonce, "base64").length < 12 || Buffer.from(nonce, "base64").length > 32 || !Number.isInteger(protocolVersion) || protocolVersion < 1) {
        return res.status(400).json({ ok: false, error: "INVALID_MESSAGE_ENVELOPE" });
      }
      const member = await pool.query("SELECT 1 FROM messenger_memberships WHERE conversation_id=$1 AND user_id=$2 AND left_at IS NULL", [req.params.id, req.user.sub]);
      if (!member.rowCount) return res.status(404).json({ ok: false, error: "CONVERSATION_NOT_FOUND" });
      const inserted = await pool.query(
        "INSERT INTO messenger_messages(conversation_id,sender_id,client_message_id,payload_ciphertext,payload_nonce,protocol_version) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(sender_id,client_message_id) DO UPDATE SET client_message_id=EXCLUDED.client_message_id RETURNING id,conversation_id,sender_id,client_message_id,created_at",
        [req.params.id, req.user.sub, clientMessageId, Buffer.from(ciphertext, "base64"), Buffer.from(nonce, "base64"), protocolVersion]
      );
      const recipients = await pool.query("SELECT user_id FROM messenger_memberships WHERE conversation_id=$1 AND left_at IS NULL AND user_id<>$2", [req.params.id, req.user.sub]);
      for (const recipient of recipients.rows) {
        if (typeof req.app.locals.broadcastToUser === "function") {
          req.app.locals.broadcastToUser(recipient.user_id, {
            type: "message_available",
            conversationId: req.params.id,
            messageId: inserted.rows[0].id,
            createdAt: inserted.rows[0].created_at
          });
        }
      }
      res.status(201).json({ ok: true, message: inserted.rows[0], state: "accepted" });
    } catch (error) { next(error); }
  });

  app.get("/v1/conversations/:id/messages", auth, async (req, res, next) => {
    try {
      const member = await pool.query("SELECT 1 FROM messenger_memberships WHERE conversation_id=$1 AND user_id=$2 AND left_at IS NULL", [req.params.id, req.user.sub]);
      if (!member.rowCount) return res.status(404).json({ ok: false, error: "CONVERSATION_NOT_FOUND" });
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 100));
      const result = await pool.query(
        "SELECT m.id,m.conversation_id,m.sender_id,m.client_message_id,m.payload_ciphertext,m.payload_nonce,m.protocol_version,m.created_at, (SELECT max(dr.acknowledged_at) FROM messenger_delivery_receipts dr JOIN messenger_devices dd ON dd.id=dr.device_id WHERE dr.message_id=m.id AND dd.user_id<>m.sender_id) AS delivered_at, (SELECT max(rr.read_at) FROM messenger_read_receipts rr WHERE rr.message_id=m.id AND rr.user_id<>m.sender_id) AS read_at FROM messenger_messages m WHERE m.conversation_id=$1 AND m.deleted_at IS NULL ORDER BY m.created_at DESC,m.id DESC LIMIT $2",
        [req.params.id, limit]
      );
      res.json({ ok: true, messages: result.rows.map(m => ({ ...m, payload_ciphertext: m.payload_ciphertext.toString("base64"), payload_nonce: m.payload_nonce.toString("base64") })) });
    } catch (error) { next(error); }
  });

  app.post("/v1/messages/:id/delivered", auth, async (req, res, next) => {
    try {
      const own = await pool.query("SELECT send_delivery_receipts FROM messenger_user_privacy WHERE user_id=$1", [req.user.sub]);
      if (!own.rowCount || !own.rows[0].send_delivery_receipts) return res.json({ ok: true, acknowledged: false, reason: "PRIVATE_BY_RECIPIENT_SETTING" });
      const result = await pool.query(
        "INSERT INTO messenger_delivery_receipts(message_id,device_id) SELECT m.id,d.id FROM messenger_messages m JOIN messenger_memberships x ON x.conversation_id=m.conversation_id AND x.user_id=$2 AND x.left_at IS NULL JOIN messenger_devices d ON d.user_id=$2 AND d.revoked_at IS NULL WHERE m.id=$1 AND m.sender_id<>$2 ON CONFLICT DO NOTHING RETURNING message_id",
        [req.params.id, req.user.sub]
      );
      res.json({ ok: true, acknowledged: result.rowCount > 0 });
    } catch (error) { next(error); }
  });

  app.post("/v1/messages/:id/read", auth, async (req, res, next) => {
    try {
      const own = await pool.query("SELECT send_read_receipts FROM messenger_user_privacy WHERE user_id=$1", [req.user.sub]);
      if (!own.rowCount || !own.rows[0].send_read_receipts) return res.json({ ok: true, acknowledged: false, reason: "PRIVATE_BY_RECIPIENT_SETTING" });
      const result = await pool.query(
        "INSERT INTO messenger_read_receipts(message_id,user_id) SELECT m.id,$2 FROM messenger_messages m JOIN messenger_memberships x ON x.conversation_id=m.conversation_id AND x.user_id=$2 AND x.left_at IS NULL WHERE m.id=$1 AND m.sender_id<>$2 ON CONFLICT DO NOTHING RETURNING message_id",
        [req.params.id, req.user.sub]
      );
      res.json({ ok: true, acknowledged: result.rowCount > 0 });
    } catch (error) { next(error); }
  });

  app.use((error, _req, res, _next) => {
    if (error.code === "23505") return res.status(409).json({ ok: false, error: "CONFLICT" });
    console.error("messenger_api_error", error.code || error.name);
    res.status(500).json({ ok: false, error: "INTERNAL_ERROR" });
  });
  return app;
}

function attachRealtime(server, { jwtSecret }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/v1/realtime") return socket.destroy();
    try {
      const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(req.headers.authorization || "");
      if (!match) throw new Error("Missing bearer token");
      const user = verifyAccessToken(match[1], jwtSecret);
      wss.handleUpgrade(req, socket, head, ws => { ws.userId = user.sub; wss.emit("connection", ws, req); });
    } catch { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); }
  });
  wss.on("connection", ws => ws.send(JSON.stringify({ type: "connected" })));
  return wss;
}

async function main() {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: true } : undefined, max: 10 });
  const secret = process.env.JWT_SECRET || "";
  if (secret.length < 32) throw new Error("JWT_SECRET must contain at least 32 characters");
  const app = createApp({ pool, jwtSecret: secret, allowedOrigin: process.env.CORS_ORIGIN || "https://localhost" });
  const server = http.createServer(app);
  const realtime = attachRealtime(server, { jwtSecret: secret });
  app.locals.broadcastToUser = (userId, payload) => {
    for (const client of realtime.clients) {
      if (client.readyState === 1 && client.userId === userId) client.send(JSON.stringify(payload));
    }
  };
  const port = Number(process.env.PORT || 8790);
  server.listen(port, "0.0.0.0", () => process.stdout.write("SAMURAI Messenger API listening on " + port + "\n"));
  const shutdown = () => server.close(() => pool.end().finally(() => process.exit(0)));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
if (require.main === module) main().catch(error => { process.stderr.write(error.message + "\n"); process.exit(1); });
module.exports = { createApp, attachRealtime };
