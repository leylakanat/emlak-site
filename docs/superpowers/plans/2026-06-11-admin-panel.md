# Admin Paneli (/admin.html) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teknik olmayan emlak danışmanı Leyla Kanat'ın, Notion ve Cloudinary'nin varlığını bilmeden, telefonundan ilan ekleyip yayından kaldırabileceği şifre korumalı bir yönetim sayfası.

**Architecture:** Mevcut `lib/server.js`'e `/api/admin/*` uçları eklenir (login + CRUD + Cloudinary upload imzası). Kimlik doğrulama: `ADMIN_PASSWORD` env değişkeni + HMAC imzalı süreli çerez (veritabanı yok). Fotoğraflar tarayıcıdan doğrudan Cloudinary'ye imzalı yüklenir (Vercel 4.5MB gövde limitine takılmaz); ilan Notion'a external URL'lerle yazılır. UI tek dosya: `admin.html` (mobil öncelikli, Türkçe).

**Tech Stack:** Node built-in `http`/`crypto` (bağımlılık eklenmez), `node:test` (test), Notion API, Cloudinary Upload API, Vercel serverless.

**Önemli bağlam (mevcut durum):**
- Sunucu: `lib/server.js` — `handleRequest(request, response)` export eder; `api/index.js` Vercel fonksiyonu olarak bunu sarar. Lokal: `npm run dev` (port 3000) veya `PORT=3199 node lib/server.js`.
- Notion yardımcıları zaten `lib/server.js` içinde: `notionRequest`, `findDatabaseByTitle`, `mapListing`, `titleProperty`, `richTextProperty`, `readJsonBody`, `createHttpError`, `sendJson`, `apiCache`.
- `.env` köktedir; `lib/server.js` `path.join(__dirname, "..", ".env")` ile okur. Cloudinary anahtarları `.env`'de mevcut.
- Deploy: `mv .git .git-bak && npx vercel deploy --prod --yes; mv .git-bak .git` (Hobby plan commit-yazarı engeli nedeniyle).

---

### Task 1: `lib/slugify.js` — başlıktan URL slug üretimi

**Files:**
- Create: `lib/slugify.js`
- Test: `tests/slugify.test.js`
- Modify: `package.json` (test script)

- [ ] **Step 1: Failing test'i yaz**

`tests/slugify.test.js`:

```js
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
```

- [ ] **Step 2: Test'in FAIL ettiğini doğrula**

Run: `node --test tests/slugify.test.js`
Expected: FAIL — `Cannot find module '../lib/slugify.js'`

- [ ] **Step 3: Implementasyonu yaz**

`lib/slugify.js`:

```js
function slugify(value) {
  return (
    String(value)
      .toLowerCase()
      .replaceAll("ı", "i")
      .replaceAll("ğ", "g")
      .replaceAll("ü", "u")
      .replaceAll("ş", "s")
      .replaceAll("ö", "o")
      .replaceAll("ç", "c")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "ilan"
  );
}

module.exports = { slugify };
```

- [ ] **Step 4: Test'in PASS ettiğini doğrula**

Run: `node --test tests/slugify.test.js`
Expected: `# pass 3`

- [ ] **Step 5: package.json'a test script ekle**

`package.json` (tam içerik):

```json
{
  "scripts": {
    "dev": "node lib/server.js",
    "test": "node --test tests/"
  },
  "dependencies": {
    "nodemailer": "^8.0.10"
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/slugify.js tests/slugify.test.js package.json
git commit -m "feat: add slugify helper with tests"
```

---

### Task 2: `lib/admin-auth.js` — HMAC imzalı süreli token (DB'siz oturum)

**Files:**
- Create: `lib/admin-auth.js`
- Test: `tests/admin-auth.test.js`

- [ ] **Step 1: Failing test'i yaz**

`tests/admin-auth.test.js`:

```js
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
```

- [ ] **Step 2: Test'in FAIL ettiğini doğrula**

Run: `node --test tests/admin-auth.test.js`
Expected: FAIL — `Cannot find module '../lib/admin-auth.js'`

- [ ] **Step 3: Implementasyonu yaz**

`lib/admin-auth.js`:

```js
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
```

- [ ] **Step 4: Test'in PASS ettiğini doğrula**

Run: `node --test tests/admin-auth.test.js`
Expected: `# pass 5`

- [ ] **Step 5: Commit**

```bash
git add lib/admin-auth.js tests/admin-auth.test.js
git commit -m "feat: add stateless admin token auth with tests"
```

---

### Task 3: Login ucu + admin koruması (`lib/server.js`)

