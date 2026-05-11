# metadata-store-service

ArangoDB Foxx microservice exposing the metadata dictionary as an HTTP API.
Mounted at `/dict` in the `metadata` database. The UI never talks to the
database directly; everything goes through the routes defined here, which
delegate to AQL bodies in `lib/queries.js`.

---

## Environment

| Item | Value |
|------|-------|
| ArangoDB | `http://localhost:8529` (Docker, port-forwarded to host) |
| Database | `metadata` |
| Mount point | `/dict` |
| Base URL | `http://localhost:8529/_db/metadata/dict` |
| Collections | `terms`, `edges`, `links`, `blobs` |
| Custom analyzer | `delim_underscore` |
| Inverted indexes | `idx_code`, `idx_info_eng`, `idx_domn` (on `terms`) |
| Search-alias views | `v_idx_code`, `v_idx_info_eng`, `v_idx_domn` |

Authentication uses ArangoDB's built-in Basic auth. All curl examples below
use `user:password` as a placeholder — replace with your actual ArangoDB
credentials.

---

## Repository layout

```
APP/
├── manifest.json          — Foxx service metadata; declares setup/teardown scripts
├── main.js                — Root router; mounts sub-routers
├── lib/
│   ├── indexes.js         — Collections, analyzers, inverted indexes, views (pure data)
│   └── queries.js         — AQL query functions shared by all routes
├── routes/
│   ├── term.js            — GET /term/:gid, POST /term/bulk
│   ├── enum.js            — GET /enum/:root, POST /enum/check
│   ├── fields.js          — GET /fields/:gid
│   ├── resolve.js         — POST /resolve/node
│   └── blob.js            — GET /blob/:key
├── scripts/
│   ├── setup.js           — Idempotent install: collections, analyzers, indexes, views
│   └── teardown.js        — Destructive uninstall: drops everything created by setup
└── test/
    ├── term.js            — Heuristic alias resolution, bulk, 404
    ├── enum.js            — Hierarchical traversal + membership check
    ├── fields.js          — Required/recommended ordering, 400/404
    ├── resolve.js         — Graph-aware alias resolution
    └── blob.js            — Known blob, 404
```

In development mode (the current default), edits to any file take effect on
the next request without a manual reload.

---

## Edge-direction parameter

Every edge-aware endpoint takes a `direction` parameter — `"inbound"` (default,
many-to-one) or `"outbound"` (one-to-many). Inbound is correct for every graph
currently in the dictionary; the parameter is in place for future graphs whose
roots sit at the `_from` side. It flips two things consistently in the
underlying query: the AQL `INBOUND`/`OUTBOUND` keyword, and which end of an
edge (`_from` vs `_to`) is treated as the "leaf" vs the "root/parent".

---

## Routes

### `GET /term/:gid`

Fetch a single term by its `_gid`.

Heuristic alias resolution: if the requested term carries only `_code` (no
`_info`, no `_data`), the service treats it as an alias and follows the first
`_predicate_enum-of` edge pointing at it to return the canonical term. This is
fast and right for the common case; when graph membership matters, use
`/resolve/node` instead.

**Path parameter**

| Parameter | Type | Description |
|-----------|------|-------------|
| `gid` | string | The term's `_gid` (e.g. `_code`, `ISO_3166_3_ITA`) |

**Response** — `200 OK`, term document as JSON. `404` if not found.

```bash
curl -u user:password \
  http://localhost:8529/_db/metadata/dict/term/_code
```

---

### `POST /term/bulk`

Fetch multiple terms in one request.

Aliases are resolved transparently via the same heuristic as `GET /term/:gid`.
Terms that cannot be found are silently omitted from the result — the caller
must compare input and output counts if completeness matters.

**Request body**

```json
{ "gids": ["_code", "_info", "_data"] }
```

**Response** — `200 OK`, array of term documents.

```bash
curl -u user:password -X POST \
  -H "Content-Type: application/json" \
  -d '{"gids": ["_code", "_info", "_data"]}' \
  http://localhost:8529/_db/metadata/dict/term/bulk
```

---

### `GET /enum/:root`

Breadth-first hierarchical traversal of an enumeration graph.

There is intentionally no "list every element" endpoint — returning all ~7k
ISO 639-3 elements is not a real use case. Users navigate enumerations
through their hierarchy, one level at a time. The traversal:

- INBOUND BFS from `branch` (defaults to `root`), bounded by `levels`
  (default 1).
- Edges considered: `_predicate_enum-of` (selectable options),
  `_predicate_section-of` (display-only groups), `_predicate_bridge-of`
  (transparent passthrough).
- Each edge's `_path` must contain the `root` handle.
- Bridge-of edges are not returned and do not consume a level — the
  internal max depth is `levels + 1` to allow one bridge hop at the root.
