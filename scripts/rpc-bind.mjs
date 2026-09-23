/**
 * Phase A4 — pure helpers so Samba `net rpc shutdown` sources from AV-LAN IPv4.
 * Shared by engine-lan.ts and unit tests (plain .mjs, JSDoc-typed for checkJs).
 */

/**
 * @param {string} localAddress
 * @returns {string}
 */
export function smbBindInterfacesConf(localAddress) {
  return `[global]\ninterfaces = ${localAddress}/32\nbind interfaces only = yes\n`;
}

/**
 * @param {string} host
 * @param {string} user
 * @param {string} password
 * @param {string} [smbConfPath]
 * @returns {string[]}
 */
export function netRpcShutdownArgs(host, user, password, smbConfPath) {
  const args = ["rpc", "shutdown", "-I", host, "-U", `${user}%${password}`, "-f", "-t", "0"];
  if (smbConfPath) args.unshift("-s", smbConfPath);
  return args;
}
