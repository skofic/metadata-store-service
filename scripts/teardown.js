'use strict';

// Destructor. Runs on Foxx service uninstall.
//
// Drops the views first (they reference indexes), then the collections
// (which removes their indexes implicitly), then the custom analyzers.
// This is destructive: uninstalling the service erases all term, edge,
// link, and blob data.

const { db } = require('@arangodb');
const analyzers = require('@arangodb/analyzers');
const { collections, analyzers: analyzerDefs, views } = require('../lib/indexes');

for (const v of views) {
    if (db._view(v.name)) {
        db._dropView(v.name);
    }
}

for (const c of collections) {
    if (db._collection(c.name)) {
        db._drop(c.name);
    }
}

// `force: true` removes the analyzer even if other indexes/views still
// reference it. By this point all indexes from this service are gone with
// the collections; the flag covers any external references.
for (const a of analyzerDefs) {
    if (analyzers.analyzer(a.name)) {
        analyzers.remove(a.name, true);
    }
}
