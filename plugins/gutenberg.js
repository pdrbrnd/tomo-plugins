// Project Gutenberg plugin for Tomo. Served from `pdrbrnd/tomo-plugins`.
//
// Scrapes PG's own HTML search (`/ebooks/search/`). An earlier version
// used gutendex.com, but by Oct 2026 its origin was overloaded: only
// Cloudflare-cached queries came back fast, and a cache miss took 20-70s
// (past Tomo's 30s fetch timeout) or returned an Apache 503. PG's search
// answers in under a second. It does rate-limit bursts, but one debounced
// search per keystroke pause is well inside that.

const manifest = {
  id: "gutenberg",
  name: "Project Gutenberg",
  description:
    "Search and download public-domain books from Project Gutenberg.",
  homepage: "https://www.gutenberg.org",
  author: "Tomo",
  license: "MIT",
  minAppVersion: "1.7.0",
};

const PG_BASE = "https://www.gutenberg.org";

// PG appends " (Portuguese)" etc. to non-English titles; English titles
// carry no suffix. Unknown names map to "" and Tomo classifies on import.
const LANGUAGE_CODES = {
  English: "en", French: "fr", German: "de", Spanish: "es",
  Portuguese: "pt", Italian: "it", Dutch: "nl", Finnish: "fi",
  Swedish: "sv", Danish: "da", Norwegian: "no", Polish: "pl",
  Russian: "ru", Hungarian: "hu", Czech: "cs", Greek: "el",
  Latin: "la", Catalan: "ca", Esperanto: "eo", Tagalog: "tl",
  Chinese: "zh", Japanese: "ja", Welsh: "cy", Irish: "ga",
};

async function search(query) {
  // Only EPUB is surfaced; if the user asked for another format, skip.
  if (query.format && query.format.toLowerCase() !== "epub") return [];

  const text = [query.text, query.title, query.author]
    .filter((s) => s && s.trim().length > 0)
    .join(" ")
    .trim();
  if (!text) return [];

  // `!cat.audio` drops audiobooks: they look identical to texts in the
  // result list but have no EPUB, so download() would 404.
  const url = `${PG_BASE}/ebooks/search/?query=${encodeURIComponent(`${text} !cat.audio`)}`;
  console.log(`fetching ${url}`);
  const r = await fetch(url);
  if (!r.ok) {
    console.error(`search failed: HTTP ${r.status}`);
    return [];
  }

  // Non-book rows ("Authors", "Subjects", "No records found.") are also
  // `li.booklink` but don't link to /ebooks/<id>, so the id check drops them.
  const items = querySelectorAll(r.body, "li.booklink");
  const results = [];
  for (const item of items) {
    const href = querySelectorAll(item.html, "a.link")[0]?.attrs?.href || "";
    const id = href.match(/^\/ebooks\/(\d+)$/)?.[1];
    if (!id) continue;

    const rawTitle = (querySelectorAll(item.html, "span.title")[0]?.text || "").trim();
    if (!rawTitle) continue;
    const { title, language } = splitLanguageSuffix(rawTitle);
    const author = (querySelectorAll(item.html, "span.subtitle")[0]?.text || "").trim();

    results.push({
      id,
      title,
      authors: author ? [author] : [],
      year: null,
      language,
      format: "epub",
      sizeBytes: null,
      coverURL: `${PG_BASE}/cache/epub/${id}/pg${id}.cover.medium.jpg`,
      detailURL: `${PG_BASE}/ebooks/${id}`,
      metadata: [
        { key: "Catalogue ID", value: `PG #${id}` },
        { key: "License", value: "Public domain" },
      ],
    });
  }
  console.log(`returning ${results.length} results`);
  return results;
}

async function download(result) {
  // PG's direct EPUB URL is a pure function of the id. `.epub3.images` is
  // the modern EPUB3 build.
  return `${PG_BASE}/ebooks/${result.id}.epub3.images`;
}

// "Os Maias (Portuguese)" -> { title: "Os Maias", language: "pt" }.
// Also tidies PG's "Title :  Subtitle" spacing.
function splitLanguageSuffix(rawTitle) {
  const tidy = (s) => s.replace(/\s+:\s+/g, ": ").trim();
  const match = rawTitle.match(/^(.*)\s+\(([A-Z][a-z]+)\)$/);
  if (match && LANGUAGE_CODES[match[2]]) {
    return { title: tidy(match[1]), language: LANGUAGE_CODES[match[2]] };
  }
  return { title: tidy(rawTitle), language: match ? "" : "en" };
}
