'use strict';

// Idempotent installer. Runs on Foxx service install and upgrade.
//
// Existence is keyed by name in all three passes:
// - Collection: `db._collection(name)` returns the collection or null.
// - Analyzer:   `analyzers.analyzer(name)` returns the analyzer object or null.
// - Index:      `coll.indexes()` is searched for a matching `name`.
//
// Definitions are not compared. To change an existing collection, analyzer,
// or index, drop it first and re-run setup (or upgrade the service).

const { db } = require('@arangodb');
const analyzers = require('@arangodb/analyzers');
const { context } = require('@arangodb/locals');
const { collections, analyzers: analyzerDefs, indexes } = require('../lib/indexes');

// 1. Collections (bare names, shared with the loader and other tooling).
for (const c of collections) {
    if (db._collection(c.name)) {
        if (context.isProduction) {
            console.debug(`collection ${c.name} already exists; leaving untouched`);
        }
        continue;
    }
    if (c.type === 'edge') {
        db._createEdgeCollection(c.name);
    } else {
        db._createDocumentCollection(c.name);
    }
}

// 2. Custom analyzers.
for (const a of analyzerDefs) {
    if (analyzers.analyzer(a.name)) {
        if (context.isProduction) {
            console.debug(`analyzer ${a.name} already exists; leaving untouched`);
        }
        continue;
    }
    analyzers.save(a.name, a.type, a.properties, a.features);
}

// 3. Indexes — match by name on the target collection.
for (const def of indexes) {
    const coll = db._collection(def.collection);
    if (!coll) {
        console.warn(`collection ${def.collection} missing; cannot create index ${def.index.name}`);
        continue;
    }
    const existing = coll.indexes().find(i => i.name === def.index.name);
    if (existing) {
        if (context.isProduction) {
            console.debug(`index ${def.collection}/${def.index.name} already exists; leaving untouched`);
        }
        continue;
    }
    coll.ensureIndex(def.index);
}
