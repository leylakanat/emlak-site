const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = __dirname;
const NOTION_VERSION = "2022-06-28";
const MAX_JSON_BODY_SIZE = 64 * 1024;
const API_CACHE_TTL_MS = Number(process.env.API_CACHE_TTL_MS || 60_000);
const API_CACHE_STALE_MS = Number(process.env.API_CACHE_STALE_MS || 10 * 60_000);
const apiCache = new Map();

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/api/leads" && request.method === "POST") {
      const lead = await readJsonBody(request);
      const result = await createLead(lead);
      sendJson(response, 201, result);
      return;
    }

    if (url.pathname === "/api/pages/home") {
      const page = await readThroughApiCache("page:home", () =>
        getPageContent("home", { requireHero: true })
      );
      sendJson(response, 200, page);
      return;
    }

    if (url.pathname === "/api/pages/listings") {
      const page = await readThroughApiCache("page:listings", () => getPageContent("listings"));
      sendJson(response, 200, page);
      return;
    }

    if (url.pathname === "/api/listings") {
      const listings = await readThroughApiCache(`listings:${url.search}`, () =>
        getPublishedListings(url.searchParams)
      );
      sendJson(response, 200, { listings });
      return;
    }

    if (url.pathname.startsWith("/api/listings/")) {
      const slug = decodeURIComponent(url.pathname.replace("/api/listings/", ""));
      const listing = await readThroughApiCache(`listing:${slug}`, () =>
        getPublishedListingBySlug(slug)
      );
      sendJson(response, 200, { listing });
      return;
    }

    if (url.pathname === "/api/site-settings/home") {
      const page = await readThroughApiCache("site-settings:home", getHomePageContent);
      sendJson(response, 200, flattenHomePageContent(page));
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      sendJson(response, 404, { error: "API endpoint not found." });
      return;
    }

    serveStaticFile(url.pathname, response);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    sendJson(response, statusCode, { error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`EstateBridge site running at http://localhost:${PORT}`);
});

async function getHomePageContent() {
  return getPageContent("home", { requireHero: true });
}

async function readThroughApiCache(cacheKey, loader) {
  const now = Date.now();
  const cached = apiCache.get(cacheKey);

  if (cached?.value && cached.expiresAt > now) {
    return cached.value;
  }

  if (cached?.value && cached.staleUntil > now) {
    if (!cached.promise) {
      refreshApiCache(cacheKey, loader, cached).catch(() => {});
    }
    return cached.value;
  }

  if (cached?.promise) {
    return cached.promise;
  }

  return refreshApiCache(cacheKey, loader, cached);
}

async function refreshApiCache(cacheKey, loader, cached) {
  const promise = loader()
    .then((value) => {
      apiCache.set(cacheKey, {
        value,
        expiresAt: Date.now() + API_CACHE_TTL_MS,
        staleUntil: Date.now() + API_CACHE_TTL_MS + API_CACHE_STALE_MS,
      });
      return value;
    })
    .catch((error) => {
      if (cached?.value) {
        apiCache.set(cacheKey, cached);
      } else {
        apiCache.delete(cacheKey);
      }
      throw error;
    });

  apiCache.set(cacheKey, {
    value: cached?.value,
    expiresAt: cached?.expiresAt || 0,
    staleUntil: cached?.staleUntil || 0,
    promise,
  });

  return promise;
}

async function getPageContent(pageKey, options = {}) {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    throw new Error("Missing NOTION_TOKEN environment variable.");
  }

  const sectionsDatabaseId =
    process.env.PAGE_SECTIONS_DATABASE_ID || (await findDatabaseByTitle(token, "Page Sections"));

  if (!sectionsDatabaseId) {
    const legacySettings = await getLegacyHomeSettings(token);
    return {
      settings: legacySettings,
      sections: legacySettingsToSections(legacySettings),
      source: "legacy-site-settings",
    };
  }

  const result = await notionRequest(
    token,
    `/databases/${sectionsDatabaseId}/query`,
    "POST",
    {
      filter: {
        and: [
          {
            property: "PageKey",
            rich_text: {
              equals: pageKey,
            },
          },
          {
            property: "IsVisible",
            checkbox: {
              equals: true,
            },
          },
        ],
      },
      sorts: [
        {
          property: "Order",
          direction: "ascending",
        },
      ],
      page_size: 25,
    }
  );

  const sections = {};
  result.results?.forEach((page) => {
    const section = mapPageSection(page.properties);
    if (section.sectionKey) {
      sections[section.sectionKey] = section;
    }
  });

  if (options.requireHero && !sections.hero) {
    throw new Error(`No visible Page Sections row found for PageKey '${pageKey}' and SectionKey 'hero'.`);
  }

  return {
    settings: await getGlobalSiteSettings(token),
    sections,
    source: "page-sections",
  };
}

