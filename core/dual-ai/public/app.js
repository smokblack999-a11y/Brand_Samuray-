"use strict";

const $ = (id) => document.getElementById(id);
let session = null;
let connected = false;
let busy = false;

function apiKey() {
  return $("apiKey").value.trim();
}

function headers(extra = {}) {
  return { "X-API-Key": apiKey(), "Content-Type": "application/json", ...extra };
}

function setStatus(text) {
  $("status").textContent = text;
}

function errorText(error) {
  return error?.message || String(error);
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: headers(options.headers || {})
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || body?.error || `HTTP ${response.status}`);
  }
  return body;
}

function turnCard(turn) {
  const card = document.createElement("div");
  card.className = "turn";

  const meta = document.createElement("div");
  meta.className = "turn-meta";
  meta.textContent = `TURN ${turn.turn} · ${turn.phase || ""} · ${turn.role || ""} · ${turn.model || ""}`;

  const pre = document.createElement("pre");
  pre.textContent = turn.content || "";

  card.append(meta, pre);
  return card;
}

function render() {
  if (!session) return;
  $("sessionId").textContent = session.id;
  $("phase").textContent = session.phase || "—";
  $("gate").textContent = session.lastGate
    ? (session.lastGate.pass ? "PASS" : `BLOCK: ${session.lastGate.reasons.join(", ")}`)
    : "—";

  $("agentAInfo").textContent = `${session.agentA.provider} / ${session.agentA.model}`;
  $("agentBInfo").textContent = `${session.agentB.provider} / ${session.agentB.model}`;

  $("agentA").replaceChildren();
  $("agentB").replaceChildren();

  for (const turn of session.turns || []) {
    (turn.agent === "A" ? $("agentA") : $("agentB")).appendChild(turnCard(turn));
  }

  $("final").textContent = session.finalAnswer || (
    session.status === "BLOCKED"
      ? "KILL CRITIC заблокировал выпуск: требуется ещё исправление или ручной разбор."
      : "Диалог продолжается…"
  );

  const terminal = ["COMPLETE", "BLOCKED", "STOPPED", "ERROR"].includes(session.status);
  $("nextBtn").disabled = !session || terminal || busy;
  $("stopBtn").disabled = !session || terminal || busy;
}

async function connect() {
  sessionStorage.setItem("samurai_core_api_key", apiKey());
  try {
    const data = await request("/api/dual/config");
    connected = true;
    setStatus(data.agents?.A?.configured && data.agents?.B?.configured ? "ONLINE" : "PARTIAL");
    $("modelA").value = data.agents?.A?.model || $("modelA").value;
    $("modelB").value = data.agents?.B?.model || $("modelB").value;
  } catch (error) {
    connected = false;
    setStatus(`AUTH ERROR`);
    alert(errorText(error));
  }
}

async function runStart() {
  if (!connected) await connect();
  const task = $("task").value.trim();
  if (!task) return alert("Введите TASK");

  busy = true;
  setStatus("RUNNING");
  try {
    const created = await request("/api/dual/sessions", {
      method: "POST",
      body: JSON.stringify({
        task,
        mode: $("mode").value,
        maxCycles: Number($("maxCycles").value || 2),
        modelA: $("modelA").value.trim(),
        modelB: $("modelB").value.trim()
      })
    });
    session = created.session;
    session = (await request(`/api/dual/sessions/${session.id}/turn`, { method: "POST", body: "{}" })).session;
    render();
    setStatus(session.status);
  } catch (error) {
    setStatus("ERROR");
    alert(errorText(error));
  } finally {
    busy = false;
    render();
  }
}

async function nextTurn() {
  if (!session || busy) return;
  busy = true;
  setStatus("RUNNING");
  try {
    session = (await request(`/api/dual/sessions/${session.id}/turn`, {
      method: "POST",
      body: "{}"
    })).session;
    render();
    setStatus(session.status);
  } catch (error) {
    setStatus("ERROR");
    alert(errorText(error));
  } finally {
    busy = false;
    render();
  }
}

async function stop() {
  if (!session || busy) return;
  try {
    session = (await request(`/api/dual/sessions/${session.id}/stop`, { method: "POST", body: "{}" })).session;
    render();
    setStatus(session.status);
  } catch (error) {
    alert(errorText(error));
  }
}

async function exportTxt() {
  if (!session) return;
  const response = await fetch(`/api/dual/sessions/${session.id}/export?format=txt`, {
    headers: { "X-API-Key": apiKey() }
  });
  if (!response.ok) return alert("Не удалось экспортировать");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dual-ai-${session.id}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

$("connectBtn").addEventListener("click", connect);
$("startBtn").addEventListener("click", runStart);
$("nextBtn").addEventListener("click", nextTurn);
$("stopBtn").addEventListener("click", stop);
$("exportBtn").addEventListener("click", exportTxt);
$("apiKey").value = sessionStorage.getItem("samurai_core_api_key") || "";
$("apiKey").addEventListener("change", () => sessionStorage.setItem("samurai_core_api_key", apiKey()));
render();

\n$("jsonBtn").addEventListener("click", async () => {
  if (!session) return;
  const response = await fetch(`/api/dual/sessions/${session.id}/export?format=json`, {
    headers: { "X-API-Key": apiKey() }
  });
  if (!response.ok) return alert("Не удалось экспортировать JSON");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dual-ai-${session.id}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

$("pdfBtn").addEventListener("click", () => {
  if (!session) return;
  window.print();
});
