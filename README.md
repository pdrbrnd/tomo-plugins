# Tomo plugins

The official plugin registry for [Tomo](https://github.com/pdrbrnd/tomo).

`registry.json` is fetched by Tomo when the user clicks **Check for updates** in Settings → Plugins. Each entry points at a `.js` file in `plugins/`, pinned by sha256.

## How it works

```
[Tomo client] --GET registry.json--> [this repo]
[Tomo client] --GET plugin.url (.js)--> [this repo]
[Tomo client] verifies sha256(.js) == entry.sha256
[Tomo client] writes <plugins-dir>/<id>.js
```

The default registry URL hardcoded in the app is:

```
https://raw.githubusercontent.com/pdrbrnd/tomo-plugins/main/registry.json
```

Users can add third-party registries by URL in Settings → Plugins → Registries. The shape is the same; this repo doesn't host or vet third-party registries.

## Layout

```
plugins/
  gutenberg.js                  # Project Gutenberg
  standard-ebooks.js            # Standard Ebooks
scripts/
  build-registry.mjs            # regenerates registry.json
.github/workflows/
  build-registry.yml            # runs the script on every push
registry.json                   # the manifest Tomo fetches
```

Each plugin declares a top-level `const manifest = { id, name, … }`. The build script:

- Reads the manifest (`id`, `name`, `description`, `homepage`, `author`, `license`, `minAppVersion`).
- Reads the file's last git commit timestamp and emits it as the entry's `version` (CalVer, ISO-8601). Plugin authors never set this by hand — a forgotten bump is impossible.
- Computes the sha256 of the file bytes.

**Never hand-edit `registry.json`** — push changes to `plugins/` and let CI regenerate it. The build script refuses if a manifest declares a `version` field (it owns that).

## What goes in this registry

Only plugins for legitimately-distributable sources:

- Public domain catalogues (Project Gutenberg, Wikisource, Standard Ebooks).
- Internet Archive public domain.
- OPDS feeds of legitimate libraries / publishers.
- Self-published author catalogues distributed for free.

Anything that searches a shadow library or scrapes copyrighted material does not go here. That posture is what keeps Tomo's official registry legally clean. Users wanting other plugins can add a third-party registry URL.

## Adding a plugin

1. Write the `.js` file following the [plugin contract](https://github.com/pdrbrnd/tomo/blob/main/docs/plugins.md). Declare `const manifest = { … }` with at least `id`. Set `minAppVersion` to the lowest Tomo release with every host capability the plugin uses ([CONTRACT.md](https://github.com/pdrbrnd/tomo/blob/main/docs/CONTRACT.md)).
2. Drop it into `plugins/`. The filename is irrelevant at runtime (Tomo writes it as `<id>.js` on the client) but should match `<id>.js` for tidiness here.
3. Open a PR. CI verifies the build; on merge, `registry.json` regenerates automatically.

## Updating a plugin

Edit the file, commit, push. CI rereads the file's git mtime, recomputes its sha256, and rewrites `registry.json`. Clients pick it up on their next "Check for updates."

No version field to bump anywhere.

## Local development

```sh
node scripts/build-registry.mjs
```

Outputs `registry.json` at repo root. Node 20+.
