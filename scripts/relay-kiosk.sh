#!/bin/sh
# Cage client on tty1: pin HDMI, wait for Relay panel on AV-LAN URL, then Chromium on Wayland.
# RELAY_VIDEO_OUTPUT / RELAY_KIOSK_URL come from data/relay-kiosk.env (written by Configurator).
set -eu
CHROME="$(command -v chromium || command -v chromium-browser || echo /usr/bin/chromium)"
URL="${RELAY_KIOSK_URL:-}"

if [ -z "$URL" ]; then
  echo "relay-kiosk: RELAY_KIOSK_URL is empty — set panel HDMI in Configurator (Room → Local display)." >&2
  exit 1
fi

case "$URL" in
  http://0.0.0.0:*|https://0.0.0.0:*|http://\[::\]:*|https://\[::\]:*)
    echo "relay-kiosk: refusing unspecified listen URL: $URL" >&2
    exit 1
    ;;
esac

apply_output() {
  command -v wlr-randr >/dev/null 2>&1 || return 0
  [ -n "${RELAY_VIDEO_OUTPUT:-}" ] || return 0
  i=0
  while [ "$i" -lt 15 ]; do
    if wlr-randr >/dev/null 2>&1; then
      break
    fi
    i=$((i + 1))
    sleep 0.4
  done
  wlr-randr --output "$RELAY_VIDEO_OUTPUT" --on >/dev/null 2>&1 || true
  wlr-randr 2>/dev/null | awk '
    /^[A-Za-z0-9._-]+/ { print $1 }
  ' | while read -r name; do
    [ -n "$name" ] || continue
    [ "$name" = "$RELAY_VIDEO_OUTPUT" ] && continue
    wlr-randr --output "$name" --off >/dev/null 2>&1 || true
  done
}

wait_panel() {
  i=0
  while [ "$i" -lt 40 ]; do
    if command -v curl >/dev/null 2>&1 && curl -sf -o /dev/null --max-time 1 "$URL"; then
      return 0
    fi
    i=$((i + 1))
    sleep 0.5
  done
}

apply_output &
wait_panel || true
# Optional: RELAY_KIOSK_NO_SANDBOX=1 adds --no-sandbox (Snap Chromium under cage only).
EXTRA=""
if [ "${RELAY_KIOSK_NO_SANDBOX:-}" = "1" ]; then
  EXTRA="--no-sandbox"
fi
# shellcheck disable=SC2086
exec "$CHROME" \
  --ozone-platform=wayland \
  --enable-features=UseOzonePlatform \
  --kiosk \
  --no-first-run \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-translate \
  --autoplay-policy=no-user-gesture-required \
  --check-for-update-interval=31536000 \
  --disable-dev-shm-usage \
  $EXTRA \
  "$URL"
