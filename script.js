let listings = [];
let currentListing = null;

function createListingCard(listing) {
  const cardImage = listing.imageCard || listing.image;
  const imageMarkup = cardImage
    ? `<img src="${cardImage}" alt="${listing.title}" loading="lazy" />`
    : `<div class="listing-image-placeholder" aria-hidden="true">
        <span class="material-symbols-outlined">real_estate_agent</span>
      </div>`;
  const roomsText = listing.rooms
    ? `<span class="feature"><span class="material-symbols-outlined">bed</span>${listing.rooms}</span>`
    : "";
  const bathroomText =
    !listing.bathrooms || listing.bathrooms === "-"
      ? ""
      : `<span class="feature"><span class="material-symbols-outlined">bathtub</span>${listing.bathrooms}</span>`;
  const areaText = listing.area
    ? `<span class="feature"><span class="material-symbols-outlined">square_foot</span>${listing.area}</span>`
    : "";

  return `
    <article class="listing-card" data-category="${listing.category}">
      <div class="listing-image">
        ${imageMarkup}
        <span class="listing-status">${listing.status}</span>
      </div>
      <div class="listing-body">
        <strong class="listing-price">${listing.price}</strong>
        <h3>${listing.title}</h3>
        <p class="listing-location">
          <span class="material-symbols-outlined">location_on</span>
          ${listing.location}
        </p>
        ${listing.description ? `<p class="listing-description">${listing.description}</p>` : ""}
        <div class="listing-features">
          ${roomsText}
          ${bathroomText}
          ${areaText}
        </div>
        <a class="card-button" href="listing-detail.html?id=${encodeURIComponent(listing.slug)}">Detayları Gör</a>
      </div>
    </article>
  `;
}

function renderListings(targetId, items) {
  const target = document.getElementById(targetId);
  if (!target) return;

  target.innerHTML = items.map(createListingCard).join("");
}

function createFeaturedListingCard(listing) {
  const cardImage = listing.imageCard || listing.image;
  const imageMarkup = cardImage
    ? `<img class="w-full h-full object-cover" src="${cardImage}" alt="${listing.title}" loading="lazy" />`
    : `<div class="w-full h-full bg-surface-container-highest text-primary flex items-center justify-center">
        <span class="material-symbols-outlined text-5xl text-secondary">real_estate_agent</span>
      </div>`;
  const roomsText = listing.rooms
    ? `<div class="flex items-center gap-1 text-on-surface-variant">
        <span class="material-symbols-outlined text-xl">bed</span>
        <span class="text-label-md">${listing.rooms}</span>
      </div>`
    : "";
  const bathroomText = listing.bathrooms
    ? `<div class="flex items-center gap-1 text-on-surface-variant">
        <span class="material-symbols-outlined text-xl">bathtub</span>
        <span class="text-label-md">${listing.bathrooms}</span>
      </div>`
    : "";
  const areaText = listing.area
    ? `<div class="flex items-center gap-1 text-on-surface-variant">
        <span class="material-symbols-outlined text-xl">square_foot</span>
        <span class="text-label-md">${listing.area}</span>
      </div>`
    : "";

  return `
    <article class="listing-card bg-surface-container-lowest rounded-xl overflow-hidden border border-outline-variant flex flex-col">
      <div class="relative h-64 overflow-hidden">
        ${imageMarkup}
        <span class="absolute top-4 left-4 bg-primary text-on-primary px-3 py-1 rounded-full text-label-md">${listing.status}</span>
      </div>
      <div class="p-6 flex-grow">
        <div class="text-secondary font-headline-md mb-2">${listing.price}</div>
        <h3 class="text-headline-md text-lg font-bold text-on-surface mb-2">${listing.title}</h3>
        <div class="flex items-center gap-2 text-on-surface-variant mb-4">
          <span class="material-symbols-outlined text-sm">location_on</span>
          <span class="text-label-md">${listing.location}</span>
        </div>
        <div class="flex gap-4 border-t border-outline-variant pt-4">
          ${roomsText}
          ${bathroomText}
          ${areaText}
        </div>
      </div>
      <div class="px-6 pb-6">
        <a class="w-full bg-surface-container-highest text-primary py-3 rounded-lg font-label-md hover:bg-primary hover:text-on-primary transition-colors flex items-center justify-center" href="listing-detail.html?id=${encodeURIComponent(listing.slug)}">Detayları Gör</a>
      </div>
    </article>
  `;
}

