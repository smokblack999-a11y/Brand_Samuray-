(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const state = { id: null, session: null, busy: false, auto: false, stopAuto: false, apiKey: "" };
  const el = {
    apiKey: $("#apiKey"), task: $("#task"), connection: $("#connection"), state: $("#state"),
    notice: $("#notice"), phase: $("#phase"), round: $("#round"), aTurns: $("#aTurns"),
    bTurns: $("#bTurns"), aCount: $("#aCount"), bCount: $("#bCount"), final: $("#final"),
    history: $("#historyList"), start: $("#start"), next: $("#next"), auto: $("#auto"),
    stop: $("#stop"), exportTxt: $("#exportTxt"), exportJson: $("#exportJson"), printPdf: $("#printPdf")
  };

  function setNotice(message, error = false) {
    el.notice.textContent = message;
    el.notice.classList.toggle("error", error);
  }
  function setBusy(value) {
    state.busy = value;
    el.start.disabled = value;
    el.next.disabled = value || !state.session || state.session.status !== "RUNNING";
    el.auto.disabled = value || !state.session || state.session.status !== "RUNNING";
    el.stop.disabled = value || !state.session || state.session.status !== "RUNNING";
  }
  async function api(path, options = {}) {
    const headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
    if (state.apiKey) headers["X-API-Key"] = state.apiKey;
    const response = await fetch(path, Object.assign({}, options, { headers, cache: "no-store" }));
    const type = response.headers.get("content-type") || "";
    const body = type.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const message = body && body.error && body.error.message ? body.error.message : "HTTP " + response.status;
      throw new Error(message);
    }
    return body;
  }
  function node(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = String(text);
    return item;
  }
  function renderTurns(target, turns, agent) {
    target.replaceChildren();
    const own = (turns || []).filter(turn => turn.agent === agent);
    if (!own.length) {
      target.append(node("p", "empty", "Ожидание ответа..."));
      return;
    }
    for (const turn of own) {
      const card = node("article", "turn-card " + (turn.verdict === "PASS" ? "pass" : turn.verdict === "FAIL" ? "fail" : ""));
      const meta = node("div", "turn-meta", (turn.kind || turn.verdict || "TURN") + " · раунд " + (turn.round || "—"));
      const body = node("div", "turn-body");
      if (agent === "A") body.textContent = turn.content || "Пустой ответ";
      else {
        const verdict = node("strong", "verdict " + (turn.verdict === "PASS" ? "good" : "bad"), turn.verdict || "NO VERDICT");
        body.append(verdict);
        for (const [label, values] of [["Проблемы", turn.issues], ["Что исправить", turn.required_changes], ["Пробелы доказательств", turn.evidence_gaps]]) {
          if (Array.isArray(values) && values.length) {
            body.append(node("h4", "", label));
            const list = node("ul");
            values.forEach(value => list.append(node("li", "", value)));
            body.append(list);
          }
        }
        if (turn.confidence !== undefined) {
          body.append(node("small", "confidence", "Уверенность критика: " + Number(turn.confidence).toFixed(2)));
          const scores = [
            ["Требования", turn.requirement_coverage],
            ["Факты", turn.factuality],
            ["Логика", turn.reasoning_quality],
            ["Безопасность", turn.safety]
          ].filter(([, score]) => score !== undefined);
          if (scores.length) {
            const scoreLine = node("p", "confidence", scores.map(([name, score]) => name + ": " + Math.round(Number(score) * 100) + "%").join(" · "));
            body.append(scoreLine);
          }
        }
      }
      card.append(meta, body);
      target.append(card);
    }
  }
  function render(session) {
    state.session = session;
    state.id = session.id;
    el.state.textContent = session.status;
    el.state.className = "pill " + String(session.status).toLowerCase();
    el.phase.textContent = session.phase || "—";
    el.round.textContent = "Раунд " + (session.round || 0) + " / " + (session.maxRounds || 0);
    renderTurns(el.aTurns, session.turns, "A");
    renderTurns(el.bTurns, session.turns, "B");
    el.aCount.textContent = (session.turns || []).filter(t => t.agent === "A").length;
    el.bCount.textContent = (session.turns || []).filter(t => t.agent === "B").length;
    const hasSession = Boolean(session.id);
    [el.exportTxt, el.exportJson, el.printPdf].forEach(button => button.disabled = !hasSession);
    if (session.final) {
      el.final.hidden = false;
      el.final.replaceChildren(node("p", "eyebrow", "FINAL RESULT · " + session.status), node("h3", "", "Итоговый ответ"));
      el.final.append(node("div", "final-content", session.final));
    } else {
      el.final.hidden = true;
      el.final.replaceChildren();
    }
    setBusy(false);
  }
  function sessionPayload() {
    const task = el.task.value.trim();
    if (!task) throw new Error("Сначала введи задачу.");
    return {
      task,
      a: { provider: $("#aProvider").value, model: $("#aModel").value.trim() || undefined },
      b: { provider: $("#bProvider").value, model: $("#bModel").value.trim() || undefined }
    };
  }
  async function loadConfig() {
    const result = await api("/api/dual-ai/config");
    const cfg = result.config;
    if (!$("#aModel").value) $("#aModel").value = cfg.defaults.a.model;
    if (!$("#bModel").value) $("#bModel").value = cfg.defaults.b.model;
    const unavailable = cfg.providers.filter(item => !item.configured).map(item => item.provider);
    const diversity = cfg.modelDiversity && cfg.modelDiversity.sameDefaultModel
      ? " Важно: обе роли сейчас используют одну модель; для более независимой критики назначь B другой модели."
      : "";
    setNotice("Конфигурация загружена. Недоступные провайдеры: " + (unavailable.join(", ") || "нет") + "." + diversity);
    return cfg;
  }
  async function startSession() {
    state.stopAuto = true;
    state.apiKey = el.apiKey.value.trim();
    if (!state.apiKey) throw new Error("Введи CORE_API_KEY для доступа к SAMURAI Core.");
    setBusy(true);
    try {
      const cfg = await loadConfig();
      const payload = sessionPayload();
      const providerA = cfg.providers.find(item => item.provider === payload.a.provider);
      const providerB = cfg.providers.find(item => item.provider === payload.b.provider);
      if (!providerA || !providerA.configured) throw new Error("Провайдер Model A не настроен на сервере.");
      if (!providerB || !providerB.configured) throw new Error("Провайдер Model B не настроен на сервере.");
      const result = await api("/api/dual-ai/session", { method: "POST", body: JSON.stringify(payload) });
      render(result.session);
      setNotice("Сессия создана. Первый ход Model A.");
      await nextTurn();
      await refreshHistory();
    } finally {
      setBusy(false);
    }
  }
  async function nextTurn() {
    if (!state.id || state.busy) return false;
    setBusy(true);
    try {
      const result = await api("/api/dual-ai/turn", { method: "POST", body: JSON.stringify({ id: state.id }) });
      render(result.session);
      setNotice(result.session.status === "COMPLETE" ? "Kill Critic одобрил результат: все пороги качества пройдены." :
        result.session.status === "BLOCKED" ? "Лимит раундов достигнут. Результат не утверждён." : "Ход завершён.");
      await refreshHistory();
      return true;
    } catch (error) {
      setNotice(error.message, true);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function runAuto() {
    if (state.auto || !state.session || state.session.status !== "RUNNING") return;
    state.auto = true;
    state.stopAuto = false;
    el.auto.textContent = "Остановить автодиалог";
    try {
      while (!state.stopAuto && state.session && state.session.status === "RUNNING") {
        const ok = await nextTurn();
        if (!ok || !state.session || state.session.status !== "RUNNING") break;
      }
    } finally {
      state.auto = false;
      el.auto.textContent = "Автодиалог";
      setBusy(false);
    }
  }
  async function stopSession() {
    state.stopAuto = true;
    if (!state.id || !state.session || state.session.status !== "RUNNING") return;
    setBusy(true);
    try {
      const result = await api("/api/dual-ai/stop", { method: "POST", body: JSON.stringify({ id: state.id }) });
      render(result.session);
      setNotice("Сессия остановлена.");
      await refreshHistory();
    } catch (error) { setNotice(error.message, true); }
    finally { setBusy(false); }
  }
  async function refreshHistory() {
    if (!state.apiKey) return;
    try {
      const result = await api("/api/dual-ai/sessions");
      el.history.replaceChildren();
      if (!result.sessions || !result.sessions.length) {
        el.history.append(node("p", "empty", "Сохранённых сессий пока нет."));
        return;
      }
      result.sessions.slice(0, 30).forEach(session => {
        const button = node("button", "history-item");
        button.type = "button";
        const title = node("b", "", session.task);
        const meta = node("small", "", session.status + " · " + new Date(session.updatedAt || session.createdAt).toLocaleString());
        button.append(title, meta);
        button.addEventListener("click", () => loadSession(session.id));
        el.history.append(button);
      });
    } catch (error) { setNotice("История: " + error.message, true); }
  }
  async function loadSession(id) {
    try {
      const result = await api("/api/dual-ai/session/" + encodeURIComponent(id));
      render(result.session);
      el.task.value = result.session.task || "";
      setNotice("Загружена сохранённая сессия.");
    } catch (error) { setNotice(error.message, true); }
  }
  function download(name, type, content) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = node("a");
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function transcript() {
    const session = state.session;
    if (!session) return "";
    const lines = [
      "SAMURAI DUAL AI",
      "Status: " + session.status,
      "Task: " + session.task,
      "Created: " + session.createdAt,
      ""
    ];
    (session.turns || []).forEach(turn => {
      lines.push("[" + turn.agent + " / " + (turn.kind || turn.verdict || "TURN") + " / round " + turn.round + "]");
      lines.push(turn.agent === "A" ? (turn.content || "") : JSON.stringify({
        verdict: turn.verdict, confidence: turn.confidence, issues: turn.issues,
        required_changes: turn.required_changes, evidence_gaps: turn.evidence_gaps
      }, null, 2));
      lines.push("");
    });
    if (session.final) lines.push("FINAL RESULT\n" + session.final);
    return lines.join("\n");
  }
  async function checkCore() {
    try {
      await api("/health");
      el.connection.textContent = "CORE ONLINE";
      el.connection.className = "status-dot online";
      setNotice("SAMURAI Core отвечает. Для защищённых операций нужен API key.");
    } catch (error) {
      el.connection.textContent = "CORE UNAVAILABLE";
      el.connection.className = "status-dot offline";
      setNotice("Core health check: " + error.message, true);
    }
  }

  $("#checkCore").addEventListener("click", checkCore);
  el.start.addEventListener("click", () => startSession().catch(error => { setBusy(false); setNotice(error.message, true); }));
  el.next.addEventListener("click", nextTurn);
  el.auto.addEventListener("click", () => state.auto ? state.stopAuto = true : runAuto());
  el.stop.addEventListener("click", stopSession);
  $("#retryTask").addEventListener("click", () => {
    if (!el.task.value.trim()) { setNotice("Нет задачи для повторного запуска.", true); return; }
    startSession().catch(error => { setBusy(false); setNotice(error.message, true); });
  });
  $("#newSession").addEventListener("click", () => {
    state.stopAuto = true; state.id = null; state.session = null;
    el.task.value = ""; el.aTurns.replaceChildren(node("p", "empty", "Ответы Model A появятся здесь."));
    el.bTurns.replaceChildren(node("p", "empty", "Критика Model B появится здесь."));
    el.state.textContent = "IDLE"; el.state.className = "pill"; el.phase.textContent = "Ожидание сессии";
    el.round.textContent = "—"; el.final.hidden = true;
    [el.next, el.auto, el.stop, el.exportTxt, el.exportJson, el.printPdf].forEach(button => button.disabled = true);
    setNotice("Готово к новой задаче.");
  });
  $("#refreshHistory").addEventListener("click", refreshHistory);
  el.exportTxt.addEventListener("click", () => download("samurai-dual-ai-" + state.id + ".txt", "text/plain;charset=utf-8", transcript()));
  el.exportJson.addEventListener("click", () => download("samurai-dual-ai-" + state.id + ".json", "application/json;charset=utf-8", JSON.stringify(state.session, null, 2)));
  el.printPdf.addEventListener("click", () => window.print());
  window.addEventListener("pagehide", () => { state.apiKey = ""; el.apiKey.value = ""; });
  checkCore();
})();