**Files:**
- Modify: `lib/server.js` (require'lar, route dağıtımı, yeni fonksiyonlar)
- Modify: `.env` ve `.env.example` (ADMIN_PASSWORD, ADMIN_SECRET)

- [ ] **Step 1: `.env.example`'a yeni değişkenleri ekle**

`.env.example` içinde `CLOUDINARY_API_SECRET=` satırının altına:

```
ADMIN_PASSWORD=
ADMIN_SECRET=
```

- [ ] **Step 2: `.env`'e gerçek değerleri ekle**

```bash
printf 'ADMIN_PASSWORD=%s\nADMIN_SECRET=%s\n' "$(openssl rand -base64 12)" "$(openssl rand -hex 32)" >> .env
tail -2 .env
```

Not: `ADMIN_PASSWORD` çıktısını kaydet — kullanıcıya (Leyla Hanım'a) iletilecek; istenirse elle daha akılda kalıcı bir parolayla değiştirilebilir.

- [ ] **Step 3: `lib/server.js` başına require'ları ekle**

Dosyanın en üstündeki mevcut require bloğunu şu hale getir:

```js
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createAdminToken, verifyAdminToken, timingSafeEqual } = require("./admin-auth.js");
const { slugify } = require("./slugify.js");
```

- [ ] **Step 4: Route dağıtımına admin dalını ekle**

`handleRequest` içinde, mevcut `if (url.pathname.startsWith("/api/")) { sendJson(response, 404, ...)` bloğunun HEMEN ÜSTÜNE:

```js
    if (url.pathname.startsWith("/api/admin/")) {
      await handleAdminRequest(url, request, response);
      return;
    }
```

- [ ] **Step 5: Admin handler + yardımcıları ekle**

`lib/server.js`'te `module.exports = { handleRequest };` satırının ÜSTÜNE:

```js
async function handleAdminRequest(url, request, response) {
  if (url.pathname === "/api/admin/login" && request.method === "POST") {
    await handleAdminLogin(request, response);
    return;
  }

  requireAdmin(request);

  if (url.pathname === "/api/admin/listings" && request.method === "GET") {
    sendJson(response, 200, { listings: await getAdminListings() });
    return;
  }

  if (url.pathname === "/api/admin/listings" && request.method === "POST") {
    const input = await readJsonBody(request);
    sendJson(response, 201, await createAdminListing(input));
    return;
  }

  if (url.pathname.startsWith("/api/admin/listings/") && request.method === "PATCH") {
    const pageId = decodeURIComponent(url.pathname.replace("/api/admin/listings/", ""));
    if (!/^[0-9a-f-]{32,36}$/i.test(pageId)) {
      throw createHttpError(400, "Geçersiz ilan kimliği.");
    }
    const input = await readJsonBody(request);
    sendJson(response, 200, await updateAdminListing(pageId, input));
    return;
  }

  if (url.pathname === "/api/admin/upload-signature" && request.method === "POST") {
    const input = await readJsonBody(request);
    sendJson(response, 200, createUploadSignature(input));
    return;
  }

  throw createHttpError(404, "API endpoint not found.");
}

async function handleAdminLogin(request, response) {
  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.ADMIN_SECRET;
  if (!password || !secret) {
    throw createHttpError(500, "Missing ADMIN_PASSWORD or ADMIN_SECRET environment variable.");
  }

  const body = await readJsonBody(request);
  if (!timingSafeEqual(String(body?.password || ""), password)) {
    await delay(1500); // kaba kuvveti yavaşlat
    throw createHttpError(401, "Şifre hatalı.");
  }

  const maxAgeSeconds = 7 * 24 * 60 * 60;
  // Vercel'de istek https'ten gelir (x-forwarded-proto); lokal http testlerinde
  // Secure bayrağı konursa tarayıcı/curl çerezi geri göndermez.
  const secureFlag = request.headers["x-forwarded-proto"] === "https" ? "Secure; " : "";
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Set-Cookie": `admin_token=${createAdminToken(secret)}; HttpOnly; ${secureFlag}SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`,
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify({ ok: true }));
}

function requireAdmin(request) {
  const cookies = parseCookies(request.headers.cookie);
  if (!verifyAdminToken(cookies.admin_token, process.env.ADMIN_SECRET)) {
    throw createHttpError(401, "Giriş gerekli.");
  }
}

function parseCookies(header) {
  const cookies = {};
  String(header || "")
    .split(";")
    .forEach((part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex === -1) return;
      cookies[part.slice(0, separatorIndex).trim()] = decodeURIComponent(
        part.slice(separatorIndex + 1).trim()
      );
    });
  return cookies;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

Not: `getAdminListings`, `createAdminListing`, `updateAdminListing`, `createUploadSignature` sonraki task'larda eklenecek — bu task'ın curl testinde yalnızca login ve 401 davranışı doğrulanır. Bu task sonunda sunucunun `node --check` ile sözdizimi kontrolünden geçmesi için bu dört fonksiyonun YERİNE geçici olarak şu stub'ları KOYMA — onun yerine Task 4-6'daki gerçek implementasyonları bu task ile AYNI oturumda ekleyeceksen stub gerekmez. Task'ları ayrı çalıştırıyorsan şu geçici satırları ekle ve Task 4-6'da gerçekleriyle değiştir:

```js
async function getAdminListings() { throw createHttpError(501, "Not implemented yet."); }
async function createAdminListing() { throw createHttpError(501, "Not implemented yet."); }
async function updateAdminListing() { throw createHttpError(501, "Not implemented yet."); }
function createUploadSignature() { throw createHttpError(501, "Not implemented yet."); }
```

- [ ] **Step 6: Sözdizimi + login akışını doğrula**

```bash
node --check lib/server.js
PORT=3199 node lib/server.js > /tmp/admin-test.log 2>&1 &
sleep 2
# Yanlış şifre -> 401 (ve ~1.5 sn gecikme)
curl -s -o /dev/null -w "yanlis: HTTP %{http_code}\n" -X POST -H "Content-Type: application/json" -d '{"password":"yanlis"}' http://localhost:3199/api/admin/login
# Doğru şifre -> 200 + Set-Cookie
PASS=$(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2-)
curl -s -i -X POST -H "Content-Type: application/json" -d "{\"password\":\"$PASS\"}" http://localhost:3199/api/admin/login | grep -E "HTTP|set-cookie" 
# Çerezsiz korumalı uç -> 401
curl -s -o /dev/null -w "korumali: HTTP %{http_code}\n" http://localhost:3199/api/admin/listings
lsof -ti :3199 | xargs kill
```

Expected: `yanlis: HTTP 401`, login cevabında `HTTP/1.1 200` + `set-cookie: admin_token=...`, `korumali: HTTP 401`.

- [ ] **Step 7: Commit**

```bash
git add lib/server.js .env.example
git commit -m "feat: admin login endpoint with signed cookie auth"
```

---

### Task 4: Admin ilan listesi — `GET /api/admin/listings`

**Files:**
- Modify: `lib/server.js` (Task 3'teki stub'ı gerçek implementasyonla değiştir)

- [ ] **Step 1: `getAdminListings` implementasyonu**

Task 3'te eklenen `getAdminListings` stub'ını şununla değiştir:

```js
async function getAdminListings() {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    throw createHttpError(500, "Missing NOTION_TOKEN environment variable.");
  }

  const databaseId =
    process.env.NOTION_LISTINGS_DATABASE_ID || (await findDatabaseByTitle(token, "Listings"));
  if (!databaseId) {
    throw createHttpError(500, "Missing NOTION_LISTINGS_DATABASE_ID environment variable.");
  }

  const pages = [];
  let cursor;
  do {
    const result = await notionRequest(token, `/databases/${databaseId}/query`, "POST", {
      sorts: [{ timestamp: "created_time", direction: "descending" }],
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    pages.push(...(result.results || []));
    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor);

  return pages.map((page) => ({ id: page.id, ...mapListing(page.properties) }));
}
```

Yayında olmayanlar da döner (yönetim ekranı hepsini görmeli); `id` alanı PATCH için gerekli.

- [ ] **Step 2: Curl ile doğrula**

```bash
node --check lib/server.js
PORT=3199 node lib/server.js > /tmp/admin-test.log 2>&1 &
sleep 2
PASS=$(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2-)
curl -s -c /tmp/admin.jar -X POST -H "Content-Type: application/json" -d "{\"password\":\"$PASS\"}" http://localhost:3199/api/admin/login > /dev/null
curl -s -b /tmp/admin.jar http://localhost:3199/api/admin/listings | python3 -c "
import json,sys
ls = json.load(sys.stdin)['listings']
print(len(ls), 'ilan;', 'id var' if ls and ls[0].get('id') else 'ID YOK', '; published alanı:', ls[0].get('published'))
"
lsof -ti :3199 | xargs kill
```

Expected: `20 ilan; id var ; published alanı: True` (sayı mevcut duruma göre değişebilir; kritik olan id ve published alanlarının gelmesi).

- [ ] **Step 3: Commit**

```bash
git add lib/server.js
git commit -m "feat: admin listings endpoint (includes unpublished + page ids)"
```

---

### Task 5: İlan oluşturma — `POST /api/admin/listings`

**Files:**
- Modify: `lib/server.js` (stub'ları gerçek implementasyonla değiştir)

- [ ] **Step 1: `createAdminListing` + yardımcıları ekle**

Task 3'teki `createAdminListing` stub'ını şunlarla değiştir:

```js
async function createAdminListing(input) {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    throw createHttpError(500, "Missing NOTION_TOKEN environment variable.");
  }

  const databaseId =
    process.env.NOTION_LISTINGS_DATABASE_ID || (await findDatabaseByTitle(token, "Listings"));
  if (!databaseId) {
    throw createHttpError(500, "Missing NOTION_LISTINGS_DATABASE_ID environment variable.");
  }

  const title = String(input?.title || "").trim();
  if (!title) {
    throw createHttpError(400, "Başlık zorunlu.");
  }

  const images = (Array.isArray(input?.images) ? input.images : []).filter(
    (item) => typeof item === "string" && item.startsWith("https://res.cloudinary.com/")
  );

  const slug = await generateUniqueSlug(token, databaseId, title);

  const properties = {
    Title: titleProperty(title),
    Slug: richTextProperty(slug),
    Price: richTextProperty(String(input?.price || "").trim()),
    Location: richTextProperty(String(input?.location || "").trim()),
    Rooms: richTextProperty(String(input?.rooms || "").trim()),
    Bathrooms: richTextProperty(String(input?.bathrooms || "").trim()),
    Area: richTextProperty(String(input?.area || "").trim()),
    Description: richTextProperty(String(input?.description || "").trim()),
    Published: { checkbox: input?.published === false ? false : true },
    Featured: { checkbox: false },
  };

  if (input?.category) {
    properties.Category = { select: { name: String(input.category) } };
  }
  if (input?.status) {
    properties.Status = { select: { name: String(input.status) } };
  }
  if (images.length) {
    properties.CoverImage = { files: [externalImageFile(images[0])] };
    if (images.length > 1) {
      properties.Gallery = { files: images.slice(1).map(externalImageFile) };
    }
  }

  await notionRequest(token, "/pages", "POST", {
    parent: { database_id: databaseId },
    properties,
  });

  apiCache.clear();
  return { ok: true, slug };
}

function externalImageFile(imageUrl) {
  return { name: "photo", type: "external", external: { url: imageUrl } };
}

async function generateUniqueSlug(token, databaseId, title) {
  const base = slugify(title);
  const existing = await notionRequest(token, `/databases/${databaseId}/query`, "POST", {
    filter: { property: "Slug", rich_text: { equals: base } },
    page_size: 1,
  });
  if (!existing.results?.length) return base;
  return `${base}-${Date.now().toString(36).slice(-4)}`;
}
```

`apiCache.clear()` notu: cache instance-bazlıdır; Vercel'de birden çok warm instance varsa diğerleri TTL (60 sn) ile tazelenir. Panel UI metni bunu "birkaç dakika içinde görünür" diye yansıtacak.

- [ ] **Step 2: Curl ile uçtan uca doğrula (gerçek Notion'a TEST ilanı yazar, sonra arşivlenecek)**

```bash
node --check lib/server.js
PORT=3199 node lib/server.js > /tmp/admin-test.log 2>&1 &
sleep 2
PASS=$(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2-)
curl -s -c /tmp/admin.jar -X POST -H "Content-Type: application/json" -d "{\"password\":\"$PASS\"}" http://localhost:3199/api/admin/login > /dev/null
# Yayında OLMAYAN test ilanı oluştur (canlı siteye sızmaz)
curl -s -b /tmp/admin.jar -X POST -H "Content-Type: application/json" -d '{
  "title": "TEST SİLİNECEK - Plan Doğrulama İlanı",
  "category": "Arsa", "status": "Satılık", "price": "1.000.000 TL",
  "location": "Test / Kaş", "area": "500 m²", "published": false,
  "images": ["https://res.cloudinary.com/dayrstlsi/image/upload/v1781102033/emlak-site/kalkan-hacioglanda-villa-temelli-satilik-parsel/test.jpg"]
}' http://localhost:3199/api/admin/listings
# Başlık zorunluluğu
curl -s -o /dev/null -w "bossiz baslik: HTTP %{http_code}\n" -b /tmp/admin.jar -X POST -H "Content-Type: application/json" -d '{}' http://localhost:3199/api/admin/listings
lsof -ti :3199 | xargs kill
```

Expected: ilk istek `{"ok":true,"slug":"test-silinecek-plan-dogrulama-ilani"}`, ikincisi `HTTP 400`.

- [ ] **Step 3: Commit**

```bash
git add lib/server.js
git commit -m "feat: admin create-listing endpoint with auto slug"
```

---

### Task 6: Yayın anahtarı + arşivleme — `PATCH /api/admin/listings/:id`

**Files:**
- Modify: `lib/server.js` (stub'ı değiştir)

- [ ] **Step 1: `updateAdminListing` implementasyonu**

```js
async function updateAdminListing(pageId, input) {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    throw createHttpError(500, "Missing NOTION_TOKEN environment variable.");
  }

  const payload = {};
  if (typeof input?.published === "boolean") {
    payload.properties = { Published: { checkbox: input.published } };
  }
  if (input?.archived === true) {
    payload.archived = true;
  }
  if (!payload.properties && !payload.archived) {
    throw createHttpError(400, "Değiştirilecek alan yok.");
  }

  await notionRequest(token, `/pages/${pageId}`, "PATCH", payload);
  apiCache.clear();
  return { ok: true };
}
```

- [ ] **Step 2: Curl ile doğrula (Task 5'te açılan TEST ilanını kullan, sonunda arşivle)**

```bash
node --check lib/server.js
PORT=3199 node lib/server.js > /tmp/admin-test.log 2>&1 &
sleep 2
PASS=$(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2-)
curl -s -c /tmp/admin.jar -X POST -H "Content-Type: application/json" -d "{\"password\":\"$PASS\"}" http://localhost:3199/api/admin/login > /dev/null
TESTID=$(curl -s -b /tmp/admin.jar http://localhost:3199/api/admin/listings | python3 -c "
import json,sys
ls = json.load(sys.stdin)['listings']
print(next(l['id'] for l in ls if l['title'].startswith('TEST SİLİNECEK')))
")
echo "test ilanı: $TESTID"
# Yayına al -> yayından kaldır -> arşivle
curl -s -b /tmp/admin.jar -X PATCH -H "Content-Type: application/json" -d '{"published":true}'  "http://localhost:3199/api/admin/listings/$TESTID"; echo
curl -s -b /tmp/admin.jar -X PATCH -H "Content-Type: application/json" -d '{"published":false}' "http://localhost:3199/api/admin/listings/$TESTID"; echo
curl -s -b /tmp/admin.jar -X PATCH -H "Content-Type: application/json" -d '{"archived":true}'   "http://localhost:3199/api/admin/listings/$TESTID"; echo
# Arşivlenen ilan admin listesinde artık görünmemeli
curl -s -b /tmp/admin.jar http://localhost:3199/api/admin/listings | grep -c "TEST SİLİNECEK" || echo "temiz"
lsof -ti :3199 | xargs kill
```

Expected: üç PATCH de `{"ok":true}`; son kontrol `0` veya `temiz` (arşivlenen Notion query sonuçlarına gelmez).

- [ ] **Step 3: Commit**

```bash
git add lib/server.js
git commit -m "feat: admin publish-toggle and archive endpoint"
```

---

### Task 7: Cloudinary upload imzası — `POST /api/admin/upload-signature`

**Files:**
- Modify: `lib/server.js` (stub'ı değiştir)

- [ ] **Step 1: `createUploadSignature` implementasyonu**

```js
function createUploadSignature(input) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw createHttpError(500, "Missing CLOUDINARY_* environment variables.");
  }

  const folder = `emlak-site/${slugify(String(input?.folder || "ilan")).slice(0, 80)}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHash("sha1")
    .update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`)
    .digest("hex");

  return { cloudName, apiKey, folder, timestamp, signature };
}
```

Tarayıcı bu imzayla `https://api.cloudinary.com/v1_1/{cloudName}/image/upload` adresine `file, api_key, timestamp, signature, folder` form alanlarıyla doğrudan POST eder. `apiSecret` tarayıcıya asla inmez; imza yalnızca o `folder` + `timestamp` için geçerlidir (Cloudinary imzaları ~1 saat geçerli kabul eder).

