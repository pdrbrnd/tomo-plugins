// Wikisource plugin for Tomo. Served from `pdrbrnd/tomo-plugins`.
//
// Searches one Wikisource per language through the MediaWiki API (one
// request per wiki) and downloads EPUBs from ws-export, Wikisource's own
// export tool.
//
// The wiki is picked from `query.language` (the sidebar's language, or a
// typed `lang:fr`). With no language we search English and Portuguese:
// fanning out to every wiki on each keystroke pause would be six requests
// per search.

const manifest = {
  id: "wikisource",
  name: "Wikisource",
  description:
    "Search and download public-domain texts from Wikisource in English, Portuguese, French, German, Italian and Spanish.",
  homepage: "https://wikisource.org",
  author: "Tomo",
  license: "MIT",
  minAppVersion: "1.7.0",
};

const EXPORT_BASE = "https://ws-export.wmcloud.org";

// Wikimedia asks API clients for a descriptive User-Agent. `fetch` headers
// override the host's default Safari one.
const API_HEADERS = {
  "User-Agent": "Tomo (https://tomolibrary.com; feedback@tomolibrary.com)",
};

const DEFAULT_LANGUAGES = ["en", "pt"];

// Per-wiki conventions. All optional:
// - `authorNamespace`: the work's header links its authors there, so those
//   links are the authors. German Wikisource keeps authors in the main
//   namespace, indistinguishable from any other link, so it gets none.
// - `year`: the category that carries the publication year. Each wiki
//   names it differently; wikis without one give `year: null`.
// - `skipCategories`: pages that aren't a text. Most wikis flag version
//   lists as disambiguation pages (dropped below); some use a category
//   instead, and exporting one gives a near-empty EPUB.
// - `requireCategory`: German Wikisource mixes texts with author, topic
//   and encyclopedia-entry pages in the main namespace; only texts carry
//   "Werke".
const WIKIS = {
  en: {
    authorNamespace: 102,
    year: /^(\d{4}) works$/,
    skipCategories: ["Versions pages"],
  },
  pt: {
    authorNamespace: 102,
    year: /^Obras publicadas em (\d{4})$/,
    skipCategories: ["!Listas de versões"],
  },
  fr: { authorNamespace: 102, year: /^\D+ parue?s en (\d{4})$/ },
  de: { requireCategory: "Werke" },
  it: { authorNamespace: 102, year: /^Testi del (\d{4})$/ },
  es: {
    authorNamespace: 106,
    year: /^P(\d{4})$/,
    skipCategories: ["Versiones"],
  },
};

async function search(query) {
  // ws-export is asked for EPUB; if the user asked for another format, skip.
  if (query.format && query.format.toLowerCase() !== "epub") return [];

  const text = [query.text, query.title, query.author]
    .filter((s) => s && s.trim().length > 0)
    .join(" ")
    .trim();
  if (!text) return [];

  // "pt-PT" -> "pt". A language without a wiki here has no results.
  let languages = DEFAULT_LANGUAGES;
  if (query.language) {
    const base = query.language.split("-")[0].toLowerCase();
    if (!WIKIS[base]) return [];
    languages = [base];
  }

  const lists = await Promise.all(
    languages.map((lang) => searchWiki(lang, text)),
  );
  const results = interleave(lists);
  console.log(`returning ${results.length} results`);
  return results;
}

