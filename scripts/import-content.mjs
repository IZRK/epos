import * as cheerio from "cheerio";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DATA_DIR = path.join(ROOT, "src", "_data");
const PUBLIC_DIR = path.join(ROOT, "public");

const SITE_ORIGIN = "https://epos-ip.zrc-sazu.si";
const STORY_ID = "ec3c6d784536473bab965af575a6d131";
const STORY_URL = `https://www.arcgis.com/sharing/rest/content/items/${STORY_ID}`;
const STORYMAP_PUBLIC_URL = `https://storymaps.arcgis.com/stories/${STORY_ID}`;
const LOGO_URL = `${SITE_ORIGIN}/wp-content/uploads/2023/07/logo.png`;

const MANUAL_LINK_FIXES = new Map([
  [
    `${SITE_ORIGIN}/partners/geozs/jasna.sinigoj@geo-zs.si`,
    "mailto:jasna.sinigoj@geo-zs.si"
  ],
  [
    `${SITE_ORIGIN}/publications-sp/egu2020-4657-print.pdf`,
    "https://izrk.zrc-sazu.si/sites/default/files/egu2020-4657-print.pdf"
  ],
  [`${SITE_ORIGIN}/egu2020-4657-print.pdf`, "https://izrk.zrc-sazu.si/sites/default/files/egu2020-4657-print.pdf"],
  [
    "http://fgg-web.fgg.unilj.si/SUGG/referati/2022/SZGG_2022_Sket_in_dr.pdf",
    "http://fgg-web.fgg.uni-lj.si/SUGG/referati/2022/SZGG_2022_Sket_in_dr.pdf"
  ]
]);

const SECTION_HEADINGS = new Map([
  ["contact information", "h2"],
  ["research", "h2"],
  ["ri-si-epos project", "h2"],
  ["ri-si-epos third project", "h2"],
  ["ri-si-epos equipment", "h2"],
  ["epos sp project", "h2"],
  ["publications", "h2"],
  ["activities on ri-si-epos project", "h3"],
  ["research equipment acquired through ri-si-epos", "h3"],
  ["the alparray programme", "h3"],
  ["european seismic hazard model (eshm20)", "h3"],
  ["observatory for the study of landslide dynamics – tevče", "h3"],
  ["observatory for the study of rockfall formation", "h3"],
  ["observatory for monitoring nitrate in groundwater", "h3"],
  ["observatory in the unsaturated zone – lysimeter", "h3"],
  ["observatory for monitoring the impact of shallow geothermal energy use", "h3"],
  ["measurement of seismic velocity properties of rocks in boreholes", "h3"]
]);

const PUBLICATION_AUTHOR_SEQUENCES = [
  { route: "/partners/ijs/", authors: "Dovjak, Mateja, Vaupotič, Janja," },
  {
    route: "/partners/arso/",
    authors:
      "Basili R., Danciu L., Carafa M.M.C, Kastelic V., Maesano F. E., M. M. Tiberti, R. Vallone, E. Gracia, K. Sesetyan, J. Atanackov, B. Sket-Motnikar, P. Zupančič, K. Vanneste, and S. Vilanova"
  },
  {
    route: "/partners/arso/",
    authors:
      "Šket Motnikar, B., Zupančič, P., Živčić, M., Atanackov, J., Jamšek Rupnik, P., Čarman, M., Kastelic V., Gosar, A.,"
  },
  { route: "/partners/ijs/", authors: "DOVJAK, Mateja, VENE, Ožbej, VAUPOTIČ, Janja." },
  { route: "/partners/ijs/", authors: "BUH, Tanja." },
  { route: "/partners/ijs/", authors: "VADNJAL, Nina." },
  {
    route: "/partners/ul-fgg/",
    authors:
      "Medved, K., Berk, S., Komadina, Ž., Majcen, D., Režek, J., Fabiani, N., Novak, N., Oven, K., Triglav Čekada, M., Ambrožič, T., Koler, B., Pavlovčič Prešeren, P., Ritlop, K., Sterle, O., Stopar, B."
  },
  {
    route: "/partners/ul-fgg/",
    authors:
      "Medved, K., Berk, S., Režek, J., Fabiani, N., Triglav Čekada, M., Koler, B., Urbančič, T., Ritlop, K., Kuhar, M., Pavlovčič Prešeren, P., Sterle, O., Stopar, B."
  },
  {
    route: "/partners/ul-fgg/",
    authors:
      "Stopar, B., Sterle, O., Ritlop, K., Pavlovčič Prešeren, P., Koler, B., Triglav Čekada, M., Radovan, D., Fabiani, N., Jamšek Rupnik, P., Atanackov, J., Bavec, M., Vrabec, M."
  },
  {
    route: "/partners/ul-fgg/",
    authors: "Sterle, O., Hamza, V., Ritlop, K., Stopar, B., Pavlovčič Prešeren, P."
  },
  { route: "/partners/ul-fgg/", authors: "Stopar, B." },
  { route: "/partners/ul-fgg/", authors: "Stopar, B., Vrabec, M, Koler, B., Sterle, O." },
  {
    route: "/partners/ul-fgg/",
    authors: "Triglav Čekada, M., Oven, K., Radovan, D., Stopar, B., Koler, B., Kogoj, D., Kuhar, M., Lisec, A., Sterle, O., Režek, J."
  }
].sort((a, b) => b.authors.length - a.authors.length);

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function decodeHtml(value = "") {
  return cheerio.load(`<span>${value}</span>`)("span").text();
}

