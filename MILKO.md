# Foxx service — `metadata-store-service`

The HTTP API gateway between the metadata-store UI and the ArangoDB database.
The UI never talks to the database directly; everything goes through the routes
defined here, which call the AQL bodies in `lib/queries.js`.

Mount point: `/dict` in database `metadata`.

Origin: `skofic/metadata-store-service`.

## Layout

```
APP/
├── manifest.json           — service metadata; declares setup/teardown scripts
├── main.js                 — mounts route modules under the service root
├── lib/
│   ├── indexes.js          — collections, custom analyzers, inverted index defs
│   └── queries.js          — AQL query bodies (single source of truth)
├── routes/
│   ├── term.js             — /term/:gid (with alias resolution), /term/bulk
│   ├── enum.js             — /enum/:gid
│   ├── fields.js           — /fields/:gid
│   └── blob.js             — /blob/:key
├── scripts/
│   ├── setup.js            — runs on install + upgrade (idempotent)
│   └── teardown.js         — runs on uninstall (destructive)
└── test/                   — Foxx test files (extend over time)
```

## Where queries live

All AQL is in `lib/queries.js`. Routes are thin: they validate path/body params
and call a query function. Adding a query means: add a function to `queries.js`
that returns whatever the route needs, then expose it through a route.

This makes the API surface portable — if we ever migrate off ArangoDB, the
queries are the only thing to rewrite; the routes and the UI stay put.

## Where indexes live

`lib/indexes.js` exports three arrays — pure data, no execution:

- `collections` — `terms`, `edges`, `links`, `blobs` (bare names; shared with
  the loader and other tooling, no service-mount prefix).
- `analyzers` — custom analyzers only. Built-ins (`identity`, `text_en`,
  `norm_en`) are not listed.
- `indexes` — every inverted index, paired with its target collection.

`scripts/setup.js` reads this module and applies the definitions idempotently.
`scripts/teardown.js` reads `collections` and `analyzers` and removes them.

## Lifecycle

### Install / upgrade

1. Edit code under `APP/` (or pull from `skofic/metadata-store-service`).
2. In the ArangoDB web UI: **Services → dict → Settings → Upgrade**.
   This re-runs `scripts/setup.js` against the current database.
3. `setup.js` is idempotent: collections, analyzers, and indexes that already
   exist by name are left untouched. Anything new in `lib/indexes.js` is
   created.

### Uninstall

In the web UI: **Services → dict → Settings → Uninstall**.
This runs `scripts/teardown.js`, which drops the four collections (along with
their indexes) and removes the custom analyzers. **All term, edge, link, and
blob data is destroyed.** Re-run the loader after re-installing to repopulate.

## How "idempotent" actually works

Existence checks are by name only — definitions are never compared:

| Resource | Check | Action if present | Action if missing |
|----------|-------|-------------------|-------------------|
| Collection | `db._collection(name)` | skip | create (document or edge per `type`) |
| Analyzer | `analyzers.analyzer(name)` | skip | `analyzers.save(...)` |
| Index | `coll.indexes().find(i => i.name === ...)` | skip | `coll.ensureIndex(def)` |

This is an intentional design choice. Comparing definitions and patching them
silently leads to surprise behaviour (an upgrade quietly rebuilds a 14k-row
index). Match-by-name forces an explicit drop when something needs to change:

```javascript
// arangosh
db._collection('terms').dropIndex('idx_code');
// then upgrade the service — setup.js will recreate idx_code from the new def
```

The same pattern applies to analyzers (`analyzers.remove(name, true)`) and
collections (`db._drop(name)`).

## Inverted index design

Three indexes on `terms`:

- `idx_code` — `_code.*` exact-match identifiers, plus `_gid` doubled with the
  `delim_underscore` analyzer for segment search. Cached. `primarySort` on
  `_code._gid`. `storedValues` cover the standard list view (gid, namespace,
  English title, term roles).
- `idx_info_eng` — multilingual `_info` content, English locale. `text_en`
  tokenisation across description bodies, plus `norm_en` on titles for
  case/accent-insensitive sort and exact match. **Not cached** — the Markdown
  body expansion will dominate index size and isn't RAM-friendly.
- `idx_domn` — open categorical section. `includeAllFields: true` with
  `identity` so new sub-properties pick up automatically. Cached.

Per-language clones of `idx_info_eng` (`idx_info_ita`, `idx_info_fra`, …) get
added in `lib/indexes.js` as translations land.

## Tooling notes

- Collection names are bare (`terms`, not `dict_terms`). The original
  `context.collectionName(...)` prefixing from the Foxx scaffold is intentionally
  not used — the loader and other workflow tools assume bare names.
- Inverted index `cache: true` is supported in recent ArangoDB versions; verify
  the deployed version supports it before pushing changes that depend on it.
- The `delim_underscore` analyzer is only meaningful for `_code._gid`-style
  underscore-segmented identifiers. Don't apply it to natural-language fields.
