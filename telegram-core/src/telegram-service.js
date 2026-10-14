"use strict";

const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

function createTelegramService({ apiId, apiHash, sessionStore, connectionRetries = 5 }) {
  const parsedApiId = Number(apiId);
  if (!Number.isSafeInteger(parsedApiId) || parsedApiId <= 0) throw new Error("TELEGRAM_API_ID must be a positive integer");
  if (!apiHash || typeof apiHash !== "string") throw new Error("TELEGRAM_API_HASH is required");
  if (!sessionStore) throw new Error("sessionStore is required");

  let client = null;
  let pendingLogin = null;
  let connecting = null;

  function newClient(session = "") {
    return new TelegramClient(new StringSession(session), parsedApiId, apiHash, {
      connectionRetries,
      useWSS: false
    });
  }

  async function connect() {
    if (client?.connected) return client;
    if (connecting) return connecting;
    connecting = (async () => {
      const saved = sessionStore.load() || "";
      const candidate = newClient(saved);
      await candidate.connect();
      if (saved && !(await candidate.checkAuthorization())) {
        await candidate.disconnect();
        throw new Error("saved Telegram session is no longer authorized; sign in again");
      }
      client = candidate;
      return client;
    })();
    try { return await connecting; } finally { connecting = null; }
  }

  async function requestCode(phoneNumber) {
    if (typeof phoneNumber !== "string" || !/^\+[1-9]\d{6,14}$/.test(phoneNumber)) {
      throw new Error("phoneNumber must be in international E.164 format");
    }
    if (pendingLogin) throw new Error("a login attempt is already pending");
    const candidate = newClient("");
    await candidate.connect();
    try {
      const sent = await candidate.sendCode({ apiId: parsedApiId, apiHash }, phoneNumber);
      pendingLogin = { client: candidate, phoneNumber, phoneCodeHash: sent.phoneCodeHash, createdAt: Date.now() };
      return { phoneNumber, phoneCodeHash: sent.phoneCodeHash, nextStep: "verify_code" };
    } catch (error) {
      await candidate.disconnect().catch(() => {});
      throw error;
    }
  }

  async function verifyCode({ phoneNumber, phoneCodeHash, phoneCode }) {
    if (!pendingLogin || pendingLogin.phoneNumber !== phoneNumber || pendingLogin.phoneCodeHash !== phoneCodeHash) {
      throw new Error("no matching pending login; request a new code");
    }
    if (Date.now() - pendingLogin.createdAt > 10 * 60 * 1000) {
      await pendingLogin.client.disconnect().catch(() => {});
      pendingLogin = null;
      throw new Error("login attempt expired; request a new code");
    }
    try {
      await pendingLogin.client.signIn({ phoneNumber, phoneCodeHash, phoneCode: String(phoneCode || "").trim() });
      const loggedIn = pendingLogin.client;
      sessionStore.save(loggedIn.session.save());
      client = loggedIn;
      pendingLogin = null;
      return { authenticated: true, account: await getMe() };
    } catch (error) {
      const message = String(error?.message || "");
      if (/SESSION_PASSWORD_NEEDED/i.test(message) || /password/i.test(error?.errorMessage || "")) {
        return { authenticated: false, requiresPassword: true };
      }
      throw error;
    }
  }

  async function verifyPassword(password) {
    if (!pendingLogin) throw new Error("no pending login requires a password");
    await pendingLogin.client.signInWithPassword({ password: async () => String(password || "") });
    client = pendingLogin.client;
    sessionStore.save(client.session.save());
    pendingLogin = null;
    return { authenticated: true, account: await getMe() };
  }

  async function requireClient() {
    const active = await connect();
    if (!(await active.checkAuthorization())) throw new Error("Telegram account is not authorized");
    return active;
  }

  async function getMe() {
    const active = await requireClient();
    const me = await active.getMe();
    return { id: String(me.id), username: me.username || null, firstName: me.firstName || null, lastName: me.lastName || null, phone: me.phone || null };
  }

  async function getChats(limit = 30) {
    const active = await requireClient();
    const safeLimit = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 30));
    const dialogs = await active.getDialogs({ limit: safeLimit });
    return dialogs.map(dialog => ({
      id: String(dialog.id),
      title: dialog.name || dialog.entity?.title || dialog.entity?.firstName || dialog.entity?.username || "Unknown",
      username: dialog.entity?.username || null,
      unreadCount: Number(dialog.unreadCount || 0),
      pinned: Boolean(dialog.pinned)
    }));
  }

  async function getMessages(chatId, limit = 30) {
    if (!chatId || !/^-?\d+$/.test(String(chatId))) throw new Error("chatId must be a numeric Telegram peer ID");
    const active = await requireClient();
    const safeLimit = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 30));
    const messages = await active.getMessages(String(chatId), { limit: safeLimit });
    return messages.map(message => ({
      id: String(message.id),
      text: message.message || "",
      date: message.date ? new Date(message.date * 1000).toISOString() : null,
      outgoing: Boolean(message.out),
      senderId: message.senderId == null ? null : String(message.senderId),
      replyToMessageId: message.replyToMsgId == null ? null : String(message.replyToMsgId)
    }));
  }

  async function sendMessage({ chatId, text }) {
    if (!chatId || !/^-?\d+$/.test(String(chatId))) throw new Error("chatId must be a numeric Telegram peer ID");
    if (typeof text !== "string" || !text.trim() || text.length > 4096) throw new Error("text must contain 1–4096 characters");
    const active = await requireClient();
    const message = await active.sendMessage(String(chatId), { message: text });
    return { chatId: String(chatId), messageId: String(message.id), text: message.message || text };
  }

  async function sendPhoto({ chatId, filePath, caption = "" }) {
    if (!chatId || !/^-?\d+$/.test(String(chatId))) throw new Error("chatId must be a numeric Telegram peer ID");
    if (typeof filePath !== "string" || !filePath) throw new Error("filePath is required");
    const active = await requireClient();
    const message = await active.sendFile(String(chatId), { file: filePath, caption: String(caption).slice(0, 1024) });
    return { chatId: String(chatId), messageId: message?.id == null ? null : String(message.id) };
  }

  async function logout() {
    if (client) {
      await client.invoke(new (require("telegram").Api.auth.LogOut)()).catch(() => {});
      await client.disconnect().catch(() => {});
      client = null;
    }
    if (pendingLogin) {
      await pendingLogin.client.disconnect().catch(() => {});
      pendingLogin = null;
    }
    sessionStore.remove();
    return { loggedOut: true };
  }

  async function close() {
    if (client) await client.disconnect().catch(() => {});
    if (pendingLogin) await pendingLogin.client.disconnect().catch(() => {});
    client = null;
    pendingLogin = null;
  }

  return Object.freeze({ requestCode, verifyCode, verifyPassword, connect, getMe, getChats, getMessages, sendMessage, sendPhoto, logout, close });
}

module.exports = { createTelegramService };