async function searchWiki(lang, text) {
  const wiki = WIKIS[lang];
  const params = {
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    gsrsearch: text,
    gsrnamespace: "0",
    // Chapter subpages match too and are dropped below, so ask for more
    // than we show to leave room for the works themselves.
    gsrlimit: "50",
    prop: "pageprops|categories",
    ppprop: "disambiguation",
    cllimit: "max",
    clshow: "!hidden",
  };
  if (wiki.authorNamespace) {
    params.prop += "|links";
    params.plnamespace = String(wiki.authorNamespace);
    params.pllimit = "max";
  }
  const queryString = Object.keys(params)
    .map((k) => `${k}=${encodeURIComponent(params[k])}`)
    .join("&");
  const url = `https://${lang}.wikisource.org/w/api.php?${queryString}`;
  console.log(`fetching ${url}`);
  // `method` and `body` must be spelled out whenever `opts` is passed: Tomo
  // up to 1.17.0 reads a missing one as the string "undefined", so the API
  // answers 405, or URLSession refuses a GET with a body (-1103).
  let r;
  try {
    r = await fetch(url, { method: "GET", headers: API_HEADERS, body: "" });
  } catch (e) {
    // One unreachable wiki shouldn't sink the other's results.
    console.error(`${lang} search failed: ${e.message}`);
    return [];
  }
  if (!r.ok) {
    console.error(`${lang} search failed: HTTP ${r.status}`);
    return [];
  }

  // No hits means no `query` key at all.
  const pages = JSON.parse(r.body).query?.pages || [];
  // Pages come back in arbitrary order; `index` is the search rank.
  pages.sort((a, b) => a.index - b.index);

  const results = [];
  for (const page of pages) {
    // "Os Maias/Livro I/I" is a chapter; only whole works are exported.
    if (page.title.includes("/")) continue;
    if (page.pageprops?.disambiguation !== undefined) continue;

    const categories = (page.categories || []).map((c) => stripNamespace(c.title));
    const skip = wiki.skipCategories || [];
    if (categories.some((c) => skip.includes(c))) continue;
    if (wiki.requireCategory && !categories.includes(wiki.requireCategory)) continue;

    // Any link into the author namespace. Usually just the header's
    // author(s); translators and illustrators get linked there too.
    const authors = (page.links || []).map((l) => stripNamespace(l.title));

    const path = encodeURIComponent(page.title.replace(/ /g, "_"));
    results.push({
      id: `${lang}:${page.title}`,
      title: page.title,
      authors,
      year: findYear(categories, wiki.year),
      // Each wiki holds texts in its own language. Never a region variant:
      // pt.wikisource mixes Portuguese and Brazilian texts.
      language: lang,
      format: "epub",
      sizeBytes: null,
      coverURL: null,
      detailURL: `https://${lang}.wikisource.org/wiki/${path}`,
      metadata: [
        { key: "Source", value: `${lang}.wikisource.org` },
        { key: "License", value: "Public domain" },
      ],
    });
  }
  return results;
}

async function download(result) {
  // id is "<lang>:<page title>"; titles can contain ":" themselves.
  const lang = result.id.slice(0, result.id.indexOf(":"));
  const title = result.id.slice(lang.length + 1);
  const page = encodeURIComponent(title.replace(/ /g, "_"));
  // ws-export builds the EPUB on request before sending a byte: about 2s
  // for a novel, 8s for the five volumes of Les Misérables. Tomo's
  // download gives up after 60s of silence, so a huge work could time out.
  //
  // ws-export only follows the work's own table of contents one level
  // down. A work whose chapters sit two levels deep (en "Les Misérables":
  // work -> book -> chapter) comes out as the book-level contents pages.
  //
  // ws-export sits behind Anubis, which serves a proof-of-work page to
  // anything whose User-Agent looks like a browser. Tomo downloads this URL
  // with URLSession's default "Tomo/… CFNetwork/…" UA, which gets the EPUB.
  // If the host ever sends a browser UA here, downloads turn into HTML.
  return `${EXPORT_BASE}/?lang=${lang}&page=${page}&format=epub-3`;
}

// "Author:Mary Shelley" -> "Mary Shelley".
function stripNamespace(title) {
  return title.slice(title.indexOf(":") + 1);
}

function findYear(categories, pattern) {
  if (!pattern) return null;
  for (const category of categories) {
    const match = category.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

// [[a1, a2], [b1]] -> [a1, b1, a2]: each wiki's best hits stay on top
// instead of one wiki's tail burying the other's first result.
function interleave(lists) {
  const merged = [];
  const longest = Math.max(...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      if (i < list.length) merged.push(list[i]);
    }
  }
  return merged;
}
