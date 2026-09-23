/**
 * C1 — in-box venue CA + leaf (ECDSA P-256) via Node `crypto` only.
 * No openssl shell-out; no ACME/LE. Leaf carries IP SAN for live NIC2 IPv4.
 *
 * Lifetimes: CA ~10y, leaf ~2y (see SECURITY.md / LINUX.md).
 */
import {
  createSign,
  generateKeyPairSync,
  randomBytes,
  X509Certificate,
} from "node:crypto";

/**
 * @typedef {{
 *   caCertPem: string,
 *   caKeyPem: string,
 *   leafCertPem: string,
 *   leafKeyPem: string,
 *   sanIp: string,
 *   caFingerprint256: string,
 *   leafFingerprint256: string,
 *   caNotAfter: Date,
 *   leafNotAfter: Date,
 *   keyType: "ECDSA P-256",
 * }} VenueTlsMaterial
 */

export const VENUE_TLS_KEY_TYPE = "ECDSA P-256";
export const VENUE_TLS_CA_YEARS = 10;
export const VENUE_TLS_LEAF_YEARS = 2;

const OID = {
  ecdsaWithSha256: "1.2.840.10045.4.3.2",
  commonName: "2.5.4.3",
  organizationName: "2.5.4.10",
  basicConstraints: "2.5.29.19",
  keyUsage: "2.5.29.15",
  extKeyUsage: "2.5.29.37",
  subjectAltName: "2.5.29.17",
  serverAuth: "1.3.6.1.5.5.7.3.1",
};

/** @param {number} n @returns {Buffer} */
function encodeLength(n) {
  if (n < 0x80) return Buffer.from([n]);
  if (n < 0x100) return Buffer.from([0x81, n]);
  if (n < 0x10000) return Buffer.from([0x82, (n >> 8) & 0xff, n & 0xff]);
  throw new Error(`DER length too large: ${n}`);
}

/** @param {number} tag @param {Buffer} content @returns {Buffer} */
function tlv(tag, content) {
  return Buffer.concat([Buffer.from([tag]), encodeLength(content.length), content]);
}

/** @param {Buffer[]} parts @returns {Buffer} */
function seq(...parts) {
  return tlv(0x30, Buffer.concat(parts));
}

/** @param {Buffer[]} parts @returns {Buffer} */
function setOf(...parts) {
  return tlv(0x31, Buffer.concat(parts));
}

/** @param {boolean} v @returns {Buffer} */
function bool(v) {
  return tlv(0x01, Buffer.from([v ? 0xff : 0x00]));
}

/** @param {Buffer} bytes @returns {Buffer} */
function integer(bytes) {
  let b = Buffer.from(bytes);
  while (b.length > 1 && b[0] === 0x00 && (b[1] & 0x80) === 0) b = b.subarray(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0x00]), b]);
  return tlv(0x02, b);
}

/** @param {number} n @returns {Buffer} */
function integerFromNumber(n) {
  if (!Number.isInteger(n) || n < 0) throw new Error("integerFromNumber expects non-neg int");
  const hex = n.toString(16);
  const padded = hex.length % 2 ? `0${hex}` : hex;
  return integer(Buffer.from(padded, "hex"));
}

/** @param {string} s @returns {Buffer} */
function utf8String(s) {
  return tlv(0x0c, Buffer.from(s, "utf8"));
}

/** @param {string} oid @returns {Buffer} */
function objectIdentifier(oid) {
  const parts = oid.split(".").map((p) => Number(p));
  if (parts.length < 2) throw new Error(`bad OID ${oid}`);
  const body = [40 * parts[0] + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i];
    if (!Number.isInteger(v) || v < 0) throw new Error(`bad OID component ${v}`);
    const stack = [v & 0x7f];
    v >>= 7;
    while (v > 0) {
      stack.push(0x80 | (v & 0x7f));
      v >>= 7;
    }
    for (let j = stack.length - 1; j >= 0; j--) body.push(stack[j]);
  }
  return tlv(0x06, Buffer.from(body));
}

/** @param {Buffer} bits @param {number} [unused=0] @returns {Buffer} */
function bitString(bits, unused = 0) {
  return tlv(0x03, Buffer.concat([Buffer.from([unused]), bits]));
}

/** @param {Buffer} b @returns {Buffer} */
function octetString(b) {
  return tlv(0x04, b);
}

