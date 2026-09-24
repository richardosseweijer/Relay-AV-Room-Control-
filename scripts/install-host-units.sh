#!/usr/bin/env bash
# Install Relay systemd units from deploy/ templates.
#
# Idempotent: re-running overwrites /etc/systemd/system/relay.service and
# /etc/systemd/system/relay-kiosk.service with freshly substituted templates,
# then daemon-reload. Packaged/custom local unit edits under those paths are
# replaced — re-apply local customizations afterward if you had any.
#
# Default: enable --now relay.service; install relay-kiosk.service but do NOT
# enable it (Foyer dual-head prefers relay-kiosk off — LINUX.md §7a). Pass
# --enable-kiosk for Relay-only HDMI (LINUX.md §7b/§7c).
#
# Usage (from repo root or any cwd):
#   sudo bash scripts/install-host-units.sh
#   sudo RELAY_USER=ubuntu bash scripts/install-host-units.sh
#   sudo bash scripts/install-host-units.sh --enable-kiosk
#   sudo bash scripts/install-host-units.sh --with-sudoers
#   sudo bash scripts/install-host-units.sh --skip-preflight   # unusual layouts only
#   sudo bash scripts/install-host.sh          # thin wrapper: units + sudoers
#
# Preflight (before any write): Node/npm on unit PATH (/usr/bin:/usr/local/bin)
# major >= 22, and .vercel/output/nitro.json from `npm run build`. See LINUX.md §6a.
#
# Username (service account = systemd User=):
#   1. RELAY_USER or UNIT_USER if set
#   2. else SUDO_USER when invoked via sudo (the invoking human account)
#   3. else current login name (id -un)
#
# WorkingDirectory / kiosk paths use this checkout (script location), not a
# hardcoded ~/Relay-AV-Room-Control- assumption when the tree lives elsewhere.
#
# Update / pull / reboot do NOT install these units. Run once on the appliance;
# re-run if User= or checkout path changes.
#
# Requires root.

set -euo pipefail

die() {
  echo "install-host-units: $*" >&2
  exit 1
}

ENABLE_KIOSK=0
WITH_SUDOERS=0
SKIP_PREFLIGHT=0
for arg in "$@"; do
  case "${arg}" in
    --enable-kiosk) ENABLE_KIOSK=1 ;;
    --with-sudoers) WITH_SUDOERS=1 ;;
    --skip-preflight) SKIP_PREFLIGHT=1 ;;
    -h|--help)
      sed -n '2,45p' "$0"
      exit 0
      ;;
    *)
      die "unknown argument: ${arg} (supported: --enable-kiosk, --with-sudoers, --skip-preflight)"
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEPLOY_DIR="${REPO_ROOT}/deploy"
SYSTEMD_DIR="/etc/systemd/system"

TEMPLATE_RELAY="${DEPLOY_DIR}/relay.service"
TEMPLATE_KIOSK="${DEPLOY_DIR}/relay-kiosk.service"

# Preflight before root check / any write so a failure leaves the host untouched.
# shellcheck source=scripts/install-host-preflight.sh
source "${SCRIPT_DIR}/install-host-preflight.sh"
if [ "${SKIP_PREFLIGHT}" -eq 1 ]; then
  echo "install-host-units: --skip-preflight set (skipping Node/build checks)"
else
  relay_preflight_all "${REPO_ROOT}" || exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  die "must run as root (try: sudo bash scripts/install-host-units.sh)"
fi

[ -f "${TEMPLATE_RELAY}" ] || die "missing template: ${TEMPLATE_RELAY}"
[ -f "${TEMPLATE_KIOSK}" ] || die "missing template: ${TEMPLATE_KIOSK}"
command -v systemctl >/dev/null 2>&1 || die "systemctl not found"

# Resolve service username (same order as install-host-sudoers.sh)
if [ -n "${RELAY_USER:-}" ]; then
  RELAY_SVC_USER="${RELAY_USER}"
elif [ -n "${UNIT_USER:-}" ]; then
  RELAY_SVC_USER="${UNIT_USER}"
elif [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER}" != "root" ]; then
  RELAY_SVC_USER="${SUDO_USER}"
else
  RELAY_SVC_USER="$(id -un)"
fi

case "${RELAY_SVC_USER}" in
  ''|[!A-Za-z_]*|*[!A-Za-z0-9_-]*)
    die "invalid service username: '${RELAY_SVC_USER}' (set RELAY_USER=…)"
    ;;
esac

if ! id -u "${RELAY_SVC_USER}" >/dev/null 2>&1; then
  die "user '${RELAY_SVC_USER}' does not exist on this host (set RELAY_USER=…)"
fi

# Home for documentation / linger notes (unit paths use REPO_ROOT)
RELAY_HOME="$(getent passwd "${RELAY_SVC_USER}" | cut -d: -f6)"
[ -n "${RELAY_HOME}" ] || die "could not resolve home for ${RELAY_SVC_USER}"

