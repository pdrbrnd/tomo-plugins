#!/usr/bin/env node
// Generates registry.json from the .js files in plugins/.
//
// For each plugin:
//  - reads the file
//  - eval()s the `const manifest = { ... }` block to lift its fields
//  - computes sha256 of the file bytes
//  - reads the file's last git commit timestamp as the entry's `version`
//    (CalVer — plugin authors don't hand-set versions; the build script
//    derives them from git so a forgotten bump is impossible)
//  - emits one entry pointing at the raw.githubusercontent URL on main
//
// Run with:  node scripts/build-registry.mjs
// Outputs:   registry.json at repo root
//
// Eval is safe here because every file under plugins/ is reviewed at PR
// time before landing on main.

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const REPO = "pdrbrnd/tomo-plugins";
const BRANCH = "main";
const PLUGINS_DIR = "plugins";
const OUTPUT = "registry.json";

const REGISTRY_NAME = "Tomo Official Plugins";

// Plugins seeded on first launch when the user is online. Tomo's bundled
// `gutenberg.js` covers the offline case; everyone else gets the live copy.
// This is a registry-curator decision (kept out of the per-plugin manifest
// because plugins shouldn't be able to claim it themselves).
const FIRST_LAUNCH_INSTALL = new Set(["gutenberg"]);

function extractManifest(source) {
  // Strip comments before scanning so example manifests inside doc comments
  // don't get matched ahead of the real declaration. Crude but adequate for
  // hand-written plugin files.
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const match = stripped.match(/const\s+manifest\s*=\s*(\{[\s\S]*?\});/m);
  if (!match) throw new Error("no manifest block found");
  return eval(`(${match[1]})`);
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

/// Reads the latest commit timestamp that touched `path` (ISO-8601 UTC).
/// Falls back to "now" if git can't answer — happens locally for
/// uncommitted plugin files (build still works, version is current time).
function gitCommitTimestamp(path) {
  try {
    const out = execFileSync(
      "git",
      ["log", "-1", "--format=%cI", "--", path],
      { encoding: "utf8" },
    ).trim();
    if (!out) throw new Error("no commit found");
    // %cI is "2026-05-23T16:38:00+01:00" — normalize to UTC Z form so
    // entries are byte-identical across timezones / contributors.
    return new Date(out).toISOString().replace(/\.\d{3}Z$/, "Z");
  } catch {
    console.warn(
      `  warn: no git history for ${path}, using current time as version`,
    );
    return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  }
}

function buildEntry(filename) {
  const path = join(PLUGINS_DIR, filename);
  const source = readFileSync(path, "utf8");
  const manifest = extractManifest(source);
  const sha = sha256(source);
  const version = gitCommitTimestamp(path);
  const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${PLUGINS_DIR}/${filename}`;

  // Plugin manifests no longer declare `version` — the build script owns
  // it (derived from git). Catch the legacy field so we notice if someone
  // re-adds it by accident.
  if ("version" in manifest) {
    throw new Error(
      `${filename}: manifest must not declare a 'version' field — the build script sets it from git mtime`,
    );
  }

  return {
    id: manifest.id,
    name: manifest.name ?? manifest.id,
    version,
    description: manifest.description ?? null,
    homepage: manifest.homepage ?? null,
    author: manifest.author ?? null,
    license: manifest.license ?? null,
    minAppVersion: manifest.minAppVersion ?? null,
    url,
    sha256: sha,
    // Field is omitted (not `false`) when not promoted so the Swift
    // decoder's optional field stays nil — keeps the JSON tight.
    ...(FIRST_LAUNCH_INSTALL.has(manifest.id) ? { firstLaunchInstall: true } : {}),
  };
}

function main() {
  if (!existsSync(PLUGINS_DIR)) {
    console.error(`error: ${PLUGINS_DIR}/ not found — run from repo root`);
    process.exit(1);
  }

  const files = readdirSync(PLUGINS_DIR)
    .filter((f) => f.endsWith(".js"))
    .sort();

  const plugins = files.map(buildEntry);

  const registry = {
    version: 1,
    name: REGISTRY_NAME,
    plugins,
  };

  // Trailing newline so editor configs that normalize on save don't
  // re-dirty the file on next regeneration.
  writeFileSync(OUTPUT, JSON.stringify(registry, null, 2) + "\n", "utf8");

  console.log(
    `wrote ${OUTPUT} (${plugins.length} plugin${plugins.length === 1 ? "" : "s"})`,
  );
  for (const p of plugins) {
    const ageHint = p.minAppVersion ? ` (≥ Tomo ${p.minAppVersion})` : "";
    console.log(`  ${p.id}  ${p.version}  ${p.sha256.slice(0, 12)}…${ageHint}`);
  }
}

main();