/** @param {string} oid @param {Buffer} value @param {boolean} [critical=false] @returns {Buffer} */
function extension(oid, value, critical = false) {
  const parts = [objectIdentifier(oid)];
  if (critical) parts.push(bool(true));
  parts.push(octetString(value));
  return seq(...parts);
}

/**
 * UTCTime YYMMDDHHMMSSZ for years 1950–2049; GeneralizedTime otherwise.
 * @param {Date} d
 * @returns {Buffer}
 */
function time(d) {
  const y = d.getUTCFullYear();
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
  if (y >= 1950 && y <= 2049) {
    const body =
      pad(y % 100) +
      pad(d.getUTCMonth() + 1) +
      pad(d.getUTCDate()) +
      pad(d.getUTCHours()) +
      pad(d.getUTCMinutes()) +
      pad(d.getUTCSeconds()) +
      "Z";
    return tlv(0x17, Buffer.from(body, "ascii"));
  }
  const full =
    String(y) +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z";
  return tlv(0x18, Buffer.from(full, "ascii"));
}

/** @param {{ cn: string, o: string }} name @returns {Buffer} */
function nameDer(name) {
  // RDN = SET OF AttributeTypeAndValue; AttributeTypeAndValue = SEQUENCE { oid, value }.
  const cn = seq(objectIdentifier(OID.commonName), utf8String(name.cn));
  const o = seq(objectIdentifier(OID.organizationName), utf8String(name.o));
  return seq(setOf(o), setOf(cn));
}

/** @param {import("node:crypto").KeyObject} publicKey @returns {Buffer} */
function subjectPublicKeyInfo(publicKey) {
  return publicKey.export({ type: "spki", format: "der" });
}

/**
 * @param {string} ipv4
 * @returns {Buffer} 4 octets
 */
export function ipv4ToOctets(ipv4) {
  const parts = String(ipv4 ?? "").trim().split(".");
  if (parts.length !== 4) throw new Error(`invalid IPv4 for SAN: ${ipv4}`);
  const octets = parts.map((p) => Number(p));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error(`invalid IPv4 for SAN: ${ipv4}`);
  }
  return Buffer.from(octets);
}

/** @param {string} ipv4 @returns {boolean} */
export function isValidIpv4(ipv4) {
  try {
    ipv4ToOctets(ipv4);
    return true;
  } catch {
    return false;
  }
}

