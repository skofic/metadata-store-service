# metadata-store-service

ArangoDB Foxx microservice exposing the metadata dictionary as an HTTP API.
Mounted at `/dict` in the `metadata` database.

---

## Environment

| Item | Value |
|------|-------|
| ArangoDB | `http://localhost:8529` (Docker, port-forwarded to host) |
| Database | `metadata` |
| Mount point | `/dict` |
| Base URL | `http://localhost:8529/_db/metadata/dict` |
| Collections (read) | `terms`, `edges`, `links`, `blobs` |

Authentication uses ArangoDB's built-in Basic auth. All curl examples below use
`user:password` as a placeholder — replace with your actual ArangoDB credentials.

---

## Repository layout

```
APP/
├── manifest.json       — Foxx service metadata (name, version, entry point)
├── main.js             — Root router; mounts sub-routers under /term, /enum, /fields
├── lib/
│   └── queries.js      — AQL query functions shared by all routes
├── routes/
│   ├── term.js         — Term lookup with alias resolution
│   ├── enum.js         — Enumeration traversal
│   └── fields.js       — Field ordering for record types and sections
├── scripts/
│   ├── setup.js        — Run on install (no-op: collections owned by the loader)
│   └── teardown.js     — Run on uninstall (no-op)
└── test/
    └── example.js      — Placeholder test suite (Mocha + Chai)
```

Since the repository directory is directly mounted by ArangoDB (development mode),
edits to any file take effect on the next request without a manual reload.

---

## Routes

### `GET /term/:gid`

Fetch a single term by its `_gid`.

Alias terms carry only a `_code` section (no `_info`, no `_data`). When the
requested `_gid` identifies an alias, the service resolves it to the canonical
term and returns that instead. The caller always receives a fully populated term.

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

Aliases are resolved transparently. Terms that cannot be found are silently
omitted from the result — the caller must compare input and output counts if
completeness matters.

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

### `GET /enum/:gid`

Return all elements of an enumeration.

The dictionary stores enumeration membership via `_predicate_enum-of` edges.
Each edge carries a `_path` set of graph root handles; filtering by the root's
handle isolates exactly the members of that enumeration, even when edges are
shared across bridge graphs.

Returns a flat list of term documents. Section grouping (`_predicate_section-of`
edges) is not reflected here — use the graph browser for hierarchical display.

**Path parameter**

| Parameter | Type | Description |
|-----------|------|-------------|
| `gid` | string | Enumeration root `_gid` (e.g. `_type_scalar`, `ISO_639_3`) |

**Response** — `200 OK`, array of term documents. Empty array if the root has no members.

```bash
curl -u user:password \
  http://localhost:8529/_db/metadata/dict/enum/_type_scalar
```

---

### `GET /fields/:gid`

Return the ordered field list for a record type or section.

Field ordering is stored as `_predicate_field-of` edges. Each edge points from a
field descriptor to its parent (a record type or section term), with the display
order in `_path_data[parent_handle]._order`. The ordering matches the canonical
key order enforced by `assign-roles`/`JSONWriter`.

Works at all levels of the hierarchy:

| `gid` | Fields returned |
|-------|-----------------|
| `_term` | `_code`, `_info`, `_data`, `_domn`, `_prop` (positions 1–5) |
| `_edge` | `_from`, `_predicate`, `_to`, `_target`, `_path`, `_path_data` (1–6) |
| `_code` | `_nid`, `_lid`, `_gid`, `_uri`, `_aid`, `_pid`, `_name`, `_symbol`, `_emoji`, `_regexp` (1–10) |
| `_info` | `_title`, `_definition`, `_description`, `_examples`, `_methods`, `_uses`, `_citation`, `_provider`, `_url`, `_notes` (1–10) |
| `_domn` | `_term_role`, `_class`, `_category`, `_domain`, `_list`, `_options`, `_subject`, `_tag`, `_usage` (1–9) |

**Path parameter**

| Parameter | Type | Description |
|-----------|------|-------------|
| `gid` | string | Record type or section `_gid` (e.g. `_term`, `_code`, `_info`) |

**Response** — `200 OK`, array of objects sorted by `order`:

```json
[
  { "gid": "_code",  "handle": "terms/_code",  "order": 1 },
  { "gid": "_info",  "handle": "terms/_info",  "order": 2 },
  { "gid": "_data",  "handle": "terms/_data",  "order": 3 },
  { "gid": "_domn",  "handle": "terms/_domn",  "order": 4 },
  { "gid": "_prop",  "handle": "terms/_prop",  "order": 5 }
]
```

Empty array if no `_predicate_field-of` edges point to the given term (e.g. the
`edges.fields.json` file has not yet been loaded into the database).

```bash
curl -u user:password \
  http://localhost:8529/_db/metadata/dict/fields/_term
```

---

## Data dependencies

The service is read-only. All data is loaded into ArangoDB by the `loader`
workflow in the `metadata-store` repository. The `/fields` routes require
`data/core/edges.fields.json` to be loaded; the other routes work with any
populated `terms` and `edges` collections.

To load outstanding data files:

```bash
# From the metadata-store repo root
swift run --package-path workflows/loader loader
```

---

## Reloading the service

### From the ArangoDB web UI (recommended)

Navigate to **Services → dict → Settings → Replace**, then select the **GitHub** tab.
Enter the following and click **Install**:

| Field | Value |
|-------|-------|
| Repository | `skofic/metadata-store-service` |
| Version | `main` |

This installs the latest version from the `main` branch. Use the same procedure
for first-time installation if the service does not yet exist — ArangoDB will
create the mount point automatically.

### Via the API

In production mode, trigger a development-mode reload (which forces a full reload):

```bash
curl -X POST \
  "http://localhost:8529/_db/metadata/_api/foxx/development?mount=/dict" \
  -u user:password
```

In development mode (current default), the service reloads automatically on every request.

---

## License

Copyright (c) 2026 Milko Škofič — Apache 2.0