async function createLead(input) {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    throw createHttpError(500, "Missing NOTION_TOKEN environment variable.");
  }

  const databaseId =
    process.env.NOTION_LEADS_DATABASE_ID || (await findDatabaseByTitle(token, "Leads"));

  if (!databaseId) {
    throw createHttpError(500, "Missing NOTION_LEADS_DATABASE_ID environment variable.");
  }

  const lead = normalizeLead(input);
  validateLead(lead);

  const createdAt = new Date().toISOString();
  await notionRequest(token, "/pages", "POST", {
    parent: {
      database_id: databaseId,
    },
    properties: {
      Name: titleProperty(lead.name),
      Phone: {
        phone_number: lead.phone,
      },
      Email: {
        email: lead.email || null,
      },
      Listing: richTextProperty(lead.listing),
      Message: richTextProperty(lead.message),
      Source: {
        select: {
          name: "Website",
        },
      },
      Status: {
        select: {
          name: "New",
        },
      },
      CreatedAt: {
        date: {
          start: createdAt,
        },
      },
    },
  });

  const emailResult = await sendLeadNotification(lead, createdAt);

  return {
    ok: true,
    emailSent: emailResult.sent,
  };
}

async function getPublishedListings(searchParams) {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    throw createHttpError(500, "Missing NOTION_TOKEN environment variable.");
  }

  const databaseId =
    process.env.NOTION_LISTINGS_DATABASE_ID || (await findDatabaseByTitle(token, "Listings"));

  if (!databaseId) {
    throw createHttpError(500, "Missing NOTION_LISTINGS_DATABASE_ID environment variable.");
  }

  const filters = [
    {
      property: "Published",
      checkbox: {
        equals: true,
      },
    },
  ];

  if (searchParams.get("featured") === "true") {
    filters.push({
      property: "Featured",
      checkbox: {
        equals: true,
      },
    });
  }

  const category = searchParams.get("category");
  if (category && category !== "Hepsi") {
    filters.push({
      property: "Category",
      select: {
        equals: category,
      },
    });
  }

  const requestedLimit = Number(searchParams.get("limit"));
  const pageSize =
    Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 100)
      : 100;

  const result = await notionRequest(token, `/databases/${databaseId}/query`, "POST", {
    filter: {
      and: filters,
    },
    sorts: [
      {
        property: searchParams.get("featured") === "true" ? "FeaturedOrder" : "Order",
        direction: "ascending",
      },
    ],
    page_size: pageSize,
  });

  return result.results?.map((page) => mapListing(page.properties)) || [];
}

async function getPublishedListingBySlug(slug) {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    throw createHttpError(500, "Missing NOTION_TOKEN environment variable.");
  }

  const databaseId =
    process.env.NOTION_LISTINGS_DATABASE_ID || (await findDatabaseByTitle(token, "Listings"));

  if (!databaseId) {
    throw createHttpError(500, "Missing NOTION_LISTINGS_DATABASE_ID environment variable.");
  }

  const result = await notionRequest(token, `/databases/${databaseId}/query`, "POST", {
    filter: {
      and: [
        {
          property: "Slug",
          rich_text: {
            equals: slug,
          },
        },
        {
          property: "Published",
          checkbox: {
            equals: true,
          },
        },
      ],
    },
    page_size: 1,
  });

  const page = result.results?.[0];
  if (!page) {
    throw createHttpError(404, "Listing not found.");
  }

  return mapListing(page.properties);
}

