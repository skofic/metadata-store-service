/*global describe, it */
'use strict';

// Tests for /blob/:key.
// Fixture: the Andorra landscape flag blob. Its _key is computed at insert
// time as LOWER(MD5("flag/_text_SVG/_media_landscape/ad")) — deterministic
// across reloads as long as the four identifying fields stay the same.

const { expect } = require('chai');
const request = require('@arangodb/request');
const baseUrl = module.context.baseUrl;

const FLAG_KEY_ANDORRA_LANDSCAPE = '339d23fc1dbffe043bc69d6db95b5912';

describe('/blob', function () {

    it('returns a known blob document', function () {
        const res = request.get(`${baseUrl}/blob/${FLAG_KEY_ANDORRA_LANDSCAPE}`);
        expect(res.status).to.equal(200);
        const body = JSON.parse(res.body);
        expect(body._blob_item).to.equal('flag');
        expect(body._blob_type).to.equal('_text_SVG');
        expect(body._blob_kind).to.equal('_media_landscape');
        expect(body._blob_identifier).to.equal('ad');
        expect(body._blob_content).to.be.a('string').and.not.empty;
    });

    it('returns 404 for an unknown blob key', function () {
        const res = request.get(`${baseUrl}/blob/0000000000000000000000000000aaaa`);
        expect(res.status).to.equal(404);
    });

});
