// Standard Ebooks plugin for Tomo.
//
// Curated, carefully-edited public-domain ebooks. Same legal posture as
// Gutenberg but with modern EPUB3, semantic markup, and proper typography.
// Catalog is small (~1000 books) — every entry is high quality.
//
// Plain HTTP, no anti-scraping, no Cloudflare. Direct EPUB URLs are
// derivable from the detail-page slug so download() never hits the
// network — we just compose the URL.

const manifest = {
  id: "standard-ebooks",
  name: "Standard Ebooks",
  description:
    "Curated public-domain ebooks with modern EPUB3 and careful editorial polish.",
  homepage: "https://standardebooks.org",
  author: "pdrbrnd",
  license: "MIT",
  minAppVersion: "1.7.0",
};

const BASE = "https://standardebooks.org";

async function search(query) {
  // SE only serves EPUB — if the user asked for anything else, bail.
  if (query.format && query.format.toLowerCase() !== "epub") return [];

  // SE has no ISBN index, no publisher filter, no year filter. Their
  // catalog is small enough that free-text against title/author covers
  // everything; structured queries that exclude text would return junk,
  // so we bail when there's no text component.
  const text = [query.text, query.title, query.author]
    .filter((s) => s && s.trim().length > 0)
    .join(" ")
    .trim();
  if (!text) return [];

  const url = `${BASE}/ebooks?query=${encodeURIComponent(text)}`;
  console.log(`fetching ${url}`);
  const r = await fetch(url);
  if (!r.ok) {
    console.error(`search failed: HTTP ${r.status}`);
    return [];
  }

  const items = querySelectorAll(r.body, "ol.ebooks-list li");
  console.log(`found ${items.length} raw items`);

  const results = [];
  for (const item of items) {
    // Title link carries the slug pair `/ebooks/<author>/<title>` plus
    // the title text inside a schema:name span.
    const titleAnchors = querySelectorAll(item.html, "a[property='schema:url']");
    if (titleAnchors.length === 0) continue;
    const detailPath = (titleAnchors[0].attrs?.href || "").trim();
    const slugMatch = detailPath.match(/^\/ebooks\/([^/]+)\/([^/]+)\/?$/);
    if (!slugMatch) continue;
    const slug = `${slugMatch[1]}/${slugMatch[2]}`;

    const titleSpans = querySelectorAll(
      titleAnchors[0].html,
      "span[property='schema:name']",
    );
    const title = (titleSpans[0]?.text || titleAnchors[0].text || "").trim();
    if (!title) continue;

    // Author lives in a separate <p class="author"> sibling. Each link is
    // one author; SE lists multiple for co-authored / translated works.
    const authorSpans = querySelectorAll(
      item.html,
      "p.author span[property='schema:name']",
    );
    const authors = authorSpans
      .map((s) => (s.text || "").trim())
      .filter(Boolean);

    results.push({
      id: slug,
      title,
      authors,
      year: null,
      // SE is overwhelmingly English. Specific edition language (en-GB vs
      // en-US) lives on the detail page but isn't worth an N+1 fetch.
      // Leaving this empty lets Tomo's classifier handle locale on import.
      language: "",
      format: "epub",
      sizeBytes: null,
      coverURL: `${BASE}/ebooks/${slug}/downloads/cover.jpg`,
      detailURL: `${BASE}${detailPath}`,
      metadata: [{ key: "License", value: "Public domain" }],
    });
  }

  console.log(`returning ${results.length} results`);
  return results;
}

async function download(result) {
  // SE's direct EPUB URL is a pure function of the slug pair — no detail
  // page round-trip needed.
  //   /ebooks/<author>/<title>/downloads/<author>_<title>.epub
  const [author, title] = result.id.split("/");
  return `${BASE}/ebooks/${author}/${title}/downloads/${author}_${title}.epub`;
}
