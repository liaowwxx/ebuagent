/**
 * Shared auth utilities — works in Cloudflare Workers (Web Crypto) and Node.js 19+.
 */

const COOKIE_NAME = "auth_token";
const TOKEN_DAYS = 7;

function parseCookies(header) {
  const map = {};
  if (!header) return map;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = decodeURIComponent(part.slice(idx + 1).trim());
    if (name) map[name] = value;
  }
  return map;
}

// ---- HMAC helpers (Web Crypto) -------------------------------------------

async function importKey(secret) {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function bufHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexBuf(hex) {
  return new Uint8Array(hex.match(/.{2}/g).map((b) => parseInt(b, 16)));
}

async function signToken(payload, secret) {
  const enc = new TextEncoder();
  const data = enc.encode(JSON.stringify(payload));
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return btoa(JSON.stringify(payload)) + "." + bufHex(sig);
}

async function verifyToken(token, secret) {
  if (!token || !secret) return null;
  try {
    const dot = token.lastIndexOf(".");
    if (dot === -1) return null;
    const payloadB64 = token.slice(0, dot);
    const sigHex = token.slice(dot + 1);
    const payload = JSON.parse(atob(payloadB64));

    // Expiry check
    if (payload.exp && payload.exp < Date.now()) return null;

    const enc = new TextEncoder();
    const data = enc.encode(JSON.stringify(payload));
    const key = await importKey(secret);
    const valid = await crypto.subtle.verify("HMAC", key, hexBuf(sigHex), data);
    return valid ? payload : null;
  } catch {
    return null;
  }
}

function setAuthCookie(token) {
  const maxAge = TOKEN_DAYS * 24 * 60 * 60;
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function clearAuthCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export { COOKIE_NAME, parseCookies, signToken, verifyToken, setAuthCookie, clearAuthCookie };