- [ ] **Step 2: Curl + gerçek upload ile doğrula**

```bash
node --check lib/server.js
PORT=3199 node lib/server.js > /tmp/admin-test.log 2>&1 &
sleep 2
PASS=$(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2-)
curl -s -c /tmp/admin.jar -X POST -H "Content-Type: application/json" -d "{\"password\":\"$PASS\"}" http://localhost:3199/api/admin/login > /dev/null
SIG=$(curl -s -b /tmp/admin.jar -X POST -H "Content-Type: application/json" -d '{"folder":"test-upload"}' http://localhost:3199/api/admin/upload-signature)
echo "$SIG"
# İmzayla gerçek bir upload dene (1px png), sonra temizlik için public_id'yi not et
python3 - "$SIG" <<'EOF'
import base64, json, sys, urllib.request, urllib.parse
sig = json.loads(sys.argv[1])
png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
data = urllib.parse.urlencode({
    "file": "data:image/png;base64," + base64.b64encode(png).decode(),
    "api_key": sig["apiKey"], "timestamp": sig["timestamp"],
    "signature": sig["signature"], "folder": sig["folder"],
}).encode()
req = urllib.request.urlopen(f"https://api.cloudinary.com/v1_1/{sig['cloudName']}/image/upload", data)
out = json.load(req)
print("UPLOAD OK:", out["secure_url"][:80])
EOF
lsof -ti :3199 | xargs kill
```

