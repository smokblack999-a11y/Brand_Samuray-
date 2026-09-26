export class Hamylion {
  constructor({ baseUrl, apiKey }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  async send(type, payload, idempotencyKey) {
    const response = await fetch(this.baseUrl + "/v1/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: JSON.stringify({ type, payload, idempotency_key: idempotencyKey }),
    });
    if (!response.ok) throw new Error("HAMYLION HTTP " + response.status);
    return response.json();
  }

  async getEvent(eventId) {
    const response = await fetch(this.baseUrl + "/v1/events/" + encodeURIComponent(eventId), {
      headers: { "X-API-Key": this.apiKey },
    });
    if (!response.ok) throw new Error("HAMYLION HTTP " + response.status);
    return response.json();
  }

  async ack(eventId) {
    const response = await fetch(this.baseUrl + "/v1/events/" + encodeURIComponent(eventId) + "/ack", {
      method: "POST",
      headers: { "X-API-Key": this.apiKey },
    });
    if (!response.ok) throw new Error("HAMYLION HTTP " + response.status);
    return response.json();
  }

  connect({ wsUrl, onEvent, onError, projectId }) {
    const suffix =
      "?project_id=" + encodeURIComponent(projectId || "default-project") +
      "&api_key=" + encodeURIComponent(this.apiKey);
    const ws = new WebSocket(wsUrl + suffix);
    ws.onmessage = (message) => onEvent?.(JSON.parse(message.data));
    ws.onerror = (error) => onError?.(error);
    return ws;
  }
}
