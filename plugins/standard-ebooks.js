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

  // `.not-pd` marks books SE lists for discoverability but doesn't yet host
  // — typically still under U.S. copyright (e.g. Orwell until 2045). The
  // detail page is a placeholder; the `/downloads/*.epub` and cover URLs
  // 404, which surfaces as a -1011 download failure with no cover. Filter
  // these out so they never become search results.
  const items = querySelectorAll(r.body, "ol.ebooks-list li:not(.not-pd)");
  console.log(`found ${items.length} raw items`);

  const results = [];
  for (const item of items) {
    // Canonical detail path lives on the <li>'s `about` attribute. Using
    // it avoids picking between the three `schema:url` anchors inside (one
    // wraps the cover, one the title, one the author).
    //
    // SE slugs are 2 or 3 segments: `/ebooks/<author>/<title>` for native
    // works, `/ebooks/<author>/<title>/<translator>` for translations. The
    // earlier 2-segment-only regex silently dropped every translated work
    // — Tolstoy, Dostoevsky, Dumas, etc. — and the user saw an empty
    // result set with no error.
    const detailPath = (item.attrs?.about || "").trim();
    const slugMatch = detailPath.match(/^\/ebooks\/((?:[^/]+\/){1,2}[^/]+)\/?$/);
    if (!slugMatch) continue;
    const slug = slugMatch[1];

    const titleSpan = querySelectorAll(
      item.html,
      "span[property='schema:name']",
    )[0];
    const title = (titleSpan?.text || "").trim();
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
  // SE's direct EPUB URL is a pure function of the slug — no detail-page
  // round-trip needed. Two quirks:
  //
  // 1. Without `?source=download` the server returns an XHTML interstitial
  //    ("Your Download Has Started!") with a `<meta http-equiv="refresh">`
  //    pointing at the same URL plus the query param. URLSession doesn't
  //    follow HTML meta-refreshes, so the .epub file ends up containing
  //    HTML and the import fails (NSURLErrorDomain -1011 / bad server
  //    response, since the response type doesn't match the request).
  //
  // 2. The EPUB filename joins path segments with `_`, but any `_` *inside*
  //    a segment (used to join co-authors or multi-translators) becomes
  //    `-`. So `joseph-conrad_ford-madox-ford/the-nature-of-a-crime`
  //    resolves to `joseph-conrad-ford-madox-ford_the-nature-of-a-crime`.
  const segments = result.id.split("/");
  const filename = segments.map((s) => s.replace(/_/g, "-")).join("_");
  return `${BASE}/ebooks/${result.id}/downloads/${filename}.epub?source=download`;
}
