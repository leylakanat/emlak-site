// Notion'daki dosya tipli (1 saatte expire olan) görselleri Cloudinary'ye taşır
// ve Notion property'lerini kalıcı external URL ile günceller.
//
// Kullanım:
//   node migrate-images-to-cloudinary.js --dry-run   # sadece raporla, değişiklik yapma
//   node migrate-images-to-cloudinary.js             # taşı ve Notion'u güncelle
//
// Gerekli .env değişkenleri:
//   NOTION_TOKEN, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

loadEnvFile();

const NOTION_VERSION = "2022-06-28";
const DRY_RUN = process.argv.includes("--dry-run");

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

const IMAGE_PROPERTIES = {
  Listings: ["CoverImage", "Gallery"],
  "Site Settings": ["Logo", "AgentPhoto"],
  "Page Sections": ["Image"],
};

main().catch((error) => {
  console.error("Migration failed:", error.message);
  process.exit(1);
});

async function main() {
  if (!NOTION_TOKEN) throw new Error("Missing NOTION_TOKEN.");
  if (!DRY_RUN && (!CLOUD_NAME || !API_KEY || !API_SECRET)) {
    throw new Error("Missing CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET.");
  }

  console.log(DRY_RUN ? "DRY RUN — hiçbir şey değiştirilmeyecek.\n" : "Migration başlıyor...\n");

  let migrated = 0;
  let skipped = 0;

  for (const [databaseTitle, propertyNames] of Object.entries(IMAGE_PROPERTIES)) {
    const databaseId = await findDatabaseByTitle(databaseTitle);
    if (!databaseId) {
      console.warn(`! '${databaseTitle}' veritabanı bulunamadı, atlanıyor.`);
      continue;
    }

    console.log(`== ${databaseTitle} ==`);
    const pages = await queryAllPages(databaseId);

    for (const page of pages) {
      const pageLabel = readPageTitle(page) || page.id;
      const updates = {};

      for (const propertyName of propertyNames) {
        const property = page.properties[propertyName];
        const files = property?.files || [];
        if (!files.length) continue;

        const notionHosted = files.filter((file) => file.type === "file");
        if (!notionHosted.length) {
          skipped += files.length;
          continue;
        }

        const newFiles = [];
        for (const file of files) {
          if (file.type === "external") {
            newFiles.push(file);
            continue;
          }

          const folder = `emlak-site/${slugify(pageLabel)}`;
          console.log(`  ${pageLabel} / ${propertyName}: '${file.name}' -> Cloudinary (${folder})`);

          if (DRY_RUN) {
            newFiles.push(file);
            migrated += 1;
            continue;
          }

          const secureUrl = await uploadToCloudinary(file.file.url, folder);
          newFiles.push({
            name: file.name || "image",
            type: "external",
            external: { url: secureUrl },
          });
          migrated += 1;
        }

        if (!DRY_RUN) {
          updates[propertyName] = { files: newFiles };
        }
      }

      if (Object.keys(updates).length) {
        await notionRequest(`/pages/${page.id}`, "PATCH", { properties: updates });
        console.log(`  ${pageLabel}: Notion güncellendi.`);
      }
    }
  }

  console.log(`\nBitti. Taşınan: ${migrated}, zaten harici (atlanan): ${skipped}.`);
  if (DRY_RUN) console.log("Gerçek taşıma için --dry-run olmadan tekrar çalıştırın.");
}

async function uploadToCloudinary(sourceUrl, folder) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHash("sha1")
    .update(`folder=${folder}&timestamp=${timestamp}${API_SECRET}`)
    .digest("hex");

  const body = new URLSearchParams({
    file: sourceUrl,
    folder,
    timestamp: String(timestamp),
    api_key: API_KEY,
    signature,
  });

  const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
    method: "POST",
    body,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || `Cloudinary upload failed: ${response.status}`);
  }

  return data.secure_url;
}

async function queryAllPages(databaseId) {
  const pages = [];
  let cursor;

  do {
    const result = await notionRequest(`/databases/${databaseId}/query`, "POST", {
      page_size: 100,
      start_cursor: cursor,
    });
    pages.push(...(result.results || []));
    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor);

  return pages;
}

async function findDatabaseByTitle(title) {
  const result = await notionRequest("/search", "POST", {
    query: title,
    filter: { property: "object", value: "database" },
    page_size: 10,
  });

  const database = result.results?.find(
    (item) => item.title?.map((part) => part.plain_text).join("") === title
  );

  return database?.id;
}

function readPageTitle(page) {
  const titleProperty = Object.values(page.properties || {}).find(
    (property) => property.type === "title"
  );
  return titleProperty?.title?.map((part) => part.plain_text).join("") || "";
}

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
      .replace(/^-+|-+$/g, "") || "untitled"
  );
}

async function notionRequest(endpoint, method, body) {
  const response = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || `Notion API request failed: ${response.status}`);
  }
  return data;
}

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) return;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    process.env[key] ||= value;
  });
}