function renderFeaturedListings(items) {
  const target = document.getElementById("featured-listings");
  if (!target) return;

  target.innerHTML = items.map(createFeaturedListingCard).join("");
}

function setupFilters() {
  const filters = document.querySelector("[data-listing-filters]");
  if (!filters) return;

  filters.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;

    const selectedCategory = button.dataset.filter;
    filters.querySelectorAll("[data-filter]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    await loadListings(selectedCategory);
  });
}

function renderFilters(items) {
  const target = document.querySelector("[data-listing-filters]");
  if (!target) return;

  const categories = [...new Set(items.map((listing) => listing.category).filter(Boolean))];
  const buttons = ["Hepsi", ...categories]
    .map((category, index) => {
      const activeClass = index === 0 ? " active" : "";
      return `<button class="filter-button${activeClass}" type="button" data-filter="${category}">${category}</button>`;
    })
    .join("");

  target.innerHTML = buttons;
}

const LISTINGS_PER_PAGE = 8;
let currentListingsPage = 1;

async function loadListings(category = "Hepsi") {
  const target = document.getElementById("listings-grid");
  if (!target) return;

  const query = category && category !== "Hepsi" ? `?category=${encodeURIComponent(category)}` : "";
  const response = await fetch(`/api/listings${query}`);
  if (!response.ok) {
    target.innerHTML = "";
    throw new Error("Listings could not be loaded from Notion.");
  }

  const data = await response.json();
  listings = data.listings || [];
  currentListingsPage = 1;
  renderListingsPage();
  if (category === "Hepsi" && !document.querySelector("[data-listing-filters] [data-filter]")) {
    renderFilters(listings);
  }
}

function renderListingsPage() {
  const start = (currentListingsPage - 1) * LISTINGS_PER_PAGE;
  const pageItems = listings.slice(start, start + LISTINGS_PER_PAGE);
  renderListings("listings-grid", pageItems);
  renderPagination("listings-pagination", listings.length, currentListingsPage);
}

function renderPagination(containerId, total, current) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const totalPages = Math.ceil(total / LISTINGS_PER_PAGE);
  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  const prevDisabled = current === 1 ? ' disabled' : '';
  const nextDisabled = current === totalPages ? ' disabled' : '';

  const pageButtons = Array.from({ length: totalPages }, (_, i) => {
    const page = i + 1;
    const active = page === current ? ' class="active"' : '';
    return `<button type="button"${active} data-page="${page}">${page}</button>`;
  }).join("");

  container.innerHTML = `
    <button type="button" data-page-prev${prevDisabled} aria-label="Önceki sayfa">
      <span class="material-symbols-outlined">chevron_left</span>
    </button>
    ${pageButtons}
    <button type="button" data-page-next${nextDisabled} aria-label="Sonraki sayfa">
      <span class="material-symbols-outlined">chevron_right</span>
    </button>
  `;
}