- The result preserves the option/section distinction via the `predicate`
  field.
- `parent` is the closest visible (non-bridge) ancestor handle, so
  consumers can rebuild a tree even when the immediate graph parent is a
  bridge node.

**Path parameter**

| Parameter | Type | Description |
|-----------|------|-------------|
| `root` | string | Enumeration root `_gid` (e.g. `_type_scalar`, `ISO_639_3`) |

**Query parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `branch` | string | `root` | Starting vertex `_gid` |
| `levels` | integer 1–20 | `1` | Depth of BFS traversal |
| `direction` | `inbound` \| `outbound` | `inbound` | Edge direction |
| `shape` | `full` \| `compact` | `full` | Result shape (see below) |

**Response** — `200 OK`, array of rows.

With `shape=full`, each row embeds the term document:

```json
[
  {
    "term":      { "_code": { "_gid": "_number" }, "...": "..." },
    "predicate": "_predicate_enum-of",
    "level":     1,
    "parent":    "terms/_type_scalar"
  }
]
```

With `shape=compact`, the term is replaced by its bare `_gid` — same traversal
structure, ~50× smaller payload. Use for large leaf sets (e.g.
`branch=ISO_639_type_L` is 7k languages) and call `/term/:gid` on demand for
whatever the user selects:

```json
[
  {
    "gid":       "_number",
    "predicate": "_predicate_enum-of",
    "level":     1,
    "parent":    "terms/_type_scalar"
  }
]
```

```bash
curl -u user:password \
  "http://localhost:8529/_db/metadata/dict/enum/_type_scalar?levels=1"
```

---

### `POST /enum/check`

Bulk enumeration-membership check used by the validation framework. For each
input term, returns the subset of input enumeration roots that accept it as
a member.

The check is **literal** — it looks for at least one edge with the term at the
leaf end (`_from` for inbound, `_to` for outbound), `_predicate_enum-of`, and
the root in `_path`. **No alias resolution** — if the value to validate is an
alias, resolve it first via `/resolve/node`.

**Request body**

```json
{
  "terms":     ["_number", "ISO_639_3_eng"],
  "roots":     ["_type_scalar", "ISO_639_1"],
  "direction": "inbound"
}
```

`direction` defaults to `"inbound"`.

**Response** — `200 OK`, `{ <term_gid>: [<root_gid>, ...], ... }`. Every input
term is a key; values list the input roots that accept it (empty if none):

```json
{
  "_number":       ["_type_scalar"],
  "ISO_639_3_eng": ["ISO_639_1"]
}
```

```bash
curl -u user:password -X POST \
  -H "Content-Type: application/json" \
  -d '{"terms": ["_number"], "roots": ["_type_scalar"]}' \
  http://localhost:8529/_db/metadata/dict/enum/check
```

---

### `POST /resolve/node`

Graph-aware alias resolution. Given a target node and a graph root, returns
the preferred (canonical) term document the target resolves to within that
graph. The principled counterpart to `/term/:gid`'s heuristic.

**Algorithm**

1. Look for an edge in the `root` graph touching `target` at the leaf end
   whose predicate is either the functional one (`_predicate_enum-of` by
   default) or one of the configured traversal predicates
   (`_predicate_section-of`, `_predicate_bridge-of` by default).
2. If the seed edge is functional, the target is already canonical — return
   its document.
3. Otherwise the target is a section or bridge node. Traverse from the
   target in the same direction, walking through allowed predicates until a
   functional-predicate edge surfaces the canonical vertex.

**Use case**: a value submitted as `ISO_639_1_en` resolves to
`ISO_639_3_eng`, which is what `/enum/check` will then test against the
`ISO_639_1` root.

**Request body** (only `root` and `target` are required)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `root` | string | — | Graph root `_gid` |
| `target` | string | — | Node `_gid` to resolve |
| `predicate` | string | `_predicate_enum-of` | Functional predicate for canonical edges |
| `direction` | `inbound` \| `outbound` | `inbound` | Edge direction |
| `traverse` | string[] | `[_predicate_section-of, _predicate_bridge-of]` | Non-functional predicates to walk through |
| `levels` | integer 1–100 | `10` | Max traversal depth |

The functional predicate is auto-included in the traversal set, so callers
don't have to repeat it.

**Response** — `200 OK`, resolved term document, or `null` if the target is
not in the graph (or no resolution path exists within `levels` hops).

```bash
curl -u user:password -X POST \
  -H "Content-Type: application/json" \
  -d '{"root": "ISO_639_1", "target": "ISO_639_1_en"}' \
  http://localhost:8529/_db/metadata/dict/resolve/node
```

---

