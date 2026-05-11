/*global describe, it */
'use strict';

// Tests for /resolve/node.
// Fixtures:
//   ISO_639_1_en (alias)        → ISO_639_3_eng (canonical) within graph ISO_639_1
//   ISO_639_3_eng (canonical)   → itself within graph ISO_639_1
//   ISO_639_3_eng (leaf)        → itself within graph ISO_639_3 (already canonical;
//                                 step 1 finds the functional enum-of edge to
//                                 ISO_639_type_L and short-circuits)
//   _number                     → not in ISO_639_1, so resolves to null

const { expect } = require('chai');
const request = require('@arangodb/request');
const baseUrl = module.context.baseUrl;

function postResolve(body) {
    return request.post(`${baseUrl}/resolve/node`, {
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' }
    });
}

describe('/resolve/node', function () {

    it('resolves an alias node to its canonical', function () {
        const res = postResolve({ root: 'ISO_639_1', target: 'ISO_639_1_en' });
        expect(res.status).to.equal(200);
        const body = JSON.parse(res.body);
        expect(body).to.be.an('object');
        expect(body._code._gid).to.equal('ISO_639_3_eng');
        // Resolution must produce a fully-populated term, not the alias shell.
        expect(body).to.have.property('_info');
    });

    it('returns the target unchanged when it is already canonical', function () {
        const res = postResolve({ root: 'ISO_639_1', target: 'ISO_639_3_eng' });
        expect(res.status).to.equal(200);
        const body = JSON.parse(res.body);
        expect(body._code._gid).to.equal('ISO_639_3_eng');
    });

    it('returns the target when it is a leaf in a non-aliased graph', function () {
        // Within ISO_639_3, ISO_639_3_eng is already a leaf reachable by an
        // _predicate_enum-of edge to ISO_639_type_L (path: [ISO_639_3]).
        // Step 1 finds the functional edge and short-circuits — no traversal.
        const res = postResolve({ root: 'ISO_639_3', target: 'ISO_639_3_eng' });
        expect(res.status).to.equal(200);
        const body = JSON.parse(res.body);
        expect(body._code._gid).to.equal('ISO_639_3_eng');
    });

    it('returns null when the target is not in the graph', function () {
        const res = postResolve({ root: 'ISO_639_1', target: '_number' });
        expect(res.status).to.equal(200);
        const body = JSON.parse(res.body);
        expect(body).to.equal(null);
    });

    it('returns null for an unknown target', function () {
        const res = postResolve({ root: 'ISO_639_1', target: '__not_a_real_term_xyz' });
        expect(res.status).to.equal(200);
        const body = JSON.parse(res.body);
        expect(body).to.equal(null);
    });

    it('honours an explicit direction parameter (inbound default)', function () {
        const res = postResolve({
            root: 'ISO_639_1',
            target: 'ISO_639_1_en',
            direction: 'inbound'
        });
        expect(res.status).to.equal(200);
        const body = JSON.parse(res.body);
        expect(body._code._gid).to.equal('ISO_639_3_eng');
    });

});
