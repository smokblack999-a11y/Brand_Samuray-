#!/data/data/com.termux/files/usr/bin/bash
set -eu
: "${X10_AGENT_URL:?Set X10_AGENT_URL to your trusted release URL}"
pkg update -y
pkg install python curl -y
mkdir -p "$HOME/x10-agent"
curl -fsSL "$X10_AGENT_URL" -o "$HOME/x10-agent/agent.py"
chmod 700 "$HOME/x10-agent/agent.py"
echo "Agent installed. Configure X10_HUB, X10_AGENT_ID and X10_AGENT_TOKEN before starting."