### `GET /fields/:gid`

Return the canonical property order for an object descriptor.

Reads from the term's own `_data._object._open` or `_data._object._closed`
body. `_required` entries are flattened (their `_selection` arrays — including
nested arrays used by pipeline selectors such as `_range`'s 2-level form) in
declaration order, then `_recommended` entries are appended. Properties are
deduplicated on `_gid`; first occurrence wins, so a required property is
never re-emitted as recommended.

**Path parameter**

| Parameter | Type | Description |
|-----------|------|-------------|
| `gid` | string | Object-descriptor term `_gid` (e.g. `_code`, `_term`) |

**Response**

| Status | Body |
|--------|------|
| `200 OK` | Array of `{ gid, required }` in declaration order |
| `200 OK` | `[]` — object descriptor with no schema body (e.g. `_object: {}`) |
| `400 Bad Request` | Term exists but is not an object descriptor |
| `404 Not Found` | No term with this `_gid` |

```json
[
  { "gid": "_lid", "required": true },
  { "gid": "_gid", "required": true },
  { "gid": "_aid", "required": true },
  { "gid": "_nid", "required": false },
  { "gid": "_uri", "required": false }
]
```

```bash
curl -u user:password \
  http://localhost:8529/_db/metadata/dict/fields/_code
```

---

### `GET /blob/:key`

Fetch a blob document by its `_key`. Blobs hold binary or text media (e.g.
country-flag SVGs) referenced from term `_prop` sections via
`blobs/<key>` handles.

**Path parameter**

| Parameter | Type | Description |
|-----------|------|-------------|
| `key` | string | Blob document `_key` (MD5 of identifying fields) |

**Response** — `200 OK`, full blob document. `404` if not found.

```bash
curl -u user:password \
  http://localhost:8529/_db/metadata/dict/blob/339d23fc1dbffe043bc69d6db95b5912
```

---

## Lifecycle

### Install / upgrade

`scripts/setup.js` runs automatically on install and upgrade. It is
**idempotent** — existence is checked by name in four passes:

1. Collections (`terms`, `edges`, `links`, `blobs`).
2. Custom analyzers (`delim_underscore`).
3. Inverted indexes (`idx_code`, `idx_info_eng`, `idx_domn`).
4. Search-alias views (`v_idx_code`, `v_idx_info_eng`, `v_idx_domn`) — one
   per inverted index. Required because ArangoDB 3.12 community does not
   allow `SEARCH` directly on collections; each view is a thin routing layer
   over its index (no data duplication).

Definitions are never compared. To modify an existing index/analyzer/view,
**drop it first** (e.g. `db._collection('terms').dropIndex('idx_code')` in
arangosh), then re-run setup.

From the ArangoDB web UI: **Services → dict → Settings → Upgrade**.

From the HTTP API:

```bash
curl -sS -u user:password -X POST -H "Content-Type: application/json" -d '{}' \
  "http://localhost:8529/_db/metadata/_api/foxx/scripts/setup?mount=/dict"
```

### Uninstall

`scripts/teardown.js` runs on uninstall. It drops the four views, then the
four collections (which removes their indexes implicitly), then the custom
analyzers. **This is destructive** — all term, edge, link, and blob data is
erased. Re-run the loader after re-installing to repopulate.

### Replace from GitHub

For a fresh install or a clean upgrade from the published source, in the
ArangoDB web UI navigate to **Services → dict → Settings → Replace**, then
select the **GitHub** tab:

| Field | Value |
|-------|-------|
| Repository | `skofic/metadata-store-service` |
| Version | `main` |

---

## Testing

Tests live under `test/`, one file per route, and are auto-discovered via
the `"tests": "test/**/*.js"` field in `manifest.json`. They are read-only
against the live database and assume **core + standards + ISO** data is
loaded — `_code`, `_type_scalar`, `_lid`, and the ISO 639 graphs are used as
fixtures.

Run from the ArangoDB web UI: **Services → dict → Tests**.

Or via the HTTP API:

```bash
curl -sS -u user:password -X POST -H "Content-Type: application/json" \
  "http://localhost:8529/_db/metadata/_api/foxx/tests?mount=/dict"
```

If a test fails because the expected term/edge isn't in the database, the
fixture data hasn't been fully loaded — re-run the loader for `data/core/`,
`data/standards/`, and `data/ISO/`.

---

## Data dependencies

The service is read-only at the data level (setup/teardown manage schema,
not contents). All term, edge, link, and blob data is loaded into ArangoDB
by the `loader` workflow in the `metadata-store` repository:

```bash
# From the metadata-store repo root
swift run --package-path workflows/loader loader
```

---

## License

Copyright (c) 2026 Milko Škofič — Apache 2.0
