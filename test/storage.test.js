import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { sanitizeName, encodeId, createStorage } from '../src/storage.js';

async function tempStorage() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'easytransfert-'));
  const storage = createStorage(dir);
  await storage.ensureRoot();
  return storage;
}

test('sanitizeName retire les separateurs de chemin', () => {
  assert.equal(sanitizeName('../../evil.txt'), 'evil.txt');
  assert.equal(sanitizeName('C:\\Windows\\System32\\drivers\\etc\\hosts'), 'hosts');
});

test('sanitizeName remplace les caracteres interdits sous Windows', () => {
  assert.equal(sanitizeName('rapport:final?.pdf'), 'rapport_final_.pdf');
});

test('sanitizeName conserve les accents', () => {
  assert.equal(sanitizeName('été à la mer.jpg'), 'été à la mer.jpg');
});

test('sanitizeName retombe sur "fichier" quand il ne reste rien', () => {
  assert.equal(sanitizeName('..'), 'fichier');
  assert.equal(sanitizeName('   '), 'fichier');
  assert.equal(sanitizeName(''), 'fichier');
});

test('sanitizeName echappe les noms reserves de Windows', () => {
  assert.equal(sanitizeName('CON.txt'), '_CON.txt');
  assert.equal(sanitizeName('com1'), '_com1');
});

test('uniqueName suffixe en cas de collision', async () => {
  const storage = await tempStorage();
  await fs.writeFile(path.join(storage.rootDir, 'photo.jpg'), 'a');
  assert.equal(await storage.uniqueName('photo.jpg'), 'photo (1).jpg');

  await fs.writeFile(path.join(storage.rootDir, 'photo (1).jpg'), 'b');
  assert.equal(await storage.uniqueName('photo.jpg'), 'photo (2).jpg');
});

test('list retourne les fichiers du plus recent au plus ancien et ignore les .part', async () => {
  const storage = await tempStorage();
  await fs.writeFile(path.join(storage.rootDir, 'ancien.txt'), 'aaa');
  await new Promise((r) => setTimeout(r, 10));
  await fs.writeFile(path.join(storage.rootDir, 'recent.txt'), 'bbbbb');
  await fs.writeFile(path.join(storage.rootDir, 'en-cours.part'), 'cc');

  const files = await storage.list();
  assert.deepEqual(files.map((f) => f.name), ['recent.txt', 'ancien.txt']);
  assert.equal(files[0].size, 5);
  assert.equal(files[1].id, encodeId('ancien.txt'));
});

test('resolve refuse un identifiant qui sort du dossier partage', async () => {
  const storage = await tempStorage();
  const evil = encodeId('../../evil.txt');
  assert.throws(() => storage.resolve(evil), (err) => err.code === 'EOUTSIDE');
});

test('resolve refuse un identifiant qui designe le dossier lui-meme', async () => {
  const storage = await tempStorage();
  assert.throws(() => storage.resolve(encodeId('.')), (err) => err.code === 'EOUTSIDE');
});

test('remove supprime le fichier', async () => {
  const storage = await tempStorage();
  await fs.writeFile(path.join(storage.rootDir, 'jetable.txt'), 'x');
  await storage.remove(encodeId('jetable.txt'));
  assert.deepEqual(await storage.list(), []);
});

test('removeAll vide le dossier et retourne le nombre de fichiers supprimes', async () => {
  const storage = await tempStorage();
  await fs.writeFile(path.join(storage.rootDir, 'a.txt'), 'a');
  await fs.writeFile(path.join(storage.rootDir, 'b.txt'), 'b');

  assert.equal(await storage.removeAll(), 2);
  assert.deepEqual(await storage.list(), []);
});

test('removeAll epargne les envois en cours', async () => {
  const storage = await tempStorage();
  await fs.writeFile(path.join(storage.rootDir, 'a.txt'), 'a');
  await fs.writeFile(path.join(storage.rootDir, 'en-cours.part'), 'x');

  assert.equal(await storage.removeAll(), 1);
  assert.deepEqual(await fs.readdir(storage.rootDir), ['en-cours.part']);
});

test('removeAll sur un dossier vide ne leve pas', async () => {
  const storage = await tempStorage();
  assert.equal(await storage.removeAll(), 0);
});
