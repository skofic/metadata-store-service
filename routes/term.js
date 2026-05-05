'use strict';
const createRouter = require('@arangodb/foxx/router');
const joi = require('joi');
const { getTerm, getTerms } = require('../lib/queries');
const router = createRouter();

// GET /term/:gid
// Alias terms (only _code, no _info/_data) are resolved to their canonical term
// transparently — the caller always receives a fully populated term document.
router.get('/:gid', function (req, res) {
    const term = getTerm(req.pathParams.gid);
    if (!term) { res.throw(404, 'Term not found'); }
    res.json(term);
})
.pathParam('gid', joi.string().required(), 'Term _gid')
.response(['application/json'], 'Term document or resolved alias')
.summary('Fetch a term by _gid')
.description('Returns the term with the given _gid. If the term is an alias (has only _code), returns the canonical term it points to.');

// POST /term/bulk
// Body: { "gids": ["_code", "_info", ...] }
// Terms that cannot be found (or whose aliases cannot be resolved) are omitted
// from the result rather than causing an error — the caller must check counts.
router.post('/bulk', function (req, res) {
    res.json(getTerms(req.body.gids));
})
.body(joi.object({ gids: joi.array().items(joi.string()).required() }), 'Array of _gid strings')
.response(['application/json'], 'Array of term documents')
.summary('Fetch multiple terms by _gid')
.description('Returns an array of term documents for the given _gid list. Aliases are resolved. Terms not found are omitted.');

module.exports = router;
