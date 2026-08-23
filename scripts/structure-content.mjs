import * as cheerio from "cheerio";

function normalizeText(value = "") {
  return String(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function escapeText(value = "") {
  return cheerio.load("<span></span>", null, false)("span").text(value).html();
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

function splitPublicationEntries($) {
  $(".publication-entry").each((_, entry) => {
    const element = $(entry);
    if (element.find(".publication-authors").length < 2) return;

    const chunks = [];
    let current = "";
    let authorsSeen = 0;
    for (const node of element.contents().toArray()) {
      const isAuthors = node.type === "tag" && $(node).hasClass("publication-authors");
      if (isAuthors && authorsSeen > 0 && normalizeText(cheerio.load(current, null, false).text())) {
        chunks.push(current.replace(/^(?:\s|<br\s*\/?\s*>)+/gi, "").trim());
        current = "";
      }
      current += $.html(node);
      if (isAuthors) authorsSeen += 1;
    }
    if (normalizeText(cheerio.load(current, null, false).text())) {
      chunks.push(current.replace(/^(?:\s|<br\s*\/?\s*>)+/gi, "").trim());
    }
    if (chunks.length > 1) {
      element.replaceWith(chunks.map((chunk) => `<p class="publication-entry">${chunk}</p>`).join(""));
    }
  });
}

const ARSO_SPLIT_AUTHOR_SEQUENCES = [
  "Cunder M., Krsnik P.",
  "Danciu L., Nandan S., Reyes C., Basili R., Weatherill G., Beauval C., Rovida A., Vilanova S., Sesetyan K., Bard P-Y., Cotton F., Wiemer S., Giardini D."
];

function emphasizeLeadingAuthors(html = "", authorSequences = []) {
  const fragment = cheerio.load(html, null, false);
  const firstTextNode = fragment
    .root()
    .contents()
    .toArray()
    .find((node) => node.type === "text" && normalizeText(node.data));
  if (!firstTextNode) return fragment.html();

  const leadingSpace = firstTextNode.data.match(/^\s*/u)?.[0] || "";
  const text = firstTextNode.data.slice(leadingSpace.length);
  const authors = authorSequences.find((sequence) => text.startsWith(sequence));
  if (!authors) return fragment.html();

  fragment(firstTextNode).replaceWith(
    `${escapeText(leadingSpace)}<strong class="publication-authors">${escapeText(authors)}</strong>${escapeText(text.slice(authors.length))}`
  );
  return fragment.html();
}

function splitArsoCombinedCitations($, page = {}) {
  if (page.url !== "/partners/arso/") return;

  $(".publication-entry").each((_, entry) => {
    const element = $(entry);
    const nodes = element.contents().toArray();
    const splitAt = nodes.findIndex((node, index) => {
      if (node.type !== "tag" || node.name !== "br") return false;
      const before = normalizeText(nodes.slice(0, index).map((item) => $.html(item)).join(""));
      const afterHtml = nodes.slice(index + 1).map((item) => $.html(item)).join("");
      const after = cheerio.load(afterHtml, null, false);
      const afterText = normalizeText(after.text());
      const startsWithMarkedAuthors = after.root().children().first().hasClass("publication-authors");
      const startsWithKnownAuthors = ARSO_SPLIT_AUTHOR_SEQUENCES.some((authors) => afterText.startsWith(authors));
      return Boolean(before && afterText && (startsWithMarkedAuthors || startsWithKnownAuthors));
    });
    if (splitAt < 0) return;

    const before = emphasizeLeadingAuthors(
      nodes.slice(0, splitAt).map((node) => $.html(node)).join(""),
      ARSO_SPLIT_AUTHOR_SEQUENCES
    );
    const after = emphasizeLeadingAuthors(
      nodes.slice(splitAt + 1).map((node) => $.html(node)).join(""),
      ARSO_SPLIT_AUTHOR_SEQUENCES
    );
    element.replaceWith(
      `<p class="publication-entry">${before}</p><p class="publication-entry">${after}</p>`
    );
  });
}

function normalizeGeozsAuthorEmphasis($, page = {}) {
  if (page.url !== "/partners/geozs/geozs-publications/") return;

  $(".publication-entry .publication-authors").each((_, authors) => {
    const element = $(authors);
    const text = normalizeText(element.text());
    const authorAndTitle = text.match(/^(.+?\.)\s*:\s*(.+)$/u);
    if (authorAndTitle) {
      element.replaceWith(
        `<strong class="publication-authors">${escapeText(authorAndTitle[1])}</strong>: ${escapeText(authorAndTitle[2])}`
      );
      return;
    }

    if (!text.includes(",") && text.split(/\s+/u).length > 3) {
      element.replaceWith(`<cite class="publication-title">${element.html()}</cite>`);
    }
  });
}

function promotePublicationYearLabels($) {
  $(".publication-entry .publication-year-label").each((_, yearLabel) => {
    const label = $(yearLabel);
    const entry = label.closest(".publication-entry");
    const nodes = entry.contents().toArray();
    const labelIndex = nodes.indexOf(yearLabel);
    const precedingText = normalizeText(
      nodes
        .slice(0, labelIndex)
        .filter((node) => node.type !== "tag" || node.name !== "br")
        .map((node) => $.html(node))
        .join("")
    );
    const heading = `<p class="publication-year-heading"><strong>${escapeText(normalizeText(label.text()))}</strong></p>`;

    let sibling = yearLabel.previousSibling;
    while (sibling && (sibling.type === "text" ? !normalizeText(sibling.data) : sibling.name === "br")) {
      const previous = sibling.previousSibling;
      $(sibling).remove();
      sibling = previous;
    }
    sibling = yearLabel.nextSibling;
    while (sibling && (sibling.type === "text" ? !normalizeText(sibling.data) : sibling.name === "br")) {
      const next = sibling.nextSibling;
      $(sibling).remove();
      sibling = next;
    }
    label.remove();

    if (precedingText) entry.after(heading);
    else entry.before(heading);
  });
}

function mergeAdjacentLinks($) {
  $("a[href]").each((_, anchor) => {
    const element = $(anchor);
    while (true) {
      let sibling = anchor.nextSibling;
      const whitespace = [];
      while (sibling?.type === "text" && !normalizeText(sibling.data)) {
        whitespace.push(sibling);
        sibling = sibling.nextSibling;
      }
      if (sibling?.type !== "tag" || sibling.name !== "a" || $(sibling).attr("href") !== element.attr("href")) {
        break;
      }
      whitespace.forEach((node) => $(node).remove());
      element.append($(sibling).contents());
      $(sibling).remove();
    }
  });
}

function splitLongParagraphs($) {
  $("p:not(.publication-entry)").each((_, paragraph) => {
    const element = $(paragraph);
    if (normalizeText(element.text()).length < 900) return;

    const chunks = [];
    let current = "";
    let currentLength = 0;
    const nodes = element.contents().toArray();

    function commit() {
      if (normalizeText(cheerio.load(current, null, false).text())) chunks.push(current.trim());
      current = "";
      currentLength = 0;
    }

    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (node.type === "tag" && node.name === "br") {
        if (nodes[index + 1]?.type === "tag" && nodes[index + 1].name === "br") {
          commit();
          while (nodes[index + 1]?.type === "tag" && nodes[index + 1].name === "br") index += 1;
        } else {
          current += "<br>";
        }
        continue;
      }

      if (node.type === "text") {
        const parts = String(node.data).split(/(?<=[.!?])(?=(?:\s+[A-ZÀ-Ž0-9“"'])|[A-ZÀ-Ž“"'])|(?=–\s+)/u);
        parts.forEach((part, partIndex) => {
          const partLength = normalizeText(part).length;
          if (currentLength >= 280 && currentLength + partLength > 680) commit();
          current += escapeText(part);
          currentLength += partLength;
          if (partIndex < parts.length - 1 && currentLength >= 680) commit();
        });
      } else {
        const nodeLength = normalizeText($(node).text()).length;
        if (currentLength >= 280 && currentLength + nodeLength > 680) commit();
        current += $.html(node);
        currentLength += nodeLength;
      }
    }
    commit();

    if (chunks.length > 1) {
      const className = element.attr("class");
      const classAttribute = className ? ` class="${className}"` : "";
      element.replaceWith(chunks.map((chunk) => `<p${classAttribute}>${chunk}</p>`).join(""));
    }
  });
}

function prepareContent(value = "", page = {}) {
  const $ = cheerio.load(String(value || ""), null, false);
  $('a[href^="http://Within RI-SI-EPOS project partners are purchasing"]').each((_, anchor) => {
    $(anchor).attr("href", "/data-sites/").removeAttr("target rel");
  });
  $("p").each((_, paragraph) => {
    const element = $(paragraph);
    element.html((element.html() || "").replace(/49E-mail:/g, "49<br>E-mail:"));
  });
  splitPublicationEntries($);
  splitArsoCombinedCitations($, page);
  normalizeGeozsAuthorEmphasis($, page);
  promotePublicationYearLabels($);
  mergeAdjacentLinks($);
  splitLongParagraphs($);
  $('img[src$="/logoEPOS.png"][alt=""]').attr("alt", "European Plate Observing System logo");
  if (page.type === "partner") {
    const profileImage = $("img").first();
    profileImage.attr({ loading: "eager", fetchpriority: "high" });
    if (!normalizeText(profileImage.attr("alt"))) profileImage.attr("alt", `${page.title} building`);
  }

  const usedIds = new Map();
  $("h2").each((_, heading) => {
    const element = $(heading);
    const base = slugify(element.text());
    const count = usedIds.get(base) || 0;
    usedIds.set(base, count + 1);
    if (!element.attr("id")) element.attr("id", count ? `${base}-${count + 1}` : base);
  });
  return $;
}

export function structureHomeContent(value = "") {
  const $ = cheerio.load(String(value || ""), null, false);
  const paragraph = $("p").first();
  const breakAfter = [
    "economic power of Europeans.",
    "among the most significant.",
    "essential information for decision makers.",
    "under different geological regimes.",
    "delivery system for the solid Earth."
  ];
  let remainder = paragraph.html() || "";
  const chunks = [];
  for (const marker of breakAfter) {
    const end = remainder.indexOf(marker);
    if (end < 0) continue;
    const splitAt = end + marker.length;
    chunks.push(remainder.slice(0, splitAt).trim());
    remainder = remainder.slice(splitAt).trim();
  }
  if (remainder) chunks.push(remainder);
  if (chunks.length > 1) paragraph.replaceWith(chunks.map((chunk) => `<p>${chunk}</p>`).join(""));
  return $.html().trim();
}

export function contentHeadings(value = "") {
  const $ = prepareContent(value);
  return $("h2")
    .toArray()
    .filter((heading) => normalizeText($(heading).text()))
    .map((heading) => ({ id: $(heading).attr("id"), label: normalizeText($(heading).text()) }));
}

function tidyLegacyLinks($) {
  $("a").each((_, anchor) => {
    $(anchor).children("br").remove();
  });
}

function groupCardPairs($, section, headingSelector = "h4") {
  const nodes = section.children().toArray();
  const cards = [];
  const consumed = new Set();
  let firstNode = null;

  for (let index = 0; index < nodes.length - 1; index += 1) {
    const heading = nodes[index];
    const paragraph = nodes[index + 1];
    if (!$(heading).is(headingSelector) || !$(paragraph).is("p")) continue;
    firstNode ||= heading;
    cards.push(`<article class="legacy-card">${$.html(heading)}${$.html(paragraph)}</article>`);
    consumed.add(heading);
    consumed.add(paragraph);
    index += 1;
  }

  if (!cards.length) return;
  $(firstNode).before(`<div class="legacy-card-grid">${cards.join("")}</div>`);
  consumed.forEach((node) => $(node).remove());
}

function groupImageCards($, section) {
  const nodes = section.children().toArray();
  const cards = [];
  const consumed = new Set();
  let firstNode = null;

  for (let index = 0; index < nodes.length - 2; index += 1) {
    const figure = nodes[index];
    const heading = nodes[index + 1];
    const paragraph = nodes[index + 2];
    if (!$(figure).is("figure") || !$(heading).is("h4") || !$(paragraph).is("p")) continue;
    firstNode ||= figure;
    cards.push(
      `<article class="legacy-card legacy-card--image">${$.html(figure)}${$.html(heading)}${$.html(paragraph)}</article>`
    );
    consumed.add(figure);
    consumed.add(heading);
    consumed.add(paragraph);
    index += 2;
  }

  if (!cards.length) return;
  $(firstNode).before(`<div class="legacy-card-grid legacy-card-grid--images">${cards.join("")}</div>`);
  consumed.forEach((node) => $(node).remove());
}

function extractImagePair($, section) {
  const paragraph = section.children("p").first();
  const images = paragraph.find("img").toArray();
  if (!images.length) return;

  const gallery = images
    .map((image) => {
      const html = $.html(image);
      $(image).remove();
      return `<figure>${html}</figure>`;
    })
    .join("");
  paragraph.find("br").remove();
  section.append(`<div class="legacy-image-pair">${gallery}</div>`);
}

function structureTestimonials($, section) {
  const paragraph = section.children("p").first();
  const images = [];
  const chunks = [""];

  for (const node of paragraph.contents().toArray()) {
    if (node.type === "tag" && node.name === "img") {
      images.push($.html(node));
      chunks.push("");
    } else if (node.type === "tag" && node.name === "br") {
      chunks[chunks.length - 1] += " ";
    } else if (node.type === "text") {
      chunks[chunks.length - 1] += node.data;
    } else {
      chunks[chunks.length - 1] += $(node).text();
    }
  }

  if (!images.length) return;
  const quotes = [normalizeText(chunks[0])];
  const names = [];
  for (const chunk of chunks.slice(1)) {
    const text = normalizeText(chunk);
    const nextQuote = text.indexOf("“");
    if (nextQuote >= 0) {
      names.push(text.slice(0, nextQuote).trim());
      quotes.push(text.slice(nextQuote).trim());
    } else {
      names.push(text);
    }
  }

  const cards = images.map((image, index) => {
    const quote = quotes[index] || "";
    const name = names[index] || "";
    return `<blockquote class="legacy-testimonial"><p>${escapeText(quote)}</p><footer>${image}<strong>${escapeText(name)}</strong></footer></blockquote>`;
  });
  paragraph.replaceWith(`<div class="legacy-testimonials">${cards.join("")}</div>`);
}

function structureFaq($, section) {
  const items = [];
  section.children("h4").each((index, heading) => {
    const answer = $(heading).next("p");
    if (!answer.length) return;
    const id = $(heading).attr("id");
    const idAttribute = id ? ` id="${id}"` : "";
    items.push(
      `<details class="legacy-faq-item"${idAttribute}${index === 0 ? " open" : ""}><summary>${escapeText(normalizeText($(heading).text()))}</summary><div>${$.html(answer)}</div></details>`
    );
    $(heading).remove();
    answer.remove();
  });
  if (items.length) section.append(`<div class="legacy-faq-list">${items.join("")}</div>`);
}

function structureLegacyHome($) {
  $(".content-section--this-headline-grabs-visitors-attention").addClass("legacy-intro");

  const services = $(".content-section--our-services").addClass("legacy-card-section");
  groupImageCards($, services);

  const benefits = $(".content-section--why-choose-us").addClass("legacy-card-section");
  groupCardPairs($, benefits);

  $(".content-section--about-our-company").addClass("legacy-copy-section");
  structureTestimonials($, $(".content-section--client-testimonials").addClass("legacy-testimonial-section"));
  $(".content-section--a-title-to-turn-the-visitor-into-a-lead").addClass("legacy-cta-section");
}

function structureLegacyStory($) {
  const story = $(".content-section--our-story").addClass("legacy-intro");
  const eyebrowSection = $(".content-section--intro");
  const eyebrow = eyebrowSection.children("h6").first();
  if (eyebrow.length) {
    eyebrow.addClass("legacy-eyebrow");
    story.prepend(eyebrow);
    eyebrowSection.remove();
  }

  extractImagePair($, $(".content-section--our-mission").addClass("legacy-media-section"));
  const benefits = $(".content-section--why-choose-us").addClass("legacy-card-section");
  groupCardPairs($, benefits);
  structureTestimonials($, $(".content-section--client-testimonials").addClass("legacy-testimonial-section"));
  $(".content-section--a-title-to-turn-the-visitor-into-a-lead").addClass("legacy-cta-section");
}

function structureLegacyServices($) {
  const intro = $(".content-section--our-services").addClass("legacy-intro");
  const leadSection = $(".content-section--this-text-briefly-introduces-visitors-to-your-main-services");
  const lead = leadSection.children("h2").first();
  if (lead.length) {
    lead[0].tagName = "p";
    lead.addClass("legacy-lead");
    intro.append(lead);
    leadSection.remove();
  }

  const serviceSections = $("section[class*='content-section--service-']").toArray();
  const serviceCards = [];
  let featureEyebrow = null;
  for (const section of serviceSections) {
    const element = $(section);
    const heading = element.children("h2").first();
    if (!/^Service \d+$/i.test(normalizeText(heading.text()))) continue;
    const eyebrow = element.children("h6").first();
    if (eyebrow.length) {
      featureEyebrow = eyebrow.clone().addClass("legacy-eyebrow");
      eyebrow.remove();
    }
    if (heading.length) heading[0].tagName = "h3";
    serviceCards.push(`<article class="legacy-card legacy-service-card">${element.html()}</article>`);
    element.remove();
  }
  if (serviceCards.length) {
    intro.after(`<div class="legacy-card-grid legacy-card-grid--services">${serviceCards.join("")}</div>`);
  }

  const feature = $(".content-section--a-title-about-your-services").addClass("legacy-media-section");
  if (featureEyebrow?.length) feature.prepend(featureEyebrow);
  extractImagePair($, feature);

  structureFaq($, $(".content-section--faq").addClass("legacy-faq-section"));
  structureTestimonials($, $(".content-section--client-testimonials").addClass("legacy-testimonial-section"));
  $(".content-section--a-title-to-turn-the-visitor-into-a-lead").addClass("legacy-cta-section");
}

function structureLegacyContent(html, pageUrl) {
  const $ = cheerio.load(html, null, false);
  tidyLegacyLinks($);
  if (pageUrl === "/home-2/") structureLegacyHome($);
  if (pageUrl === "/our-story/") structureLegacyStory($);
  if (pageUrl === "/our-services/") structureLegacyServices($);
  return $.html().trim();
}

function structureTransformProject($) {
  const section = $(".content-section--intro").first().addClass("project-story project-story--transform");
  const heading = section.children("h3").first();
  const facts = section.children("ul").first().addClass("project-facts");
  if (!heading.length || !facts.length) return;

  heading[0].tagName = "h2";
  heading.addClass("project-summary__title");
  facts.children("li").addClass("project-fact");

  const summary = $('<header class="project-summary"></header>').append(heading, facts);
  const copy = $('<div class="project-story__copy"></div>').append(section.children().toArray());
  section.empty().append(summary, copy);
}

function structureEposOnProject($) {
  const section = $(".content-section--intro").first().addClass("project-story project-story--epos-on");
  const figures = section.children("figure");
  const paragraphs = section.children("p");
  if (figures.length < 2 || !paragraphs.length) return;

  const logo = figures.first().addClass("project-overview__logo");
  const feature = figures.last().addClass("project-story__visual");
  const lead = paragraphs.first().addClass("project-overview__lead");
  lead[0].tagName = "h2";
  const logoImage = logo.find("img").first();
  const featureImage = feature.find("img").first();
  logoImage.attr({ loading: "eager", fetchpriority: "high" });
  featureImage.attr("loading", "eager");
  if (!normalizeText(logoImage.attr("alt"))) logoImage.attr("alt", "EPOS ON");
  if (!normalizeText(featureImage.attr("alt"))) {
    featureImage.attr("alt", "EPOS ON project meeting participants");
  }

  const overview = $('<header class="project-overview"></header>')
    .append($('<div class="project-overview__mark"></div>').append(logo))
    .append($('<div class="project-overview__copy"></div>').append(lead));
  const copy = $('<div class="project-story__copy"></div>').append(paragraphs.slice(1).toArray());
  section.empty().append(overview, copy, feature);
}

function structureContactCard($) {
  const section = $(".content-section--intro").first().addClass("contact-card");
  const headings = section.children("h3");
  const brand = headings.first();
  const person = headings.eq(1);
  const role = section.children("h4").first();
  if (!brand.length || !person.length || !role.length) return;

  brand[0].tagName = "p";
  brand.addClass("contact-card__brand");
  person[0].tagName = "h2";
  person.addClass("contact-card__person");
  role[0].tagName = "p";
  role.addClass("contact-card__role");

  const identity = $('<header class="contact-card__identity"></header>').append(brand, person, role);
  const details = $('<div class="contact-card__details"></div>').append(section.children().toArray());
  details.children("div").eq(0).addClass("contact-card__organization");
  details.children("div").eq(1).addClass("contact-card__institute");
  details.children("div").eq(2).addClass("contact-card__methods");
  details.children("p").last().addClass("contact-card__social");
  section.empty().append(identity, details);
}

function structureEposSp($) {
  const section = $(".content-section--intro").first().addClass("programme-story programme-story--epos-sp");
  const summary = section.children("p").first().addClass("programme-story__summary-text");
  const columns = section.children(".wp-block-columns").first().addClass("programme-story__body");
  const columnItems = columns.children(".wp-block-column");
  if (!summary.length || columnItems.length < 2) return;

  columnItems.first().addClass("programme-story__copy");
  columnItems.last().addClass("programme-story__visual");
  const image = columnItems.last().find("img").first();
  image.attr({
    alt: "EPOS Sustainability Phase project overview",
    loading: "eager",
    fetchpriority: "high"
  });

  const header = $('<header class="programme-story__summary"></header>').append(summary);
  section.empty().append(header, columns);
}

function structureFundedProject($) {
  const section = $(".content-section--intro").first().addClass("funded-project");
  const paragraphs = section.children("p");
  const visual = section.children("figure").first().addClass("funded-project__visual");
  if (!paragraphs.length || !visual.length) return;

  paragraphs.first().addClass("funded-project__title");
  paragraphs.eq(1).addClass("funded-project__facts");
  paragraphs.slice(2).addClass("funded-project__links");
  const image = visual.find("img").first();
  image.attr({
    alt: "RI-SI-EPOS research infrastructure project overview",
    loading: "eager",
    fetchpriority: "high"
  });

  const copy = $('<div class="funded-project__copy"></div>').append(paragraphs.toArray());
  section.empty().append(copy, visual);
}

function structureResearchPage($) {
  const section = $(".content-section--intro").first().addClass("research-story");
  section.children("p").first().addClass("research-story__lead");
  const document = section.children("figure").first().addClass("research-story__document");
  document.find("img").first().attr({
    alt: "RI-SI-EPOS research equipment project overview",
    loading: "eager"
  });
}

function structureDataServices($) {
  const section = $(".content-section--intro").first().addClass("data-services-story");
  const source = section.find(".field-item").first();
  const image = source.find("img").first();
  if (!source.length || !image.length) return;

  image.attr({
    src: "/wp-content/uploads/2018/05/EPOS_ICSarchitecture_2016-01.png",
    alt: "EPOS integrated core services architecture",
    loading: "eager",
    fetchpriority: "high"
  }).removeAttr("width height").removeClass("alignleft size-medium");
  const imageHtml = $.html(image);
  image.closest("p").remove();

  const copy = $('<div class="data-services-story__copy"></div>').append(source.children().toArray());
  const visual = $(`<figure class="data-services-story__visual">${imageHtml}</figure>`);
  section.empty().append(copy, visual);
}

function structureSpecialContent(html, pageUrl) {
  const $ = cheerio.load(html, null, false);
  if (pageUrl === "/epos-slovenia/epos-transform/") structureTransformProject($);
  if (pageUrl === "/epos-slovenia/epos-on/") structureEposOnProject($);
  if (pageUrl === "/contact/") structureContactCard($);
  if (pageUrl === "/epos-sp/") structureEposSp($);
  if (pageUrl === "/ri-si-epos/") structureFundedProject($);
  if (pageUrl === "/research-sp/") structureResearchPage($);
  if (pageUrl === "/data-services/") structureDataServices($);
  return $.html().trim();
}

export default function structureContent(value = "", page = {}) {
  const html = String(value || "").trim();
  if (!html) return "";

  let $ = cheerio.load(html, null, false);

  $("h1").each((_, heading) => {
    heading.tagName = "h2";
    $(heading).addClass("section-heading");
  });

  $("h1,h2,h3,h4,h5,h6").each((_, heading) => {
    const element = $(heading);
    if (!normalizeText(element.text())) element.remove();
  });

  $ = prepareContent($.html(), page);

  if (page.type === "media") {
    const cards = [];
    const nodes = $.root().children().toArray();
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (node.tagName === "p" && nodes[index + 1]?.tagName === "figure") {
        cards.push(
          `<article class="media-card"><h2>${$(node).html()}</h2>${$.html(nodes[index + 1])}</article>`
        );
        index += 1;
      } else {
        cards.push($.html(node));
      }
    }
    return `<section class="media-grid">${cards.join("")}</section>`;
  }

  if (page.type === "partner-publications") {
    let currentYear = "";
    const entries = [];
    $(".publication-entry").each((_, entry) => {
      const element = $(entry);
      const year = normalizeText(element.text()).match(/\b(?:19|20)\d{2}\b/)?.[0] || "Other";
      if (year !== currentYear) {
        currentYear = year;
        const yearId = year === "Other" ? "other-publications" : `publications-${year}`;
        entries.push(`<h2 class="publication-year-heading" id="${yearId}">${year}</h2>`);
      }
      entries.push($.html(element));
    });
    return `<div class="partner-publication-list">${entries.join("")}</div>`;
  }

  if (page.url === "/partners/" || page.url === "/consortium/") {
    return $.html().trim();
  }

  const nodes = $.root().children().toArray();
  if (!nodes.some((node) => node.tagName === "h2")) {
    const intro = `<section class="content-section content-section--intro">${$.html().trim()}</section>`;
    return structureSpecialContent(intro, page.url);
  }

  const sections = [];
  let current = [];
  let modifier = "intro";

  function commit() {
    if (!current.length) return;
    sections.push(`<section class="content-section content-section--${modifier}">${current.join("")}</section>`);
    current = [];
  }

  for (const node of nodes) {
    if (node.tagName === "h2") {
      commit();
      modifier = slugify($(node).text());
    }
    current.push($.html(node));
  }
  commit();

  const structured = sections.join("");
  if (["/home-2/", "/our-story/", "/our-services/"].includes(page.url)) {
    return structureLegacyContent(structured, page.url);
  }
  return structureSpecialContent(structured, page.url);
}
