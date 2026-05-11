'use strict';
const createRouter = require('@arangodb/foxx/router');
const joi = require('joi');
const { getEnumTree, checkEnumMembership } = require('../lib/queries');
const router = createRouter();

// POST /enum/check
// Bulk enumeration-membership check used by the validation framework.
// Detects at least one edge with the term as _from, _predicate_enum-of as
// predicate, and the root in _path. No alias resolution — pass canonical _gids.
//
// Body: { "terms": ["gid1", ...], "roots": ["rootGid1", ...] }
// Response: { <term_gid>: [<root_gid>, ...], ... }
//   - Every input term is a key in the result.
//   - The value lists which of the input roots accept the term as a member;
//     an empty array means the term is not a member of any input root.
router.post('/check', function (req, res) {
    res.json(checkEnumMembership(req.body.terms, req.body.roots, req.body.direction));
})
.body(
    joi.object({
        terms: joi.array().items(joi.string()).min(1).required(),
        roots: joi.array().items(joi.string()).min(1).required(),
        direction: joi.string().valid('inbound', 'outbound').default('inbound')
    }).required(),
    'Terms to test against the listed enumeration roots'
)
.response(['application/json'], 'Map of term _gid → list of accepting root _gids')
.summary('Check enumeration membership')
.description('For each input term, returns the subset of input enumeration roots that accept it as a member (at least one _predicate_enum-of edge with the root in _path). No alias resolution — the caller is expected to canonicalise first.');

// GET /enum/:root?branch=<gid>&levels=<n>
// Hierarchical BFS traversal of an enumeration graph.
//   :root   — required path param. Enumeration root _gid; filters edges by _path.
//   branch  — optional query param. Starting vertex _gid; defaults to root.
//   levels  — optional query param. Number of BFS hops from branch; default 1.
//
// Edges considered carry one of _predicate_enum-of, _predicate_section-of,
// _predicate_bridge-of. Bridge-of edges are transparent passthroughs: they are
// not returned as results, and they do not count toward the level budget.
//
// Result preserves the option/section distinction via the `predicate` field:
//   _predicate_enum-of    — selectable enumeration option
//   _predicate_section-of — display-only grouping header
//
// Response: [{ term, predicate, level, parent }]
//   term      — full term document
//   predicate — _predicate_enum-of or _predicate_section-of
//   level     — depth in the visible hierarchy (1 = direct child of branch)
//   parent    — document handle of the closest visible ancestor
//               (skips bridge nodes so consumers can rebuild a tree)
router.get('/:root', function (req, res) {
    const root = req.pathParams.root;
    const branch = req.queryParams.branch || root;
    const levels = req.queryParams.levels;
    const direction = req.queryParams.direction;
    const shape = req.queryParams.shape;
    res.json(getEnumTree(root, branch, levels, direction, shape));
})
.pathParam('root', joi.string().required(), 'Enumeration root _gid (filters _path)')
.queryParam('branch', joi.string(), 'Starting vertex _gid (defaults to root)')
.queryParam('levels', joi.number().integer().min(1).max(20).default(1), 'Number of BFS hops from branch (default 1)')
.queryParam('direction', joi.string().valid('inbound', 'outbound').default('inbound'), 'Traversal direction (default inbound, i.e. many-to-one)')
.queryParam('shape', joi.string().valid('full', 'compact').default('full'), 'Result shape: full returns embedded term docs, compact returns the bare _gid (default full)')
.response(['application/json'], 'Array of { term|gid, predicate, level, parent }')
.summary('Traverse an enumeration hierarchy from a branch')
.description('Breadth-first traversal of the enumeration graph rooted at `root`, starting at `branch` (defaults to `root`) and going `levels` deep. With shape=full each row is { term, predicate, level, parent }; with shape=compact the embedded term is replaced by `gid`. _predicate_bridge-of edges pass through transparently without consuming a level.');

module.exports = router;