async function getGlobalSiteSettings(token) {
  const databaseId =
    process.env.SITE_SETTINGS_DATABASE_ID || (await findDatabaseByTitle(token, "Site Settings"));

  if (!databaseId) return {};

  const database = await notionRequest(token, `/databases/${databaseId}`, "GET");
  const titlePropertyName = findTitlePropertyName(database.properties);

  const result = await notionRequest(token, `/databases/${databaseId}/query`, "POST", {
    filter: {
      property: titlePropertyName,
      title: {
        equals: "site",
      },
    },
    page_size: 1,
  });

  const page = result.results?.[0];
  if (!page) return {};

  return mapGlobalSiteSettings(page.properties);
}

async function getLegacyHomeSettings(token) {
  const databaseId =
    process.env.SITE_SETTINGS_DATABASE_ID || (await findDatabaseByTitle(token, "Site Settings"));

  if (!databaseId) {
    throw new Error("Could not find Site Settings database.");
  }

  const result = await notionRequest(
    token,
    `/databases/${databaseId}/query`,
    "POST",
    {
      filter: {
        property: "PageKey",
        title: {
          equals: "home",
        },
      },
      page_size: 1,
    }
  );

  const page = result.results?.[0];
  if (!page) {
    throw new Error("No Site Settings row found for PageKey 'home'.");
  }

  return mapLegacySiteSettings(page.properties);
}

async function findDatabaseByTitle(token, title) {
  const result = await notionRequest(token, "/search", "POST", {
    query: title,
    filter: {
      property: "object",
      value: "database",
    },
    page_size: 10,
  });

  const database = result.results?.find((item) => {
    const databaseTitle = item.title?.map((part) => part.plain_text).join("");
    return databaseTitle === title;
  });

  return database?.id;
}

function mapGlobalSiteSettings(properties) {
  return {
    brandName: readRichText(properties.BrandName) || "EstateBridge",
    phone: readRichText(properties.Phone),
    logo: optimizeImageUrl(readFileUrl(properties.Logo), "f_auto,q_auto,w_400"),
    callButton: readRichText(properties.CallButton),
    mapAddress: readRichText(properties.MapAddress),
    instagramHandle: readRichText(properties.InstagramHandle),
    agentName: readRichText(properties.AgentName),
    agentTitle: readRichText(properties.AgentTitle),
    agentPhoto: optimizeImageUrl(readFileUrl(properties.AgentPhoto), "f_auto,q_auto,w_800"),
  };
}

function mapPageSection(properties) {
  return {
    pageKey: readRichText(properties.PageKey),
    sectionKey: readTitle(properties.SectionKey),
    eyebrow: readRichText(properties.Eyebrow),
    title: readRichText(properties.Title),
    subtitle: readRichText(properties.Subtitle),
    body: readRichText(properties.Body),
    body2: readRichText(properties.Body2),
    image: optimizeImageUrl(readFileUrl(properties.Image), "f_auto,q_auto,w_1600"),
    primaryButton: readRichText(properties.PrimaryButton),
    secondaryButton: readRichText(properties.SecondaryButton),
    stat1Value: readRichText(properties.Stat1Value),
    stat1Label: readRichText(properties.Stat1Label),
    stat2Value: readRichText(properties.Stat2Value),
    stat2Label: readRichText(properties.Stat2Label),
    linkText: readRichText(properties.LinkText),
    linkUrl: readUrl(properties.LinkUrl),
    order: readNumber(properties.Order),
    isVisible: readCheckbox(properties.IsVisible),
  };
}

function mapListing(properties) {
  return {
    slug: readRichText(properties.Slug),
    title: readTitle(properties.Title),
    category: readSelect(properties.Category),
    status: readSelect(properties.Status),
    price: readRichText(properties.Price),
    location: readRichText(properties.Location),
    rooms: readRichText(properties.Rooms),
    bathrooms: readRichText(properties.Bathrooms),
    area: readRichText(properties.Area),
    description: readRichText(properties.Description),
    summary: readRichText(properties.ListingSummary),
    zoning: readRichText(properties.Zoning),
    details: readRichText(properties.PropertyDetails),
    image: optimizeImageUrl(readFileUrl(properties.CoverImage), "f_auto,q_auto,w_1600"),
    imageCard: optimizeImageUrl(readFileUrl(properties.CoverImage), "f_auto,q_auto,w_800"),
    gallery: readFileUrls(properties.Gallery).map((url) =>
      optimizeImageUrl(url, "f_auto,q_auto,w_1600")
    ),
    featured: readCheckbox(properties.Featured),
    featuredOrder: readNumber(properties.FeaturedOrder),
    published: readCheckbox(properties.Published),
    order: readNumber(properties.Order),
  };
}