function setupPagination() {
  const container = document.getElementById("listings-pagination");
  if (!container) return;
  container.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || btn.disabled) return;
    const totalPages = Math.ceil(listings.length / LISTINGS_PER_PAGE);
    if ("pagePrev" in btn.dataset) {
      currentListingsPage = Math.max(1, currentListingsPage - 1);
    } else if ("pageNext" in btn.dataset) {
      currentListingsPage = Math.min(totalPages, currentListingsPage + 1);
    } else if (btn.dataset.page) {
      currentListingsPage = Number(btn.dataset.page);
    } else {
      return;
    }
    renderListingsPage();
    document.querySelector(".page-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

async function loadListingsPageContent() {
  const title = document.querySelector("[data-site-setting='listingsTitle']");
  if (!title) return;

  const response = await fetch("/api/pages/listings");
  if (!response.ok) return;

  const page = await response.json();
  const hero = page.sections?.hero || {};
  setText("listingsTitle", hero.title);
  setText("listingsSubtitle", hero.subtitle);
  setWhatsAppLink(page.settings?.phone);
  setCallLink(page.settings?.phone);
}

async function loadFeaturedListings() {
  const target = document.getElementById("featured-listings");
  if (!target) return;

  const response = await fetch("/api/listings?featured=true&limit=3");
  if (!response.ok) {
    target.innerHTML = "";
    throw new Error("Featured listings could not be loaded from Notion.");
  }

  const data = await response.json();
  renderFeaturedListings((data.listings || []).slice(0, 3));
}

async function renderListingDetail() {
  const detailPage = document.getElementById("listing-detail");
  if (!detailPage) return;

  const params = new URLSearchParams(window.location.search);
  const listingSlug = params.get("id");
  if (!listingSlug) return;

  const response = await fetch(`/api/listings/${encodeURIComponent(listingSlug)}`);
  if (!response.ok) {
    throw new Error("Listing detail could not be loaded from Notion.");
  }

  const data = await response.json();
  const listing = data.listing;
  currentListing = listing;

  document.title = `${listing.title} | EstateBridge`;
  const detailImage = detailPage.querySelector("[data-detail-image]");
  if (listing.image) {
    detailImage.src = listing.image;
    detailImage.alt = listing.title;
    const thumbImages = listing.gallery?.length ? listing.gallery : [listing.image];
    detailPage.querySelectorAll(".detail-thumb").forEach((thumb, index) => {
      thumb.style.backgroundImage = `url("${thumbImages[index % thumbImages.length]}")`;
      thumb.style.backgroundSize = "cover";
      thumb.style.backgroundPosition = "center";
    });
  } else {
    detailImage.removeAttribute("src");
    detailImage.alt = "";
  }
  detailPage.querySelector("[data-detail-status]").textContent = listing.status;
  detailPage.querySelector("[data-detail-title]").textContent = listing.title;
  detailPage.querySelector("[data-detail-location]").textContent = listing.location;
  detailPage.querySelector("[data-detail-price]").textContent = listing.price;
  detailPage.querySelector("[data-detail-description]").textContent = listing.description;
  detailPage.querySelector("[data-detail-rooms]").textContent = listing.rooms;
  detailPage.querySelector("[data-detail-bathrooms]").textContent = listing.bathrooms;
  detailPage.querySelector("[data-detail-area]").textContent = listing.area;
  renderListingSummary(detailPage, listing.summary);

  const locationNote = detailPage.querySelector("[data-detail-location-note]");
  if (locationNote) {
    locationNote.textContent = listing.location
      ? `${listing.location} konumunu Google Maps üzerinde görüntüleyin.`
      : "";
  }
}

function renderListingSummary(detailPage, summary) {
  const target = detailPage.querySelector("[data-detail-summary]");
  if (!target) return;

  const items = String(summary || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

  target.innerHTML = items
    .map(
      (item) => `
        <li>
          <span class="material-symbols-outlined">check_circle</span>
          ${escapeHtml(item)}
        </li>
      `
    )
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.addEventListener("DOMContentLoaded", async () => {
  setupActiveNavigation();

  const startupTasks = [
    loadHomeHeroSettings(),
    loadListingsPageContent(),
    loadFeaturedListings(),
    loadListings(),
    renderListingDetail(),
  ];

  await Promise.allSettled(startupTasks);
  setupFilters();
  setupPagination();
  setupContactModal();
});

function setupActiveNavigation() {
  updateActiveNavigation();
  document.querySelectorAll("[data-nav-link]").forEach((link) => {
    link.addEventListener("click", () => {
      setActiveNavigationLink(link.dataset.navLink);
    });
  });
  window.addEventListener("hashchange", updateActiveNavigation);
}

function updateActiveNavigation() {
  const navLinks = document.querySelectorAll("[data-nav-link]");
  if (!navLinks.length) return;

  const activeKey =
    window.location.hash === "#about"
      ? "about"
      : window.location.hash === "#contact"
        ? "contact"
        : "home";

  setActiveNavigationLink(activeKey);
}

function setActiveNavigationLink(activeKey) {
  const navLinks = document.querySelectorAll("[data-nav-link]");
  if (!navLinks.length) return;

  navLinks.forEach((link) => {
    const isActive = link.dataset.navLink === activeKey;
    link.classList.toggle("text-secondary", isActive);
    link.classList.toggle("border-b-2", isActive);
    link.classList.toggle("border-secondary", isActive);
    link.classList.toggle("font-bold", isActive);
    link.classList.toggle("text-on-surface-variant", !isActive);
    link.classList.toggle("hover:text-secondary", !isActive);
    if (isActive) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

async function loadHomeHeroSettings() {
  const cacheKey = "estatebridge.homePageContent";

  try {
    const cachedPage = readSessionCache(cacheKey);
    if (cachedPage) {
      applyHomePageContent(cachedPage, { includeImages: false });
    }

    const response = await fetch("/api/pages/home");
    if (!response.ok) {
      throw new Error("Home page content could not be loaded.");
    }

    const page = await response.json();
    applyHomePageContent(page);
    writeSessionCache(cacheKey, createCacheableHomePage(page));
  } catch (error) {
    console.error(error);
  }
}

function readSessionCache(key) {
  try {
    const rawValue = sessionStorage.getItem(key);
    if (!rawValue) return null;
    return JSON.parse(rawValue);
  } catch {
    return null;
  }
}

function writeSessionCache(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // If storage is unavailable, the live Notion-backed request still works.
  }
}

function createCacheableHomePage(page) {
  const cacheablePage = JSON.parse(JSON.stringify(page));

  // Notion file URLs are temporary signed links. Caching them can make the
  // browser request the same image twice, so cache only text/business fields.
  if (cacheablePage.settings) {
    cacheablePage.settings.agentPhoto = "";
  }
  if (cacheablePage.sections?.hero) {
    cacheablePage.sections.hero.image = "";
  }
  cacheablePage.heroImage = "";

  return cacheablePage;
}

function applyHomePageContent(page, options = {}) {
  const includeImages = options.includeImages !== false;
  const sections = page.sections || {};
  const settings = page.settings || {};
  const hero = sections.hero || page;
  const about = sections.about || page;
  const featured = sections.featured || page;

  setText("eyebrow", hero.eyebrow);
  setText("heroTitle", hero.title || page.heroTitle);
  setText("heroSubtitle", hero.subtitle || page.heroSubtitle);
  setText("primaryButton", hero.primaryButton || page.primaryButton);
  setText("secondaryButton", hero.secondaryButton || page.secondaryButton);
  setText("aboutTitle", about.title || page.aboutTitle);
  setText("aboutParagraph1", about.body || page.aboutParagraph1);
  setText("aboutParagraph2", about.body2 || page.aboutParagraph2);
  setText("stat1Value", about.stat1Value || page.stat1Value);
  setText("stat1Label", about.stat1Label || page.stat1Label);
  setText("stat2Value", about.stat2Value || page.stat2Value);
  setText("stat2Label", about.stat2Label || page.stat2Label);
  setText("featuredTitle", featured.title || page.featuredTitle);
  setText("featuredSubtitle", featured.subtitle || page.featuredSubtitle);
  setText("featuredButton", featured.linkText || page.featuredButton);
  if (includeImages) {
    setHeroImage(hero.image || settings.agentPhoto || page.heroImage);
  }
  setMapLink(settings.mapAddress || page.mapAddress);
  setWhatsAppLink(settings.phone || page.phone);
  setCallLink(settings.phone || page.phone);
  setInstagramLink(settings.instagramHandle || page.instagramHandle);
  setAgentProfile(settings);
}

function setMapLink(address) {
  const mapLink = document.querySelector("[data-map-link]");
  if (!mapLink) return;
  if (!address) return;

  const mapAddress = address;
  const encodedAddress = encodeURIComponent(mapAddress);
  mapLink.href = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
  mapLink.setAttribute("aria-label", `${mapAddress} konumunu Google Maps'te aç`);
}

function setWhatsAppLink(phone) {
  const whatsappLink = document.querySelector("[data-whatsapp-link]");
  if (!whatsappLink) return;
  if (!phone) return;

  const normalizedPhone = normalizePhoneForWhatsApp(phone);
  whatsappLink.href = `https://wa.me/${normalizedPhone}`;
}

function setCallLink(phone) {
  const callLinks = document.querySelectorAll("[data-call-link]");
  if (!callLinks.length || !phone) return;

  const normalizedPhone = normalizePhoneForWhatsApp(phone);
  callLinks.forEach((link) => {
    link.href = `tel:+${normalizedPhone}`;
    if ("phoneDisplay" in link.dataset) {
      link.textContent = phone;
    }
  });
}

function normalizePhoneForWhatsApp(phone) {
  const digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("90")) return digits;
  if (digits.startsWith("0")) return `90${digits.slice(1)}`;
  return `90${digits}`;
}

function setInstagramLink(handle) {
  const instagramLink = document.querySelector("[data-instagram-link]");
  if (!instagramLink) return;
  if (!handle) return;

  const cleanHandle = String(handle).replace(/^@/, "").trim();
  instagramLink.href = `https://www.instagram.com/${encodeURIComponent(cleanHandle)}/`;
  instagramLink.setAttribute("aria-label", `${cleanHandle} Instagram profilini aç`);
}

function setText(settingName, value) {
  const element = document.querySelector(`[data-site-setting="${settingName}"]`);
  if (!element) return;
  element.textContent = value || "";
}

function setHeroImage(imageUrl) {
  const image = document.querySelector("[data-site-setting-image='heroImage']");
  if (!image) return;

  if (!imageUrl) {
    image.removeAttribute("src");
    image.classList.remove("is-loaded");
    return;
  }

  if (image.src === imageUrl) {
    image.classList.add("is-loaded");
    return;
  }

  image.classList.remove("is-loaded");
  image.onload = () => image.classList.add("is-loaded");
  image.src = imageUrl;
  if (image.complete) {
    image.classList.add("is-loaded");
  }
}

function setAgentProfile(settings) {
  setText("agentName", settings.agentName);
  setText("agentTitle", settings.agentTitle);

  const photo = document.querySelector("[data-site-setting-image='agentPhoto']");
  if (!photo || !settings.agentPhoto) return;

  photo.src = settings.agentPhoto;
  photo.alt = settings.agentName || "";
}

function setupContactModal() {
  const triggers = document.querySelectorAll("[data-contact-trigger]");
  if (!triggers.length) return;

  injectContactModalStyles();
  document.body.insertAdjacentHTML("beforeend", createContactModalMarkup());

  const modal = document.querySelector("[data-contact-modal]");
  const form = document.querySelector("[data-contact-form]");
  const status = document.querySelector("[data-contact-status]");
  const listingInput = document.querySelector("[data-contact-listing]");
  const submitButton = document.querySelector("[data-contact-submit]");
  const closeButtons = document.querySelectorAll("[data-contact-close]");

  const currentListing = getCurrentListing();
  if (currentListing && listingInput) {
    listingInput.value = `${currentListing.title} - ${currentListing.location}`;
  }

  triggers.forEach((trigger) => {
    trigger.addEventListener("click", () => openContactModal(modal, status));
  });

  closeButtons.forEach((button) => {
    button.addEventListener("click", () => closeContactModal(modal));
  });

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeContactModal(modal);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) {
      closeContactModal(modal);
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setContactStatus(status, "", "");
    setContactLoading(submitButton, true);

    const formData = new FormData(form);
    const lead = {
      name: formData.get("name")?.trim(),
      phone: formData.get("phone")?.trim(),
      email: formData.get("email")?.trim(),
      listing: formData.get("listing")?.trim(),
      message: formData.get("message")?.trim(),
    };

    // Required fields are checked in JS too, so users get a polished Turkish message.
    if (!lead.name || !lead.phone || !lead.message) {
      setContactStatus(
        status,
        "error",
        "Bir hata oluştu. Lütfen tekrar deneyin veya WhatsApp üzerinden yazın."
      );
      setContactLoading(submitButton, false);
      return;
    }

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(lead),
      });

      if (!response.ok) {
        throw new Error("Lead could not be saved.");
      }

      form.reset();
      if (currentListing && listingInput) {
        listingInput.value = `${currentListing.title} - ${currentListing.location}`;
      }
      setContactStatus(
        status,
        "success",
        "Talebiniz alındı. En kısa sürede sizinle iletişime geçeceğiz."
      );
      setTimeout(() => {
        closeContactModal(modal);
      }, 900);
    } catch (error) {
      console.error(error);
      setContactStatus(
        status,
        "error",
        "Bir hata oluştu. Lütfen tekrar deneyin veya WhatsApp üzerinden yazın."
      );
    } finally {
      setContactLoading(submitButton, false);
    }
  });
}