Expected: imza JSON'ı (cloudName/apiKey/folder/timestamp/signature) + `UPLOAD OK: https://res.cloudinary.com/dayrstlsi/...`

- [ ] **Step 3: Commit**

```bash
git add lib/server.js
git commit -m "feat: signed direct-to-Cloudinary upload endpoint"
```

---

### Task 8: `admin.html` — Leyla Hanım'ın göreceği ekran

**Files:**
- Create: `admin.html` (UI + gömülü CSS/JS, tek dosya; siteden link verilmez, adres bookmark'lanır)

- [ ] **Step 1: `admin.html` dosyasını oluştur**

Tam içerik:

```html
<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Portföy Yönetimi</title>
<style>
  :root { --navy:#16324c; --bg:#f4f7fa; --ok:#1c8a4c; --off:#9aa7b3; --danger:#c0392b; }
  * { box-sizing:border-box; margin:0; font-family:-apple-system,"Segoe UI",Roboto,sans-serif; }
  body { background:var(--bg); color:#1d2b38; padding-bottom:48px; }
  header { background:var(--navy); color:#fff; padding:16px 20px; display:flex; justify-content:space-between; align-items:center; }
  header h1 { font-size:18px; }
  main { max-width:680px; margin:0 auto; padding:16px; }
  .card { background:#fff; border-radius:12px; padding:16px; margin-bottom:12px; box-shadow:0 1px 3px rgba(0,0,0,.08); }
  .hidden { display:none !important; }
  label { display:block; font-size:13px; font-weight:600; margin:10px 0 4px; }
  input, select, textarea { width:100%; padding:12px; border:1px solid #cdd7e0; border-radius:8px; font-size:16px; }
  textarea { min-height:90px; }
  button { border:0; border-radius:8px; padding:12px 16px; font-size:15px; font-weight:600; cursor:pointer; }
  .btn-primary { background:var(--navy); color:#fff; width:100%; margin-top:14px; }
  .btn-ghost { background:#e8eef3; color:var(--navy); }
  .listing { display:flex; gap:12px; align-items:center; }
  .listing img, .listing .noimg { width:72px; height:56px; border-radius:8px; object-fit:cover; background:#dde6ed; flex:none;
    display:flex; align-items:center; justify-content:center; color:#8aa; font-size:11px; }
  .listing .info { flex:1; min-width:0; }
  .listing .info b { display:block; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .listing .info span { font-size:13px; color:#5a6b7a; }
  .badge { font-size:11px; font-weight:700; padding:2px 8px; border-radius:99px; color:#fff; }
  .badge.on { background:var(--ok); } .badge.off { background:var(--off); }
  .row-actions { display:flex; flex-direction:column; gap:6px; }
  .row-actions button { padding:8px 10px; font-size:12px; }
  .toggle-on { background:#e7f6ed; color:var(--ok); }
  .toggle-off { background:#f1f3f5; color:#5a6b7a; }
  .delete { background:#fdf0ee; color:var(--danger); }
  #photo-list { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
  #photo-list img { width:64px; height:64px; object-fit:cover; border-radius:8px; }
  .msg { padding:12px; border-radius:8px; margin-top:10px; font-size:14px; }
  .msg.ok { background:#e7f6ed; color:#14532d; } .msg.err { background:#fdf0ee; color:#7f1d1d; }
  .topbtns { display:flex; gap:8px; margin-bottom:14px; }
  .topbtns button { flex:1; }
  .active-tab { background:var(--navy); color:#fff; }
</style>
</head>
<body>
<header><h1>🏠 Portföy Yönetimi</h1><span id="who"></span></header>
<main>

  <!-- GİRİŞ -->
  <section id="login-view" class="card">
    <h2 style="font-size:17px">Giriş</h2>
    <label for="password">Şifreniz</label>
    <input id="password" type="password" autocomplete="current-password" />
    <button class="btn-primary" id="login-btn">Giriş Yap</button>
    <div id="login-msg"></div>
  </section>

  <!-- PANEL -->
  <section id="panel-view" class="hidden">
    <div class="topbtns">
      <button id="tab-list" class="btn-ghost active-tab">Portföyüm</button>
      <button id="tab-new" class="btn-ghost">+ Yeni İlan</button>
    </div>

    <div id="list-view"><div class="card">Yükleniyor…</div></div>

    <div id="new-view" class="hidden">
      <div class="card">
        <h2 style="font-size:17px">Yeni İlan</h2>
        <label>Başlık *</label><input id="f-title" placeholder="Örn: Kalkan'da deniz manzaralı arsa" />
        <label>Kategori</label>
        <select id="f-category"><option>Arsa</option><option>Konut</option><option>İş Yeri</option></select>
        <label>Durum</label>
        <select id="f-status"><option>Satılık</option><option>Kiralık</option></select>
        <label>Fiyat</label><input id="f-price" placeholder="Örn: 5.500.000 TL" />
        <label>Konum</label><input id="f-location" placeholder="Örn: Kalkan / Kaş" />
        <label>Oda (konut için)</label><input id="f-rooms" placeholder="Örn: 3+1" />
        <label>Banyo</label><input id="f-bathrooms" placeholder="Örn: 2" />
        <label>Alan</label><input id="f-area" placeholder="Örn: 650 m²" />
        <label>Açıklama</label><textarea id="f-description"></textarea>
        <label>Fotoğraflar</label>
        <input id="f-photos" type="file" accept="image/*" multiple />
        <div id="photo-list"></div>
        <button class="btn-primary" id="save-btn">İlanı Kaydet</button>
        <div id="new-msg"></div>
      </div>
    </div>
  </section>

</main>
<script>
const $ = (id) => document.getElementById(id);
let uploadedUrls = [];

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== "/api/admin/login") { showLogin(); throw new Error("Oturum süresi doldu, tekrar giriş yapın."); }
  if (!response.ok) throw new Error(data.error || "Bir sorun oluştu.");
  return data;
}

function showLogin() { $("login-view").classList.remove("hidden"); $("panel-view").classList.add("hidden"); }
function showPanel() { $("login-view").classList.add("hidden"); $("panel-view").classList.remove("hidden"); loadListings(); }
function message(el, text, kind) { el.innerHTML = text ? `<div class="msg ${kind}">${text}</div>` : ""; }

$("login-btn").onclick = async () => {
  message($("login-msg"), "", "");
  try {
    await api("/api/admin/login", { method: "POST", body: JSON.stringify({ password: $("password").value }) });
    $("password").value = "";
    showPanel();
  } catch (error) { message($("login-msg"), error.message, "err"); }
};
$("password").addEventListener("keydown", (e) => { if (e.key === "Enter") $("login-btn").click(); });

$("tab-list").onclick = () => { switchTab("list"); };
$("tab-new").onclick = () => { switchTab("new"); };
function switchTab(tab) {
  $("list-view").classList.toggle("hidden", tab !== "list");
  $("new-view").classList.toggle("hidden", tab !== "new");
  $("tab-list").classList.toggle("active-tab", tab === "list");
  $("tab-new").classList.toggle("active-tab", tab === "new");
  if (tab === "list") loadListings();
}

async function loadListings() {
  try {
    const { listings } = await api("/api/admin/listings");
    $("list-view").innerHTML = listings.map((listing) => `
      <div class="card listing">
        ${listing.image ? `<img src="${listing.image}" alt="" />` : `<div class="noimg">foto yok</div>`}
        <div class="info">
          <b>${escapeHtml(listing.title)}</b>
          <span>${escapeHtml(listing.price || "")} · ${escapeHtml(listing.location || "")}</span><br/>
          <span class="badge ${listing.published ? "on" : "off"}">${listing.published ? "YAYINDA" : "PASİF"}</span>
        </div>
        <div class="row-actions">
          <button class="${listing.published ? "toggle-off" : "toggle-on"}"
            onclick="setPublished('${listing.id}', ${!listing.published})">
            ${listing.published ? "Yayından Kaldır" : "Yayına Al"}
          </button>
          <button class="delete" onclick="archiveListing('${listing.id}', '${escapeHtml(listing.title).replaceAll("'", "&#39;")}')">Sil</button>
        </div>
      </div>`).join("") || `<div class="card">Henüz ilan yok.</div>`;
  } catch (error) {
    $("list-view").innerHTML = `<div class="card msg err">${error.message}</div>`;
  }
}

async function setPublished(id, published) {
  await api(`/api/admin/listings/${id}`, { method: "PATCH", body: JSON.stringify({ published }) });
  loadListings();
}

async function archiveListing(id, title) {
  if (!confirm(`"${title}" ilanı silinsin mi?\n(Yanlışlıkla silerseniz bize haber verin, geri getirilebilir.)`)) return;
  await api(`/api/admin/listings/${id}`, { method: "PATCH", body: JSON.stringify({ archived: true }) });
  loadListings();
}

$("f-photos").onchange = async (event) => {
  const files = [...event.target.files];
  if (!files.length) return;
  message($("new-msg"), `Fotoğraflar yükleniyor… (0/${files.length})`, "ok");
  const folderName = $("f-title").value || "ilan";
  try {
    for (let i = 0; i < files.length; i++) {
      const sig = await api("/api/admin/upload-signature", { method: "POST", body: JSON.stringify({ folder: folderName }) });
      const form = new FormData();
      form.append("file", files[i]);
      form.append("api_key", sig.apiKey);
      form.append("timestamp", sig.timestamp);
      form.append("signature", sig.signature);
      form.append("folder", sig.folder);
      const upload = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`, { method: "POST", body: form });
      const result = await upload.json();
      if (!upload.ok) throw new Error(result.error?.message || "Fotoğraf yüklenemedi.");
      uploadedUrls.push(result.secure_url);
      $("photo-list").insertAdjacentHTML("beforeend", `<img src="${result.secure_url.replace("/upload/", "/upload/w_128,h_128,c_fill/")}" />`);
      message($("new-msg"), `Fotoğraflar yükleniyor… (${i + 1}/${files.length})`, "ok");
    }
    message($("new-msg"), "Fotoğraflar hazır. Şimdi 'İlanı Kaydet'e basabilirsiniz.", "ok");
  } catch (error) { message($("new-msg"), error.message, "err"); }
};