function mapLegacySiteSettings(properties) {
  return {
    pageKey: readTitle(properties.PageKey),
    eyebrow: readRichText(properties.Eyebrow),
    heroTitle: readRichText(properties.HeroTitle),
    heroSubtitle: readRichText(properties.HeroSubtitle),
    heroImage: readFileUrl(properties.HeroImage),
    primaryButton: readRichText(properties.PrimaryButton),
    secondaryButton: readRichText(properties.SecondaryButton),
    aboutTitle: readRichText(properties.AboutTitle),
    aboutParagraph1: readRichText(properties.AboutParagraph1),
    aboutParagraph2: readRichText(properties.AboutParagraph2),
    stat1Value: readRichText(properties.Stat1Value),
    stat1Label: readRichText(properties.Stat1Label),
    stat2Value: readRichText(properties.Stat2Value),
    stat2Label: readRichText(properties.Stat2Label),
    featuredTitle: readRichText(properties.FeaturedTitle),
    featuredSubtitle: readRichText(properties.FeaturedSubtitle),
    featuredButton: readRichText(properties.FeaturedButton),
  };
}

function legacySettingsToSections(settings) {
  return {
    hero: {
      sectionKey: "hero",
      eyebrow: settings.eyebrow,
      title: settings.heroTitle,
      subtitle: settings.heroSubtitle,
      image: settings.heroImage,
      primaryButton: settings.primaryButton,
      secondaryButton: settings.secondaryButton,
    },
    about: {
      sectionKey: "about",
      title: settings.aboutTitle,
      body: settings.aboutParagraph1,
      body2: settings.aboutParagraph2,
      stat1Value: settings.stat1Value,
      stat1Label: settings.stat1Label,
      stat2Value: settings.stat2Value,
      stat2Label: settings.stat2Label,
    },
    featured: {
      sectionKey: "featured",
      title: settings.featuredTitle,
      subtitle: settings.featuredSubtitle,
      linkText: settings.featuredButton,
    },
  };
}

function flattenHomePageContent(page) {
  const sections = page.sections || {};
  const hero = sections.hero || {};
  const about = sections.about || {};
  const featured = sections.featured || {};

  return {
    pageKey: "home",
    mapAddress: page.settings?.mapAddress || "",
    phone: page.settings?.phone || "",
    instagramHandle: page.settings?.instagramHandle || "",
    agentName: page.settings?.agentName || "",
    agentTitle: page.settings?.agentTitle || "",
    agentPhoto: page.settings?.agentPhoto || "",
    eyebrow: hero.eyebrow,
    heroTitle: hero.title,
    heroSubtitle: hero.subtitle,
    heroImage: hero.image,
    primaryButton: hero.primaryButton,
    secondaryButton: hero.secondaryButton,
    aboutTitle: about.title,
    aboutParagraph1: about.body,
    aboutParagraph2: about.body2,
    stat1Value: about.stat1Value,
    stat1Label: about.stat1Label,
    stat2Value: about.stat2Value,
    stat2Label: about.stat2Label,
    featuredTitle: featured.title,
    featuredSubtitle: featured.subtitle,
    featuredButton: featured.linkText,
  };
}

function readTitle(property) {
  return property?.title?.map((part) => part.plain_text).join("") || "";
}

function titleProperty(content) {
  return {
    title: [
      {
        text: { content },
      },
    ],
  };
}

