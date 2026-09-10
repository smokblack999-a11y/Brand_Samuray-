"use strict";

function scoreLead(text) {
  const value = String(text || "").trim();
  const lower = value.toLowerCase();
  let score = 10;
  const signals = [];

  // Explicit purchase/transaction signals carry enough weight to classify
  // an otherwise ordinary buying-intent sentence as hot.
  const strong = ["купить", "заказать", "цена", "стоимость", "сколько стоит", "оплат", "записать", "забронировать", "доставка", "сегодня", "сейчас"];
  const medium = ["интересует", "хочу", "нужен", "нужна", "нужно", "можно", "есть ли", "условия", "наличие"];
  const noise = ["спасибо", "понятно", "ок", "хорошо", "привет"];

  for (const word of strong) if (lower.includes(word)) { score += 25; signals.push(word); }
  for (const word of medium) if (lower.includes(word)) { score += 8; signals.push(word); }
  for (const word of noise) if (lower === word) score -= 5;
  if (/\d/.test(value)) score += 5;
  if (value.length > 80) score += 5;

  score = Math.max(0, Math.min(100, score));
  const intent = score >= 70 ? "hot" : score >= 40 ? "warm" : "cold";
  return { score, intent, signals: [...new Set(signals)] };
}

module.exports = { scoreLead };
