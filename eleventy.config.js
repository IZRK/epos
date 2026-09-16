import htmlmin from "./scripts/html-minify.mjs";
import structureContent, { contentHeadings, structureHomeContent } from "./scripts/structure-content.mjs";

export default function (eleventyConfig) {
  const rawPathPrefix = process.env.PATH_PREFIX || "/";
  const pathPrefix = rawPathPrefix === "/" ? "/" : `/${rawPathPrefix.replace(/^\/+|\/+$/g, "")}/`;
  const baseUrl = (process.env.SITE_URL || "https://epos-ip.zrc-sazu.si").replace(/\/$/, "");

  eleventyConfig.addPassthroughCopy({ public: "/" });
  eleventyConfig.addGlobalData("deployment", { pathPrefix, baseUrl });
  eleventyConfig.addGlobalData("currentYear", new Date().getUTCFullYear());

  eleventyConfig.addFilter("year", (date = new Date()) =>
    new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "UTC" }).format(date)
  );

  eleventyConfig.addFilter("stripHtml", (value = "") =>
    String(value)
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#8211;|&ndash;/g, "–")
      .replace(/&#8212;|&mdash;/g, "—")
      .replace(/&#8217;|&rsquo;/g, "’")
      .replace(/\s+/g, " ")
      .trim()
  );

  eleventyConfig.addFilter("json", (value) => JSON.stringify(value));
  eleventyConfig.addFilter("pageByUrl", (pages = [], url = "/") =>
    pages.find((item) => item.url === url)
  );
  eleventyConfig.addFilter("isNavActive", (item, currentUrl = "/") => {
    if (item?.url === currentUrl) return true;
    return (item?.children || []).some((child) => child.url === currentUrl);
  });
  eleventyConfig.addFilter("excerpt", (value = "", length = 190) => {
    const text = String(value).replace(/\s+/g, " ").trim();
    return text.length > length ? `${text.slice(0, length - 1).trim()}…` : text;
  });
  eleventyConfig.addFilter("structureContent", structureContent);
  eleventyConfig.addFilter("localMapSegments", (html) => html
    .split(/(<iframe\b[^>]*src="https:\/\/zrc\.maps\.arcgis\.com\/[^>]*>[\s\S]*?<\/iframe>)/gi)
    .map(part => /^<iframe/i.test(part)
      ? { mapSlug: part.includes('daba1ce3c7c74957af450092afb31e41') ? 'stations' : 'slo-karst' }
      : { html: part }));
  eleventyConfig.addFilter("contentHeadings", contentHeadings);
  eleventyConfig.addFilter("structureHomeContent", structureHomeContent);
  eleventyConfig.addFilter("storySections", (blocks = []) => {
    const normalizedBlocks = [];
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      if (block.type !== "list") {
        normalizedBlocks.push(block);
        continue;
      }
      let html = block.html;
      while (blocks[index + 1]?.type === "text" && /^\s*\d+\.\s/.test(blocks[index + 1].html || "")) {
        index += 1;
        html += `<li>${String(blocks[index].html).replace(/^\s*\d+\.\s*/, "")}</li>`;
      }
      normalizedBlocks.push({ ...block, html });
    }

    const sections = [];
    let section = null;
    for (const block of normalizedBlocks) {
      if (block.type === "separator") continue;
      if (!section || (block.type === "heading" && block.level <= 2)) {
        section = { id: block.id || `story-section-${sections.length + 1}`, blocks: [] };
        sections.push(section);
      }
      section.blocks.push(block);
    }
    return sections;
  });
  eleventyConfig.addFilter("absoluteUrl", (url = "/") => {
    if (/^https?:\/\//i.test(url)) return url;
    return `${baseUrl}${url === "/" ? "/" : `/${String(url).replace(/^\//, "")}`}`;
  });
  eleventyConfig.addFilter("xmlEscape", (value = "") =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
  );
  eleventyConfig.addFilter("rfc822", (value) => new Date(value).toUTCString());
  eleventyConfig.addTransform("htmlmin", function (content) {
    return htmlmin.call(this, content, pathPrefix);
  });

  return {
    dir: {
      input: "src",
      includes: "_includes",
      data: "_data",
      output: "_site"
    },
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
    templateFormats: ["njk", "md"],
    pathPrefix
  };
}
