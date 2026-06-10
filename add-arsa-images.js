// Arsa ilanlarına Unsplash'tan uygun kapak görseli atar:
// Unsplash URL -> Cloudinary'ye yükle -> Notion CoverImage'a kalıcı external URL yaz.
// Tek seferlik araç. Kullanım: node add-arsa-images.js

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

loadEnvFile();

const NOTION_VERSION = "2022-06-28";
const { NOTION_TOKEN, NOTION_LISTINGS_DATABASE_ID, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;

const UNSPLASH = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1600&q=80`;

// Tema havuzları — script kullanmadan önce her URL'in eriştiğini doğrular.
const POOLS = {
  sea: [
    "photo-1505118380757-91f5f5632de0",
    "photo-1519046904884-53103b34b206",
    "photo-1507525428034-b723cf961d3e",
    "photo-1468413253725-0d5181091126",
  ],
  field: [
    "photo-1500382017468-9049fed747ef",
    "photo-1472214103451-9374bd1c798e",
    "photo-1505765050516-f72dcac9c60e",
  ],
  nature: [
    "photo-1469474968028-56623f02e42e",
    "photo-1501785888041-af3ef285b470",
    "photo-1506744038136-46273834b3fb",
    "photo-1441974231531-c6227db76b6e",
    "photo-1473448912268-2022ce9509d8",
    "photo-1500530855697-b586d89ba3ee",
    "photo-1470071459604-3b5ec3a7fe05",
    "photo-1426604966848-d7adac402bff",
    "photo-1447752875215-b2761acb3c5d",
    "photo-1500534314209-a25ddb2bd429",
  ],
};

main().catch((error) => {
  console.error("HATA:", error.message);
  process.exit(1);
});

async function main() {
  for (const key of ["NOTION_TOKEN", "NOTION_LISTINGS_DATABASE_ID", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]) {
    if (!process.env[key]) throw new Error(`Missing ${key}`);
  }

  console.log("1) Unsplash adaylarını doğrula...");
  const pools = {};
  for (const [theme, ids] of Object.entries(POOLS)) {
    pools[theme] = [];
    for (const id of ids) {
      const url = UNSPLASH(id);
      const ok = await urlAlive(url);
      console.log(`   ${ok ? "ok " : "ÖLÜ"} [${theme}] ${id}`);
      if (ok) pools[theme].push(url);
    }
  }

  console.log("\n2) Arsa ilanlarını çek...");
  const result = await notionRequest(`/databases/${NOTION_LISTINGS_DATABASE_ID}/query`, "POST", {
    filter: { property: "Category", select: { equals: "Arsa" } },
    page_size: 100,
  });
  const pages = result.results || [];
  console.log(`   ${pages.length} arsa ilanı bulundu.`);

  const used = { sea: 0, field: 0, nature: 0 };

  console.log("\n3) Görsel ata, Cloudinary'ye yükle, Notion'u güncelle...");
  for (const page of pages) {
    const props = page.properties;
    const slug = props.Slug?.rich_text?.map((t) => t.plain_text).join("") || page.id;

    if (props.CoverImage?.files?.length) {
      console.log(`   atla (zaten görselli): ${slug}`);
      continue;
    }

    const theme = slug.includes("deniz-manzarali") ? "sea" : slug.includes("tarla") ? "field" : "nature";
    const pool = pools[theme].length ? pools[theme] : pools.nature;
    const sourceUrl = pool[used[theme] % pool.length];
    used[theme] += 1;

    const secureUrl = await uploadToCloudinary(sourceUrl, `emlak-site/${slug.slice(0, 80)}`);
    await notionRequest(`/pages/${page.id}`, "PATCH", {
      properties: {
        CoverImage: {
          files: [{ name: "cover.jpg", type: "external", external: { url: secureUrl } }],
        },
      },
    });
    console.log(`   ${slug} <- [${theme}] ${secureUrl.split("/upload/")[1].slice(0, 50)}`);
  }

  console.log("\nBitti.");
}

async function urlAlive(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

async function uploadToCloudinary(sourceUrl, folder) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHash("sha1")
    .update(`folder=${folder}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`)
    .digest("hex");

  const body = new URLSearchParams({
    file: sourceUrl,
    folder,
    timestamp: String(timestamp),
    api_key: CLOUDINARY_API_KEY,
    signature,
  });

  const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: "POST",
    body,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || `Cloudinary upload failed: ${response.status}`);
  }
  return data.secure_url;
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

  fs.readFileSync(envPath, "utf8").split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) return;
    process.env[trimmed.slice(0, separatorIndex).trim()] ||= trimmed.slice(separatorIndex + 1).trim();
  });
}
