"use strict";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}
function renderPlainText(value) {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}
module.exports = { escapeHtml, renderPlainText };
