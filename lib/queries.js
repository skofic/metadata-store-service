'use strict';
const { db, aql } = require('@arangodb');

// Returns the term for the given _gid, resolving aliases transparently.
// An alias term carries only _code (no _info, no _data). When one is detected,
// we follow its _predicate_enum-of edge (directed leaf→root, so _to == alias)
// to the canonical term and return that instead.
function getTerm(gid) {
    const handle = `terms/${gid}`;
    return db._query(aql`
        LET doc = DOCUMENT(${handle})
        LET isAlias = (doc != null AND !HAS(doc, '_info') AND !HAS(doc, '_data'))
        LET canonical = isAlias ? (
            FOR e IN edges
                FILTER e._to == ${handle}
                FILTER e._predicate == '_predicate_enum-of'
                LIMIT 1                          // exactly one canonical term per alias
                RETURN DOCUMENT(e._from)
        )[0] : null
        RETURN isAlias ? canonical : doc
    `).toArray()[0] || null;
}

// Bulk variant — silently omits gids that resolve to nothing.
function getTerms(gids) {
    return gids.map(gid => getTerm(gid)).filter(t => t != null);
}

// Returns all enum element terms that belong to the given root's graph.
// _path on each edge is the set of graph root handles the edge participates in,
// so filtering by handle IN e._path isolates exactly this enumeration without
// traversing bridge graphs or unrelated enumerations that share the same edges.
function getEnum(gid) {
    const handle = `terms/${gid}`;
    return db._query(aql`
        FOR e IN edges
            FILTER e._predicate == '_predicate_enum-of'
            FILTER ${handle} IN e._path
            RETURN DOCUMENT(e._from)
    `).toArray();
}

// Returns the ordered field list for a record type or section term.
// _path_data on each _predicate_field-of edge is keyed by the _to handle;
// the value object carries _order, which is the canonical display position.
// Works for both top-level record types (_term, _edge) and their sections
// (_code, _info, _domn), since all levels use the same edge structure.
function getFields(gid) {
    const handle = `terms/${gid}`;
    return db._query(aql`
        FOR e IN edges
            FILTER e._predicate == '_predicate_field-of'
            FILTER e._to == ${handle}
            LET order = e._path_data[${handle}]._order
            SORT order ASC
            RETURN {
                gid:    SPLIT(e._from, '/')[1],  // strip "terms/" prefix → bare _gid
                handle: e._from,
                order:  order
            }
    `).toArray();
}

module.exports = { getTerm, getTerms, getEnum, getFields };
