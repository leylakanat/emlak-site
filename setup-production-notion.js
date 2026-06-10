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

setupProductionDatabases()
  .then(({ siteSettingsDatabaseId, pageSectionsDatabaseId, leadsDatabaseId, listingsDatabaseId }) => {
    updateEnvValue("SITE_SETTINGS_DATABASE_ID", siteSettingsDatabaseId);
    updateEnvValue("PAGE_SECTIONS_DATABASE_ID", pageSectionsDatabaseId);
    updateEnvValue("NOTION_LEADS_DATABASE_ID", leadsDatabaseId);
    updateEnvValue("NOTION_LISTINGS_DATABASE_ID", listingsDatabaseId);

    console.log("Production Notion databases are ready:");
    console.log(`SITE_SETTINGS_DATABASE_ID=${siteSettingsDatabaseId}`);
    console.log(`PAGE_SECTIONS_DATABASE_ID=${pageSectionsDatabaseId}`);
    console.log(`NOTION_LEADS_DATABASE_ID=${leadsDatabaseId}`);
    console.log(`NOTION_LISTINGS_DATABASE_ID=${listingsDatabaseId}`);
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });

async function setupProductionDatabases() {
  const siteSettingsDatabase =
    (await findDatabaseByTitle("Site Settings")) || (await createSiteSettingsDatabase());
  const pageSectionsDatabase =
    (await findDatabaseByTitle("Page Sections")) || (await createPageSectionsDatabase());
  const leadsDatabase = (await findDatabaseByTitle("Leads")) || (await createLeadsDatabase());
  const listingsDatabase =
    (await findDatabaseByTitle("Listings")) || (await createListingsDatabase());

  await ensureDatabaseProperties(siteSettingsDatabase.id, {
    BrandName: { rich_text: {} },
    Phone: { rich_text: {} },
    Logo: { files: {} },
    CallButton: { rich_text: {} },
    MapAddress: { rich_text: {} },
    InstagramHandle: { rich_text: {} },
  });

  await ensureDatabaseProperties(pageSectionsDatabase.id, {
    PageKey: { rich_text: {} },
    Eyebrow: { rich_text: {} },
    Title: { rich_text: {} },
    Subtitle: { rich_text: {} },
    Body: { rich_text: {} },
    Body2: { rich_text: {} },
    Image: { files: {} },
    PrimaryButton: { rich_text: {} },
    SecondaryButton: { rich_text: {} },
    Stat1Value: { rich_text: {} },
    Stat1Label: { rich_text: {} },
    Stat2Value: { rich_text: {} },
    Stat2Label: { rich_text: {} },
    LinkText: { rich_text: {} },
    LinkUrl: { url: {} },
    Order: { number: {} },
    IsVisible: { checkbox: {} },
  });

  await ensureDatabaseProperties(leadsDatabase.id, {
    Phone: { phone_number: {} },
    Email: { email: {} },
    Listing: { rich_text: {} },
    Message: { rich_text: {} },
    Source: {
      select: {
        options: [{ name: "Website", color: "blue" }],
      },
    },
    Status: {
      select: {
        options: [
          { name: "New", color: "green" },
          { name: "Contacted", color: "blue" },
          { name: "Closed", color: "gray" },
        ],
      },
    },
    CreatedAt: { date: {} },
  });

  await ensureDatabaseProperties(listingsDatabase.id, {
    Slug: { rich_text: {} },
    Category: { select: {} },
    Status: {
      select: {
        options: [
          { name: "Satılık", color: "green" },
          { name: "Kiralık", color: "blue" },
          { name: "Yeni İlan", color: "purple" },
        ],
      },
    },
    Price: { rich_text: {} },
    Location: { rich_text: {} },
    Rooms: { rich_text: {} },
    Bathrooms: { rich_text: {} },
    Area: { rich_text: {} },
    Description: { rich_text: {} },
    ListingSummary: { rich_text: {} },
    PropertyDetails: { rich_text: {} },
    Zoning: { rich_text: {} },
    CoverImage: { files: {} },
    Gallery: { files: {} },
    Featured: { checkbox: {} },
    FeaturedOrder: { number: {} },
    Published: { checkbox: {} },
    Order: { number: {} },
  });

  await ensureSiteSettingsRow(siteSettingsDatabase);

  return {
    siteSettingsDatabaseId: siteSettingsDatabase.id,
    pageSectionsDatabaseId: pageSectionsDatabase.id,
    leadsDatabaseId: leadsDatabase.id,
    listingsDatabaseId: listingsDatabase.id,
  };
}

async function createSiteSettingsDatabase() {
  return notionRequest("/databases", "POST", {
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
      SettingKey: { title: {} },
      BrandName: { rich_text: {} },
      Phone: { rich_text: {} },
      Logo: { files: {} },
      CallButton: { rich_text: {} },
    },
  });
}

