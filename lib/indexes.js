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
            fields: [
                { name: '_code._gid',          analyzer: 'identity'         },
                { name: '_code._gid',          analyzer: 'delim_underscore' },
                { name: '_code._lid',          analyzer: 'identity'         },
                { name: '_code._nid',          analyzer: 'identity'         },
                { name: '_code._uri',          analyzer: 'identity'         },
                { name: '_code._aid[*]',       analyzer: 'identity'         },
                { name: '_code._pid[*]',       analyzer: 'identity'         },
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
            fields: [
                { name: '_info._title.ISO_639_3_eng',       analyzer: 'norm_en' },
                { name: '_info._title.ISO_639_3_eng',       analyzer: 'text_en' },
                { name: '_info._definition.ISO_639_3_eng',  analyzer: 'text_en' },
                { name: '_info._description.ISO_639_3_eng', analyzer: 'text_en' },
                { name: '_info._examples[*].ISO_639_3_eng', analyzer: 'text_en' },
                { name: '_info._methods.ISO_639_3_eng',     analyzer: 'text_en' },
                { name: '_info._uses.ISO_639_3_eng',        analyzer: 'text_en' },
                { name: '_info._notes.ISO_639_3_eng',       analyzer: 'text_en' },
                { name: '_info._citation[*]',               analyzer: 'text_en' },
                { name: '_info._provider[*]',               analyzer: 'text_en' },
                { name: '_info._url[*]',                    analyzer: 'text_en' }
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
            fields: [
                { name: '_domn', includeAllFields: true, analyzer: 'identity' }
            ]
        }
    }
];
