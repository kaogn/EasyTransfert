import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createApp } from '../src/app.js';
import { createStorage, encodeId } from '../src/storage.js';
import { createEventHub } from '../src/events.js';

const TOKEN = 'a'.repeat(32);

/** Demarre l'application sur un port ephemere et retourne de quoi la piloter. */
async function demarrer() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'easytransfert-routes-'));
  const storage = createStorage(dir);
  await storage.ensureRoot();

  const app = createApp({
    storage,
    events: createEventHub(),
    network: { candidates: [], active: '127.0.0.1', port: 4455, token: TOKEN },
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    storage,
    base,
    /** Appel API authentifie par en-tete. */
    api: (chemin, options = {}) =>
      fetch(`${base}${chemin}`, {
        ...options,
        headers: { 'X-Transfer-Token': TOKEN, ...(options.headers ?? {}) },
      }),
    fermer: () => new Promise((r) => server.close(r)),
  };
}

function formulaireAvec(nom, contenu) {
  const form = new FormData();
  form.append('files', new Blob([contenu]), nom);
  return form;
}

test('l API refuse un appel sans token', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);

  const res = await fetch(`${ctx.base}/api/files`);
  assert.equal(res.status, 401);
});

test('l API accepte le token en parametre d URL', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);

  const res = await fetch(`${ctx.base}/api/files?t=${TOKEN}`);
  assert.equal(res.status, 200);
});

test('un fichier envoye apparait dans la liste puis se telecharge a l identique', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);

  const envoi = await ctx.api('/api/upload', { method: 'POST', body: formulaireAvec('note.txt', 'bonjour') });
  assert.equal(envoi.status, 200);

  const liste = await (await ctx.api('/api/files')).json();
  assert.equal(liste.length, 1);
  assert.equal(liste[0].name, 'note.txt');
  assert.equal(liste[0].size, 7);

  const telechargement = await fetch(`${ctx.base}/api/download/${liste[0].id}?t=${TOKEN}`);
  assert.equal(telechargement.status, 200);
  assert.equal(await telechargement.text(), 'bonjour');
});

test('les noms accentues survivent a l envoi', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);

  await ctx.api('/api/upload', { method: 'POST', body: formulaireAvec('été à Nîmes.txt', 'x') });
  const liste = await (await ctx.api('/api/files')).json();
  assert.equal(liste[0].name, 'été à Nîmes.txt');
});

test('deux fichiers de meme nom coexistent', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);

  await ctx.api('/api/upload', { method: 'POST', body: formulaireAvec('photo.jpg', 'un') });
  await ctx.api('/api/upload', { method: 'POST', body: formulaireAvec('photo.jpg', 'deux') });

  const noms = (await (await ctx.api('/api/files')).json()).map((f) => f.name);
  assert.deepEqual([...noms].sort(), ['photo (1).jpg', 'photo.jpg']);
});

test('aucun fichier .part ne subsiste apres un envoi', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);

  await ctx.api('/api/upload', { method: 'POST', body: formulaireAvec('note.txt', 'bonjour') });
  const surDisque = await fs.readdir(ctx.storage.rootDir);
  assert.deepEqual(surDisque, ['note.txt']);
});

test('un identifiant qui sort du dossier partage est refuse', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);

  const malveillant = encodeId('../../evil.txt');
  assert.equal((await fetch(`${ctx.base}/api/download/${malveillant}?t=${TOKEN}`)).status, 403);
  assert.equal((await ctx.api(`/api/files/${malveillant}`, { method: 'DELETE' })).status, 403);
});

test('un identifiant inexistant renvoie 404', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);

  const fantome = encodeId('jamais-vu.txt');
  assert.equal((await fetch(`${ctx.base}/api/download/${fantome}?t=${TOKEN}`)).status, 404);
});

test('la suppression retire le fichier', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);

  await ctx.api('/api/upload', { method: 'POST', body: formulaireAvec('jetable.txt', 'x') });
  const [fichier] = await (await ctx.api('/api/files')).json();

  assert.equal((await ctx.api(`/api/files/${fichier.id}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual(await (await ctx.api('/api/files')).json(), []);
});

test('DELETE /api/files vide le dossier partage d un coup', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);

  await ctx.api('/api/upload', { method: 'POST', body: formulaireAvec('un.txt', 'a') });
  await ctx.api('/api/upload', { method: 'POST', body: formulaireAvec('deux.txt', 'b') });

  const res = await ctx.api('/api/files', { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { deleted: 2 });
  assert.deepEqual(await (await ctx.api('/api/files')).json(), []);
});

test('DELETE /api/files sur un dossier vide repond 200 et zero', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);

  const res = await ctx.api('/api/files', { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { deleted: 0 });
});

test('DELETE /api/files exige le token', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);

  await ctx.api('/api/upload', { method: 'POST', body: formulaireAvec('precieux.txt', 'a') });

  assert.equal((await fetch(`${ctx.base}/api/files`, { method: 'DELETE' })).status, 401);
  assert.equal((await (await ctx.api('/api/files')).json()).length, 1);
});

test('un champ de formulaire inattendu renvoie une erreur JSON', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);

  const form = new FormData();
  form.append('other', new Blob(['x']), 'inattendu.txt');
  const res = await ctx.api('/api/upload', { method: 'POST', body: form });

  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /Trop de fichiers/i);
});

test('GET /ping identifie le service sans exiger de token', async (t) => {
  const ctx = await demarrer();
  t.after(ctx.fermer);

  const res = await fetch(`${ctx.base}/ping`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { app: 'easytransfert' });
});
