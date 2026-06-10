const fs = require("node:fs");
const path = require("node:path");

loadEnvFile();

const NOTION_VERSION = "2022-06-28";

const token = process.env.NOTION_TOKEN;
const parentPageId = process.env.NOTION_PARENT_PAGE_ID;

if (!token || !parentPageId) {
  console.error("Set NOTION_TOKEN and NOTION_PARENT_PAGE_ID before running this script.");
  process.exit(1);
}

createSiteSettingsDatabase()
  .then((database) => {
    console.log("Created Site Settings database:");
    console.log(database.id);
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });

async function createSiteSettingsDatabase() {
  const database = await notionRequest("/databases", "POST", {
    parent: {
      type: "page_id",
      page_id: parentPageId,
    },
    title: [
      {
        type: "text",
        text: { content: "Site Settings" },
      },
    ],
    properties: {
      PageKey: { title: {} },
      Eyebrow: { rich_text: {} },
      HeroTitle: { rich_text: {} },
      HeroSubtitle: { rich_text: {} },
      HeroImage: { files: {} },
      PrimaryButton: { rich_text: {} },
      SecondaryButton: { rich_text: {} },
      AboutTitle: { rich_text: {} },
      AboutParagraph1: { rich_text: {} },
      AboutParagraph2: { rich_text: {} },
      Stat1Value: { rich_text: {} },
      Stat1Label: { rich_text: {} },
      Stat2Value: { rich_text: {} },
      Stat2Label: { rich_text: {} },
      FeaturedTitle: { rich_text: {} },
      FeaturedSubtitle: { rich_text: {} },
      FeaturedButton: { rich_text: {} },
    },
  });

  await notionRequest("/pages", "POST", {
    parent: {
      database_id: database.id,
    },
    properties: {
      PageKey: title("home"),
      Eyebrow: richText("Güvenilir Emlak Çözümleri"),
      HeroTitle: richText("Hayalinizdeki Gayrimenkule Giden Yolda Profesyonel Rehberiniz"),
      HeroSubtitle: richText(
        "EstateBridge ile konut, arsa ve ticari gayrimenkul yolculuğunuzda modern, şeffaf ve sonuç odaklı danışmanlık alın."
      ),
      PrimaryButton: richText("İlanları İncele"),
      SecondaryButton: richText("Ücretsiz Danışmanlık Al"),
      AboutTitle: richText("Ben Kimim?"),
      AboutParagraph1: richText(
        "Merhaba, ben EstateBridge'in dinamik ve çözüm odaklı danışmanıyım. Konut, arsa ve ticari gayrimenkul dünyasında karar sürecinizi sadeleştirmek için çalışıyorum."
      ),
      AboutParagraph2: richText(
        "Her müşteri bir öncelik, her mülk özel bir projedir. Doğru fiyatlama, açık iletişim ve güncel pazarlama yöntemleriyle yanınızdayım."
      ),
      Stat1Value: richText("500+"),
      Stat1Label: richText("Mutlu Müşteri"),
      Stat2Value: richText("7/24"),
      Stat2Label: richText("Aktif Hizmet"),
      FeaturedTitle: richText("Öne Çıkan Portföyler"),
      FeaturedSubtitle: richText("Haftanın en prestijli ve fırsat dolu ilanları."),
      FeaturedButton: richText("Tümünü Gör"),
    },
  });

  return database;
}

function title(content) {
  return {
    title: [
      {
        text: { content },
      },
    ],
  };
}

function richText(content) {
  return {
    rich_text: [
      {
        text: { content },
      },
    ],
  };
}

async function notionRequest(endpoint, method, body) {
  const response = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: JSON.stringify(body),
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
