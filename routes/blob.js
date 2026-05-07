'use strict';
const createRouter = require('@arangodb/foxx/router');
const joi = require('joi');
const { db } = require('@arangodb');
const router = createRouter();

router.get('/:key', function (req, res) {
    let doc;
    try { doc = db._document('blobs/' + req.pathParams.key); } catch (e) { doc = null; }
    if (!doc) { res.throw(404, 'Blob not found'); }
    res.json(doc);
})
.pathParam('key', joi.string().required(), 'Blob document _key')
.response(['application/json'], 'Blob document')
.summary('Fetch a blob by key')
.description('Returns the full blob document for the given _key.');

module.exports = router;