function createContactModalMarkup() {
  return `
    <div class="contact-modal-overlay" data-contact-modal hidden>
      <div class="contact-modal-panel" role="dialog" aria-modal="true" aria-labelledby="contact-modal-title">
        <button class="contact-modal-close" data-contact-close type="button" aria-label="Formu kapat">
          <span class="material-symbols-outlined">close</span>
        </button>
        <div class="contact-modal-heading">
          <span class="contact-modal-eyebrow">EstateBridge</span>
          <h2 id="contact-modal-title">Sizinle Tanışalım</h2>
          <p>Bilgilerinizi bırakın, gayrimenkul hedefiniz için en doğru adımı birlikte planlayalım.</p>
        </div>
        <form class="contact-form" data-contact-form>
          <label>
            <span>Ad Soyad *</span>
            <input name="name" type="text" autocomplete="name" required />
          </label>
          <label>
            <span>Telefon *</span>
            <input name="phone" type="tel" autocomplete="tel" required />
          </label>
          <label>
            <span>E-posta</span>
            <input name="email" type="email" autocomplete="email" />
          </label>
          <label>
            <span>İlgilendiği İlan</span>
            <input name="listing" type="text" data-contact-listing />
          </label>
          <label class="contact-form-full">
            <span>Mesaj *</span>
            <textarea name="message" rows="4" required></textarea>
          </label>
          <p class="contact-modal-status" data-contact-status aria-live="polite"></p>
          <div class="contact-modal-actions">
            <button class="contact-modal-secondary" data-contact-close type="button">Vazgeç</button>
            <button class="contact-modal-primary" data-contact-submit type="submit">
              Talep Gönder
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function injectContactModalStyles() {
  if (document.getElementById("contact-modal-styles")) return;

  const style = document.createElement("style");
  style.id = "contact-modal-styles";
  style.textContent = `
    .contact-modal-overlay {
      align-items: center;
      background: rgba(17, 28, 45, 0.56);
      backdrop-filter: blur(10px);
      display: flex;
      inset: 0;
      justify-content: center;
      padding: 20px;
      position: fixed;
      z-index: 1000;
    }

    .contact-modal-overlay[hidden] {
      display: none;
    }

    .contact-modal-panel {
      background: #ffffff;
      border: 1px solid #c3c6d0;
      border-radius: 12px;
      box-shadow: 0 18px 45px rgba(17, 28, 45, 0.18);
      color: #111c2d;
      max-height: min(92vh, 760px);
      max-width: 680px;
      overflow-y: auto;
      padding: 32px;
      position: relative;
      width: min(100%, 680px);
    }

    .contact-modal-close {
      align-items: center;
      background: #d8e3fb;
      border: 0;
      border-radius: 12px;
      color: #002a4d;
      cursor: pointer;
      display: inline-flex;
      height: 44px;
      justify-content: center;
      position: absolute;
      right: 20px;
      top: 20px;
      transition: background 180ms ease, color 180ms ease;
      width: 44px;
    }

    .contact-modal-close:hover {
      background: #002a4d;
      color: #ffffff;
    }

    .contact-modal-heading {
      padding-right: 48px;
    }

    .contact-modal-eyebrow {
      background: #dae2ff;
      border-radius: 12px;
      color: #003fa3;
      display: inline-block;
      font-size: 16px;
      font-weight: 600;
      line-height: 1.4;
      margin-bottom: 14px;
      padding: 4px 14px;
    }

    .contact-modal-heading h2 {
      color: #002a4d;
      font-size: 28px;
      font-weight: 700;
      line-height: 1.2;
      margin: 0 0 10px;
    }

    .contact-modal-heading p {
      color: #42474e;
      font-size: 18px;
      line-height: 1.6;
      margin: 0 0 24px;
    }

    .contact-form {
      display: grid;
      gap: 18px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .contact-form label,
    .contact-form-full {
      display: grid;
      gap: 8px;
    }

    .contact-form span {
      color: #111c2d;
      font-size: 16px;
      font-weight: 600;
      line-height: 1.4;
    }

    .contact-form input,
    .contact-form textarea {
      background: #f9f9ff;
      border: 1px solid #c3c6d0;
      border-radius: 8px;
      color: #111c2d;
      font: inherit;
      font-size: 18px;
      line-height: 1.4;
      min-height: 54px;
      outline: none;
      padding: 14px 16px;
      transition: border-color 180ms ease, box-shadow 180ms ease;
      width: 100%;
    }

    .contact-form textarea {
      min-height: 132px;
      resize: vertical;
    }

    .contact-form input:focus,
    .contact-form textarea:focus {
      border-color: #0053cf;
      box-shadow: 0 0 0 4px rgba(0, 83, 207, 0.12);
    }

    .contact-form-full,
    .contact-modal-status,
    .contact-modal-actions {
      grid-column: 1 / -1;
    }

    .contact-modal-status {
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      line-height: 1.4;
      margin: 0;
      padding: 0;
    }

    .contact-modal-status.success,
    .contact-modal-status.error {
      padding: 12px 14px;
    }

    .contact-modal-status.success {
      background: #d8e3fb;
      color: #002a4d;
    }

    .contact-modal-status.error {
      background: #ffdad6;
      color: #93000a;
    }

    .contact-modal-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      justify-content: flex-end;
      margin-top: 4px;
    }

    .contact-modal-primary,
    .contact-modal-secondary {
      align-items: center;
      border: 0;
      border-radius: 12px;
      cursor: pointer;
      display: inline-flex;
      font: inherit;
      font-size: 18px;
      font-weight: 700;
      justify-content: center;
      min-height: 56px;
      padding: 14px 28px;
      transition: background 180ms ease, color 180ms ease, opacity 180ms ease;
    }

    .contact-modal-primary {
      background: #0053cf;
      color: #ffffff;
    }

    .contact-modal-primary:hover {
      box-shadow: 0 18px 45px rgba(17, 28, 45, 0.12);
    }

    .contact-modal-primary:disabled {
      cursor: wait;
      opacity: 0.72;
    }

    .contact-modal-secondary {
      background: #d8e3fb;
      color: #002a4d;
    }

    .contact-modal-secondary:hover {
      background: #002a4d;
      color: #ffffff;
    }

    body.contact-modal-open {
      overflow: hidden;
    }

    @media (max-width: 680px) {
      .contact-modal-panel {
        padding: 24px 18px;
      }

      .contact-modal-heading {
        padding-right: 48px;
      }

      .contact-form {
        grid-template-columns: 1fr;
      }

      .contact-modal-actions {
        flex-direction: column-reverse;
      }

      .contact-modal-primary,
      .contact-modal-secondary {
        width: 100%;
      }
    }
  `;
  document.head.appendChild(style);
}

function openContactModal(modal, status) {
  modal.hidden = false;
  document.body.classList.add("contact-modal-open");
  setContactStatus(status, "", "");

  const firstInput = modal.querySelector("input");
  if (firstInput) {
    firstInput.focus();
  }
}

function closeContactModal(modal) {
  modal.hidden = true;
  document.body.classList.remove("contact-modal-open");
}

function setContactLoading(button, isLoading) {
  button.disabled = isLoading;
  button.textContent = isLoading ? "Gönderiliyor..." : "Talep Gönder";
}

function setContactStatus(status, type, message) {
  status.className = "contact-modal-status";
  if (type) {
    status.classList.add(type);
  }
  status.textContent = message;
}

function getCurrentListing() {
  return currentListing;
}
