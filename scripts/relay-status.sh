#!/bin/bash
# Usage: bash scripts/relay-status.sh
# From anywhere: bash ~/Relay-AV-Room-Control-/scripts/relay-status.sh

set -e
PORT="${RELAY_PORT:-8081}"
echo "Relay status"
echo "------------"
echo "host:     $(hostname)  $(hostname -I 2>/dev/null | awk '{print $1}')"
echo "time:     $(date)"
echo

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files relay.service >/dev/null 2>&1; then
  echo "service:  $(systemctl is-active relay.service 2>/dev/null || echo unknown)"
  echo "enabled:  $(systemctl is-enabled relay.service 2>/dev/null || echo no)"
else
  echo "service:  relay.service not installed"
fi

if command -v ss >/dev/null 2>&1; then
  if ss -lptn 2>/dev/null | grep -q ":${PORT} "; then
    echo "port:     ${PORT} is open"
  else
    echo "port:     ${PORT} is not listening"
  fi
elif command -v lsof >/dev/null 2>&1; then
  if lsof -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port:     ${PORT} is open"
  else
    echo "port:     ${PORT} is not listening"
  fi
fi

CODE="$(curl -s -o /tmp/relay-status.body -w "%{http_code}" --max-time 3 "http://127.0.0.1:${PORT}/" || echo 000)"
echo "http:     ${CODE}  http://127.0.0.1:${PORT}/"
if [ "${CODE}" = "200" ] || [ "${CODE}" = "304" ]; then
  echo "result:   running"
  exit 0
fi
echo "result:   not answering"
echo "logs:     sudo journalctl -u relay -e --no-pager"
exit 1
