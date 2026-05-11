/*global describe, it, before */
'use strict';

// Tests for /term routes.
// Anchored on core terms (_code, _info) and ISO 639 fixtures. Alias resolution
// is verified against the real bridge: ISO_639_1_en is the alias node (bridge
// shell with only _code) and ISO_639_3_eng is the canonical term.

const { expect } = require('chai');
const request = require('@arangodb/request');
const baseUrl = module.context.baseUrl;

describe('/term', function () {

    it('GET /term/:gid returns a known core term', function () {
        const res = request.get(`${baseUrl}/term/_code`);
        expect(res.status).to.equal(200);
        const body = JSON.parse(res.body);
        expect(body._code._gid).to.equal('_code');
        expect(body).to.have.property('_info');
        expect(body).to.have.property('_data');
    });

    it('GET /term/:gid resolves an alias term to its canonical', function () {
        const res = request.get(`${baseUrl}/term/ISO_639_1_en`);
        expect(res.status).to.equal(200);
        const body = JSON.parse(res.body);
        expect(body._code._gid).to.equal('ISO_639_3_eng');
        expect(body).to.have.property('_info');
    });

    it('GET /term/:gid returns 404 for an unknown _gid', function () {
        const res = request.get(`${baseUrl}/term/__not_a_real_term_xyz`);
        expect(res.status).to.equal(404);
    });

    it('POST /term/bulk returns the known terms and omits the unknown', function () {
        const res = request.post(`${baseUrl}/term/bulk`, {
            body: JSON.stringify({ gids: ['_code', '__not_a_real_term_xyz', '_info'] }),
            headers: { 'content-type': 'application/json' }
        });
        expect(res.status).to.equal(200);
        const body = JSON.parse(res.body);
        const gids = body.map(t => t._code._gid);
        expect(gids).to.have.members(['_code', '_info']);
        expect(gids).to.not.include('__not_a_real_term_xyz');
    });

    it('POST /term/bulk resolves aliases inside the input list', function () {
        const res = request.post(`${baseUrl}/term/bulk`, {
            body: JSON.stringify({ gids: ['ISO_639_1_en', 'ISO_639_1_aa'] }),
            headers: { 'content-type': 'application/json' }
        });
        expect(res.status).to.equal(200);
        const body = JSON.parse(res.body);
        const gids = body.map(t => t._code._gid);
        expect(gids).to.have.members(['ISO_639_3_eng', 'ISO_639_3_aar']);
    });

});