$("save-btn").onclick = async () => {
  message($("new-msg"), "Kaydediliyor…", "ok");
  try {
    const result = await api("/api/admin/listings", { method: "POST", body: JSON.stringify({
      title: $("f-title").value, category: $("f-category").value, status: $("f-status").value,
      price: $("f-price").value, location: $("f-location").value, rooms: $("f-rooms").value,
      bathrooms: $("f-bathrooms").value, area: $("f-area").value, description: $("f-description").value,
      images: uploadedUrls,
    }) });
    ["f-title","f-price","f-location","f-rooms","f-bathrooms","f-area","f-description"].forEach((id) => { $(id).value = ""; });
    uploadedUrls = []; $("photo-list").innerHTML = ""; $("f-photos").value = "";
    message($("new-msg"), `İlan kaydedildi ✓ Sitede birkaç dakika içinde görünür.`, "ok");
  } catch (error) { message($("new-msg"), error.message, "err"); }
};

function escapeHtml(value) {
  return String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
}

// Oturum varsa direkt paneli aç
api("/api/admin/listings").then(showPanel).catch(() => showLogin());
</script>
</body>
</html>
```

- [ ] **Step 2: Tarayıcıda uçtan uca doğrula (Playwright MCP)**

```bash
PORT=3199 node lib/server.js > /tmp/admin-test.log 2>&1 &
```

Playwright ile `http://localhost:3199/admin.html` aç ve sırasıyla doğrula:
1. Giriş ekranı görünüyor; yanlış şifre → "Şifre hatalı." mesajı
2. Doğru şifre (`grep '^ADMIN_PASSWORD=' .env`) → "Portföyüm" listesi geliyor, ilanlar fotoğraflı, YAYINDA/PASİF rozetleri doğru
3. Bir ilanda "Yayından Kaldır" → rozet PASİF'e dönüyor; `curl http://localhost:3199/api/listings` çıktısında o ilan yok; "Yayına Al" ile geri al
4. "+ Yeni İlan" → form doldur, 1 fotoğraf seç (yüklenme sayacı + küçük önizleme görünmeli), "İlanı Kaydet" → başarı mesajı; listede yeni ilan görünüyor
5. Test ilanını "Sil" ile arşivle → listeden düşüyor
6. Ekran görüntüsü al (kullanıcıya gösterilecek)

