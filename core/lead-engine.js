"use strict";

function scoreLead(text) {
  const value = String(text || "").trim();
  const lower = value.toLowerCase();
  let score = 10;
  const signals = [];

  const strong = ["купить", "заказать", "цена", "стоимость", "сколько стоит", "оплат", "записать", "забронировать", "доставка", "сегодня", "сейчас"];
  const medium = ["интересует", "хочу", "нужен", "нужна", "нужно", "можно", "есть ли", "условия", "наличие"];
  const noise = ["спасибо", "понятно", "ок", "хорошо", "привет"];

  for (const word of strong) if (lower.includes(word)) { score += 15; signals.push(word); }
  for (const word of medium) if (lower.includes(word)) { score += 8; signals.push(word); }
  for (const word of noise) if (lower === word) score -= 5;
  // A price question combined with explicit purchase intent is a strong lead signal.
  if (/(сколько стоит|цена|стоимость|прайс)/i.test(lower) && /(купить|заказать|оплат)/i.test(lower)) {
    score += 25;
    signals.push("pricing_and_purchase_intent");
  }
  if (/\d/.test(value)) score += 5;
  if (value.length > 80) score += 5;

  score = Math.max(0, Math.min(100, score));
  const intent = score >= 70 ? "hot" : score >= 40 ? "warm" : "cold";
  return { score, intent, signals: [...new Set(signals)] };
}

module.exports = { scoreLead };
