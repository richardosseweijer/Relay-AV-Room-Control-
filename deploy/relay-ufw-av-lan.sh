#!/usr/bin/env bash
# Narrow ufw helper for Relay Apply AV-LAN (installed to /usr/local/sbin/relay-ufw-av-lan).
# argv only — no shell from callers. Never opens 8081 to Anywhere / 0.0.0.0/0.
set -euo pipefail

COMMENT="Relay-AV-LAN"
UFW=/usr/sbin/ufw

die() { echo "relay-ufw-av-lan: $*" >&2; exit 1; }

is_anywhere() {
  local c
  c="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
  case "$c" in
    anywhere|any|0.0.0.0/0|::/0|0.0.0.0|\*) return 0 ;;
    *) return 1 ;;
  esac
}

valid_cidr() {
  local c="$1"
  [[ "$c" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$ ]] || return 1
  is_anywhere "$c" && return 1
  return 0
}

cmd="${1:-}"
case "$cmd" in
  status)
    exec "$UFW" status
    ;;
  status-numbered)
    exec "$UFW" status numbered
    ;;
  status-verbose)
    exec "$UFW" status verbose
    ;;
  reload)
    exec "$UFW" reload
    ;;
  allow)
    cidr="${2:-}"
    [ -n "$cidr" ] || die "allow needs CIDR"
    valid_cidr "$cidr" || die "refusing CIDR: $cidr"
    exec "$UFW" allow from "$cidr" to any port 8081 proto tcp comment "$COMMENT"
    ;;
  delete)
    cidr="${2:-}"
    [ -n "$cidr" ] || die "delete needs CIDR"
    valid_cidr "$cidr" || die "refusing CIDR: $cidr"
    exec "$UFW" delete allow from "$cidr" to any port 8081 proto tcp comment "$COMMENT"
    ;;
  *)
    die "usage: relay-ufw-av-lan status|status-numbered|status-verbose|reload|allow <cidr>|delete <cidr>"
    ;;
esac
