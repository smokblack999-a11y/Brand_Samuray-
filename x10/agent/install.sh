#!/data/data/com.termux/files/usr/bin/bash
set -eu
pkg update -y
pkg install python -y
mkdir -p "$HOME/x10-agent"
curl -fsSLo "$HOME/x10-agent/agent.py" "$X10_AGENT_URL"
chmod 700 "$HOME/x10-agent/agent.py"
echo "Agent installed. Set X10_HUB, X10_AGENT_ID and X10_AGENT_TOKEN before starting."
