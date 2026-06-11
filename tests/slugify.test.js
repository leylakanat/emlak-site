const { test } = require("node:test");
const assert = require("node:assert");
const { slugify } = require("../lib/slugify.js");

test("Türkçe karakterleri çevirir ve boşlukları tireler", () => {
  assert.strictEqual(
    slugify("Kalkan'da Deniz Manzaralı Müstakil Parsel"),
    "kalkan-da-deniz-manzarali-mustakil-parsel"
  );
});

test("baş/son tireleri temizler", () => {
  assert.strictEqual(slugify("  --Satılık!! "), "satilik");
});

test("boş girişte 'ilan' döner", () => {
  assert.strictEqual(slugify(""), "ilan");
  assert.strictEqual(slugify("!!!"), "ilan");
});

test("büyük İ harfini doğru çevirir (U+0130)", () => {
  assert.strictEqual(slugify("İstanbul Satılık İLAN"), "istanbul-satilik-ilan");
});
