'use strict';
const createRouter = require('@arangodb/foxx/router');
const joi = require('joi');
const { getEnum } = require('../lib/queries');
const router = createRouter();

// GET /enum/:gid
// The _path field on each edge records which graph roots the edge belongs to,
// so passing the root's handle as a filter selects only the members of that
// specific enumeration — even when edges are shared across bridge graphs.
// Returns a flat list; section structure (_predicate_section-of) is ignored here.
router.get('/:gid', function (req, res) {
    res.json(getEnum(req.pathParams.gid));
})
.pathParam('gid', joi.string().required(), 'Enumeration root _gid')
.response(['application/json'], 'Array of enum element term documents')
.summary('Get all elements of an enumeration')
.description('Returns all terms reachable from the given root via _predicate_enum-of edges in any path containing that root.');

module.exports = router;
