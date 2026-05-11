'use strict';
const createRouter = require('@arangodb/foxx/router');
const joi = require('joi');
const { getFields } = require('../lib/queries');
const router = createRouter();

// GET /fields/:gid
// Returns the canonical property order for an object descriptor.
//
// Source: the term's own _data._object._open or ._closed body. _required
// entries are flattened (their _selection arrays — possibly nested for
// pipeline selectors like _range) in declaration order, then _recommended
// entries are appended. Properties are deduplicated on _gid; first
// occurrence wins, so a required property is never re-emitted as recommended.
//
// Status semantics:
//   404 — no term with this _gid
//   400 — term exists but is not an object descriptor (no _data._object)
//   200 + []                    — object descriptor with no schema body
//   200 + [{ gid, required }]   — ordered list
router.get('/:gid', function (req, res) {
    const out = getFields(req.pathParams.gid);
    if (out && out.error === 'not-found')  { res.throw(404, 'Term not found');                 }
    if (out && out.error === 'not-object') { res.throw(400, 'Term is not an object descriptor'); }
    res.json(out);
})
.pathParam('gid', joi.string().required(), 'Object-descriptor term _gid')
.response(['application/json'], 'Array of { gid, required } in declaration order')
.summary('Get ordered field list for an object descriptor')
.description('Returns the canonical property order for an object descriptor, drawn from the term\'s _data._object._open or _closed body: _required entries first (flattened, in order), then _recommended entries. Properties are deduplicated on _gid.');

module.exports = router;
