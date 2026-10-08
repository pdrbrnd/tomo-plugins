// Projecto Adamastor plugin for Tomo.
//
// Portuguese-language classics in the public domain, revised by volunteers
// to the 1945 orthographic agreement (pre-AO90 European spelling) — so
// every result is pt-PT, Brazilian authors included. Catalogue is small
// (~85 books) and each one ships as EPUB plus a MOBI twin.
//
// The site is WordPress. Two public REST endpoints do all the work:
// `wpdmpro` (the WP Download Manager entries: title + download id) and
// `posts` (the book's announcement page, which carries the cover image).
// WP search matches against the "Title — Author" string, so author
// queries ("Eça de Queirós", "Camilo") work without special handling.

const manifest = {
  id: "projecto-adamastor",
  name: "Projecto Adamastor",
  description:
    "Portuguese public-domain classics, revised to the 1945 orthography (pt-PT).",
  homepage: "https://projectoadamastor.org",
  author: "Tomo",
  license: "MIT",
  minAppVersion: "1.7.0",
};

const BASE = "https://projectoadamastor.org";
const API = `${BASE}/wp-json/wp/v2`;

// WP category on `posts` that holds the book pages (as opposed to the blog).
const EBOOKS_CATEGORY = 219;

// `wpdmcategory` ids on downloads. Unknown ids just get no "Genre" row.
const GENRES = {
  77: "Poesia",
  78: "Romance",
  79: "Conto/Novela",
  80: "Não-Ficção",
  84: "Teatro",
};

async function search(query) {
  // Only EPUB is surfaced (the MOBI twins are dropped below).
  if (query.format && query.format.toLowerCase() !== "epub") return [];

  const text = [query.text, query.title, query.author]
    .filter((s) => s && s.trim().length > 0)
    .join(" ")
    .trim();
  if (!text) return [];

  const q = encodeURIComponent(text);
  const downloadsURL = `${API}/wpdmpro?search=${q}&per_page=50&_fields=id,title,link,wpdmcategory`;
  const postsURL = `${API}/posts?search=${q}&categories=${EBOOKS_CATEGORY}&per_page=50&_fields=link,content`;
  console.log(`fetching ${downloadsURL}`);
  const [downloadsResponse, postsResponse] = await Promise.all([
    fetch(downloadsURL),
    fetch(postsURL),
  ]);
  if (!downloadsResponse.ok) {
    console.error(`search failed: HTTP ${downloadsResponse.status}`);
    return [];
  }

  const downloads = JSON.parse(downloadsResponse.body);
  // Covers are best-effort: if the posts call fails, results still come
  // back and Tomo's cover enricher fills the gaps.
  const pages = postsResponse.ok ? pagesByDownloadSlug(JSON.parse(postsResponse.body)) : {};

  const results = [];
  for (const download of downloads) {
    const rawTitle = decodeEntities(download.title?.rendered || "").trim();
    if (!rawTitle || rawTitle.endsWith("[MOBI]")) continue;

    const slug = (download.link || "").match(/\/download\/([^/]+)\/?$/)?.[1];
    if (!slug) continue;

    const { title, authors } = splitTitleAndAuthor(rawTitle);
    const page = pages[slug];
    const genre = (download.wpdmcategory || [])
      .map((id) => GENRES[id])
      .filter(Boolean)
      .join(", ");

    const metadata = [];
    if (genre) metadata.push({ key: "Genre", value: genre });
    metadata.push({ key: "License", value: "Public domain" });

    results.push({
      id: String(download.id),
      title,
      authors,
      // Neither endpoint carries the original publication year.
      year: null,
      language: "pt-PT",
      format: "epub",
      sizeBytes: null,
      coverURL: page?.coverURL || null,
      detailURL: page?.link || download.link,
      metadata,
    });
  }

  console.log(`returning ${results.length} results`);
  return results;
}

async function download(result) {
  // WP Download Manager serves the file straight from `?wpdmdl=<id>` —
  // 200 application/epub+zip, no interstitial, no cookie or UA check.
  return `${BASE}/?wpdmdl=${result.id}`;
}

// Maps each download slug to the book page that links to it, with that
// page's cover. The page's own slug doesn't always match the download's
// (e.g. "antologia-dentro-da-noute-…" vs "dentro-da-noute-…"), but every
// book page links its EPUB and MOBI downloads, so join on those links.
// The first image in the page content is the cover; `featured_media` is
// a wide header banner, not the cover.
function pagesByDownloadSlug(posts) {
  const pages = {};
  for (const post of posts) {
    const html = post.content?.rendered || "";
    const coverURL = querySelectorAll(html, "img")[0]?.attrs?.src || null;
    const links = querySelectorAll(html, "a[href*='/download/']");
    for (const a of links) {
      const slug = (a.attrs?.href || "").match(/\/download\/([^/?#]+)/)?.[1];
      if (slug && !pages[slug]) pages[slug] = { link: post.link, coverURL };
    }
  }
  return pages;
}

// WP's `title.rendered` is HTML-escaped ("O Mandarim &#8211; Eça de
// Queirós", "Loucura&#8230;"). Letting the host's HTML parser read it back
// as text decodes every entity, named or numeric.
function decodeEntities(html) {
  return querySelectorAll(`<p>${html}</p>`, "p")[0]?.text || html;
}

// "A Relíquia — Eça de Queirós" -> { title: "A Relíquia", authors: ["Eça de Queirós"] }.
// Newer entries use an em dash, older ones an en dash. Anthologies have no
// author part. Co-authors ("Eça de Queirós e Ramalho Ortigão") stay one
// string: splitting on " e " would also split names like "Virgínia de
// Castro e Almeida".
function splitTitleAndAuthor(rawTitle) {
  const match = rawTitle.match(/^(.+)\s[—–]\s(.+)$/);
  if (!match) return { title: rawTitle, authors: [] };
  return { title: match[1].trim(), authors: [match[2].trim()] };
}