async function createPageSectionsDatabase() {
  return notionRequest("/databases", "POST", {
    parent: {
      type: "page_id",
      page_id: parentPageId,
    },
    title: [
      {
        type: "text",
        text: { content: "Page Sections" },
      },
    ],
    properties: {
      SectionKey: { title: {} },
      PageKey: { rich_text: {} },
      Eyebrow: { rich_text: {} },
      Title: { rich_text: {} },
      Subtitle: { rich_text: {} },
      Body: { rich_text: {} },
      Body2: { rich_text: {} },
      Image: { files: {} },
      PrimaryButton: { rich_text: {} },
      SecondaryButton: { rich_text: {} },
      Stat1Value: { rich_text: {} },
      Stat1Label: { rich_text: {} },
      Stat2Value: { rich_text: {} },
      Stat2Label: { rich_text: {} },
      LinkText: { rich_text: {} },
      LinkUrl: { url: {} },
      Order: { number: {} },
      IsVisible: { checkbox: {} },
    },
  });
}

async function createLeadsDatabase() {
  return notionRequest("/databases", "POST", {
    parent: {
      type: "page_id",
      page_id: parentPageId,
    },
    title: [
      {
        type: "text",
        text: { content: "Leads" },
      },
    ],
    properties: {
      Name: { title: {} },
      Phone: { phone_number: {} },
      Email: { email: {} },
      Listing: { rich_text: {} },
      Message: { rich_text: {} },
      Source: {
        select: {
          options: [{ name: "Website", color: "blue" }],
        },
      },
      Status: {
        select: {
          options: [
            { name: "New", color: "green" },
            { name: "Contacted", color: "blue" },
            { name: "Closed", color: "gray" },
          ],
        },
      },
      CreatedAt: { date: {} },
    },
  });
}

async function createListingsDatabase() {
  return notionRequest("/databases", "POST", {
    parent: {
      type: "page_id",
      page_id: parentPageId,
    },
    title: [
      {
        type: "text",
        text: { content: "Listings" },
      },
    ],
    properties: {
      Title: { title: {} },
      Slug: { rich_text: {} },
      Category: { select: {} },
      Status: {
        select: {
          options: [
            { name: "Satılık", color: "green" },
            { name: "Kiralık", color: "blue" },
            { name: "Yeni İlan", color: "purple" },
          ],
        },
      },
      Price: { rich_text: {} },
      Location: { rich_text: {} },
      Rooms: { rich_text: {} },
      Bathrooms: { rich_text: {} },
      Area: { rich_text: {} },
      Description: { rich_text: {} },
      ListingSummary: { rich_text: {} },
      PropertyDetails: { rich_text: {} },
      Zoning: { rich_text: {} },
      CoverImage: { files: {} },
      Gallery: { files: {} },
      Featured: { checkbox: {} },
      FeaturedOrder: { number: {} },
      Published: { checkbox: {} },
      Order: { number: {} },
    },
  });
}

async function ensureSiteSettingsRow(database) {
  const titleProperty = database.properties.SettingKey ? "SettingKey" : "PageKey";
  const databaseId = database.id;
  const existingPage = await findPage(databaseId, titleProperty, "site");
  if (existingPage) {
    return;
  }

  await createPage(databaseId, {
    [titleProperty]: title("site"),
  });
}

async function findDatabaseByTitle(titleText) {
  const result = await notionRequest("/search", "POST", {
    query: titleText,
    filter: {
      property: "object",
      value: "database",
    },
    page_size: 10,
  });

  return result.results?.find((item) => {
    const title = item.title?.map((part) => part.plain_text).join("");
    return title === titleText;
  });
}

async function ensureDatabaseProperties(databaseId, properties) {
  await notionRequest(`/databases/${databaseId}`, "PATCH", {
    properties,
  });
}

async function findPage(databaseId, titleProperty, titleText) {
  const result = await notionRequest(`/databases/${databaseId}/query`, "POST", {
    filter: {
      property: titleProperty,
      title: {
        equals: titleText,
      },
    },
    page_size: 1,
  });

  return result.results?.[0];
}

async function findSectionPage(databaseId, pageKey, sectionKey) {
  const result = await notionRequest(`/databases/${databaseId}/query`, "POST", {
    filter: {
      and: [
        {
          property: "PageKey",
          rich_text: {
            equals: pageKey,
          },
        },
        {
          property: "SectionKey",
          title: {
            equals: sectionKey,
          },
        },
      ],
    },
    page_size: 1,
  });

  return result.results?.[0];
}

async function createPage(databaseId, properties) {
  return notionRequest("/pages", "POST", {
    parent: {
      database_id: databaseId,
    },
    properties,
  });
}

async function updatePage(pageId, properties) {
  return notionRequest(`/pages/${pageId}`, "PATCH", {
    properties,
  });
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
    rich_text: content
      ? [
          {
            text: { content },
          },
        ]
      : [],
  };
}

function number(value) {
  return {
    number: value,
  };
}

function checkbox(value) {
  return {
    checkbox: value,
  };
}

function url(value) {
  return {
    url: value,
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

function updateEnvValue(key, value) {
  const envPath = path.join(__dirname, ".env");
  const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const line = `${key}=${value}`;

  if (current.includes(`${key}=`)) {
    const next = current.replace(new RegExp(`^${key}=.*$`, "m"), line);
    fs.writeFileSync(envPath, next);
    return;
  }

  const separator = current.endsWith("\n") || current === "" ? "" : "\n";
  fs.writeFileSync(envPath, `${current}${separator}${line}\n`);
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
