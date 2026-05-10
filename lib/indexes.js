'use strict';

// Database schema definitions consumed by scripts/setup.js (idempotent install)
// and scripts/teardown.js (uninstall). Pure data — no execution here.
//
// Collections use bare names (no service-mount prefix) because the loader and
// other tooling write directly to `terms`, `edges`, `links`, `blobs`.
//
// Indexes are keyed by `name`. To modify an existing index, drop it first
// (`db._collection('terms').dropIndex('<name>')`) — setup matches by name and
// will skip if the name already exists, regardless of the stored definition.

exports.collections = [
    { name: 'terms', type: 'document' },
    { name: 'edges', type: 'edge'     },
    { name: 'links', type: 'edge'     },
    { name: 'blobs', type: 'document' }
];

// Custom analyzers. Built-ins (identity, text_en, norm_en) are not listed.
exports.analyzers = [
    {
        name: 'delim_underscore',
        type: 'delimiter',
        properties: { delimiter: '_' },
        features: ['frequency', 'norm', 'position']
    }
];

exports.indexes = [
    // idx_code — codes & identifiers. Cached: small, hot, primary entry point.
    {
        collection: 'terms',
        index: {
            type: 'inverted',
            name: 'idx_code',
            cache: true,
            searchField: true,  // enable SEARCH operation; default is filter-only
            fields: [
                // _code._gid: tokenised via delim_underscore so segment search
                // works (e.g. find all gids containing 'ISO' or '3166'). Exact
                // gid lookups go through the built-in _key primary index since
                // _key === _code._gid. ArangoDB inverted indexes don't allow
                // the same field path twice with different analyzers.
                { name: '_code._gid',          analyzer: 'delim_underscore' },
                { name: '_code._lid',          analyzer: 'identity'         },
                { name: '_code._nid',          analyzer: 'identity'         },
                { name: '_code._uri',          analyzer: 'identity'         },
                // Array fields: with searchField: true, drop the [*] suffix —
                // arrays are auto-expanded by the inverted index machinery.
                { name: '_code._aid',          analyzer: 'identity'         },
                { name: '_code._pid',          analyzer: 'identity'         },
                { name: '_code._name',         analyzer: 'identity'         },
                { name: '_code._symbol_print', analyzer: 'identity'         }
            ],
            primarySort: {
                fields: [{ field: '_code._gid', direction: 'asc' }]
            },
            storedValues: [
                {
                    fields: [
                        '_code._gid',
                        '_code._nid',
                        '_info._title.ISO_639_3_eng',
                        '_domn._term_role'
                    ]
                }
            ]
        }
    },

    // idx_info_eng — multilingual content, English. Not cached: text_en token
    // expansion across Markdown bodies will dominate index size; not RAM-friendly.
    {
        collection: 'terms',
        index: {
            type: 'inverted',
            name: 'idx_info_eng',
            searchField: true,  // enable SEARCH operation; default is filter-only
            fields: [
                // _info._title: tokenised search via text_en. Sort comes from
                // primarySort below (raw byte order; fine for English). Exact
                // case-insensitive match dropped — same field-path-uniqueness
                // restriction as _code._gid.
                { name: '_info._title.ISO_639_3_eng',       analyzer: 'text_en' },
                { name: '_info._definition.ISO_639_3_eng',  analyzer: 'text_en' },
                { name: '_info._description.ISO_639_3_eng', analyzer: 'text_en' },
                // _examples is an array of multilingual dicts; drop [*]
                // since searchField: true auto-expands arrays.
                { name: '_info._examples.ISO_639_3_eng',    analyzer: 'text_en' },
                { name: '_info._methods.ISO_639_3_eng',     analyzer: 'text_en' },
                { name: '_info._uses.ISO_639_3_eng',        analyzer: 'text_en' },
                { name: '_info._notes.ISO_639_3_eng',       analyzer: 'text_en' },
                // Citation/provider/url are arrays of strings — drop [*].
                { name: '_info._citation',                  analyzer: 'text_en' },
                { name: '_info._provider',                  analyzer: 'text_en' },
                { name: '_info._url',                       analyzer: 'text_en' }
            ],
            primarySort: {
                fields: [{ field: '_info._title.ISO_639_3_eng', direction: 'asc' }]
            }
        }
    },

    // idx_domn — categorical / open. Cached: categorical filtering is the
    // second primary entry point (browse by domain, category, role).
    {
        collection: 'terms',
        index: {
            type: 'inverted',
            name: 'idx_domn',
            cache: true,
            searchField: true,  // enable SEARCH operation; default is filter-only
            fields: [
                { name: '_domn', includeAllFields: true, analyzer: 'identity' }
            ]
        }
    }
];

// Search-alias views — thin wrappers over inverted indexes that expose them
// to AQL `SEARCH`. ArangoDB 3.12 community does not support SEARCH directly
// on collections; the view is a routing layer only and does not duplicate
// any data. One view per inverted index keeps primarySort isolated (a single
// search-alias view bundling indexes with different primarySort settings is
// rejected at creation time).
exports.views = [
    {
        name: 'v_idx_code',
        type: 'search-alias',
        indexes: [{ collection: 'terms', index: 'idx_code' }]
    },
    {
        name: 'v_idx_info_eng',
        type: 'search-alias',
        indexes: [{ collection: 'terms', index: 'idx_info_eng' }]
    },
    {
        name: 'v_idx_domn',
        type: 'search-alias',
        indexes: [{ collection: 'terms', index: 'idx_domn' }]
    }
];
