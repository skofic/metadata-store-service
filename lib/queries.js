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
                LIMIT 1
                RETURN DOCUMENT(e._from)
        )[0] : null
        RETURN isAlias ? canonical : doc
    `).toArray()[0] || null;
}

// Bulk variant — silently omits gids that resolve to nothing.
function getTerms(gids) {
    return gids.map(gid => getTerm(gid)).filter(t => t != null);
}

// Hierarchical traversal of an enumeration graph.
//
// INBOUND BFS from `branch`. Edges considered are those whose _path contains
// the `root` handle and whose _predicate is one of:
//   _predicate_enum-of     — selectable enumeration option (returned)
//   _predicate_section-of  — display-only grouping (returned)
//   _predicate_bridge-of   — transparent passthrough (NOT returned)
//
// Bridges only appear at the root level (a root's edge into another graph).
// To let traversal pass through them without "spending" a level, maxDepth is
// the requested `levels` plus one. The bridge edge is excluded from the result
// and its level is not counted; `effectiveLevel = path.edges - bridgeCount`.
//
// `parent` in the result is the closest visible (non-bridge) ancestor's
// document handle, so consumers can reconstruct a tree even when the immediate
// graph parent is a bridge node.
function getEnumTree(rootGid, branchGid, levels, direction, shape) {
    const rootHandle = `terms/${rootGid}`;
    const branchHandle = `terms/${branchGid || rootGid}`;
    const depth = Math.max(1, parseInt(levels || 1, 10));
    const maxDepth = depth + 1;  // bridge-passthrough budget (1 bridge max at root)
    const bound = (direction === 'outbound') ? aql`OUTBOUND` : aql`INBOUND`;
    // shape: 'full' (default) returns the embedded term document;
    //        'compact' returns the bare _gid — ~50x smaller payload for large
    //        leaf sets such as branch=ISO_639_type_L (7k languages).
    const isCompact = (shape === 'compact');

    // The PRUNE expression must guard against the null edge that the engine
    // passes when evaluating the start vertex (depth 0). Without the `e != null`
    // gate, `e._predicate NOT IN [...]` would resolve to `null NOT IN [...]`,
    // which is true — pruning the entire traversal before it begins.
    return db._query(aql`
        FOR v, e, p IN 1..${maxDepth} ${bound} ${branchHandle} edges
            PRUNE e != null AND (
                ${rootHandle} NOT IN e._path
                OR e._predicate NOT IN ['_predicate_enum-of', '_predicate_section-of', '_predicate_bridge-of']
            )
            OPTIONS { order: "bfs", uniqueVertices: "global", uniqueEdges: "path" }
            FILTER ${rootHandle} IN e._path
            FILTER e._predicate IN ['_predicate_enum-of', '_predicate_section-of']
            LET bridgeCount = LENGTH(p.edges[* FILTER CURRENT._predicate == '_predicate_bridge-of'])
            LET effectiveLevel = LENGTH(p.edges) - bridgeCount
            FILTER effectiveLevel <= ${depth}
            LET visibleVertices = (
                FOR i IN 0..(LENGTH(p.vertices) - 1)
                    LET incomingEdge = i == 0 ? null : p.edges[i - 1]
                    FILTER incomingEdge == null OR incomingEdge._predicate != '_predicate_bridge-of'
                    RETURN p.vertices[i]
            )
            LET parentVertex = visibleVertices[LENGTH(visibleVertices) - 2]
            RETURN ${isCompact}
                ? {
                    gid:       v._key,
                    predicate: e._predicate,
                    level:     effectiveLevel,
                    parent:    parentVertex._id
                }
                : {
                    term:      v,
                    predicate: e._predicate,
                    level:     effectiveLevel,
                    parent:    parentVertex._id
                }
    `).toArray();
}

// Enumeration membership check.
// For every (term, root) combination from the two input lists, return the
// pair if at least one edge satisfies:
//   - the term sits at the "leaf" end of the edge — _from for inbound graphs
//     (default; many-to-one), _to for outbound graphs (one-to-many).
//   - _predicate == _predicate_enum-of
//   - _path      contains terms/<root>
//
// No alias resolution — the caller is expected to canonicalise first if
// aliases are in play (typically via resolveNode or getTerm).
//
// Result shape: { <term_gid>: [<root_gid>, ...], ... }
// Every input term is a key; values are the matching roots (possibly empty).
function checkEnumMembership(terms, roots, direction) {
    const termEnd = (direction === 'outbound') ? aql`_to` : aql`_from`;

    const pairs = db._query(aql`
        FOR t IN ${terms}
            FOR r IN ${roots}
                LET termHandle = CONCAT('terms/', t)
                LET rootHandle = CONCAT('terms/', r)
                LET found = LENGTH(
                    FOR e IN edges
                        FILTER e.${termEnd} == termHandle
                        FILTER e._predicate == '_predicate_enum-of'
                        FILTER rootHandle IN e._path
                        LIMIT 1
                        RETURN 1
                ) > 0
                FILTER found
                RETURN { term: t, root: r }
    `).toArray();

    const out = {};
    for (const t of terms) out[t] = [];
    for (const p of pairs) out[p.term].push(p.root);
    return out;
}

// Graph-aware alias resolution.
//
// Given a target node and a graph (identified by its root), return the
// "preferred" canonical document the target resolves to within that graph.
//
// Three outcomes:
//   1. Target is not in the graph at all       → null
//   2. Target is reached by a `predicate` edge → target IS canonical, return as-is
//   3. Target is reached by a `traverse`-predicate edge (section, bridge, …)
//      → traverse from target in the same direction following functional +
//        traversal predicates until a functional edge yields the canonical
//
// This is the principled counterpart to the heuristic alias resolution in
// getTerm() (which detects aliases by "no _info/_data"). Use this when graph
// membership matters: e.g. validating a value that arrives as an ISO 639-1
// 2-letter alias against the canonical ISO 639-3 enumeration.
//
// Parameters (all but root/target have sensible defaults):
//   root      — graph root _gid (required)
//   target    — node _gid to resolve (required)
//   predicate — functional predicate that marks "canonical" edges
//               (default '_predicate_enum-of')
//   direction — 'inbound' (many-to-one, default) | 'outbound' (one-to-many)
//   traverse  — predicates to walk through during step-3 traversal
//               (default [_predicate_section-of, _predicate_bridge-of];
//               the functional predicate is auto-included)
//   levels    — max traversal depth in step 3 (default 10)
function resolveNode(rootGid, targetGid, predicate, direction, traverse, levels) {
    const rootHandle = `terms/${rootGid}`;
    const targetHandle = `terms/${targetGid}`;
    const isInbound = (direction !== 'outbound');
    const bound = isInbound ? aql`INBOUND` : aql`OUTBOUND`;
    // For inbound (many-to-one) graphs the target sits at the leaf end of the
    // edge — _from. For outbound graphs it sits at _to.
    const targetEnd = isInbound ? aql`_from` : aql`_to`;
    const pred = predicate || '_predicate_enum-of';
    const defaultTraverse = ['_predicate_section-of', '_predicate_bridge-of'];
    const traverseList = Array.isArray(traverse) ? traverse : defaultTraverse;
    const allPreds = traverseList.includes(pred) ? traverseList : traverseList.concat([pred]);
    const maxLevels = Math.max(1, parseInt(levels || 10, 10));

    // Step 1: find an edge in this graph that touches the target at the
    // appropriate end and uses one of the allowed predicates.
    const seedEdges = db._query(aql`
        FOR e IN edges
            FILTER ${rootHandle} IN e._path
            FILTER e.${targetEnd} == ${targetHandle}
            FILTER e._predicate IN ${allPreds}
            LIMIT 1
            RETURN e
    `).toArray();

    if (seedEdges.length === 0) return null;

    // Step 2: if the seed edge is functional, the target itself is canonical.
    if (seedEdges[0]._predicate === pred) {
        try { return db._document(targetHandle); }
        catch (e) { return null; }
    }

    // Step 3: traverse from the target through allowed predicates until a
    // functional edge surfaces the canonical vertex.
    const resolved = db._query(aql`
        FOR vertex, e, p IN 1..${maxLevels} ${bound} ${targetHandle} edges
            PRUNE e != null AND (
                ${rootHandle} NOT IN e._path
                OR e._predicate NOT IN ${allPreds}
            )
            OPTIONS { uniqueVertices: "path" }
            FILTER ${rootHandle} IN e._path
            FILTER e._predicate == ${pred}
            LIMIT 1
            RETURN vertex
    `).toArray();

    return resolved.length === 0 ? null : resolved[0];
}

// Ordered property list for an object descriptor.
//
// Reads term._data._object._open OR ._closed and returns the union of
// _required (flattened, in declaration order) and _recommended, with
// _required entries first. Deduplicates on _gid; first occurrence wins, so
// a property appearing in _required is never re-emitted as recommended.
//
// _required's nested _selection arrays (used by pipeline selectors such as
// _range's "1 lower + 1 upper" form) are flattened recursively.
//
// Return shape:
//   { error: 'not-found' }     — caller should respond 404
//   { error: 'not-object' }    — term has no _data._object; caller should 400
//   []                         — object descriptor with no schema body
//                                or with empty _required/_recommended
//   [{ gid, required }, ...]   — successful list
function getFields(gid) {
    const term = getTerm(gid);
    if (!term) return { error: 'not-found' };

    const obj = term._data && term._data._object;
    if (!obj) return { error: 'not-object' };

    const body = obj._open || obj._closed;
    if (!body) return [];

    const result = [];
    const seen = new Set();

    function add(g, required) {
        if (seen.has(g)) return;
        seen.add(g);
        result.push({ gid: g, required: required });
    }

    function flattenSelection(arr) {
        if (!Array.isArray(arr)) return;
        for (const item of arr) {
            if (Array.isArray(item)) flattenSelection(item);
            else if (typeof item === 'string') add(item, true);
        }
    }

    for (const sel of (body._required || [])) {
        flattenSelection(sel && sel._selection);
    }
    for (const g of (body._recommended || [])) {
        add(g, false);
    }

    return result;
}

module.exports = { getTerm, getTerms, getEnumTree, checkEnumMembership, getFields, resolveNode };
