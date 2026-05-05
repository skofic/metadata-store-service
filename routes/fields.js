'use strict';
const createRouter = require('@arangodb/foxx/router');
const joi = require('joi');
const { getFields } = require('../lib/queries');
const router = createRouter();

// GET /fields/:gid
// Works at any level of the field hierarchy:
//   _term  → sections (_code, _info, _data, _domn, _prop)
//   _edge  → top-level edge properties (_from, _predicate, _to, …)
//   _code  → code properties (_nid, _lid, _gid, …)
//   _info  → info properties (_title, _definition, …)
// The _order values come from _path_data on each _predicate_field-of edge
// and reproduce the canonical ordering enforced by assign-roles/JSONWriter.
router.get('/:gid', function (req, res) {
    res.json(getFields(req.pathParams.gid));
})
.pathParam('gid', joi.string().required(), 'Record type or section _gid (e.g. _term, _code, _info)')
.response(['application/json'], 'Ordered array of { gid, handle, order }')
.summary('Get ordered field list for a record type or section')
.description('Returns field descriptors sorted by _order, derived from _predicate_field-of edges pointing to the given term.');

module.exports = router;
