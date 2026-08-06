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
const JETON = 'c'.repeat(32);

/** Occupe un port et rend son numero, pour simuler un conflit reel. */
async function occuperUnPort(t) {
  const serveur = http.createServer((req, res) => res.end('occupe'));
  await new Promise((r) => serveur.listen(0, HOTE, r));
  t.after(() => new Promise((r) => { serveur.closeAllConnections(); serveur.close(r); }));
  return serveur.address().port;
}

/**
 * Reserve un port puis le libere aussitot. Des numeros de port fixes rendraient
 * ces tests dependants de l'etat de la machine : un socket encore en TIME_WAIT
 * apres une execution precedente suffirait a les faire echouer par intermittence.
 */
async function portLibere() {
  const serveur = http.createServer();
  await new Promise((r) => serveur.listen(0, HOTE, r));
  const port = serveur.address().port;
  await new Promise((r) => serveur.close(r));
  return port;
}

/** Une application EasyTransfert complete, ecoutant sur un port ephemere. */
async function appEasyTransfert(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'easytransfert-demarrage-'));
  const storage = createStorage(dir);
  await storage.ensureRoot();
  const app = createApp({
    storage,
    events: createEventHub(),
    network: { candidates: [], active: HOTE, port: 0, token: JETON },
  });
  const serveur = await new Promise((resolve) => {
    const s = app.listen(0, HOTE, () => resolve(s));
  });
  t.after(() => new Promise((r) => { serveur.closeAllConnections(); serveur.close(r); }));
  return serveur.address().port;
}

test('ecouterSurPremierPortLibre retient le port prefere quand il est libre', async (t) => {
  const prefere = await portLibere();
  const secours = await portLibere();

  const { server, port } = await ecouterSurPremierPortLibre(
    http.createServer(),
    HOTE,
    [prefere, secours],
  );
  t.after(() => new Promise((r) => server.close(r)));

  assert.equal(port, prefere);
});

test('ecouterSurPremierPortLibre bascule sur le port suivant quand le prefere est pris', async (t) => {
  const pris = await occuperUnPort(t);
  const secours = await portLibere();

  const { server, port } = await ecouterSurPremierPortLibre(
    http.createServer(),
    HOTE,
    [pris, secours],
  );
  t.after(() => new Promise((r) => server.close(r)));

  assert.equal(port, secours, 'le port occupe doit etre ignore');
});

test('ecouterSurPremierPortLibre echoue quand toute la plage est occupee', async (t) => {
  const premier = await occuperUnPort(t);
  const second = await occuperUnPort(t);

  await assert.rejects(
    () => ecouterSurPremierPortLibre(http.createServer(), HOTE, [premier, second]),
    (err) => err.code === 'ENOPORT',
  );
});

test('instanceExistante reconnait une instance qui partage le meme jeton', async (t) => {
  const port = await appEasyTransfert(t);
  assert.equal(await instanceExistante(port, HOTE, JETON), true);
});

test('instanceExistante rejette un service etranger sur le meme port', async (t) => {
  const port = await occuperUnPort(t);
  assert.equal(await instanceExistante(port, HOTE, JETON), false);
});

test('instanceExistante demasque un imposteur qui se declare EasyTransfert', async (t) => {
  // Repond exactement comme une vraie instance, mais ne connait pas le jeton :
  // sans preuve verifiable, lui confier le jeton reviendrait a le lui offrir.
  const imposteur = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ app: 'easytransfert', preuve: 'a'.repeat(64) }));
  });
  await new Promise((r) => imposteur.listen(0, HOTE, r));
  t.after(() => new Promise((r) => { imposteur.closeAllConnections(); imposteur.close(r); }));

  assert.equal(await instanceExistante(imposteur.address().port, HOTE, JETON), false);
});

test('instanceExistante rejette une instance dont le jeton differe', async (t) => {
  const port = await appEasyTransfert(t);
  assert.equal(await instanceExistante(port, HOTE, 'd'.repeat(32)), false);
});

test('instanceExistante rejette un port ou personne ne repond', async () => {
  assert.equal(await instanceExistante(await portLibere(), HOTE, JETON), false);
});