Sonra: `lsof -ti :3199 | xargs kill`

- [ ] **Step 3: Commit**

```bash
git add admin.html
git commit -m "feat: mobile-first Turkish admin panel page"
```

---

### Task 9: Deploy + canlı doğrulama

**Files:**
- Modify: `.vercelignore` (tests/ ve docs/ hariç tut)
- Vercel env: `ADMIN_PASSWORD`, `ADMIN_SECRET`

- [ ] **Step 1: `.vercelignore`'a ekle**

Dosyanın sonuna:

```
tests
docs
```

- [ ] **Step 2: Tüm testleri son kez çalıştır**

Run: `npm test`
Expected: tüm testler PASS (`# fail 0`)

- [ ] **Step 3: Vercel'e env değişkenlerini ekle**

```bash
grep '^ADMIN_PASSWORD=' .env | cut -d= -f2- | tr -d '\n' | npx -y vercel env add ADMIN_PASSWORD production
grep '^ADMIN_SECRET='   .env | cut -d= -f2- | tr -d '\n' | npx -y vercel env add ADMIN_SECRET   production
```

Expected: her ikisi için `Added Environment Variable ... to Project emlak-site`

- [ ] **Step 4: Deploy (git metadata'sız — Hobby plan engeli)**

```bash
mv .git .git-bak
npx -y vercel deploy --prod --yes --force > /tmp/admin-deploy.log 2>&1
EXITCODE=$?
mv .git-bak .git
echo "exit: $EXITCODE"; grep -E "Production" /tmp/admin-deploy.log
```

Expected: `exit: 0` + Production URL.

- [ ] **Step 5: Canlı smoke test**

```bash
BASE=https://emlak-site-leyla-kanat-s-projects.vercel.app
# Sayfa erişilebilir
curl -s -o /dev/null -w "admin sayfasi: HTTP %{http_code}\n" $BASE/admin.html
# Çerezsiz API korumalı
curl -s -o /dev/null -w "korumasiz istek: HTTP %{http_code}\n" $BASE/api/admin/listings
# Login + listele
PASS=$(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2-)
curl -s -c /tmp/live.jar -X POST -H "Content-Type: application/json" -d "{\"password\":\"$PASS\"}" $BASE/api/admin/login
curl -s -b /tmp/live.jar $BASE/api/admin/listings | python3 -c "import json,sys; print(len(json.load(sys.stdin)['listings']), 'ilan (canlı)')"
```

Expected: `admin sayfasi: HTTP 200`, `korumasiz istek: HTTP 401`, login `{"ok":true}`, son satır `N ilan (canlı)`.

- [ ] **Step 6: Playwright ile canlıda 1 tur** (Task 8 Step 2'deki senaryonun 1-3. maddeleri canlı URL'de)

- [ ] **Step 7: Commit**

```bash
git add .vercelignore
git commit -m "chore: exclude tests and docs from deploys"
```

- [ ] **Step 8: Kullanıcıya teslim notu**

Kullanıcıya iletilecekler: panel adresi (`/admin.html`), `ADMIN_PASSWORD` değeri, "telefonda Safari/Chrome'dan açıp ana ekrana ekleyin" talimatı, "değişiklikler sitede 1-2 dakika içinde görünür" notu.

---

## Kapsam dışı (bilinçli — YAGNI)

- İlan alanlarını düzenleme (fiyat güncelleme vb.) — v2
- Leads (müşteri talepleri) görünümü — v2
- Çoklu kullanıcı / rol — gereksiz
- Çerez logout ucu — çerez 7 günde kendiliğinden ölür; v2'de eklenebilir
- Cloudinary'de arşivlenen ilanın fotoğraflarını silme — kota sorun olursa elle/v2
