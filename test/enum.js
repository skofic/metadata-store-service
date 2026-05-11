/*global describe, it */
'use strict';

// Tests for /enum routes.
// The four key behaviours exercised:
//   1. Flat traversal     — branch=ISO_639_type_C (Constructed languages)
//                           returns its ~24 leaf languages directly via
//                           _predicate_enum-of.
//   2. Section nodes      — ISO_639_3 has scope sections (I, M, S) as
//                           _predicate_section-of children of the root.
//   3. Bridge passthrough — ISO_639_1 contains alias nodes that bridge to
//                           the ISO_639_3 canonicals; level 1 of the
//                           ISO_639_1 traversal returns the canonical
//                           terms (no bridge edge in the result).
//   4. Compact shape      — shape=compact returns bare gids in place of
//                           embedded term documents.
//   5. /enum/check        — bulk membership check, including the literal
//                           rule (no alias resolution) so an alias _gid
//                           is NOT a member of its own root.

const { expect } = require('chai');
const request = require('@arangodb/request');
const baseUrl = module.context.baseUrl;

describe('/enum (hierarchical traversal)', function () {

    it('returns the direct enum-of children of a branch', function () {
        // ISO_639_3 → ISO_639_type_C (Constructed languages) is a small
        // leaf-bearing section: ~24 individual languages directly under it,
        // all reached via _predicate_enum-of. Picked because it's compact
        // and homogeneous, so the assertion can pin the predicate exactly.
        const res = request.get(`${baseUrl}/enum/ISO_639_3?branch=ISO_639_type_C&levels=1`);
        expect(res.status).to.equal(200);
        const body = JSON.parse(res.body);
        expect(body).to.be.an('array').and.not.empty;
        body.forEach(row => {
            expect(row.predicate).to.equal('_predicate_enum-of');
            expect(row.level).to.equal(1);
            expect(row.parent).to.equal('terms/ISO_639_type_C');
        });
        const gids = body.map(r => r.term._code._gid);
        expect(gids).to.include('ISO_639_3_epo');  // Esperanto
    });

    it('exposes section nodes via _predicate_section-of', function () {
        const res = request.get(`${baseUrl}/enum/ISO_639_3`);
        expect(res.status).to.equal(200);
        const body = JSON.parse(res.body);
        const sections = body.filter(r => r.predicate === '_predicate_section-of');
        const sectionGids = sections.map(r => r.term._code._gid);
        expect(sectionGids).to.include.members([
            'ISO_639_scope_I',  // individual languages
            'ISO_639_scope_M',  // macro-languages
            'ISO_639_scope_S'   // special codes
        ]);
        // No bridge-of leakage in the result
        expect(body.every(r => r.predicate !== '_predicate_bridge-of')).to.be.true;
    });

    it('passes through bridge-of edges transparently', function () {
        const res = request.get(`${baseUrl}/enum/ISO_639_1?levels=1`);
        expect(res.status).to.equal(200);
        const body = JSON.parse(res.body);
        // ISO 639-1 has ~180 2-letter codes; each is a bridge alias whose
        // canonical lives in ISO_639_3. After bridge passthrough we expect
        // canonical terms at level 1.
        expect(body.length).to.be.greaterThan(100);
        body.forEach(row => {
            expect(row.predicate).to.equal('_predicate_enum-of');
            expect(row.level).to.equal(1);
            expect(row.parent).to.equal('terms/ISO_639_1');
            expect(row.term._code._gid).to.match(/^ISO_639_3_/);
        });
        const gids = body.map(r => r.term._code._gid);
        expect(gids).to.include('ISO_639_3_eng');
    });

    it('limits returned levels via the levels query param', function () {
        const res = request.get(`${baseUrl}/enum/ISO_639_3?levels=1`);
        expect(res.status).to.equal(200);
        const body = JSON.parse(res.body);
        body.forEach(row => expect(row.level).to.equal(1));
    });

    it('returns bare gids when shape=compact', function () {
        const res = request.get(`${baseUrl}/enum/ISO_639_3?branch=ISO_639_type_C&shape=compact`);
        expect(res.status).to.equal(200);
        const body = JSON.parse(res.body);
        expect(body).to.be.an('array').and.not.empty;
        body.forEach(row => {
            // Compact rows drop the embedded term document entirely.
            expect(row).to.not.have.property('term');
            expect(row).to.have.property('gid');
            expect(row.gid).to.be.a('string');
            // Traversal metadata stays — that's what makes compact mode usable
            // for hierarchical browsing without the bandwidth cost.
            expect(row.predicate).to.equal('_predicate_enum-of');
            expect(row.level).to.equal(1);
            expect(row.parent).to.equal('terms/ISO_639_type_C');
        });
        expect(body.map(r => r.gid)).to.include('ISO_639_3_epo');
    });

});

describe('/enum/check (membership)', function () {

    it('reports matching (term, root) pairs', function () {
        // ISO_639_3_eng belongs to both ISO_639_3 (via type_L → scope_I →
        // root) and ISO_639_1 (via the alias bridge to ISO_639_1_en). Same
        // for ISO_639_3_ita. Membership is a literal edge test so both
        // memberships surface independently.
        const res = request.post(`${baseUrl}/enum/check`, {
            body: JSON.stringify({
                terms: ['ISO_639_3_eng', 'ISO_639_3_ita'],
                roots: ['ISO_639_3', 'ISO_639_1']
            }),
            headers: { 'content-type': 'application/json' }
        });
        expect(res.status).to.equal(200);
        const body = JSON.parse(res.body);
        expect(body.ISO_639_3_eng).to.have.members(['ISO_639_3', 'ISO_639_1']);
        expect(body.ISO_639_3_ita).to.have.members(['ISO_639_3', 'ISO_639_1']);
    });

    it('returns empty arrays for unknown terms', function () {
        const res = request.post(`${baseUrl}/enum/check`, {
            body: JSON.stringify({
                terms: ['__not_a_real_term_xyz'],
                roots: ['ISO_639_3']
            }),
            headers: { 'content-type': 'application/json' }
        });
        expect(res.status).to.equal(200);
        const body = JSON.parse(res.body);
        expect(body.__not_a_real_term_xyz).to.deep.equal([]);
    });

    it('treats alias _gids literally (no alias resolution)', function () {
        // ISO_639_1_en is the alias node; the canonical (ISO_639_3_eng) is
        // the one with the _predicate_enum-of edge into ISO_639_1, not the
        // alias itself. The literal check must therefore report no match.
        const res = request.post(`${baseUrl}/enum/check`, {
            body: JSON.stringify({
                terms: ['ISO_639_1_en'],
                roots: ['ISO_639_1']
            }),
            headers: { 'content-type': 'application/json' }
        });
        expect(res.status).to.equal(200);
        const body = JSON.parse(res.body);
        expect(body.ISO_639_1_en).to.deep.equal([]);
    });

});
