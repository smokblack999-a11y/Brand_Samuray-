# X10 Telegram Control

Uses the official Telegram Bot API over HTTPS and does not expose the bot token to the hub.

Required environment:

```text
X10_TELEGRAM_BOT_TOKEN=...
X10_HUB_URL=https://hub.example.com
CORE_API_KEY=...
X10_TELEGRAM_CHAT_IDS=123456789,987654321
```

Commands:

```text
/status
/restart camera-01
/audit
```

Only explicitly configured Telegram chat IDs are accepted.
