import test from 'node:test';
import assert from 'node:assert/strict';

import { createToken, extractToken, createAuthMiddleware } from '../src/security.js';

function fauxReq({ header, query = {} } = {}) {
  return { get: (nom) => (nom === 'X-Transfer-Token' ? header : undefined), query };
}

function fauxRes() {
  return {
    code: null,
    corps: null,
    status(c) { this.code = c; return this; },
    json(o) { this.corps = o; return this; },
  };
}

test('createToken produit 32 caracteres hexadecimaux distincts', () => {
  const a = createToken();
  const b = createToken();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, b);
});

test('extractToken lit l en-tete en priorite, puis le parametre d URL', () => {
  assert.equal(extractToken(fauxReq({ header: 'abc' })), 'abc');
  assert.equal(extractToken(fauxReq({ query: { t: 'xyz' } })), 'xyz');
  assert.equal(extractToken(fauxReq({ header: 'abc', query: { t: 'xyz' } })), 'abc');
  assert.equal(extractToken(fauxReq()), undefined);
});

test('le middleware laisse passer le bon token', () => {
  const token = createToken();
  const res = fauxRes();
  let suivantAppele = false;
  createAuthMiddleware(token)(fauxReq({ header: token }), res, () => { suivantAppele = true; });
  assert.equal(suivantAppele, true);
  assert.equal(res.code, null);
});

test('le middleware refuse un token absent, faux, ou de longueur differente', () => {
  const token = createToken();
  const middleware = createAuthMiddleware(token);

  for (const req of [fauxReq(), fauxReq({ header: 'faux' }), fauxReq({ header: 'a'.repeat(32) })]) {
    const res = fauxRes();
    let suivantAppele = false;
    middleware(req, res, () => { suivantAppele = true; });
    assert.equal(suivantAppele, false);
    assert.equal(res.code, 401);
    assert.equal(res.corps.error, 'Token invalide ou absent');
  }
});
