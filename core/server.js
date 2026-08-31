"use strict";

const express = require("express");
const cors = require("cors");

const app = express();

const HOST = "127.0.0.1";
const PORT = 8787;

app.use(cors());

app.use(
  express.json({
    limit: "25mb"
  })
);

app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    service: "SamuraiOS Core",
    version: "1.0.0",
    openai: Boolean(
      process.env.OPENAI_API_KEY
    ),
    time: new Date().toISOString()
  });
});

app.listen(PORT, HOST, () => {
  console.log("");
  console.log("================================");
  console.log("       SAMURAIOS CORE");
  console.log("================================");
  console.log(`http://${HOST}:${PORT}`);
  console.log("================================");
  console.log("");
});
