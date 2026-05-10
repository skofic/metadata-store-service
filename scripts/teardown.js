'use strict';

// Destructor. Runs on Foxx service uninstall.
//
// Drops every collection listed in lib/indexes.js (which removes their
// indexes implicitly) and removes the custom analyzers. This is destructive:
// uninstalling the service erases all term, edge, link, and blob data.

const { db } = require('@arangodb');
const analyzers = require('@arangodb/analyzers');
const { collections, analyzers: analyzerDefs } = require('../lib/indexes');

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
