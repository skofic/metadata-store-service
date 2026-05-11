/*global describe, it */
'use strict';

// Tests for /fields/:gid.
// _code is the canonical object descriptor used as fixture: its closed schema
// has _required = [_lid, _gid, _aid] and _recommended = [_nid, _uri, _pid,
// _name, _symbol, _symbol_print, _regexp, _emoji]. The test pins the order
// (_required first, then _recommended) and the required flag on each entry.

const { expect } = require('chai');
const request = require('@arangodb/request');
const baseUrl = module.context.baseUrl;

describe('/fields', function () {

    it('returns required-then-recommended ordering for an object descriptor', function () {
        const res = request.get(`${baseUrl}/fields/_code`);
        expect(res.status).to.equal(200);
        const body = JSON.parse(res.body);
        expect(body).to.be.an('array');

        const requiredEntries = body.filter(e => e.required);
        const recommendedEntries = body.filter(e => !e.required);

        // _required entries come first
        const firstRecommendedIdx = body.findIndex(e => !e.required);
        const lastRequiredIdx = body.map(e => e.required).lastIndexOf(true);
        expect(lastRequiredIdx).to.be.lessThan(firstRecommendedIdx);

        // Required declaration order: _lid, _gid, _aid
        expect(requiredEntries.map(e => e.gid)).to.deep.equal(['_lid', '_gid', '_aid']);

        // Recommended declaration order
        expect(recommendedEntries.map(e => e.gid)).to.deep.equal([
            '_nid', '_uri', '_pid', '_name', '_symbol', '_symbol_print', '_regexp', '_emoji'
        ]);
    });

    it('returns 400 when the term is not an object descriptor', function () {
        // _lid is a scalar string descriptor, not an object.
        const res = request.get(`${baseUrl}/fields/_lid`);
        expect(res.status).to.equal(400);
    });

    it('returns 404 when the term does not exist', function () {
        const res = request.get(`${baseUrl}/fields/__not_a_real_term_xyz`);
        expect(res.status).to.equal(404);
    });

});
