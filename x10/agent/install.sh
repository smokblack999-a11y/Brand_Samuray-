#!/data/data/com.termux/files/usr/bin/bash
set -eu

pkg update -y
pkg install curl python -y

mkdir -p "$HOME/.x10"
curl -fsSL "https://raw.githubusercontent.com/smokblack999-a11y/Brand_Samuray-/x10/xmas-real-life-mvp-20260928/x10/agent/auto_heal.sh" -o "$HOME/.x10/auto_heal.sh"
chmod 700 "$HOME/.x10/auto_heal.sh"

echo "X10 agent installed."
echo "Create $HOME/.x10/config.env from config.example, then:"
echo "  chmod 600 $HOME/.x10/config.env"
echo "  set -a; . $HOME/.x10/config.env; set +a"
echo "  nohup $HOME/.x10/auto_heal.sh >$HOME/.x10/agent.log 2>&1 &"