/** @param {Date} from @param {number} years @returns {Date} */
export function addYears(from, years) {
  const d = new Date(from.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

/**
 * @param {import("node:crypto").KeyObject} privateKey
 * @param {Buffer} tbs
 * @returns {Buffer}
 */
function signEcdsaSha256(privateKey, tbs) {
  const signer = createSign("SHA256");
  signer.update(tbs);
  signer.end();
  return bitString(signer.sign(privateKey));
}

/**
 * @param {{
 *   serial: Buffer,
 *   issuer: { cn: string, o: string },
 *   subject: { cn: string, o: string },
 *   notBefore: Date,
 *   notAfter: Date,
 *   publicKey: import("node:crypto").KeyObject,
 *   extensions: Buffer[],
 * }} opts
 * @returns {Buffer}
 */
function tbsCertificate(opts) {
  const version = tlv(0xa0, integerFromNumber(2)); // v3
  const serial = integer(opts.serial);
  const sigAlg = seq(objectIdentifier(OID.ecdsaWithSha256));
  const issuer = nameDer(opts.issuer);
  const validity = seq(time(opts.notBefore), time(opts.notAfter));
  const subject = nameDer(opts.subject);
  const spki = subjectPublicKeyInfo(opts.publicKey);
  const exts = tlv(0xa3, seq(...opts.extensions));
  return seq(version, serial, sigAlg, issuer, validity, subject, spki, exts);
}

/**
 * @param {Buffer} tbs
 * @param {import("node:crypto").KeyObject} issuerKey
 * @returns {Buffer}
 */
function wrapCertificate(tbs, issuerKey) {
  const sigAlg = seq(objectIdentifier(OID.ecdsaWithSha256));
  const sig = signEcdsaSha256(issuerKey, tbs);
  return seq(tbs, sigAlg, sig);
}

/**
 * @param {Buffer} der
 * @param {"CERTIFICATE"|"PRIVATE KEY"} label
 * @returns {string}
 */
export function derToPem(der, label) {
  const b64 = der.toString("base64");
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

/** @returns {{ privateKey: import("node:crypto").KeyObject, publicKey: import("node:crypto").KeyObject, keyPem: string }} */
function generateEcKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const keyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return { privateKey, publicKey, keyPem };
}

/**
 * Build a private CA + server leaf with IP SAN.
 * Callers must soft-skip when outbound is None / missing IPv4 before invoking.
 *
 * @param {{ sanIp: string, now?: Date, caYears?: number, leafYears?: number }} opts
 * @returns {VenueTlsMaterial}
 */
export function generateVenueTlsMaterial(opts) {
  const sanIp = String(opts.sanIp ?? "").trim();
  if (!isValidIpv4(sanIp) || sanIp === "0.0.0.0") {
    throw new Error(`generateVenueTlsMaterial: need a real IPv4 SAN (got ${sanIp || "empty"})`);
  }

  const now = opts.now ? new Date(opts.now) : new Date();
  const notBefore = new Date(now.getTime() - 5 * 60 * 1000);
  const caYears = opts.caYears ?? VENUE_TLS_CA_YEARS;
  const leafYears = opts.leafYears ?? VENUE_TLS_LEAF_YEARS;
  const caNotAfter = addYears(notBefore, caYears);
  const leafNotAfter = addYears(notBefore, leafYears);

  const ca = generateEcKey();
  const leaf = generateEcKey();

  const caName = { cn: "Relay Venue CA", o: "Relay" };
  const leafName = { cn: `Relay Venue ${sanIp}`, o: "Relay" };

  // CA: basicConstraints CA:true; keyUsage keyCertSign|cRLSign (bits 5,6).
  const caExts = [
    extension(OID.basicConstraints, seq(bool(true)), true),
    extension(OID.keyUsage, bitString(Buffer.from([0x06]), 1), true),
  ];

  const caTbs = tbsCertificate({
    serial: randomBytes(16),
    issuer: caName,
    subject: caName,
    notBefore,
    notAfter: caNotAfter,
    publicKey: ca.publicKey,
    extensions: caExts,
  });
  const caCertPem = derToPem(wrapCertificate(caTbs, ca.privateKey), "CERTIFICATE");

  // Leaf: SAN IP; EKU serverAuth; keyUsage digitalSignature|keyEncipherment.
  const ipSan = tlv(0x87, ipv4ToOctets(sanIp)); // context-specific [7] iPAddress
  const leafExts = [
    extension(OID.basicConstraints, seq(bool(false)), true),
    extension(OID.keyUsage, bitString(Buffer.from([0xa0]), 5), true),
    extension(OID.extKeyUsage, seq(objectIdentifier(OID.serverAuth)), false),
    extension(OID.subjectAltName, seq(ipSan), false),
  ];

  const leafTbs = tbsCertificate({
    serial: randomBytes(16),
    issuer: caName,
    subject: leafName,
    notBefore,
    notAfter: leafNotAfter,
    publicKey: leaf.publicKey,
    extensions: leafExts,
  });
  const leafCertPem = derToPem(wrapCertificate(leafTbs, ca.privateKey), "CERTIFICATE");

  const caX509 = new X509Certificate(caCertPem);
  const leafX509 = new X509Certificate(leafCertPem);
  if (!caX509.ca) {
    throw new Error("generateVenueTlsMaterial: CA cert missing CA:true");
  }
  if (!leafX509.checkIssued(caX509)) {
    throw new Error("generateVenueTlsMaterial: leaf not issued by CA");
  }
  if (!leafX509.checkIP(sanIp)) {
    throw new Error(`generateVenueTlsMaterial: leaf SAN missing IP ${sanIp}`);
  }
  if (!leafX509.checkPrivateKey(leaf.privateKey)) {
    throw new Error("generateVenueTlsMaterial: leaf key does not match cert");
  }

  return {
    caCertPem,
    caKeyPem: ca.keyPem,
    leafCertPem,
    leafKeyPem: leaf.keyPem,
    sanIp,
    caFingerprint256: caX509.fingerprint256,
    leafFingerprint256: leafX509.fingerprint256,
    caNotAfter: caX509.validToDate,
    leafNotAfter: leafX509.validToDate,
    keyType: VENUE_TLS_KEY_TYPE,
  };
}
