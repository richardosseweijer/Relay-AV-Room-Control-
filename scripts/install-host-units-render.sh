#!/usr/bin/env bash
# Pure sed + validate for deploy/ unit templates → rendered unit file.
# Sourced by install-host-units.sh; unit-tested without root / systemd.
#
# relay_render_unit_file TEMPLATE OUT_PATH REPO_ROOT SVC_USER DEST_NAME
#   Writes substituted unit to OUT_PATH. DEST_NAME is only for error messages.
#   Exits non-zero (via relay_render_die) on validation failure.

relay_render_die() {
  echo "install-host-units: $*" >&2
  return 1
}

# Escape sed replacement for paths that may contain & \ /
relay_escape_sed_repl() {
  printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'
}

# Validate a rendered unit after USER/pi placeholder substitution.
# Args: rendered_file dest_name repo_root svc_user
relay_validate_rendered_unit() {
  local tmp="$1"
  local dest_name="$2"
  local repo_root="$3"
  local svc_user="$4"

  # Literal template token USER must not remain. `pi` is a valid appliance
  # account (Wyse/testbox); User=pi after sub is success when svc_user=pi.
  if grep -qE '^User=USER$' "${tmp}"; then
    relay_render_die "${dest_name}: User= placeholder not substituted"
    return 1
  fi
  if [ "${svc_user}" != "pi" ] && grep -qE '^User=pi$' "${tmp}"; then
    relay_render_die "${dest_name}: User=pi placeholder not substituted"
    return 1
  fi

  if ! grep -qE "^User=${svc_user}$" "${tmp}"; then
    relay_render_die "${dest_name}: rendered unit missing User=${svc_user} (check template placeholders)"
    return 1
  fi

  # Fail only on literal /home/USER/... template token.
  if grep -qE '/home/USER/Relay-AV-Room-Control-' "${tmp}"; then
    relay_render_die "${dest_name}: path placeholder not substituted"
    return 1
  fi

  # Legacy /home/pi/... is fine when REPO_ROOT is that tree (correct render).
  # Fail only when it remains as an unsubstituted leftover (REPO_ROOT elsewhere).
  if grep -qE '/home/pi/Relay-AV-Room-Control-' "${tmp}"; then
    case "${repo_root}" in
      /home/pi/Relay-AV-Room-Control-|/home/pi/Relay-AV-Room-Control-/*) ;;
      *)
        relay_render_die "${dest_name}: path placeholder not substituted"
        return 1
        ;;
    esac
  fi

  # WorkingDirectory (relay.service) must equal REPO_ROOT when present.
  if grep -qE '^WorkingDirectory=' "${tmp}"; then
    local wd
    wd="$(grep -E '^WorkingDirectory=' "${tmp}" | head -n1 | sed 's/^WorkingDirectory=//')"
    if [ "${wd}" != "${repo_root}" ]; then
      relay_render_die "${dest_name}: WorkingDirectory='${wd}' != REPO_ROOT='${repo_root}'"
      return 1
    fi
  fi

  # Kiosk paths (EnvironmentFile / ExecStart) must use REPO_ROOT, not leftovers.
  if grep -qE 'Relay-AV-Room-Control-' "${tmp}"; then
    if ! grep -qF "${repo_root}" "${tmp}"; then
      relay_render_die "${dest_name}: rendered unit missing checkout path ${repo_root}"
      return 1
    fi
  fi

  return 0
}

# Render template → out_path with USER/pi → svc_user and checkout → repo_root.
relay_render_unit_file() {
  local template="$1"
  local out_path="$2"
  local repo_root="$3"
  local svc_user="$4"
  local dest_name="${5:-$(basename "${out_path}")}"

  local repo_esc user_esc tmp
  repo_esc="$(relay_escape_sed_repl "${repo_root}")"
  user_esc="$(relay_escape_sed_repl "${svc_user}")"
  tmp="$(mktemp)"
  # shellcheck disable=SC2064
  trap "rm -f '${tmp}'" RETURN

  sed \
    -e "s|/home/USER/Relay-AV-Room-Control-|${repo_esc}|g" \
    -e "s|/home/pi/Relay-AV-Room-Control-|${repo_esc}|g" \
    -e "s|^User=USER$|User=${user_esc}|" \
    -e "s|^User=pi$|User=${user_esc}|" \
    "${template}" > "${tmp}"

  relay_validate_rendered_unit "${tmp}" "${dest_name}" "${repo_root}" "${svc_user}" || return 1

  install -m 0644 "${tmp}" "${out_path}"
}