function normalizeText(value = "") {
  return decodeHtml(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function escapeText(value = "") {
  return cheerio.load("<span></span>")("span").text(value).html();
}

function escapeRegExp(value = "") {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleText(value = "") {
  return normalizeText(cheerio.load(`<span>${value}</span>`)("span").text());
}

function slugify(value = "") {
  return normalizeText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "section";
}

function canonicalUrl(rawUrl, baseUrl = SITE_ORIGIN) {
  if (!rawUrl || /^(?:data:|mailto:|tel:|javascript:)/i.test(rawUrl)) return null;
  const decoded = String(rawUrl).replace(/&amp;/g, "&").trim();
  try {
    return new URL(decoded.startsWith("//") ? `https:${decoded}` : decoded, baseUrl).href;
  } catch {
    return null;
  }
}

function internalPath(rawUrl, baseUrl = SITE_ORIGIN) {
  const absolute = canonicalUrl(rawUrl, baseUrl);
  if (!absolute) return rawUrl;
  const url = new URL(absolute);
  if (url.origin !== new URL(SITE_ORIGIN).origin) return rawUrl;
  return `${url.pathname}${url.search}${url.hash}`;
}

function decodedPathname(url) {
  try {
    return decodeURIComponent(url.pathname);
  } catch {
    return url.pathname;
  }
}

function safeRemotePath(url) {
  let pathname = decodedPathname(url).replace(/\0/g, "");
  pathname = path.posix.normalize(pathname).replace(/^\/+/, "").replace(/^(?:\.\.\/)+/, "");
  if (!pathname || pathname.endsWith("/")) pathname += "asset";
  if (url.search) {
    const extension = path.posix.extname(pathname);
    const stem = extension ? pathname.slice(0, -extension.length) : pathname;
    const suffix = crypto.createHash("sha1").update(url.search).digest("hex").slice(0, 8);
    pathname = `${stem}-${suffix}${extension}`;
  }
  return pathname;
}

function assetDestination(rawUrl) {
  const absolute = canonicalUrl(rawUrl);
  if (!absolute) return null;
  const url = new URL(absolute);
  const site = new URL(SITE_ORIGIN);
  let relative;
  if (url.origin === site.origin && decodedPathname(url).startsWith("/wp-content/uploads/")) {
    relative = decodedPathname(url).replace(/^\//, "");
  } else {
    relative = path.posix.join("assets", "remote", url.hostname, safeRemotePath(url));
  }
  return {
    absolute,
    relative,
    filePath: path.join(PUBLIC_DIR, relative),
    publicPath: `/${relative.split(path.sep).join("/")}`
  };
}

async function fetchWithRetry(url, options = {}, attempts = 3) {
  let error;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: {
          "User-Agent": "EPOS-Slovenia-11ty-import/1.0",
          ...options.headers
        },
        ...options
      });
      if (response.ok) return response;
      error = new Error(`${response.status} ${response.statusText} for ${url}`);
      if (response.status < 500) break;
    } catch (caught) {
      error = caught;
    }
    await delay(attempt * 350);
  }
  throw error;
}

async function fetchJson(url) {
  const response = await fetchWithRetry(url);
  return response.json();
}

async function fetchText(url) {
  const response = await fetchWithRetry(url);
  return response.text();
}

async function fetchWordPressCollection(type, parameters = {}) {
  const records = [];
  let page = 1;
  while (true) {
    const url = new URL(`${SITE_ORIGIN}/wp-json/wp/v2/${type}`);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await fetchWithRetry(url);
    records.push(...(await response.json()));
    const pages = Number(response.headers.get("x-wp-totalpages") || 1);
    if (page >= pages) break;
    page += 1;
  }
  return records;
}

