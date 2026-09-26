#!/usr/bin/env bash
# Install Relay host sudoers drop-ins from deploy/ templates.
#
# Idempotent: re-running overwrites /etc/sudoers.d/relay-kiosk,
# /etc/sudoers.d/relay-nmcli, and /etc/sudoers.d/relay-ufw with freshly
# substituted templates (visudo-checked).
#
# Usage (from repo root or any cwd):
#   sudo bash scripts/install-host-sudoers.sh
#   sudo RELAY_USER=ubuntu bash scripts/install-host-sudoers.sh
#
# Username (service account = systemd User= on relay.service / relay-kiosk.service):
#   1. RELAY_USER or SUDOERS_USER if set
#   2. else SUDO_USER when invoked via sudo (the invoking human account)
#   3. else current login name (id -un) — only useful if already root as that user
#
# Update / pull / reboot do NOT install these drop-ins. Run once on the appliance;
# re-run if User= changes.
#
# Requires root. Refuses to write without privileges.

set -euo pipefail

die() {
  echo "install-host-sudoers: $*" >&2
  exit 1
}

if [ "$(id -u)" -ne 0 ]; then
  die "must run as root (try: sudo bash scripts/install-host-sudoers.sh)"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEPLOY_DIR="${REPO_ROOT}/deploy"

TEMPLATE_KIOSK="${DEPLOY_DIR}/sudoers.relay-kiosk"
TEMPLATE_NMCLI="${DEPLOY_DIR}/sudoers.relay-nmcli"
TEMPLATE_UFW="${DEPLOY_DIR}/sudoers.relay-ufw"

[ -f "${TEMPLATE_KIOSK}" ] || die "missing template: ${TEMPLATE_KIOSK}"
[ -f "${TEMPLATE_NMCLI}" ] || die "missing template: ${TEMPLATE_NMCLI}"
[ -f "${TEMPLATE_UFW}" ] || die "missing template: ${TEMPLATE_UFW}"
command -v visudo >/dev/null 2>&1 || die "visudo not found (install sudo package)"

# Resolve service username
if [ -n "${RELAY_USER:-}" ]; then
  RELAY_SVC_USER="${RELAY_USER}"
elif [ -n "${SUDOERS_USER:-}" ]; then
  RELAY_SVC_USER="${SUDOERS_USER}"
elif [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER}" != "root" ]; then
  RELAY_SVC_USER="${SUDO_USER}"
else
  RELAY_SVC_USER="$(id -un)"
fi

# Linux-ish username: letters/digits/_/- starting with letter or _
case "${RELAY_SVC_USER}" in
  ''|[!A-Za-z_]*|*[!A-Za-z0-9_-]*)
    die "invalid service username: '${RELAY_SVC_USER}' (set RELAY_USER=…)"
    ;;
esac

if ! id -u "${RELAY_SVC_USER}" >/dev/null 2>&1; then
  die "user '${RELAY_SVC_USER}' does not exist on this host (set RELAY_USER=…)"
fi

echo "install-host-sudoers: service user = ${RELAY_SVC_USER}"
echo "install-host-sudoers: templates from ${DEPLOY_DIR}"

install_one() {
  local name="$1"
  local template="$2"
  local dest="/etc/sudoers.d/${name}"
  local tmp

  tmp="$(mktemp)"
  # shellcheck disable=SC2064
  trap "rm -f '${tmp}'" RETURN

  # Substitute leading "USER " placeholder only (matches deploy templates).
  sed "s/^USER /${RELAY_SVC_USER} /" "${template}" > "${tmp}"

  if ! grep -qE "^${RELAY_SVC_USER} " "${tmp}"; then
    die "${name}: template did not contain a leading USER placeholder to replace"
  fi

  echo "install-host-sudoers: validating ${name} (pre-install)…"
  visudo -cf "${tmp}" || die "${name}: visudo rejected rendered template (not installing)"

  install -o root -g root -m 0440 "${tmp}" "${dest}"

  echo "install-host-sudoers: validating ${dest} (post-install)…"
  visudo -cf "${dest}" || {
    rm -f "${dest}"
    die "${name}: visudo rejected installed file — removed ${dest}"
  }

  echo "install-host-sudoers: installed ${dest} (mode 0440)"
}

HELPER_UFW_SRC="${DEPLOY_DIR}/relay-ufw-av-lan.sh"
HELPER_UFW_DST="/usr/local/sbin/relay-ufw-av-lan"
[ -f "${HELPER_UFW_SRC}" ] || die "missing helper: ${HELPER_UFW_SRC}"
install -o root -g root -m 0755 "${HELPER_UFW_SRC}" "${HELPER_UFW_DST}"
echo "install-host-sudoers: installed ${HELPER_UFW_DST} (mode 0755)"

install_one "relay-kiosk" "${TEMPLATE_KIOSK}"
install_one "relay-nmcli" "${TEMPLATE_NMCLI}"
install_one "relay-ufw" "${TEMPLATE_UFW}"

echo
echo "OK — host sudoers drop-ins installed for ${RELAY_SVC_USER}."
echo "Update / pull / reboot do not install these; re-run this script if User= changes."
echo
echo "Next — smoke checks (must NOT prompt for a password):"
echo "  sudo -u ${RELAY_SVC_USER} sudo -n /usr/bin/systemctl status relay-kiosk.service || true"
echo "  sudo -u ${RELAY_SVC_USER} sudo -n /usr/bin/nmcli -t -f NAME connection show >/dev/null && echo nmcli OK"
echo "  sudo -u ${RELAY_SVC_USER} sudo -n /usr/local/sbin/relay-ufw-av-lan status >/dev/null && echo ufw OK"
echo
echo "See LINUX.md §5b (nmcli + ufw) and §7c (relay-kiosk)."
