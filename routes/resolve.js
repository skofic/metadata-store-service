'use strict';
const createRouter = require('@arangodb/foxx/router');
const joi = require('joi');
const { resolveNode } = require('../lib/queries');
const router = createRouter();

// POST /resolve/node
// Graph-aware alias resolution. Given a target node and a graph root, return
// the preferred (canonical) term document the target resolves to within that
// graph. The typical use case: a value submitted as an ISO 639-1 alias such
// as `ISO_639_1_en` is resolved to its canonical `ISO_639_3_eng` before the
// classical enum-membership validator runs against the ISO_639_1 enumeration.
//
// Body shape (only `root` and `target` are required):
//   root       — graph root _gid
//   target     — node _gid to resolve
//   predicate  — functional predicate marking canonical edges
//                (default '_predicate_enum-of')
//   direction  — 'inbound' (many-to-one, default) | 'outbound' (one-to-many)
//   traverse   — predicates to walk through during resolution
//                (default ['_predicate_section-of', '_predicate_bridge-of'];
//                the functional predicate is auto-included if missing)
//   levels     — max traversal depth (default 10)
//
// Response: the resolved term document, or `null` if the target is not in
// the graph (or no resolution path exists within `levels` hops).
//
// Example: POST /resolve/node { "root": "ISO_639_1", "target": "ISO_639_1_en" }
//          → ISO_639_3_eng term document
router.post('/node', function (req, res) {
    const out = resolveNode(
        req.body.root,
        req.body.target,
        req.body.predicate,
        req.body.direction,
        req.body.traverse,
        req.body.levels
    );
    res.json(out);
})
.body(
    joi.object({
        root:      joi.string().required(),
        target:    joi.string().required(),
        predicate: joi.string().default('_predicate_enum-of'),
        direction: joi.string().valid('inbound', 'outbound').default('inbound'),
        traverse:  joi.array().items(joi.string()).default(['_predicate_section-of', '_predicate_bridge-of']),
        levels:    joi.number().integer().min(1).max(100).default(10)
    }).required(),
    'Resolution parameters'
)
.response(['application/json'], 'Resolved term document, or null if unresolved')
.summary('Resolve a node to its preferred (canonical) term within a graph')
.description('Graph-aware alias resolution: if the target node is an alias or a section/bridge node, follow the configured non-functional predicates until a functional-predicate edge yields the canonical term. Returns the target itself if it is already canonical, or null if it is not in the graph.');

module.exports = router;
