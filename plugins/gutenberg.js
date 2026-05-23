// Project Gutenberg plugin for Tomo. Served from `pdrbrnd/tomo-plugins`.
//
// Talks to gutendex.com — the de-facto JSON API for Project Gutenberg
// metadata. Earlier versions of this plugin scraped PG's HTML search
// page, but `/ebooks/search/?query=` is now aggressively rate-limited
// (504s under sustained traffic) and PG themselves point developers at
// gutendex to take pressure off the HTML pages. JSON is also a lot less
// fragile than CSS selectors against a 25-year-old Plone site.

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
const API_BASE = "https://gutendex.com";

async function search(query) {
  // Project Gutenberg only serves EPUB as a first-class library import
  // for Tomo (kindle/HTML/plain text aren't surfaced). If the user
  // explicitly asked for a different format, skip the round-trip.
  if (query.format && query.format.toLowerCase() !== "epub") return [];

  // gutendex's `search=` param is free-text across title + author. ISBN
  // and publisher aren't indexed; without text we'd just paginate the
  // whole catalogue, so bail.
  const text = [query.text, query.title, query.author]
    .filter((s) => s && s.trim().length > 0)
    .join(" ")
    .trim();
  if (!text) return [];

  const url = `${API_BASE}/books?search=${encodeURIComponent(text)}`;
  console.log(`fetching ${url}`);
  const r = await fetch(url);
  console.log(`status ${r.status}, ${r.body.length} bytes`);
  if (!r.ok) {
    console.error(`gutendex returned HTTP ${r.status}`);
    return [];
  }

  let payload;
  try {
    payload = JSON.parse(r.body);
  } catch (e) {
    console.error(`gutendex JSON parse failed: ${e.message}`);
    return [];
  }

  const books = Array.isArray(payload?.results) ? payload.results : [];
  console.log(`found ${books.length} raw results`);

  const results = [];
  for (const book of books) {
    if (typeof book.id !== "number" || !book.title) continue;
    // Skip books without an EPUB — PG carries some plain-text-only items.
    const epubURL = book.formats?.["application/epub+zip"];
    if (!epubURL) continue;

    const id = String(book.id);
    const authors = (book.authors || [])
      .map((a) => flipLibraryName(a?.name))
      .filter(Boolean);
    const language = (book.languages || [])[0] || "";
    // Most PG entries carry a JPEG cover at a predictable path; gutendex
    // surfaces the URL directly under image/jpeg.
    const coverURL =
      book.formats?.["image/jpeg"] ||
      `${PG_BASE}/cache/epub/${id}/pg${id}.cover.medium.jpg`;

    results.push({
      id,
      title: book.title,
      authors,
      year: null,
      language,
      format: "epub",
      sizeBytes: null,
      coverURL,
      detailURL: `${PG_BASE}/ebooks/${id}`,
      metadata: [
        { key: "Catalogue ID", value: `PG #${id}` },
        { key: "License", value: "Public domain" },
      ],
    });
  }
  console.log(`returning ${results.length} parsed results`);
  return results;
}

async function download(result) {
  // PG's direct EPUB URL is a pure function of the id — no detail-page
  // round-trip needed. `.epub3.images` is the modern EPUB3 build (the
  // `.images` suffix isn't optional; the no-images variant is older).
  const url = `${PG_BASE}/ebooks/${result.id}.epub3.images`;
  console.log(`download URL: ${url}`);
  return url;
}

// gutendex returns authors in library catalogue order ("Shelley, Mary
// Wollstonecraft"). Flip to natural reading order for display, matching
// what the old HTML-scraping path produced.
function flipLibraryName(name) {
  if (typeof name !== "string") return "";
  const trimmed = name.trim();
  if (!trimmed) return "";
  const comma = trimmed.indexOf(",");
  if (comma < 0) return trimmed;
  const last = trimmed.slice(0, comma).trim();
  const rest = trimmed.slice(comma + 1).trim();
  return rest ? `${rest} ${last}` : last;
}
