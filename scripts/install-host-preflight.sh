#!/usr/bin/env bash
# Preflight for install-host-units.sh (sourced). Safe to source from tests.
# Verifies the Node/npm the systemd unit will see, and that a production build exists.
#
# Unit contract (deploy/relay.service):
#   Environment=PATH=/usr/bin:/usr/local/bin
#   ExecStart=/usr/bin/npm run start
#
# Override for tests: RELAY_UNIT_PATH, RELAY_PREFLIGHT_NPM, RELAY_PREFLIGHT_BUILD_MARKER

# PATH the relay.service unit uses (must match deploy/relay.service Environment=PATH=).
RELAY_UNIT_PATH_DEFAULT="/usr/bin:/usr/local/bin"

# Build artifact produced by `npm run build` (vite vercel/nitro preset).
RELAY_BUILD_MARKER_DEFAULT=".vercel/output/nitro.json"

relay_preflight_die() {
  echo "install-host-units: preflight failed: $*" >&2
  return 1
}

# Print major version number from `node -v` / `v22.19.0` → 22. Empty on failure.
relay_node_major() {
  local ver major
  ver="$1"
  major="$(printf '%s' "${ver}" | sed -n 's/^v*\([0-9][0-9]*\).*/\1/p')"
  printf '%s' "${major}"
}

# Args: repo_root
# Env: RELAY_UNIT_PATH, RELAY_PREFLIGHT_NPM (absolute path override for npm binary check)
relay_preflight_node_npm() {
  local unit_path npm_bin node_bin node_ver major
  unit_path="${RELAY_UNIT_PATH:-${RELAY_UNIT_PATH_DEFAULT}}"

  npm_bin="${RELAY_PREFLIGHT_NPM:-/usr/bin/npm}"
  if [ ! -x "${npm_bin}" ]; then
    relay_preflight_die "missing ${npm_bin} (ExecStart in deploy/relay.service). Install Node 22 via NodeSource — LINUX.md §2. nvm under ~/.nvm is invisible to the unit PATH (${unit_path})."
    return 1
  fi

  # Resolve node the same way the unit will (PATH=unit path only).
  # shellcheck disable=SC2086
  node_bin="$(PATH="${unit_path}" command -v node 2>/dev/null || true)"
  if [ -z "${node_bin}" ] || [ ! -x "${node_bin}" ]; then
    relay_preflight_die "no node on unit PATH=${unit_path}. Install Node 22 via NodeSource — LINUX.md §2. nvm (~/.nvm) is not on that PATH; enabling relay.service would crash-loop."
    return 1
  fi

  node_ver="$("${node_bin}" -v 2>/dev/null || true)"
  major="$(relay_node_major "${node_ver}")"
  if [ -z "${major}" ] || [ "${major}" -lt 22 ]; then
    relay_preflight_die "Node under unit PATH is ${node_ver:-unknown} (${node_bin}); need major >= 22. systemd Environment=PATH=${unit_path} — nvm (~/.nvm) is invisible to the unit. Install Node 22 via NodeSource (LINUX.md §2), then re-run. Enabling now would crash-loop relay.service."
    return 1
  fi

  # npm on unit PATH (same PATH the service uses when ExecStart runs /usr/bin/npm)
  if ! PATH="${unit_path}" command -v npm >/dev/null 2>&1; then
    relay_preflight_die "npm not found on unit PATH=${unit_path} (ExecStart=/usr/bin/npm). Install Node 22 via NodeSource — LINUX.md §2."
    return 1
  fi

  echo "install-host-units: preflight OK — node ${node_ver} (${node_bin}), npm ${npm_bin}"
  return 0
}

# Args: repo_root
# Env: RELAY_PREFLIGHT_BUILD_MARKER (relative to repo_root or absolute)
relay_preflight_build() {
  local repo_root marker path
  repo_root="$1"
  marker="${RELAY_PREFLIGHT_BUILD_MARKER:-${RELAY_BUILD_MARKER_DEFAULT}}"
  case "${marker}" in
    /*) path="${marker}" ;;
    *) path="${repo_root}/${marker}" ;;
  esac
  if [ ! -f "${path}" ]; then
    relay_preflight_die "missing build output (${path}). Run: npm ci --include=dev && npm run build (LINUX.md §5), then re-run. Enabling now would crash-loop relay.service."
    return 1
  fi
  echo "install-host-units: preflight OK — build present (${path})"
  return 0
}

# Args: repo_root
relay_preflight_all() {
  local repo_root="$1"
  relay_preflight_node_npm || return 1
  relay_preflight_build "${repo_root}" || return 1
  return 0
}
