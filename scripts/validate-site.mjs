import * as cheerio from "cheerio";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "_site");
const DATA = JSON.parse(await fs.readFile(path.join(ROOT, "src", "_data", "siteContent.json"), "utf8"));
const STORY = JSON.parse(await fs.readFile(path.join(ROOT, "src", "_data", "storyMap.json"), "utf8"));
const rawPrefix = process.env.PATH_PREFIX || "/";
const pathPrefix = rawPrefix === "/" ? "" : `/${rawPrefix.replace(/^\/+|\/+$/g, "")}`;
const errors = [];

function outputPathFor(urlPath) {
  const clean = decodeURIComponent(urlPath.split(/[?#]/)[0] || "/");
  if (clean === "/") return path.join(OUTPUT, "index.html");
  if (path.posix.extname(clean)) return path.join(OUTPUT, clean.replace(/^\//, ""));
  return path.join(OUTPUT, clean.replace(/^\//, ""), "index.html");
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(fullPath)));
    else files.push(fullPath);
  }
  return files;
}

const expectedRoutes = [
  ...DATA.pages.map((item) => item.url),
  ...DATA.attachments.map((item) => item.url),
  "/category/nekategorizirano/",
  "/feed/index.xml",
  "/comments/feed/index.xml",
  "/sitemap.xml",
  "/wp-sitemap.xml",
  "/robots.txt",
  "/404.html",
  "/maps/stations/",
  "/maps/slo-karst/"
];

for (const route of expectedRoutes) {
  const filePath = outputPathFor(route);
  if (!(await exists(filePath))) errors.push(`Missing output for ${route}: ${path.relative(ROOT, filePath)}`);
}

const files = await walk(OUTPUT);
const htmlFiles = files.filter((file) => file.endsWith(".html"));

for (const file of htmlFiles) {
  const relative = path.relative(OUTPUT, file);
  const html = await fs.readFile(file, "utf8");
  const $ = cheerio.load(html);
  const isEmbedPage = $("html[data-embed-page]").length > 0;

  if (!$("html[lang]").length) errors.push(`${relative}: missing document language`);
  if (!normalize($("title").text())) errors.push(`${relative}: empty title`);
  if (!isEmbedPage && !$("main#main-content").length) errors.push(`${relative}: missing main content landmark`);
  if (!isEmbedPage && !$("nav[aria-label='Primary navigation']").length) {
    errors.push(`${relative}: missing primary navigation`);
  }
  if ($(".breadcrumbs").length) errors.push(`${relative}: breadcrumbs should not be rendered`);
  if ($(".site-header__accent").length) errors.push(`${relative}: legacy header accent is still rendered`);
  if ($(`a[href*="storymaps.arcgis.com/stories/"]`).length) {
    errors.push(`${relative}: still links to the ArcGIS StoryMap shell`);
  }
  if ($(`iframe[src^="//"]`).length) errors.push(`${relative}: contains a protocol-relative iframe`);
  for (const frame of $('iframe').toArray()) {
    if (!/^https:\/\/www\.youtube(?:-nocookie)?\.com\/embed\//.test($(frame).attr('src') || '')) errors.push(`${relative}: only YouTube embeds are allowed`);
  }
  if ($('script[src^="http"],link[rel="stylesheet"][href^="http"],img[src^="http"],video[src^="http"],source[src^="http"]').length) errors.push(`${relative}: remote runtime resource`);
  if ($("iframe:not([title])").length) errors.push(`${relative}: iframe without title`);
  if ($("img:not([alt])").length) errors.push(`${relative}: image without alt attribute`);
  if ($(`a[href=""]`).length) errors.push(`${relative}: empty link target`);
  if ($('a[href^="http://Within RI-SI-EPOS"]').length) errors.push(`${relative}: malformed RI-SI-EPOS link`);

  $("a").each((_, anchor) => {
    const element = $(anchor);
    const accessibleName = normalize(
      element.attr("aria-label") || element.text() || element.find("img[alt]").first().attr("alt") || ""
    );
    if (!accessibleName) errors.push(`${relative}: link without an accessible name`);
  });

  const ids = new Set();
  $("[id]").each((_, element) => {
    const id = $(element).attr("id");
    if (ids.has(id)) errors.push(`${relative}: duplicate id #${id}`);
    ids.add(id);
  });

  for (const element of $("a[href],img[src],script[src],link[href],iframe[src],object[data],video[src],source[src]").toArray()) {
    const attribute = element.tagName === "a" || element.tagName === "link" ? "href" : element.tagName === "object" ? "data" : "src";
    const rawUrl = $(element).attr(attribute);
    if (!rawUrl || /^(?:https?:|mailto:|tel:|data:|blob:|#)/i.test(rawUrl)) continue;
    if (!rawUrl.startsWith("/")) continue;
    let localUrl = rawUrl;
    if (pathPrefix && localUrl === pathPrefix) localUrl = "/";
    else if (pathPrefix && localUrl.startsWith(`${pathPrefix}/`)) localUrl = localUrl.slice(pathPrefix.length);
    else if (pathPrefix) {
      errors.push(`${relative}: root URL is missing deployment prefix: ${rawUrl}`);
      continue;
    }
    const targetPath = outputPathFor(localUrl);
    if (!(await exists(targetPath))) errors.push(`${relative}: missing local target ${rawUrl}`);
  }
}

function normalize(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function compactText(value = "") {
  return String(value).replace(/\s+/gu, "");
}

const publicationsFile = outputPathFor("/publications-sp/");
if (await exists(publicationsFile)) {
  const $ = cheerio.load(await fs.readFile(publicationsFile, "utf8"));
  const expected = DATA.pages.find((page) => page.url === "/publications-sp/")?.publicationCount;
  if ($(".publication-card").length !== expected) {
    errors.push(`Publications: expected ${expected} entries, found ${$(".publication-card").length}`);
  }
  if ($(".publication-card .publication-authors").length !== expected) {
    errors.push(
      `Publications: expected ${expected} author spans, found ${$(".publication-card .publication-authors").length}`
    );
  }
  const expectedEntries = DATA.pages.find((page) => page.url === "/publications-sp/")
    ?.publicationGroups.flatMap((group) => group.items) || [];
  $(".publication-card").each((index, card) => {
    const expectedText = compactText(cheerio.load(expectedEntries[index]?.html || "").root().text());
    if (compactText($(card).text()) !== expectedText) {
      errors.push(`Publications: entry ${index + 1} text does not match its source`);
    }
  });
}

for (const sourcePage of DATA.pages) {
  const $ = cheerio.load(sourcePage.contentHtml || "");
  $(".publication-entry").each((index, element) => {
    const authors = $(element).find(".publication-authors");
    if (!authors.length) errors.push(`${sourcePage.url}: publication ${index + 1} has no author emphasis`);
    authors.each((_, authorElement) => {
      if (/\b(?:19|20)\d{2}[a-z]?\b/i.test(normalize($(authorElement).text()))) {
        errors.push(`${sourcePage.url}: publication ${index + 1} includes a year in its author emphasis`);
      }
    });
  });
}

const unattributedGeozsTitles = new Set([
  "Razvoj raziskovalne infrastrukture za mednarodno konkurenčnost slovenskega RRI prostora (RI-SI-EPOS).",
  "Raziskovalni geološki laboratoriji v naravi.",
  "Razvoj raziskovalne infrastrukture za mednarodno konkurenčnost slovenskega RRI prostora – RI-SI EPOS."
]);
const expectedPartnerCitationCounts = new Map([
  ["/partners/arso/", 29],
  ["/partners/geozs/geozs-publications/", 20],
  ["/partners/ijs/", 9],
  ["/partners/ul-fgg/", 10]
]);

for (const sourcePage of DATA.pages.filter((page) => ["partner", "partner-publications"].includes(page.type))) {
  const filePath = outputPathFor(sourcePage.url);
  const $ = cheerio.load(await fs.readFile(filePath, "utf8"));
  const expectedCitationCount = expectedPartnerCitationCounts.get(sourcePage.url);
  if (expectedCitationCount && $(".publication-entry").length !== expectedCitationCount) {
    errors.push(
      `${sourcePage.url}: expected ${expectedCitationCount} rendered citations, found ${$(".publication-entry").length}`
    );
  }
  $(".publication-entry").each((index, element) => {
    const authors = $(element).find(".publication-authors");
    const title = normalize($(element).find("cite.publication-title").first().text());
    const isUnattributedGeozsEntry =
      sourcePage.url === "/partners/geozs/geozs-publications/" &&
      authors.length === 0 &&
      unattributedGeozsTitles.has(title);
    if (authors.length !== 1 && !isUnattributedGeozsEntry) {
      errors.push(`${sourcePage.url}: rendered publication ${index + 1} has ${authors.length} author spans`);
    }
  });

  if (sourcePage.url === "/partners/geozs/geozs-publications/") {
    for (const title of unattributedGeozsTitles) {
      const titleCitations = $("cite.publication-title").filter((_, element) => normalize($(element).text()) === title);
      const falseAuthorCitations = $(".publication-authors").filter(
        (_, element) => normalize($(element).text()) === title
      );
      if (titleCitations.length !== 1) errors.push(`${sourcePage.url}: unattributed title is not marked as a title: ${title}`);
      if (falseAuthorCitations.length) errors.push(`${sourcePage.url}: unattributed title is marked as authors: ${title}`);
    }
  }
}

for (const route of ["/events/", "/events-2/"]) {
  const sourcePage = DATA.pages.find((page) => page.url === route);
  const expected = sourcePage.newsGroups.reduce((sum, group) => sum + group.items.length, 0);
  const $ = cheerio.load(await fs.readFile(outputPathFor(route), "utf8"));
  if ($(".news-item").length !== expected) {
    errors.push(`${route}: expected ${expected} entries, found ${$(".news-item").length}`);
  }
  const expectedEntries = sourcePage.newsGroups.flatMap((group) => group.items);
  $(".news-item__content").each((index, item) => {
    const rendered = $(item).clone();
    rendered.find(".news-item__media").remove();
    const expectedText = compactText(cheerio.load(expectedEntries[index]?.html || "").root().text());
    if (compactText(rendered.text()) !== expectedText) {
      errors.push(`${route}: entry ${index + 1} text does not match its source`);
    }
  });
}

const dataSitesHtml = await fs.readFile(outputPathFor("/data-sites/"), "utf8");
const dataSites = cheerio.load(dataSitesHtml);
if (dataSites('.local-map[data-map="stations"]').length !== 1 || dataSites('.local-map[data-map="slo-karst"]').length !== 1) errors.push('Data & Sites: expected two shared local maps');
if (dataSites('iframe[src*="youtube-nocookie.com/embed/NM1so88QNgc"]').length !== 1) errors.push('Data & Sites: YouTube video is missing');
if (!dataSitesHtml.includes("The area south from Postojna")) errors.push("Data & Sites: NFO narrative is missing");
for (const block of STORY.blocks) {
  const expectedText = normalize(block.description || block.html || "");
  const expectedRenderedText = normalize(cheerio.load(expectedText).text()).replace(/^\d+\.\s*/, "");
  if (expectedText && !normalize(dataSites(".story-content").text()).includes(expectedRenderedText)) {
    errors.push(`Data & Sites: extracted ${block.type} content is missing: ${expectedText.slice(0, 72)}`);
  }
}
if (dataSites('iframe[src*="glvn.geo-zs.si"]').length) {
  errors.push("Data & Sites: blocked GeoZS portal must not be embedded");
}
if (dataSites('a.service-card[href="https://glvn.geo-zs.si/en/"]').length !== 1) {
  errors.push("Data & Sites: GeoZS observatory portal link is missing");
}
if (dataSites(".story-section--partner").length !== 3) {
  errors.push("Data & Sites: expected three linked partner summary sections");
}
const referenceItem = dataSites(".story-list li").filter((_, item) =>
  normalize(dataSites(item).text()).startsWith("Gostinčar, P., 2016")
).first();
if (!referenceItem.length || referenceItem.parent().children("li").length !== 4) {
  errors.push("Data & Sites: references are not rendered as one four-item list");
}

const homeHtml = await fs.readFile(outputPathFor("/"), "utf8");
const home = cheerio.load(homeHtml);
if (home(".fieldwork-gallery img").length !== DATA.pages.find((page) => page.url === "/")?.heroImages.length) {
  errors.push("Home: fieldwork gallery image count does not match the source content");
}
if (home('.fieldwork-gallery img[alt=""]').length) errors.push("Home: fieldwork gallery contains empty alt text");
if (home(".home-copy > p").length < 4) errors.push("Home: introduction is not split into readable paragraphs");
const homeSource = DATA.pages.find((page) => page.url === "/");
if (compactText(home(".home-copy").text()) !== compactText(cheerio.load(homeSource.contentHtml).root().text())) {
  errors.push("Home: source content was not preserved");
}

const reorderedContentRoutes = new Set(["/partners/ijs/", "/partners/geozs/geozs-publications/"]);
for (const sourcePage of DATA.pages) {
  if (
    !sourcePage.contentHtml ||
    ["home", "news", "publications", "storymap"].includes(sourcePage.type) ||
    reorderedContentRoutes.has(sourcePage.url)
  ) continue;
  const $ = cheerio.load(await fs.readFile(outputPathFor(sourcePage.url), "utf8"));
  $('.local-map').remove();
  const expectedText = compactText(cheerio.load(sourcePage.contentHtml).root().text());
  if (compactText($("article.wp-content").text()) !== expectedText) {
    errors.push(`${sourcePage.url}: source content was not preserved`);
  }
}

const geozsSource = DATA.pages.find((page) => page.url === "/partners/geozs/geozs-publications/");
const geozsOutput = cheerio.load(await fs.readFile(outputPathFor(geozsSource.url), "utf8"));
geozsOutput(".publication-year-heading").remove();
if (
  compactText(geozsOutput("article.wp-content").text()) !==
  compactText(cheerio.load(geozsSource.contentHtml).root().text())
) {
  errors.push(`${geozsSource.url}: citation text was not preserved`);
}

const media = cheerio.load(await fs.readFile(outputPathFor("/media/"), "utf8"));
if (media(".media-card").length !== 2 || media(".media-card iframe").length !== 2) {
  errors.push("Media: expected two structured video cards");
}

const allGeneratedHtml = (
  await Promise.all(htmlFiles.map((file) => fs.readFile(file, "utf8")))
).join("\n");
for (const forbidden of ["lean Eleventy", "scraped from", "migration brief", "WordPress replacement"]) {
  if (allGeneratedHtml.toLowerCase().includes(forbidden.toLowerCase())) {
    errors.push(`Generated pages contain implementation wording: ${forbidden}`);
  }
}

if (errors.length) {
  console.error(`Validation failed with ${errors.length} error${errors.length === 1 ? "" : "s"}:`);
  errors.slice(0, 120).forEach((error) => console.error(`- ${error}`));
  if (errors.length > 120) console.error(`- …and ${errors.length - 120} more`);
  process.exitCode = 1;
} else {
  console.log(
    `Validated ${htmlFiles.length} HTML pages, ${DATA.pages.length} content routes, ` +
      `${DATA.attachments.length} attachment routes, local assets, embeds and deployment paths.`
  );
}
