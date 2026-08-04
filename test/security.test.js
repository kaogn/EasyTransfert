import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createToken,
  extractToken,
  createAuthMiddleware,
  lireOuCreerToken,
  ecrireToken,
} from '../src/security.js';

async function fichierTemporaire() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'easytransfert-token-'));
  return path.join(dir, '.token');
}

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
  createAuthMiddleware(() => token)(fauxReq({ header: token }), res, () => { suivantAppele = true; });
  assert.equal(suivantAppele, true);
  assert.equal(res.code, null);
});

test('le middleware suit le token courant apres une regeneration', () => {
  let token = createToken();
  const middleware = createAuthMiddleware(() => token);
  const ancien = token;
  token = createToken();

  const resAncien = fauxRes();
  let ancienAccepte = false;
  middleware(fauxReq({ header: ancien }), resAncien, () => { ancienAccepte = true; });
  assert.equal(ancienAccepte, false, "l'ancien token doit etre refuse");
  assert.equal(resAncien.code, 401);

  const resNouveau = fauxRes();
  let nouveauAccepte = false;
  middleware(fauxReq({ header: token }), resNouveau, () => { nouveauAccepte = true; });
  assert.equal(nouveauAccepte, true, 'le nouveau token doit etre accepte');
});

test('le middleware refuse un token absent, faux, ou de longueur differente', () => {
  const token = createToken();
  const middleware = createAuthMiddleware(() => token);

  for (const req of [fauxReq(), fauxReq({ header: 'faux' }), fauxReq({ header: 'a'.repeat(32) })]) {
    const res = fauxRes();
    let suivantAppele = false;
    middleware(req, res, () => { suivantAppele = true; });
    assert.equal(suivantAppele, false);
    assert.equal(res.code, 401);
    assert.equal(res.corps.error, 'Token invalide ou absent');
  }
});

test('lireOuCreerToken cree un token et le persiste quand le fichier est absent', async () => {
  const fichier = await fichierTemporaire();
  const token = await lireOuCreerToken(fichier);

  assert.match(token, /^[0-9a-f]{32}$/);
  assert.equal((await fs.readFile(fichier, 'utf8')).trim(), token);
});

test('lireOuCreerToken rend le meme token aux demarrages suivants', async () => {
  const fichier = await fichierTemporaire();
  const premier = await lireOuCreerToken(fichier);
  const second = await lireOuCreerToken(fichier);

  assert.equal(second, premier);
});

test('lireOuCreerToken remplace un fichier corrompu par un token neuf', async () => {
  const fichier = await fichierTemporaire();
  await fs.writeFile(fichier, 'pas-un-token');
  const token = await lireOuCreerToken(fichier);

  assert.match(token, /^[0-9a-f]{32}$/);
  assert.equal((await fs.readFile(fichier, 'utf8')).trim(), token);
});

test('ecrireToken remplace le token persiste', async () => {
  const fichier = await fichierTemporaire();
  const premier = await lireOuCreerToken(fichier);
  const nouveau = createToken();
  await ecrireToken(fichier, nouveau);

  assert.notEqual(nouveau, premier);
  assert.equal(await lireOuCreerToken(fichier), nouveau);
});
