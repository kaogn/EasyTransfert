import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createApp } from '../src/app.js';
import { createStorage } from '../src/storage.js';
import { createEventHub } from '../src/events.js';

const TOKEN = 'b'.repeat(32);

async function demarrer() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'easytransfert-reseau-'));
  const storage = createStorage(dir);
  await storage.ensureRoot();

  const network = {
    candidates: [
      { name: 'Wi-Fi', address: '192.168.1.20' },
      { name: 'Ethernet', address: '192.168.1.42' },
    ],
    active: '192.168.1.20',
    port: 4455,
    token: TOKEN,
  };

  const persistes = [];
  const app = createApp({
    storage,
    events: createEventHub(),
    network,
    persisterToken: async (token) => { persistes.push(token); },
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    network,
    persistes,
    base,
    api: (chemin, options = {}) =>
      fetch(`${base}${chemin}`, {
        ...options,
        headers: { 'X-Transfer-Token': TOKEN, ...(options.headers ?? {}) },
      }),
    // closeAllConnections est indispensable ici : un flux SSE encore ouvert
    // empecherait server.close() de rendre la main, et le test resterait pendu.
    fermer: () => new Promise((r) => {
      server.closeAllConnections();
      server.close(r);
    }),
  };
}

test('GET /api/network expose les candidates, l URL complete et un QR en data URL', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);

  const corps = await (await ctx.api('/api/network')).json();

  assert.equal(corps.active, '192.168.1.20');
  assert.equal(corps.candidates.length, 2);
  assert.equal(corps.url, `http://192.168.1.20:4455/?t=${TOKEN}`);
  assert.match(corps.qr, /^data:image\/png;base64,/);
});

test('POST /api/network change l adresse active et le QR', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);

  const avant = await (await ctx.api('/api/network')).json();
  const apres = await (
    await ctx.api('/api/network', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '192.168.1.42' }),
    })
  ).json();

  assert.equal(apres.active, '192.168.1.42');
  assert.equal(apres.url, `http://192.168.1.42:4455/?t=${TOKEN}`);
  assert.notEqual(apres.qr, avant.qr);
  assert.equal(ctx.network.active, '192.168.1.42');
});

test('POST /api/network refuse une adresse absente de la liste', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);

  const res = await ctx.api('/api/network', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: '10.99.99.99' }),
  });

  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Adresse inconnue');
  assert.equal(ctx.network.active, '192.168.1.20');
});

test('POST /api/network/token change le jeton, le persiste et invalide l ancien', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);

  const reponse = await ctx.api('/api/network/token', { method: 'POST' });
  assert.equal(reponse.status, 200);

  const etat = await reponse.json();
  assert.match(etat.token, /^[0-9a-f]{32}$/);
  assert.notEqual(etat.token, TOKEN);
  assert.equal(ctx.network.token, etat.token);
  assert.equal(etat.url, `http://192.168.1.20:4455/?t=${etat.token}`);

  // Le nouveau jeton doit avoir ete confie a la persistance.
  assert.deepEqual(ctx.persistes, [etat.token]);

  // L'ancien jeton ne doit plus ouvrir aucune porte.
  assert.equal((await ctx.api('/api/files')).status, 401);

  const avecNouveau = await fetch(`${ctx.base}/api/files?t=${etat.token}`);
  assert.equal(avecNouveau.status, 200);
});

test('POST /api/network/token exige le jeton courant', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);

  const res = await fetch(`${ctx.base}/api/network/token`, { method: 'POST' });
  assert.equal(res.status, 401);
  assert.equal(ctx.network.token, TOKEN);
});

test('POST /api/network/token coupe les flux SSE ouverts avec l ancien jeton', { timeout: 10_000 }, async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);

  // Un appareil deja connecte, authentifie avec l'ancien jeton.
  const flux = await ctx.api('/api/events');
  assert.equal(flux.status, 200);
  const lecteur = flux.body.getReader();

  await ctx.api('/api/network/token', { method: 'POST' });

  // Le flux doit se terminer de lui-meme : sans cela, l'appareil evince
  // continuerait de recevoir les notifications malgre la revocation.
  const { done } = await lecteur.read();
  assert.equal(done, true, 'le flux SSE doit se fermer apres la revocation');
});