function parseMenu(homeHtml) {
  const $ = cheerio.load(homeHtml);

  function parseList(list) {
    return $(list)
      .children("li")
      .toArray()
      .map((item) => {
        const link = $(item).children("a").first();
        const labelNode = link.clone();
        labelNode.find("svg,.dropdown-nav-toggle").remove();
        const rawHref = link.attr("href") || "/";
        const isStoryMap = canonicalUrl(rawHref) === STORYMAP_PUBLIC_URL;
        const childList = $(item).children("ul").first();
        return {
          label: normalizeText(labelNode.text()),
          url: isStoryMap ? "/data-sites/" : internalPath(rawHref),
          children: childList.length ? parseList(childList) : []
        };
      });
  }

  return parseList($("#primary-menu"));
}

function collectMenuPaths(items, paths = new Set()) {
  for (const item of items) {
    paths.add(item.url);
    collectMenuPaths(item.children || [], paths);
  }
  return paths;
}

function collectAssetUrls(records, media, storyData) {
  const urls = new Set([LOGO_URL]);
  const imageExtensions = /\.(?:avif|gif|jpe?g|png|svg|webp)(?:$|[?#])/i;
  const localAsset = /\/wp-content\/uploads\//i;

  for (const item of media) {
    if (item.source_url) urls.add(canonicalUrl(item.source_url));
  }

  for (const record of records) {
    const baseUrl = record.link || SITE_ORIGIN;
    const $ = cheerio.load(record.content?.rendered || "", null, false);
    $("img[src],source[src]").each((_, element) => {
      const absolute = canonicalUrl($(element).attr("src"), baseUrl);
      if (absolute) urls.add(absolute);
    });
    $("a[href]").each((_, element) => {
      const absolute = canonicalUrl($(element).attr("href"), baseUrl);
      if (absolute && (localAsset.test(absolute) || imageExtensions.test(absolute))) urls.add(absolute);
    });
    $("[style]").each((_, element) => {
      const style = $(element).attr("style") || "";
      for (const match of style.matchAll(/url\(["']?([^"')]+)["']?\)/gi)) {
        const absolute = canonicalUrl(match[1], baseUrl);
        if (absolute && imageExtensions.test(absolute)) urls.add(absolute);
      }
    });
  }

  for (const resource of Object.values(storyData.resources || {})) {
    if (resource.type !== "image" || !resource.data?.resourceId) continue;
    urls.add(`${STORY_URL}/resources/${encodeURIComponent(resource.data.resourceId)}`);
  }

  for (const node of Object.values(storyData.nodes || {})) {
    if (node.type !== "embed" || !node.data?.thumbnailUrl) continue;
    if (/i\.ytimg\.com/i.test(node.data.thumbnailUrl)) urls.add(node.data.thumbnailUrl);
  }

  return [...urls].filter(Boolean);
}

function storyResourceDestination(rawUrl, storyData) {
  const prefix = `${STORY_URL}/resources/`;
  if (!rawUrl.startsWith(prefix)) return null;
  const resourceId = decodeURIComponent(rawUrl.slice(prefix.length));
  const resource = Object.values(storyData.resources || {}).find(
    (item) => item.data?.resourceId === resourceId
  );
  const relative = path.posix.join("assets", "storymap", resourceId);
  return {
    absolute: rawUrl,
    relative,
    filePath: path.join(PUBLIC_DIR, relative),
    publicPath: `/${relative}`,
    width: resource?.data?.width,
    height: resource?.data?.height
  };
}

async function downloadAssets(urls, storyData) {
  const mapping = new Map();
  const manifest = [];
  let cursor = 0;

  async function worker() {
    while (cursor < urls.length) {
      const rawUrl = urls[cursor];
      cursor += 1;
      const destination = storyResourceDestination(rawUrl, storyData) || assetDestination(rawUrl);
      if (!destination) continue;
      try {
        const response = await fetchWithRetry(rawUrl);
        const buffer = Buffer.from(await response.arrayBuffer());
        await fs.mkdir(path.dirname(destination.filePath), { recursive: true });
        await fs.writeFile(destination.filePath, buffer);
        mapping.set(rawUrl, destination.publicPath);
        manifest.push({
          source: rawUrl,
          path: destination.publicPath,
          bytes: buffer.byteLength,
          contentType: response.headers.get("content-type") || "",
          width: destination.width,
          height: destination.height
        });
      } catch (error) {
        manifest.push({ source: rawUrl, error: error.message });
      }
    }
  }

  await Promise.all(Array.from({ length: 8 }, () => worker()));
  manifest.sort((a, b) => a.source.localeCompare(b.source));
  return { mapping, manifest };
}

function resolveAsset(rawUrl, baseUrl, assetMap) {
  const absolute = canonicalUrl(rawUrl, baseUrl);
  if (!absolute) return rawUrl;
  return assetMap.get(absolute) || rawUrl;
}

function publicationAuthorSequences(pageUrl) {
  return PUBLICATION_AUTHOR_SEQUENCES.filter((item) => item.route === pageUrl);
}

function wrapKnownPublicationAuthors($, entry, pageUrl) {
  const sequences = publicationAuthorSequences(pageUrl);
  if (!sequences.length) return;
  entry
    .find("*")
    .addBack()
    .contents()
    .filter((_, node) => node.type === "text" && !$(node).parent().closest(".publication-authors").length)
    .each((_, node) => {
      const source = node.data;
      const matches = [];
      for (const { authors } of sequences) {
        const pattern = new RegExp(escapeRegExp(authors).replace(/ /g, "[\\s\\u00a0]+"), "gu");
        for (const match of source.matchAll(pattern)) {
          matches.push({ index: match.index, authors: match[0] });
        }
      }
      matches.sort((a, b) => a.index - b.index || b.authors.length - a.authors.length);
      const selected = [];
      let end = -1;
      for (const match of matches) {
        if (match.index < end) continue;
        selected.push(match);
        end = match.index + match.authors.length;
      }
      if (!selected.length) return;

      let html = "";
      let cursor = 0;
      for (const match of selected) {
        const before = source.slice(cursor, match.index);
        html += escapeText(before);
        if (match.index > 0 && before && !/^\s*$/.test(before)) html += "<br><br>";
        html += `<strong class="publication-authors">${escapeText(match.authors)}</strong>`;
        cursor = match.index + match.authors.length;
      }
      html += escapeText(source.slice(cursor));
      $(node).replaceWith(html);
    });
}

function normalizePublicationElement($, element, options = {}) {
  const entry = $(element);
  entry.addClass("publication-entry");

  entry.find("strong strong").each((_, nested) => $(nested).replaceWith($(nested).contents()));
  entry.find("strong").each((_, strong) => {
    const element = $(strong);
    if (/^(?:19|20)\d{2}$/.test(normalizeText(element.text()))) {
      element.removeClass("publication-authors").addClass("publication-year-label");
    }
  });

  const fullText = normalizeText(entry.text());
  const existing = entry.find("strong:not(.publication-year-label)").first();
  if (existing.length && fullText.startsWith(normalizeText(existing.text()))) {
    const existingText = normalizeText(existing.text());
    const shorterKnownSequence = publicationAuthorSequences(options.pageUrl).some(
      ({ authors }) => existingText.startsWith(normalizeText(authors)) && existingText !== normalizeText(authors)
    );
    if (/\b(?:19|20)\d{2}[a-z]?\b/i.test(existingText) || shorterKnownSequence) {
      existing.replaceWith(existing.contents());
    } else {
      existing.addClass("publication-authors");
    }
  }

  wrapKnownPublicationAuthors($, entry, options.pageUrl);
  if (entry.find(".publication-authors").length) return;

  const firstTextNode = entry
    .contents()
    .toArray()
    .find((node) => node.type === "text" && normalizeText(node.data));
  if (!firstTextNode) return;

  const leadingSpace = firstTextNode.data.match(/^\s*/u)?.[0] || "";
  const rawText = firstTextNode.data.slice(leadingSpace.length);
  const nameEnding = rawText.match(
    /^(.{2,}?(?:[A-Za-zÀ-ž]{2,}|\([^)]*\))\.)\s*(?=$|(?=(?:\(?(?:19|20)\d{2}|[A-ZÀ-Ž])))/u
  );
  const yearIndex = rawText.search(/(?:\(|\b)(?:19|20)\d{2}[a-z]?\b/i);
  const cutoffs = [nameEnding?.[1]?.length, yearIndex > 2 && yearIndex < 420 ? yearIndex : null].filter(
    (value) => Number.isInteger(value) && value > 1
  );
  const cutoff = cutoffs.length ? Math.min(...cutoffs) : -1;
  if (cutoff < 0) return;

  const authors = rawText.slice(0, cutoff).trimEnd();
  const remainder = rawText.slice(cutoff);
  const spacer = remainder && !/^\s/u.test(remainder) ? " " : "";
  $(firstTextNode).replaceWith(
    `${escapeText(leadingSpace)}<strong class="publication-authors">${escapeText(authors)}</strong>${spacer}${escapeText(remainder)}`
  );
}

function enhanceContentStructure($, options = {}) {
  $("p").each((_, paragraph) => {
    const text = normalizeText($(paragraph).text());
    const mapped = SECTION_HEADINGS.get(text.toLowerCase());
    const publicationsRelated = /^publications related with both projects/i.test(text);
    if (!mapped && !publicationsRelated) return;
    paragraph.tagName = mapped || "h2";
    $(paragraph).addClass("section-heading");
  });

  if (options.partner || options.partnerPublications) {
    let inPublications = Boolean(options.partnerPublications);
    $("h2,h3,p,li").each((_, element) => {
      const text = normalizeText($(element).text());
      if (/^publications(?:\s|$)/i.test(text) && text.length < 100) {
        inPublications = true;
        return;
      }
      if (!inPublications || !text) return;
      if (/^\d{4}$/.test(text)) {
        $(element).addClass("publication-year-heading");
        return;
      }
      if (element.tagName === "p" || element.tagName === "li") normalizePublicationElement($, element, options);
    });
  }
}

function cleanContentHtml(html, pageUrl, assetMap, options = {}) {
  const $ = cheerio.load(html || "", null, false);
  $("script,style,noscript,template").remove();
  $("*")
    .contents()
    .filter((_, node) => node.type === "comment")
    .remove();

  if (options.home) {
    $(".n2-section-smartslider").remove();
  }

  $("img").each((_, image) => {
    const element = $(image);
    const source = element.attr("src") || element.attr("data-src");
    if (source) element.attr("src", resolveAsset(source, pageUrl, assetMap));
    element.removeAttr("srcset sizes data-src data-srcset fetchpriority");
    element.attr("loading", options.home ? "eager" : "lazy");
    element.attr("decoding", "async");
    if (!element.attr("alt")) element.attr("alt", "");
  });

  $("source").each((_, source) => {
    const element = $(source);
    if (element.attr("src")) element.attr("src", resolveAsset(element.attr("src"), pageUrl, assetMap));
    element.removeAttr("srcset sizes");
  });

  $("a[href]").each((_, anchor) => {
    const element = $(anchor);
    const rawHref = element.attr("href");
    const absolute = canonicalUrl(rawHref, pageUrl);
    if (!absolute) return;
    const fixed = MANUAL_LINK_FIXES.get(absolute) || absolute;
    if (fixed === STORYMAP_PUBLIC_URL) {
      element.attr("href", "/data-sites/");
    } else if (assetMap.has(fixed)) {
      element.attr("href", assetMap.get(fixed));
    } else {
      element.attr("href", internalPath(fixed, pageUrl));
    }
    const finalHref = element.attr("href") || "";
    if (/^https?:\/\//i.test(finalHref)) {
      element.attr("rel", "noopener noreferrer");
    }
  });

  $("iframe").each((_, frame) => {
    const element = $(frame);
    const source = element.attr("src");
    if (source?.startsWith("//")) element.attr("src", `https:${source}`);
    element.attr("loading", "lazy");
    if (!element.attr("title")) element.attr("title", "Embedded interactive content");
    element.removeAttr("marginheight marginwidth scrolling");
  });

  $("[style]").removeAttr("style");
  $("[data-id],[data-type],[data-element_type],[data-widget_type]").removeAttr(
    "data-id data-type data-element_type data-widget_type"
  );
  $("br + br + br").remove();
  $("p").each((_, paragraph) => {
    const element = $(paragraph);
    if (!normalizeText(element.text()) && !element.find("img,iframe,video,audio").length) element.remove();
  });
  $("div").each((_, division) => {
    const element = $(division);
    if (!normalizeText(element.text()) && !element.find("img,iframe,video,figure").length) element.remove();
  });

  const seenIds = new Set();
  $("[id]").each((_, element) => {
    const id = $(element).attr("id");
    if (seenIds.has(id)) $(element).removeAttr("id");
    else seenIds.add(id);
  });

  enhanceContentStructure($, options);
  return $.html().trim();
}

function extractHeroImages(homeHtml, pageUrl, assetMap) {
  const $ = cheerio.load(homeHtml, null, false);
  const images = [];
  $(".n2-ss-slide-background-image img[src]").each((index, image) => {
    const element = $(image);
    const source = resolveAsset(element.attr("src"), pageUrl, assetMap);
    if (source === "/wp-content/uploads/2023/07/20221201-DJI_0815-scaled-e1701077721809.jpg") return;
    if (images.some((item) => item.src === source)) return;
    const slide = element.closest(".n2-ss-slide-background");
    const title =
      $(`.n2-ss-slide[data-public-id="${slide.attr("data-public-id")}"]`).attr("data-title") ||
      element.attr("title") ||
      `EPOS Slovenia fieldwork ${index + 1}`;
    images.push({ src: source, alt: normalizeText(title) });
  });
  return images;
}

function topLevelElements(html) {
  const $ = cheerio.load(html || "", null, false);
  return { $, elements: $.root().children().toArray() };
}

function buildNewsGroups(html) {
  const $ = cheerio.load(html || "", null, false);
  const elements = $("p,figure,h1,h2,h3,h4,h5,h6")
    .filter((_, element) => !$(element).parents("p,figure").length)
    .toArray();
  const groups = [];
  let group = null;
  let currentItem = null;

  const ensureGroup = (year) => {
    const targetYear = year || group?.year || "Archive";
    if (!group || group.year !== targetYear) {
      group = { year: targetYear, items: [] };
      groups.push(group);
    }
    return group;
  };

  for (const element of elements) {
    const node = $(element);
    const text = normalizeText(node.text());
    const year = text.match(/^(20\d{2})$/)?.[1];
    if (year) {
      ensureGroup(year);
      currentItem = null;
      continue;
    }
    if (element.tagName === "figure") {
      if (currentItem) currentItem.media += $.html(element);
      continue;
    }
    if (!text) continue;
    ensureGroup();
    currentItem = {
      html: $.html(element),
      text,
      media: ""
    };
    group.items.push(currentItem);
  }

  return groups.filter((item) => item.items.length);
}

function buildPublicationGroups(html) {
  const { $, elements } = topLevelElements(html);
  const groups = [];
  let group = null;
  const ensureGroup = (year) => {
    const targetYear = year || group?.year || "Other";
    if (!group || group.year !== targetYear) {
      group = { year: targetYear, items: [] };
      groups.push(group);
    }
    return group;
  };

  function addEntry(element) {
    const text = normalizeText($(element).text());
    if (!text) return;
    normalizePublicationElement($, element);
    ensureGroup().items.push({ html: $(element).html(), text });
  }

  for (const element of elements) {
    const node = $(element);
    const text = normalizeText(node.text());
    const year = text.match(/^(20\d{2})$/)?.[1];
    if (year) {
      ensureGroup(year);
      continue;
    }
    if (element.tagName === "ul" || element.tagName === "ol") {
      node.children("li").each((_, item) => addEntry(item));
    } else if (element.tagName === "p" || element.tagName === "li") {
      addEntry(element);
    }
  }

  return groups.filter((item) => item.items.length);
}

function pageType(record) {
  if (record.id === 5) return "home";
  if ([13, 246].includes(record.id)) return "news";
  if (record.id === 248) return "media";
  if (record.id === 212) return "publications";
  if (record.id === 410) return "storymap";
  if (record.id === 450) return "partner-publications";
  if ([369, 372, 373, 374, 375, 376].includes(record.id)) return "partner";
  if (record.type === "post") return "post";
  return "page";
}

function pageDescription(html, fallbackTitle) {
  const $ = cheerio.load(html || "", null, false);
  const paragraph = $("p")
    .toArray()
    .map((item) => normalizeText($(item).text()))
    .find((text) => text.length > 80);
  const description = paragraph || fallbackTitle;
  return description.length > 190 ? `${description.slice(0, 187).trim()}…` : description;
}

function buildPages(records, menu, assetMap) {
  const byId = new Map(records.map((record) => [record.id, record]));
  const menuPaths = collectMenuPaths(menu);
  return records
    .map((record) => {
      const type = pageType(record);
      const url = new URL(record.link || SITE_ORIGIN);
      const title = titleText(record.title?.rendered || "Untitled");
      const rawContent = record.content?.rendered || "";
      const options = {
        home: type === "home",
        partner: type === "partner",
        partnerPublications: type === "partner-publications",
        pageUrl: url.pathname
      };
      const contentHtml = cleanContentHtml(rawContent, record.link, assetMap, options);
      const parent = record.parent ? byId.get(record.parent) : null;
      const parentTitle = parent ? titleText(parent.title?.rendered) : null;
      const parentUrl = parent ? new URL(parent.link).pathname : null;
      const result = {
        id: record.id,
        type,
        title,
        url: url.pathname,
        date: record.date,
        modified: record.modified,
        description: pageDescription(contentHtml, title),
        contentHtml,
        parent: parent ? { title: parentTitle, url: parentUrl } : null,
        inMenu: menuPaths.has(url.pathname),
        noindex: !menuPaths.has(url.pathname) && [473, 478, 489, 492].includes(record.id)
      };
      if (type === "home") result.heroImages = extractHeroImages(rawContent, record.link, assetMap);
      if (type === "news") result.newsGroups = buildNewsGroups(contentHtml);
      if (type === "publications") {
        result.publicationGroups = buildPublicationGroups(contentHtml);
        result.publicationCount = result.publicationGroups.reduce(
          (total, group) => total + group.items.length,
          0
        );
      }
      return result;
    })
    .sort((a, b) => a.url.localeCompare(b.url));
}

function buildAttachments(media, assetMap) {
  return media
    .map((item) => {
      const source = canonicalUrl(item.source_url);
      return {
        id: item.id,
        type: "attachment",
        title: titleText(item.title?.rendered || "Media"),
        url: decodedPathname(new URL(item.link)),
        file: assetMap.get(source) || item.source_url,
        mimeType: item.mime_type || "application/octet-stream",
        mediaType: item.media_type || "file",
        captionHtml: cleanContentHtml(item.caption?.rendered || "", item.link, assetMap),
        description: normalizeText(item.caption?.rendered || item.description?.rendered || ""),
        parent: null,
        noindex: true
      };
    })
    .sort((a, b) => a.url.localeCompare(b.url));
}

function buildStoryMap(storyItem, storyData, assetMap) {
  const root = storyData.nodes?.[storyData.root];
  const cover = (root?.children || [])
    .map((id) => storyData.nodes[id])
    .find((node) => node?.type === "storycover");
  const headings = new Map();
  for (const [id, node] of Object.entries(storyData.nodes || {})) {
    if (node.type === "text" && /^h[1-6]$/.test(node.data?.type || "")) {
      headings.set(id, slugify(node.data.text));
    }
  }

  function cleanStoryHtml(html = "") {
    const $ = cheerio.load(`<div>${html}</div>`, null, false);
    $("a[href]").each((_, anchor) => {
      const element = $(anchor);
      const href = element.attr("href") || "";
      const reference = href.match(/^#ref-(.+)$/)?.[1];
      if (reference && headings.has(reference)) element.attr("href", `#${headings.get(reference)}`);
      if (href === `${SITE_ORIGIN}/`) {
        element.attr("href", "/");
        element.removeAttr("target rel");
      } else if (/^https?:\/\//i.test(href)) {
        element.attr("rel", "noopener noreferrer");
      }
    });
    $("span").each((_, span) => {
      if (!$(span).attr("class")) $(span).replaceWith($(span).contents());
    });
    return $("div").html().trim();
  }

  const blocks = [];
  for (const nodeId of root?.children || []) {
    const node = storyData.nodes[nodeId];
    if (!node) continue;
    if (node.type === "text" && normalizeText(node.data?.text)) {
      const textType = node.data.type;
      if (/^h[1-6]$/.test(textType)) {
        blocks.push({
          type: "heading",
          level: Number(textType.slice(1)),
          id: headings.get(nodeId),
          html: cleanStoryHtml(node.data.text),
          text: normalizeText(node.data.text)
        });
      } else if (textType === "bullet-list" || textType === "numbered-list") {
        blocks.push({
          type: "list",
          ordered: textType === "numbered-list",
          html: cleanStoryHtml(node.data.text)
        });
      } else {
        blocks.push({ type: "text", html: cleanStoryHtml(node.data.text) });
      }
    } else if (node.type === "separator") {
      blocks.push({ type: "separator" });
    } else if (node.type === "webmap") {
      const resource = storyData.resources?.[node.data?.map];
      if (!resource?.data?.itemId) continue;
      const mapLayers = node.data.mapLayers || resource.data.mapLayers || [];
      const mapCenter = node.data.center || resource.data.center || null;
      const mapViewpoint = node.data.viewpoint || resource.data.viewpoint || null;
      blocks.push({
        type: "map",
        itemId: resource.data.itemId,
        caption: cleanStoryHtml(node.data.caption || "Interactive map"),
        center: mapCenter,
        zoom: node.data.zoom ?? resource.data.zoom ?? null,
        scale: mapViewpoint?.scale || null,
        layers: mapLayers.map((layer) => ({
          id: layer.id,
          title: layer.title,
          visible: layer.visible
        }))
      });
    } else if (node.type === "embed") {
      const url = node.data?.url || node.data?.embedSrc;
      const youtubeId = url?.match(/(?:youtu\.be\/|[?&]v=)([A-Za-z0-9_-]{6,})/)?.[1];
      const thumbnailResource = storyData.resources?.[node.data?.thumbnailResourceId];
      const thumbnailSource = thumbnailResource?.data?.resourceId
        ? `${STORY_URL}/resources/${encodeURIComponent(thumbnailResource.data.resourceId)}`
        : node.data?.thumbnailUrl;
      const isInlineSite = !youtubeId && node.data?.isEmbedSupported && node.data?.display === "inline";
      blocks.push({
        type: youtubeId ? "video" : isInlineSite ? "embed" : "service",
        title: normalizeText(node.data?.title || node.data?.caption || url),
        caption: cleanStoryHtml(node.data?.caption || ""),
        description: String(node.data?.description || "").trim(),
        thumbnail: thumbnailSource ? assetMap.get(thumbnailSource) || null : null,
        url,
        embedUrl: youtubeId ? `https://www.youtube-nocookie.com/embed/${youtubeId}` : null
      });
    }
  }

  const coverResource = storyData.resources?.[root?.data?.metaSettings?.imageResourceId];
  const coverSource = coverResource?.data?.resourceId
    ? `${STORY_URL}/resources/${encodeURIComponent(coverResource.data.resourceId)}`
    : null;
  const jumpNavigation = blocks
    .filter((block) => block.type === "heading" && block.level <= 2)
    .filter((block, index, list) => list.findIndex((item) => item.id === block.id) === index)
    .map((block) => ({ label: block.text, id: block.id }));
  const creditsNode = (root?.children || [])
    .map((id) => storyData.nodes[id])
    .find((node) => node?.type === "credits");
  const credits = (creditsNode?.children || [])
    .map((id) => storyData.nodes[id])
    .filter(Boolean)
    .map((node) => {
      if (node.type === "text" && node.data?.type !== "h4") return cleanStoryHtml(node.data?.text || "");
      if (node.type === "attribution") {
        return cleanStoryHtml(`${node.data?.content || ""}<br>${node.data?.attribution || ""}`);
      }
      return "";
    })
    .filter(Boolean);

  return {
    title: normalizeText(cover?.data?.title || storyItem.title),
    summary: normalizeText(cover?.data?.summary || root?.data?.metaSettings?.description),
    byline: normalizeText(cover?.data?.byline || storyItem.owner),
    coverImage: coverSource ? assetMap.get(coverSource) || null : null,
    jumpNavigation,
    blocks,
    maps: blocks.filter((block) => block.type === "map"),
    credits
  };
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  console.log("Fetching WordPress content and ArcGIS story data…");
  const [pages, posts, media, homeHtml, storyItem, storyData] = await Promise.all([
    fetchWordPressCollection("pages", { _embed: "1", context: "view" }),
    fetchWordPressCollection("posts", { _embed: "1", context: "view" }),
    fetchWordPressCollection("media", { context: "view" }),
    fetchText(`${SITE_ORIGIN}/`),
    fetchJson(`${STORY_URL}?f=json`),
    fetchJson(`${STORY_URL}/data?f=json`)
  ]);

  const records = [
    ...pages.map((record) => ({ ...record, type: "page" })),
    ...posts.map((record) => ({ ...record, type: "post" }))
  ];
  const menu = parseMenu(homeHtml);
  const assetUrls = collectAssetUrls(records, media, storyData);
  console.log(`Downloading ${assetUrls.length} referenced/original media assets…`);
  const { mapping: assetMap, manifest } = await downloadAssets(assetUrls, storyData);
  const builtPages = buildPages(records, menu, assetMap);
  const storyMap = buildStoryMap(storyItem, storyData, assetMap);
  const siteContent = {
    site: {
      name: "EPOS Slovenia",
      longName: "European Plate Observing System Slovenia",
      language: "en",
      logo: assetMap.get(LOGO_URL) || "/wp-content/uploads/2023/07/logo.png"
    },
    menu,
    pages: builtPages,
    attachments: buildAttachments(media, assetMap)
  };

  await Promise.all([
    writeJson(path.join(DATA_DIR, "siteContent.json"), siteContent),
    writeJson(path.join(DATA_DIR, "storyMap.json"), storyMap)
  ]);

  const failures = manifest.filter((entry) => entry.error);
  const totalBytes = manifest.reduce((sum, entry) => sum + (entry.bytes || 0), 0);
  console.log(
    `Imported ${pages.length} pages, ${posts.length} post, ${media.length} media records, ` +
      `${manifest.length - failures.length} assets (${totalBytes.toLocaleString("en")} bytes).`
  );
  if (failures.length) {
    console.warn(`${failures.length} remote assets could not be localized; their source URLs were retained.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
