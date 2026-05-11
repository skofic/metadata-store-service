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
│   ├── term.js             — GET /term/:gid (heuristic alias-resolving), POST /term/bulk
│   ├── enum.js             — GET /enum/:root (hierarchical BFS), POST /enum/check
│   ├── fields.js           — GET /fields/:gid (object descriptor property order)
│   ├── resolve.js          — POST /resolve/node (graph-aware alias resolution)
│   └── blob.js             — GET /blob/:key
├── scripts/
│   ├── setup.js            — runs on install + upgrade (idempotent)
│   └── teardown.js         — runs on uninstall (destructive)
└── test/                   — one Mocha file per route
    ├── term.js             — heuristic alias resolution, 404, bulk
    ├── enum.js             — flat / sectioned / branch / bridge traversal + /check
    ├── fields.js           — required+recommended ordering, 400, 404
    ├── resolve.js          — graph-aware alias resolution, null for not-in-graph
    └── blob.js             — known blob, 404
```

## Where queries live

All AQL is in `lib/queries.js`. Routes are thin: they validate path/body params
and call a query function. Adding a query means: add a function to `queries.js`
that returns whatever the route needs, then expose it through a route.

This makes the API surface portable — if we ever migrate off ArangoDB, the
queries are the only thing to rewrite; the routes and the UI stay put.

## Route catalogue

| Method | Path | Purpose |
|--------|------|---------|
| GET    | `/term/:gid`                                | Fetch a term; heuristic alias resolution via missing `_info`/`_data` |
| POST   | `/term/bulk`                                | Fetch many terms in one request |
| GET    | `/enum/:root?branch=&levels=&direction=&shape=` | BFS-traverse an enumeration hierarchy; bridge-of is transparent; `shape=compact` returns gids only |
| POST   | `/enum/check`                               | Bulk membership check for the validation framework |
| POST   | `/resolve/node`                             | Graph-aware alias resolution — canonical term for a target in a graph |
| GET    | `/fields/:gid`                              | Property order of an object descriptor |
| GET    | `/blob/:key`                                | Fetch a blob document |

### Edge-direction parameter

Every edge-aware endpoint takes a `direction` parameter — `"inbound"` (default,
many-to-one) or `"outbound"` (one-to-many). Inbound is correct for every graph
currently in the dictionary; the parameter is in place for future graphs whose
roots sit at the `_from` side. It flips two things consistently in the
underlying query: the AQL `INBOUND`/`OUTBOUND` keyword, and which end of an
edge (`_from` vs `_to`) is treated as the "node" vs the "root/parent".

### `/enum/:root` (hierarchical traversal)

There is intentionally no "list every element of an enumeration" endpoint —
returning all ~7k ISO 639-3 elements is not a real use case. Users always
navigate enumerations through their hierarchy. The traversal:

- INBOUND BFS from `branch` (defaults to `root`), bounded by `levels` (default 1).
- Edges considered: `_predicate_enum-of` (options), `_predicate_section-of`
  (display-only groups), `_predicate_bridge-of` (transparent passthrough).
- Edge `_path` must contain the `root` handle.
- Bridge-of edges are not returned and do not consume a level — `maxDepth` is
  `levels + 1` to allow one bridge hop at the root.
- The result preserves the option/section distinction via the `predicate` field.
- `parent` is the closest visible (non-bridge) ancestor handle, so consumers
  can rebuild a tree even when the immediate graph parent is a bridge node.
- `shape=full` (default) embeds the full term document on each row; `shape=compact`
  replaces it with the bare `gid`, ~50× smaller payload. Use compact for large
  leaf sets (e.g. `branch=ISO_639_type_L` is 7k languages) and fetch full term
  details on demand via `/term/:gid` for whatever the user selects.

### `/enum/check` (membership)

`POST { terms: [...], roots: [...] }` → `{ <term>: [<root>, ...] }`. For every
combination of input term and input root, the query finds at least one edge
with `_from == terms/<term>`, `_predicate == _predicate_enum-of`, and
`terms/<root> IN _path`. No alias resolution — callers canonicalise first.

### `/resolve/node` (graph-aware alias resolution)

The principled counterpart to `/term/:gid`'s heuristic alias detection. Given
a `root` and `target`, the algorithm:

1. Looks for an edge in the `root` graph touching `target` at the leaf end
   (`_from` for inbound, `_to` for outbound) whose predicate is the functional
   one (`_predicate_enum-of` by default) or one of the configured traversal
   predicates (`_predicate_section-of`, `_predicate_bridge-of` by default).
2. If the seed edge is functional, the target is already canonical — returns
   the target's document.
3. Otherwise the target is a section or bridge node; traverses from the
   target in the same direction, walking through allowed predicates until a
   functional-predicate edge surfaces the canonical vertex.

Use this before the classical enum-membership validator runs — e.g. a value
arriving as `ISO_639_1_en` resolves to `ISO_639_3_eng`, which is what
`/enum/check` will then test against the `ISO_639_1` root.

`/term/:gid`'s heuristic resolution stays for the common path (single edge
lookup, no graph context). Use `/resolve/node` when graph membership matters
or when the heuristic might misfire on a term that legitimately lacks
`_info`/`_data`.

### `/fields/:gid` (object property order)

Reads `term._data._object._open` or `._closed`, returns `_required` (flattened
in declaration order, including nested `_selection` arrays used by pipeline
selectors) followed by `_recommended`. Deduplicates on `_gid`. Returns 404 if
the term is missing, 400 if it is not an object descriptor, and `[]` if it has
no schema body or empty `_required`/`_recommended`. The historical
`_predicate_field-of` edge-driven implementation has been retired in favour of
reading directly from the term.

## Where indexes live

`lib/indexes.js` exports four arrays — pure data, no execution:

- `collections` — `terms`, `edges`, `links`, `blobs` (bare names; shared with
  the loader and other tooling, no service-mount prefix).
- `analyzers` — custom analyzers only. Built-ins (`identity`, `text_en`,
  `norm_en`) are not listed.
- `indexes` — every inverted index, paired with its target collection.
- `views` — `search-alias` views, one per inverted index. Required because
  ArangoDB 3.12 community does not allow `SEARCH` directly on collections;
  the view is a thin routing layer over the index (no data duplication).
  Filter-style queries via `FILTER doc.f == v OPTIONS { indexHint }` work
  directly on the collection without the view.

`scripts/setup.js` applies all four idempotently. `scripts/teardown.js` drops
views first, then collections (which drops indexes implicitly), then the
custom analyzers.

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
| View | `db._view(name)` | skip | `db._createView(name, type, props)` |

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

Three indexes on `terms`, each fronted by a single-index `search-alias` view
of the same name with a `v_` prefix:

- `idx_code` / `v_idx_code` — `_code.*` exact-match identifiers, plus `_gid`
  with the `delim_underscore` analyzer for segment search. Cached.
  `primarySort` on `_code._gid`. `storedValues` cover the standard list
  view (gid, namespace, English title, term roles).
- `idx_info_eng` / `v_idx_info_eng` — multilingual `_info` content, English
  locale. `text_en` tokenisation across description bodies. **Not cached** —
  the Markdown body expansion will dominate index size and isn't RAM-friendly.
- `idx_domn` / `v_idx_domn` — open categorical section. `includeAllFields:
  true` with `identity` so new sub-properties pick up automatically. Cached.

Per-language clones of `idx_info_eng` (`idx_info_ita`, `idx_info_fra`, …) get
added in `lib/indexes.js` as translations land — each gets its own paired
search-alias view.

### Field-path conventions

- `searchField: true` is set at the index level for SEARCH support. Under
  this mode, **do not use `[*]` array suffixes** — arrays are auto-expanded
  by the index machinery. Writing `_code._aid` (no `[*]`) correctly indexes
  every element of the alias-id array.
- ArangoDB inverted indexes do not allow the same field path with multiple
  analyzers in a single index. `_code._gid` therefore uses `delim_underscore`
  only (segment search subsumes exact-string match because the search
  expression is tokenised the same way). Exact-key lookups go through the
  built-in `_key` primary index since `_key === _code._gid`.

## Running the tests

The Foxx test files live under `APP/test/` and are auto-discovered through the
`"tests": "test/**/*.js"` field in `manifest.json`. They are read-only against
the live database and assume **core + standards + ISO** data is loaded — `_code`,
`_type_scalar`, `_lid`, and the ISO 639 graphs (`ISO_639_3_eng`,
`ISO_639_1_en` alias, `ISO_639_scope_I` section) are used as fixtures.

Run from the ArangoDB web UI: **Services → dict → Tests**.

Or via the HTTP API:

```bash
curl -sS -u zettlab:Zibibbo -X POST -H "Content-Type: application/json" \
  "http://localhost:8529/_db/metadata/_api/foxx/tests?mount=/dict"
```

If a test fails because the expected term/edge isn't in the database, the
fixture data hasn't been fully loaded — re-run the loader for `data/core/`,
`data/standards/`, and `data/ISO/`.

## Tooling notes

- Collection names are bare (`terms`, not `dict_terms`). The original
  `context.collectionName(...)` prefixing from the Foxx scaffold is intentionally
  not used — the loader and other workflow tools assume bare names.
- Inverted index `cache: true` is set on `idx_code` and `idx_domn`. Note
  that the API response from `_api/index?collection=terms` does not echo the
  `cache` field back even when set; check the server logs or arangosh to
  confirm caching is actually applied.
- The `delim_underscore` analyzer is only meaningful for `_code._gid`-style
  underscore-segmented identifiers. Don't apply it to natural-language fields.
