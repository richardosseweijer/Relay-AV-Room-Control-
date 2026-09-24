#!/usr/bin/env bash
# First-boot / appliance host installer for Relay (systemd units + sudoers).
#
# Idempotent wrapper around:
#   scripts/install-host-units.sh   (relay + relay-kiosk units; kiosk enable default OFF)
#   scripts/install-host-sudoers.sh (relay-kiosk + relay-nmcli drop-ins)
#
# Usage:
#   sudo bash scripts/install-host.sh
#   sudo RELAY_USER=ubuntu bash scripts/install-host.sh
#   sudo bash scripts/install-host.sh --enable-kiosk   # Relay-only HDMI; not for Foyer dual-head
#
# Requires root. Update / pull / reboot do NOT run this.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "install-host: must run as root (try: sudo bash scripts/install-host.sh)" >&2
  exit 1
fi

# Forward only known flags; units script validates.
exec bash "${SCRIPT_DIR}/install-host-units.sh" --with-sudoers "$@"
