import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ecouterSurPremierPortLibre, instanceExistante } from '../src/demarrage.js';
import { createApp } from '../src/app.js';
import { createStorage } from '../src/storage.js';
import { createEventHub } from '../src/events.js';

const HOTE = '127.0.0.1';

/** Occupe un port et rend son numero, pour simuler un conflit reel. */
async function occuperUnPort(t) {
  const serveur = http.createServer((req, res) => res.end('occupe'));
  await new Promise((r) => serveur.listen(0, HOTE, r));
  t.after(() => new Promise((r) => { serveur.closeAllConnections(); serveur.close(r); }));
  return serveur.address().port;
}

/** Une application EasyTransfert complete, ecoutant sur un port ephemere. */
async function appEasyTransfert(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'easytransfert-demarrage-'));
  const storage = createStorage(dir);
  await storage.ensureRoot();
  const app = createApp({
    storage,
    events: createEventHub(),
    network: { candidates: [], active: HOTE, port: 0, token: 'c'.repeat(32) },
  });
  const serveur = await new Promise((resolve) => {
    const s = app.listen(0, HOTE, () => resolve(s));
  });
  t.after(() => new Promise((r) => { serveur.closeAllConnections(); serveur.close(r); }));
  return serveur.address().port;
}

test('ecouterSurPremierPortLibre retient le port prefere quand il est libre', async (t) => {
  const { server, port } = await ecouterSurPremierPortLibre(
    http.createServer(),
    HOTE,
    [45551, 45552],
  );
  t.after(() => new Promise((r) => server.close(r)));

  assert.equal(port, 45551);
});

test('ecouterSurPremierPortLibre bascule sur le port suivant quand le prefere est pris', async (t) => {
  const pris = await occuperUnPort(t);

  const { server, port } = await ecouterSurPremierPortLibre(
    http.createServer(),
    HOTE,
    [pris, 45553],
  );
  t.after(() => new Promise((r) => server.close(r)));

  assert.equal(port, 45553, 'le port occupe doit etre ignore');
});

test('ecouterSurPremierPortLibre echoue quand toute la plage est occupee', async (t) => {
  const premier = await occuperUnPort(t);
  const second = await occuperUnPort(t);

  await assert.rejects(
    () => ecouterSurPremierPortLibre(http.createServer(), HOTE, [premier, second]),
    (err) => err.code === 'ENOPORT',
  );
});

test('instanceExistante reconnait une autre instance d EasyTransfert', async (t) => {
  const port = await appEasyTransfert(t);
  assert.equal(await instanceExistante(port, HOTE), true);
});

test('instanceExistante rejette un service etranger sur le meme port', async (t) => {
  const port = await occuperUnPort(t);
  assert.equal(await instanceExistante(port, HOTE), false);
});

test('instanceExistante rejette un port ou personne ne repond', async () => {
  // On reserve un port puis on le libere aussitot : c'est le seul moyen fiable
  // d'obtenir un numero de port dont on sait que rien n'ecoute dessus.
  const serveur = http.createServer();
  await new Promise((r) => serveur.listen(0, HOTE, r));
  const port = serveur.address().port;
  await new Promise((r) => serveur.close(r));

  assert.equal(await instanceExistante(port, HOTE), false);
});