echo "install-host-units: service user = ${RELAY_SVC_USER}"
echo "install-host-units: repo root    = ${REPO_ROOT}"
echo "install-host-units: templates from ${DEPLOY_DIR}"
if [ "${ENABLE_KIOSK}" -eq 1 ]; then
  echo "install-host-units: --enable-kiosk set (will enable --now relay-kiosk)"
else
  echo "install-host-units: relay-kiosk will be installed but NOT enabled (default; Foyer dual-head)"
fi

# shellcheck source=scripts/install-host-units-render.sh
source "${SCRIPT_DIR}/install-host-units-render.sh"

render_unit() {
  local template="$1"
  local dest_name="$2"
  local out="${SYSTEMD_DIR}/${dest_name}"
  local tmp
  tmp="$(mktemp)"
  # shellcheck disable=SC2064
  trap "rm -f '${tmp}'" RETURN

  # 1) Replace placeholder checkout paths (USER or legacy pi) with this REPO_ROOT
  # 2) Replace User=USER / User=pi with the resolved service account
  # Validation: literal User=USER / /home/USER/... are unsubstituted failures.
  # User=pi and /home/pi/... are valid when RELAY_SVC_USER=pi and REPO_ROOT is
  # under that home (Wyse/testbox) — see install-host-units-render.sh.
  # Specific errors already printed by relay_validate_rendered_unit.
  relay_render_unit_file "${template}" "${tmp}" "${REPO_ROOT}" "${RELAY_SVC_USER}" "${dest_name}"
  install -o root -g root -m 0644 "${tmp}" "${out}"
  echo "install-host-units: installed ${out}"
}

render_unit "${TEMPLATE_RELAY}" "relay.service"
render_unit "${TEMPLATE_KIOSK}" "relay-kiosk.service"

# Kiosk launcher must be executable when the unit is later enabled
if [ -f "${REPO_ROOT}/scripts/relay-kiosk.sh" ]; then
  chmod +x "${REPO_ROOT}/scripts/relay-kiosk.sh"
fi

echo "install-host-units: daemon-reload…"
systemctl daemon-reload

echo "install-host-units: enable --now relay.service…"
systemctl enable --now relay.service

if [ "${ENABLE_KIOSK}" -eq 1 ]; then
  echo "install-host-units: enable --now relay-kiosk.service…"
  systemctl enable --now relay-kiosk.service
else
  # Leave enablement alone if already on; print status. Do not force-disable
  # (operator may have intentionally enabled Relay-only HDMI).
  if systemctl is-enabled relay-kiosk.service >/dev/null 2>&1; then
    echo "install-host-units: note — relay-kiosk is currently enabled."
    echo "  Foyer dual-head: sudo systemctl disable --now relay-kiosk  (LINUX.md §7a)"
  else
    echo "install-host-units: relay-kiosk installed, left disabled (default)."
  fi
fi

if [ "${WITH_SUDOERS}" -eq 1 ]; then
  echo "install-host-units: chaining install-host-sudoers.sh…"
  RELAY_USER="${RELAY_SVC_USER}" bash "${SCRIPT_DIR}/install-host-sudoers.sh"
fi

echo
echo "OK — systemd units installed for ${RELAY_SVC_USER}."
echo "Update / pull / reboot do not install these; re-run if User= or checkout path changes."
echo "Re-running replaces ${SYSTEMD_DIR}/relay.service and relay-kiosk.service from deploy/."
echo
echo "Status:"
systemctl --no-pager --full status relay.service || true
if [ "${ENABLE_KIOSK}" -eq 1 ]; then
  systemctl --no-pager --full status relay-kiosk.service || true
fi
echo
echo "Next steps:"
if [ "${WITH_SUDOERS}" -eq 0 ]; then
  echo "  # Host sudoers (nmcli + kiosk systemctl) — once; not installed by pull/Update:"
  echo "  sudo RELAY_USER=${RELAY_SVC_USER} bash ${SCRIPT_DIR}/install-host-sudoers.sh"
  echo "  # Or re-run: sudo bash ${SCRIPT_DIR}/install-host-units.sh --with-sudoers"
  echo "  # Or:        sudo bash ${SCRIPT_DIR}/install-host.sh"
fi
echo "  # Relay-only HDMI kiosk (skip on Foyer dual-head — §7a):"
echo "  #   packages: seatd cage wlr-randr chromium (+ fonts/mesa per LINUX.md §7b)"
echo "  sudo usermod -aG video,render,input,tty ${RELAY_SVC_USER}"
echo "  sudo loginctl enable-linger ${RELAY_SVC_USER}"
echo "  # then log out/in or reboot, then:"
echo "  sudo bash ${SCRIPT_DIR}/install-host-units.sh --enable-kiosk"
echo "  # Foyer dual-head: leave relay-kiosk disabled; Configurator Local display Enable unchecked."
echo
echo "See LINUX.md §6 (units) and §7 (local panel / kiosk)."
