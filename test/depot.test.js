import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createApp } from '../src/app.js';
import { createStorage, encodeId } from '../src/storage.js';
import { createEventHub } from '../src/events.js';
import { createSessionsDepot } from '../src/sessions.js';

const TOKEN = 'e'.repeat(32);

async function demarrer() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'easytransfert-depot-'));
  const storage = createStorage(dir);
  await storage.ensureRoot();

  const sessions = createSessionsDepot();
  const app = createApp({
    storage,
    events: createEventHub(),
    network: { candidates: [], active: '127.0.0.1', port: 4455, token: TOKEN },
    sessions,
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    storage,
    sessions,
    base,
    /** Appel avec le jeton complet du PC. */
    api: (chemin, options = {}) =>
      fetch(`${base}${chemin}`, {
        ...options,
        headers: { 'X-Transfer-Token': TOKEN, ...(options.headers ?? {}) },
      }),
    /** Appel avec un jeton de depot, aux droits reduits. */
    invite: (jeton, chemin, options = {}) =>
      fetch(`${base}${chemin}`, {
        ...options,
        headers: { 'X-Transfer-Token': jeton, ...(options.headers ?? {}) },
      }),
    fermer: () => new Promise((r) => {
      server.closeAllConnections();
      server.close(r);
    }),
  };
}

function formulaireAvec(nom, contenu) {
  const form = new FormData();
  form.append('files', new Blob([contenu]), nom);
  return form;
}

test('le PC cree une session de depot et recoit de quoi la partager', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);

  const res = await ctx.api('/api/depot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dureeMs: 600_000, quotaOctets: 5_000_000, quotaFichiers: 3 }),
  });

  assert.equal(res.status, 200);
  const session = await res.json();
  assert.match(session.token, /^[0-9a-f]{32}$/);
  assert.notEqual(session.token, TOKEN, 'un invite ne doit jamais recevoir le jeton principal');
  assert.match(session.url, /\/depot\?t=/);
  assert.match(session.qr, /^data:image\/png;base64,/);
});

test('un invite peut deposer un fichier', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);
  const { token } = ctx.sessions.creer();

  const envoi = await ctx.invite(token, '/api/upload', {
    method: 'POST',
    body: formulaireAvec('photo mamie.jpg', 'contenu'),
  });
  assert.equal(envoi.status, 200);

  // Le fichier est bien arrive, verifie avec le jeton complet.
  const liste = await (await ctx.api('/api/files')).json();
  assert.equal(liste.length, 1);
  assert.equal(liste[0].name, 'photo mamie.jpg');
});

test('un invite ne voit pas la liste des fichiers', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);
  const { token } = ctx.sessions.creer();

  await ctx.api('/api/upload', { method: 'POST', body: formulaireAvec('prive.txt', 'secret') });

  const res = await ctx.invite(token, '/api/files');
  assert.equal(res.status, 403);
  const corps = await res.text();
  assert.ok(!corps.includes('prive.txt'), 'aucun nom de fichier ne doit filtrer');
});

test('un invite ne peut ni telecharger ni supprimer', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);
  const { token } = ctx.sessions.creer();

  await ctx.api('/api/upload', { method: 'POST', body: formulaireAvec('prive.txt', 'secret') });
  const [fichier] = await (await ctx.api('/api/files')).json();

  assert.equal((await ctx.invite(token, `/api/download/${fichier.id}`)).status, 403);
  assert.equal((await ctx.invite(token, `/api/files/${fichier.id}`, { method: 'DELETE' })).status, 403);
  assert.equal((await ctx.invite(token, '/api/files', { method: 'DELETE' })).status, 403);

  // Le fichier doit etre intact.
  assert.equal((await (await ctx.api('/api/files')).json()).length, 1);
});

test('un invite ne touche ni au reseau, ni au jeton, ni aux sessions', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);
  const { token } = ctx.sessions.creer();

  assert.equal((await ctx.invite(token, '/api/network')).status, 403);
  assert.equal((await ctx.invite(token, '/api/network/token', { method: 'POST' })).status, 403);
  assert.equal((await ctx.invite(token, '/api/depot', { method: 'POST' })).status, 403);
  assert.equal((await ctx.invite(token, '/api/events')).status, 403);
});

test('un invite ne recoit pas les notifications de changement', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);
  const { token } = ctx.sessions.creer();

  // Le flux SSE revelerait l'activite du dossier, meme sans en montrer le contenu.
  const res = await ctx.invite(token, '/api/events');
  assert.equal(res.status, 403);
});

test('le quota de taille est applique a l invite', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);
  const { token } = ctx.sessions.creer({ quotaOctets: 10, quotaFichiers: 5 });

  const res = await ctx.invite(token, '/api/upload', {
    method: 'POST',
    body: formulaireAvec('trop-gros.bin', 'x'.repeat(500)),
  });

  assert.equal(res.status, 413);
  assert.deepEqual(await ctx.storage.list(), [], 'rien ne doit rester sur le disque');
});

test('le quota de fichiers est applique a l invite', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);
  const { token } = ctx.sessions.creer({ quotaOctets: 1_000_000, quotaFichiers: 1 });

  assert.equal(
    (await ctx.invite(token, '/api/upload', { method: 'POST', body: formulaireAvec('un.txt', 'a') })).status,
    200,
  );
  assert.equal(
    (await ctx.invite(token, '/api/upload', { method: 'POST', body: formulaireAvec('deux.txt', 'b') })).status,
    413,
  );

  assert.equal((await (await ctx.api('/api/files')).json()).length, 1);
});

test('une session revoquee ne depose plus rien', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);
  const { token } = ctx.sessions.creer();

  const res = await ctx.api(`/api/depot/${token}`, { method: 'DELETE' });
  assert.equal(res.status, 200);

  const envoi = await ctx.invite(token, '/api/upload', {
    method: 'POST',
    body: formulaireAvec('tardif.txt', 'x'),
  });
  assert.equal(envoi.status, 401);
});

test('le PC liste ses sessions de depot en cours', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);
  ctx.sessions.creer({ quotaFichiers: 4 });

  const liste = await (await ctx.api('/api/depot')).json();
  assert.equal(liste.length, 1);
  assert.equal(liste[0].fichiersRestants, 4);
});

test('un identifiant forge reste refuse a un invite', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);
  const { token } = ctx.sessions.creer();

  const malveillant = encodeId('../../evil.txt');
  assert.equal((await ctx.invite(token, `/api/download/${malveillant}`)).status, 403);
});
