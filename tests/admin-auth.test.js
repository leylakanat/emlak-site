const { test } = require("node:test");
const assert = require("node:assert");
const { createAdminToken, verifyAdminToken, timingSafeEqual } = require("../lib/admin-auth.js");

const SECRET = "test-secret";

test("üretilen token aynı secret ile doğrulanır", () => {
  const token = createAdminToken(SECRET);
  assert.strictEqual(verifyAdminToken(token, SECRET), true);
});

test("farklı secret ile doğrulanmaz", () => {
  const token = createAdminToken(SECRET);
  assert.strictEqual(verifyAdminToken(token, "baska-secret"), false);
});

test("süresi geçmiş token reddedilir", () => {
  const token = createAdminToken(SECRET, -1000); // 1 sn önce doldu
  assert.strictEqual(verifyAdminToken(token, SECRET), false);
});

test("bozuk/boş token reddedilir", () => {
  assert.strictEqual(verifyAdminToken("", SECRET), false);
  assert.strictEqual(verifyAdminToken("abc", SECRET), false);
  assert.strictEqual(verifyAdminToken("123.deadbeef", SECRET), false);
  assert.strictEqual(verifyAdminToken(null, SECRET), false);
});

test("timingSafeEqual farklı uzunlukta false döner, patlamaz", () => {
  assert.strictEqual(timingSafeEqual("a", "ab"), false);
  assert.strictEqual(timingSafeEqual("aynı", "aynı"), true);
});
