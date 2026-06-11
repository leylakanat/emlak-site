const crypto = require("node:crypto");

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 gün

function createAdminToken(secret, ttlMs = DEFAULT_TTL_MS) {
  const expiresAt = Date.now() + ttlMs;
  return `${expiresAt}.${sign(String(expiresAt), secret)}`;
}

function verifyAdminToken(token, secret) {
  if (!token || !secret) return false;
  const separatorIndex = String(token).indexOf(".");
  if (separatorIndex === -1) return false;
  const expiresAt = String(token).slice(0, separatorIndex);
  const signature = String(token).slice(separatorIndex + 1);
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) < Date.now()) return false;
  return timingSafeEqual(signature, sign(expiresAt, secret));
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function timingSafeEqual(a, b) {
  const bufferA = Buffer.from(String(a));
  const bufferB = Buffer.from(String(b));
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

module.exports = { createAdminToken, verifyAdminToken, timingSafeEqual };