function richTextProperty(content) {
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

function readRichText(property) {
  return property?.rich_text?.map((part) => part.plain_text).join("") || "";
}

function readFileUrl(property) {
  const file = property?.files?.[0];
  if (!file) return "";
  return file.type === "external" ? file.external.url : file.file.url;
}

function readUrl(property) {
  return property?.url || "";
}

function readSelect(property) {
  return property?.select?.name || "";
}

function readNumber(property) {
  return property?.number || 0;
}

function readCheckbox(property) {
  return Boolean(property?.checkbox);
}

function readFileUrls(property) {
  return property?.files?.map((file) => (file.type === "external" ? file.external.url : file.file.url)) || [];
}

const CLOUDINARY_UPLOAD_SEGMENT = "/image/upload/";

function optimizeImageUrl(url, transform) {
  if (!url || !url.includes("res.cloudinary.com")) return url;

  const segmentIndex = url.indexOf(CLOUDINARY_UPLOAD_SEGMENT);
  if (segmentIndex === -1) return url;

  const insertAt = segmentIndex + CLOUDINARY_UPLOAD_SEGMENT.length;
  const rest = url.slice(insertAt);

  // Already has a manual transformation (e.g. .../upload/w_500,c_fill/...) — leave it alone.
  if (!/^v\d+\//.test(rest) && rest.includes(",")) return url;

  return `${url.slice(0, insertAt)}${transform}/${rest}`;
}

function findTitlePropertyName(properties) {
  const entry = Object.entries(properties || {}).find(([, property]) => property.type === "title");
  return entry?.[0] || "PageKey";
}

async function notionRequest(token, endpoint, method, body) {
  const response = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
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

function serveStaticFile(urlPath, response) {
  const requestedPath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.join(PUBLIC_DIR, path.normalize(requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendText(response, 404, "Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": getContentType(filePath),
      "Cache-Control": getCacheControl(filePath),
    });
    response.end(content);
  });
}

function getCacheControl(filePath) {
  const extension = path.extname(filePath);
  if (extension === ".html") {
    return "no-cache";
  }
  return "public, max-age=3600";
}

function getContentType(filePath) {
  const extension = path.extname(filePath);
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
  };
  return types[extension] || "application/octet-stream";
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data));
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}

function normalizeLead(input) {
  return {
    name: String(input?.name || "").trim(),
    phone: String(input?.phone || "").trim(),
    email: String(input?.email || "").trim(),
    listing: String(input?.listing || "").trim(),
    message: String(input?.message || "").trim(),
  };
}

function validateLead(lead) {
  if (!lead.name || !lead.phone || !lead.message) {
    throw createHttpError(400, "Name, phone, and message are required.");
  }
}

async function sendLeadNotification(lead, createdAt) {
  const realtorEmail = process.env.REALTOR_EMAIL;
  if (!realtorEmail) {
    return { sent: false, reason: "Missing REALTOR_EMAIL." };
  }

  const subject = `Yeni website talebi: ${lead.name}`;
  const text = [
    "Yeni bir website talebi alındı.",
    "",
    `Ad Soyad: ${lead.name}`,
    `Telefon: ${lead.phone}`,
    `E-posta: ${lead.email || "-"}`,
    `İlgilendiği İlan: ${lead.listing || "-"}`,
    `Mesaj: ${lead.message}`,
    `Kaynak: Website`,
    `Durum: New`,
    `Tarih: ${createdAt}`,
  ].join("\n");

  try {
    if (process.env.RESEND_API_KEY) {
      return await sendLeadWithResend(realtorEmail, subject, text);
    }

    return await sendLeadWithNodemailer(realtorEmail, subject, text);
  } catch (error) {
    console.error("Lead saved, but email notification failed:", error.message);
    return { sent: false, reason: error.message };
  }
}

async function sendLeadWithResend(to, subject, text) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || "EstateBridge <onboarding@resend.dev>",
      to,
      subject,
      text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Resend failed with status ${response.status}.`);
  }

  return { sent: true, provider: "resend" };
}

async function sendLeadWithNodemailer(to, subject, text) {
  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch (error) {
    return { sent: false, reason: "Nodemailer is not installed." };
  }

  const transportOptions = process.env.SMTP_HOST
    ? {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
        auth:
          process.env.SMTP_USER && process.env.SMTP_PASS
            ? {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
              }
            : undefined,
      }
    : {
        sendmail: true,
      };

  const transporter = nodemailer.createTransport(transportOptions);
  await transporter.sendMail({
    from: process.env.SMTP_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || "EstateBridge <no-reply@localhost>",
    to,
    subject,
    text,
  });

  return { sent: true, provider: "nodemailer" };
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_JSON_BODY_SIZE) {
        reject(createHttpError(413, "Request body is too large."));
        request.destroy();
      }
    });

    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(createHttpError(400, "Invalid JSON body."));
      }
    });

    request.on("error", reject);
  });
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
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
