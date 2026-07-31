# EasyTransfert — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un serveur Node local qui expose un dossier partagé aux deux appareils du réseau, joignable depuis un smartphone en scannant un QR code, sans rien installer sur le téléphone.

**Architecture:** Un unique processus Express écoutant sur `0.0.0.0:4455`. Il sert une page web responsive utilisée aussi bien par le PC que par le téléphone, reçoit les fichiers via `multer` en écriture disque directe, et les dépose dans `C:\Easytransfert\partage\`. L'accès est protégé par un token de session régénéré à chaque lancement et transporté par le QR code. Les modifications du dossier sont diffusées en SSE pour que les deux appareils voient la même liste en direct.

**Tech Stack:** Node.js 22 (ESM), Express, multer, qrcode. Tests avec `node:test`, `fetch`, `FormData` et `Blob` natifs — aucune dépendance de développement.

## Global Constraints

- **Node.js 22 minimum.** Le plan s'appuie sur `node:test`, `fetch`, `FormData`, `Blob` et `File` natifs. Version installée vérifiée : v22.19.0.
- **Exactement trois dépendances runtime :** `express`, `multer`, `qrcode`. Aucune dépendance de développement. Ne pas ajouter de framework front, de bundler ni de runner de test.
- **ESM.** `"type": "module"` dans `package.json`, `import`/`export` partout.
- **Port 4455**, écoute sur `0.0.0.0`.
- **Dossier partagé : `C:\Easytransfert\partage\`**, créé au démarrage s'il n'existe pas, ignoré par git.
- **Toute chaîne visible par l'utilisateur est en français**, accents inclus, dans l'interface comme dans les messages de la console.
- **Aucune requête sortante.** Pas de CDN, pas de police distante, pas de service tiers. Le CSS et le JS du front sont des fichiers locaux.
- **Pas de HTTPS.**
- Les messages de commit sont en français, préfixés `feat:`, `test:`, `fix:` ou `docs:`.

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `package.json` | manifeste, scripts `start` et `test` |
| `server.js` | point d'entrée : dossier, token, réseau, pare-feu, écoute, ouverture du navigateur |
| `src/app.js` | assemble l'application Express (sans l'écouter) |
| `src/storage.js` | dossier partagé : sanitisation, identifiants, listing, confinement, suppression |
| `src/network.js` | détection des adresses IPv4 LAN candidates |
| `src/security.js` | génération du token et middleware d'authentification |
| `src/events.js` | diffusion SSE vers les clients connectés |
| `src/routes.js` | routeur de l'API |
| `public/index.html` | interface unique |
| `public/style.css` | mise en forme, thème sombre, responsive |
| `public/app.js` | logique front : upload, liste, SSE, sélecteur d'IP |
| `easytransfert.bat` | lanceur double-clic |
| `setup-firewall.bat` | règle de pare-feu, à lancer une fois en administrateur |
| `test/*.test.js` | tests automatisés |

**Deux écarts assumés par rapport à la structure du spec**, tous deux au service de la testabilité et du principe « un fichier, une responsabilité » :

- `src/app.js` est ajouté pour que les tests puissent construire l'application et l'écouter sur un port éphémère sans passer par `server.js`, qui contient les effets de bord de démarrage.
- `src/events.js` est ajouté plutôt que de loger la diffusion SSE dans `src/routes.js`.

---

### Task 1 : Fondations du projet et module `storage`

Cette tâche installe le squelette du projet et livre le module le plus sensible du système : celui qui décide où les fichiers atterrissent et qui empêche un identifiant forgé de désigner un chemin hors du dossier partagé.

**Files:**
- Create: `package.json`
- Create: `src/storage.js`
- Test: `test/storage.test.js`

**Interfaces:**
- Consumes: rien (première tâche)
- Produces:
  - `sanitizeName(rawName: string): string`
  - `encodeId(name: string): string`
  - `decodeId(id: string): string`
  - `createStorage(rootDir: string): Storage`
  - `Storage` expose : `rootDir: string`, `ensureRoot(): Promise<void>`, `list(): Promise<Array<{id, name, size, mtime}>>`, `resolve(id: string): string` (synchrone, lève une erreur `code === 'EOUTSIDE'` si le chemin sort du dossier), `uniqueName(desired: string): Promise<string>`, `remove(id: string): Promise<void>`

- [ ] **Step 1 : Créer le manifeste et installer les dépendances**

Créer `package.json` :

```json
{
  "name": "easytransfert",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Transfert de fichiers entre PC et smartphone sur le reseau local, via QR code",
  "scripts": {
    "start": "node server.js",
    "test": "node --test test/"
  }
}
```

Puis, dans `C:\Easytransfert` :

```bash
npm install express multer qrcode
```

Ne pas figer les versions à la main : laisser npm inscrire les versions courantes dans `dependencies`. Vérifier ensuite qu'il n'y a que ces trois entrées et aucune `devDependencies`.

- [ ] **Step 2 : Écrire les tests de `storage` (ils doivent échouer)**

Créer `test/storage.test.js` :

```js
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
```

- [ ] **Step 3 : Lancer les tests pour vérifier qu'ils échouent**

```bash
node --test test/storage.test.js
```

Attendu : ÉCHEC — `Cannot find module '../src/storage.js'`.

- [ ] **Step 4 : Implémenter `src/storage.js`**

```js
import { promises as fs } from 'node:fs';
import path from 'node:path';

const CARACTERES_INTERDITS = /[<>:"/\\|?*\u0000-\u001f]/g;
const NOMS_RESERVES_WINDOWS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Ramene un nom fourni par un client a un nom de fichier sur, ecrivable sous Windows.
 * Ne retourne jamais une chaine vide.
 */
export function sanitizeName(rawName) {
  const base = path.basename(String(rawName ?? ''));
  // Windows refuse les noms se terminant par un point ou une espace.
  let propre = base.replace(CARACTERES_INTERDITS, '_').trim().replace(/[. ]+$/, '');
  if (propre === '') return 'fichier';
  if (NOMS_RESERVES_WINDOWS.test(path.parse(propre).name)) propre = `_${propre}`;
  return propre;
}

export function encodeId(name) {
  return Buffer.from(String(name), 'utf8').toString('base64url');
}

export function decodeId(id) {
  return Buffer.from(String(id), 'base64url').toString('utf8');
}

export function createStorage(rootDir) {
  const root = path.resolve(rootDir);

  async function ensureRoot() {
    await fs.mkdir(root, { recursive: true });
  }

  /**
   * Traduit un identifiant client en chemin absolu, en garantissant qu'il reste
   * dans le dossier partage. C'est la seule porte d'entree autorisee vers le disque.
   */
  function resolve(id) {
    const name = decodeId(id);
    const cible = path.resolve(root, name);
    const relatif = path.relative(root, cible);
    if (relatif === '' || relatif.startsWith('..') || path.isAbsolute(relatif)) {
      const err = new Error(`Chemin hors du dossier partagé : ${name}`);
      err.code = 'EOUTSIDE';
      throw err;
    }
    return cible;
  }

  async function existe(chemin) {
    try {
      await fs.access(chemin);
      return true;
    } catch {
      return false;
    }
  }

  async function uniqueName(desired) {
    const sur = sanitizeName(desired);
    const { name, ext } = path.parse(sur);
    let candidat = sur;
    let n = 0;
    while (await existe(path.join(root, candidat))) {
      n += 1;
      candidat = `${name} (${n})${ext}`;
    }
    return candidat;
  }

  async function list() {
    await ensureRoot();
    const entrees = await fs.readdir(root, { withFileTypes: true });
    const fichiers = [];
    for (const entree of entrees) {
      if (!entree.isFile() || entree.name.endsWith('.part')) continue;
      const stat = await fs.stat(path.join(root, entree.name));
      fichiers.push({
        id: encodeId(entree.name),
        name: entree.name,
        size: stat.size,
        mtime: stat.mtimeMs,
      });
    }
    fichiers.sort((a, b) => b.mtime - a.mtime);
    return fichiers;
  }

  async function remove(id) {
    await fs.rm(resolve(id));
  }

  return { rootDir: root, ensureRoot, list, resolve, uniqueName, remove };
}
```

- [ ] **Step 5 : Lancer les tests pour vérifier qu'ils passent**

```bash
node --test test/storage.test.js
```

Attendu : les 10 tests passent.

- [ ] **Step 6 : Commit**

```bash
git add package.json package-lock.json src/storage.js test/storage.test.js
git commit -m "feat: module storage avec sanitisation et confinement au dossier partage"
```

---

### Task 2 : Détection des adresses réseau

**Files:**
- Create: `src/network.js`
- Test: `test/network.test.js`

**Interfaces:**
- Consumes: rien
- Produces: `listCandidateAddresses(interfaces?: object): Array<{name: string, address: string}>` — la valeur par défaut du paramètre est `os.networkInterfaces()`. Le paramètre existe pour permettre l'injection dans les tests.

- [ ] **Step 1 : Écrire les tests (ils doivent échouer)**

Créer `test/network.test.js` :

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { listCandidateAddresses } from '../src/network.js';

const interfacesFictives = {
  'Loopback Pseudo-Interface 1': [
    { address: '127.0.0.1', family: 'IPv4', internal: true },
  ],
  'vEthernet (WSL)': [
    { address: '172.28.80.1', family: 'IPv4', internal: false },
  ],
  'VirtualBox Host-Only Network': [
    { address: '192.168.56.1', family: 'IPv4', internal: false },
  ],
  Ethernet: [
    { address: '192.168.1.42', family: 'IPv4', internal: false },
  ],
  'Wi-Fi': [
    { address: '192.168.1.20', family: 'IPv4', internal: false },
    { address: 'fe80::1', family: 'IPv6', internal: false },
  ],
};

test('ecarte le loopback, les interfaces virtuelles et l IPv6', () => {
  const adresses = listCandidateAddresses(interfacesFictives).map((c) => c.address);
  assert.deepEqual([...adresses].sort(), ['192.168.1.20', '192.168.1.42']);
});

test('place le Wi-Fi avant l Ethernet', () => {
  const candidats = listCandidateAddresses(interfacesFictives);
  assert.equal(candidats[0].address, '192.168.1.20');
  assert.equal(candidats[0].name, 'Wi-Fi');
});

test('retourne une liste vide sans lever quand rien ne convient', () => {
  const seulementLoopback = {
    'Loopback Pseudo-Interface 1': [
      { address: '127.0.0.1', family: 'IPv4', internal: true },
    ],
  };
  assert.deepEqual(listCandidateAddresses(seulementLoopback), []);
});

test('conserve une interface au nom inconnu plutot que de la jeter', () => {
  const inconnue = {
    'Carte reseau 3': [{ address: '10.0.0.5', family: 'IPv4', internal: false }],
  };
  assert.deepEqual(listCandidateAddresses(inconnue), [
    { name: 'Carte reseau 3', address: '10.0.0.5' },
  ]);
});
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

```bash
node --test test/network.test.js
```

Attendu : ÉCHEC — `Cannot find module '../src/network.js'`.

- [ ] **Step 3 : Implémenter `src/network.js`**

```js
import os from 'node:os';

// Interfaces creees par les hyperviseurs et les VPN : joignables depuis le PC,
// mais jamais depuis le telephone.
const INTERFACES_VIRTUELLES = /vethernet|virtualbox|vmware|hyper-v|wsl|loopback|docker|tailscale|zerotier/i;

// Une interface dont le nom evoque une carte physique est le candidat le plus probable.
const INTERFACES_PHYSIQUES = /wi-?fi|wireless|sans fil|ethernet/i;

function score(nom) {
  if (/wi-?fi|wireless|sans fil/i.test(nom)) return 0;
  if (INTERFACES_PHYSIQUES.test(nom)) return 1;
  return 2;
}

/**
 * Retourne les adresses IPv4 du reseau local utilisables pour joindre ce PC,
 * de la plus probable a la moins probable.
 *
 * Aucune heuristique n'etant fiable sur toutes les configurations Windows,
 * l'interface web laisse l'utilisateur choisir dans cette liste.
 */
export function listCandidateAddresses(interfaces = os.networkInterfaces()) {
  const candidats = [];
  for (const [nom, adresses] of Object.entries(interfaces)) {
    if (!adresses || INTERFACES_VIRTUELLES.test(nom)) continue;
    for (const adresse of adresses) {
      if (adresse.family !== 'IPv4' || adresse.internal) continue;
      candidats.push({ name: nom, address: adresse.address });
    }
  }
  candidats.sort((a, b) => score(a.name) - score(b.name));
  return candidats;
}
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

```bash
node --test test/network.test.js
```

Attendu : les 4 tests passent.

- [ ] **Step 5 : Vérifier le comportement sur la vraie machine**

```bash
node -e "import('./src/network.js').then(m => console.log(m.listCandidateAddresses()))"
```

Attendu : au moins une adresse en `192.168.x.x` ou `10.x.x.x` correspondant au Wi-Fi ou à l'Ethernet du PC, et aucune adresse d'une carte virtuelle. Si une carte virtuelle survit, ajouter son motif à `INTERFACES_VIRTUELLES` et ajouter un cas au fichier de tests.

- [ ] **Step 6 : Commit**

```bash
git add src/network.js test/network.test.js
git commit -m "feat: detection des adresses IPv4 du reseau local"
```

---

### Task 3 : Token de session et middleware d'authentification

**Files:**
- Create: `src/security.js`
- Test: `test/security.test.js`

**Interfaces:**
- Consumes: rien
- Produces:
  - `createToken(): string` — 32 caractères hexadécimaux
  - `extractToken(req): string | undefined` — lit `X-Transfer-Token` puis, à défaut, `req.query.t`
  - `createAuthMiddleware(token: string): (req, res, next) => void` — répond `401 { error: 'Token invalide ou absent' }` si le token ne correspond pas

- [ ] **Step 1 : Écrire les tests (ils doivent échouer)**

Créer `test/security.test.js` :

```js
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
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

```bash
node --test test/security.test.js
```

Attendu : ÉCHEC — `Cannot find module '../src/security.js'`.

- [ ] **Step 3 : Implémenter `src/security.js`**

```js
import crypto from 'node:crypto';

export function createToken() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Le token arrive en en-tete pour les appels fetch et XHR, et en parametre d'URL
 * pour les acces que le navigateur declenche lui-meme : EventSource (SSE) et les
 * liens de telechargement, qui n'acceptent aucun en-tete personnalise.
 */
export function extractToken(req) {
  return req.get('X-Transfer-Token') || req.query?.t || undefined;
}

function egaliteConstante(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  // timingSafeEqual leve si les longueurs different : on tranche avant.
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function createAuthMiddleware(token) {
  return function verifierToken(req, res, next) {
    const fourni = extractToken(req);
    if (!fourni || !egaliteConstante(fourni, token)) {
      res.status(401).json({ error: 'Token invalide ou absent' });
      return;
    }
    next();
  };
}
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

```bash
node --test test/security.test.js
```

Attendu : les 4 tests passent.

- [ ] **Step 5 : Commit**

```bash
git add src/security.js test/security.test.js
git commit -m "feat: token de session et middleware d authentification"
```

---

### Task 4 : API des fichiers (liste, envoi, téléchargement, suppression)

Le cœur fonctionnel. À la fin de cette tâche, les transferts fonctionnent réellement — testables avec `curl` — même s'il n'y a encore ni interface ni QR code.

**Files:**
- Create: `src/routes.js`
- Create: `src/app.js`
- Test: `test/routes.test.js`

**Interfaces:**
- Consumes: `createStorage` (Task 1), `createAuthMiddleware` (Task 3)
- Produces:
  - `createApiRouter({ storage }): express.Router` — le paramètre est un objet ; les tâches suivantes lui ajouteront les clés `events` puis `network`
  - `createApp({ storage, token }): express.Application` — application Express complète, non démarrée. Les tâches suivantes ajouteront les mêmes clés.

- [ ] **Step 1 : Écrire les tests (ils doivent échouer)**

Créer `test/routes.test.js` :

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createApp } from '../src/app.js';
import { createStorage, encodeId } from '../src/storage.js';

const TOKEN = 'a'.repeat(32);

/** Demarre l'application sur un port ephemere et retourne de quoi la piloter. */
async function demarrer() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'easytransfert-routes-'));
  const storage = createStorage(dir);
  await storage.ensureRoot();

  const app = createApp({ storage, token: TOKEN });
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
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

```bash
node --test test/routes.test.js
```

Attendu : ÉCHEC — `Cannot find module '../src/app.js'`.

- [ ] **Step 3 : Implémenter `src/routes.js`**

```js
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import express from 'express';
import multer from 'multer';

const TAILLE_MAX_OCTETS = 2 * 1024 * 1024 * 1024;
const FICHIERS_MAX_PAR_ENVOI = 50;

/**
 * Busboy decode les noms de fichiers en latin1. Un nom accentue arrive donc
 * sous forme de mojibake ; on le reinterprete en UTF-8 quand c'est valide.
 */
function corrigerEncodage(nom) {
  if (!/[\u00c0-\u00ff]/.test(nom)) return nom;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(nom, 'latin1'));
  } catch {
    return nom;
  }
}

function statutDepuisErreur(err) {
  if (err.code === 'EOUTSIDE') return 403;
  if (err.code === 'ENOENT') return 404;
  return 500;
}

export function createApiRouter({ storage }) {
  const router = express.Router();

  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, storage.rootDir),
      // On ecrit sous un nom temporaire : un envoi interrompu ne laisse
      // jamais un fichier tronque portant le nom definitif.
      filename: (req, file, cb) => cb(null, `${randomUUID()}.part`),
    }),
    limits: { fileSize: TAILLE_MAX_OCTETS, files: FICHIERS_MAX_PAR_ENVOI },
  });

  router.get('/files', async (req, res) => {
    res.json(await storage.list());
  });

  router.post('/upload', upload.array('files', FICHIERS_MAX_PAR_ENVOI), async (req, res) => {
    const recus = req.files ?? [];
    const enregistres = [];
    try {
      for (const fichier of recus) {
        const nomFinal = await storage.uniqueName(corrigerEncodage(fichier.originalname));
        await fs.rename(fichier.path, path.join(storage.rootDir, nomFinal));
        enregistres.push(nomFinal);
      }
    } catch (err) {
      // Ne rien laisser trainer : les .part encore presents sont supprimes.
      await Promise.all(recus.map((f) => fs.rm(f.path, { force: true })));
      res.status(500).json({ error: `Enregistrement impossible : ${err.message}` });
      return;
    }
    res.json({ saved: enregistres });
  });

  router.get('/download/:id', async (req, res) => {
    let chemin;
    try {
      chemin = storage.resolve(req.params.id);
    } catch (err) {
      res.status(statutDepuisErreur(err)).json({ error: err.message });
      return;
    }
    try {
      await fs.access(chemin);
    } catch {
      res.status(404).json({ error: 'Fichier introuvable' });
      return;
    }
    res.download(chemin, path.basename(chemin));
  });

  router.delete('/files/:id', async (req, res) => {
    try {
      await storage.remove(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(statutDepuisErreur(err)).json({ error: err.message });
    }
  });

  return router;
}
```

- [ ] **Step 4 : Implémenter `src/app.js`**

```js
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { createAuthMiddleware } from './security.js';
import { createApiRouter } from './routes.js';

const RACINE = path.dirname(fileURLToPath(import.meta.url));
const DOSSIER_PUBLIC = path.join(RACINE, '..', 'public');

/**
 * Assemble l'application sans la demarrer, pour que les tests puissent
 * l'ecouter sur un port ephemere.
 */
export function createApp({ storage, token }) {
  const app = express();

  app.use('/api', createAuthMiddleware(token), createApiRouter({ storage }));
  app.use(express.static(DOSSIER_PUBLIC));

  return app;
}
```

- [ ] **Step 5 : Lancer toute la suite de tests**

```bash
npm test
```

Attendu : les tests de `storage`, `network`, `security` et `routes` passent tous.

- [ ] **Step 6 : Commit**

```bash
git add src/routes.js src/app.js test/routes.test.js
git commit -m "feat: API de liste, envoi, telechargement et suppression des fichiers"
```

---

### Task 5 : Diffusion des changements en SSE

Sans cette tâche, un fichier envoyé depuis le téléphone n'apparaît sur l'écran du PC qu'après un rechargement manuel.

**Files:**
- Create: `src/events.js`
- Modify: `src/routes.js` (signature de `createApiRouter`, ajout de la route `/events`, émissions après envoi et suppression)
- Modify: `src/app.js` (signature de `createApp`)
- Test: `test/events.test.js`

**Interfaces:**
- Consumes: `createApiRouter` (Task 4)
- Produces:
  - `createEventHub(): EventHub` avec `subscribe(res): void`, `broadcast(type: string): void`, `count: number` (getter)
  - `createApiRouter({ storage, events })` et `createApp({ storage, token, events })` — la clé `events` est **obligatoire** à partir d'ici ; mettre à jour les appels existants dans `test/routes.test.js`.

- [ ] **Step 1 : Écrire les tests de `events` (ils doivent échouer)**

Créer `test/events.test.js` :

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createEventHub } from '../src/events.js';

/** Imite juste ce que le hub utilise d'une reponse Express. */
function fausseReponse() {
  const res = new EventEmitter();
  res.ecrit = [];
  res.entetes = null;
  res.writeHead = (code, entetes) => { res.entetes = entetes; return res; };
  res.write = (chunk) => { res.ecrit.push(chunk); return true; };
  res.flushHeaders = () => {};
  return res;
}

test('subscribe ouvre un flux SSE et compte l abonne', () => {
  const hub = createEventHub();
  const res = fausseReponse();
  hub.subscribe(res);

  assert.equal(hub.count, 1);
  assert.equal(res.entetes['Content-Type'], 'text/event-stream');
});

test('broadcast envoie a tous les abonnes au format SSE', () => {
  const hub = createEventHub();
  const a = fausseReponse();
  const b = fausseReponse();
  hub.subscribe(a);
  hub.subscribe(b);

  hub.broadcast('files-changed');

  assert.equal(a.ecrit.at(-1), 'data: {"type":"files-changed"}\n\n');
  assert.equal(b.ecrit.at(-1), 'data: {"type":"files-changed"}\n\n');
});

test('un abonne deconnecte est oublie', () => {
  const hub = createEventHub();
  const res = fausseReponse();
  hub.subscribe(res);
  res.emit('close');

  assert.equal(hub.count, 0);
  hub.broadcast('files-changed'); // ne doit pas lever
});
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

```bash
node --test test/events.test.js
```

Attendu : ÉCHEC — `Cannot find module '../src/events.js'`.

- [ ] **Step 3 : Implémenter `src/events.js`**

```js
/**
 * Diffuse les changements du dossier partage vers tous les navigateurs connectes,
 * pour que le PC et le telephone affichent la meme liste sans rechargement.
 */
export function createEventHub() {
  const abonnes = new Set();

  function subscribe(res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      // Neutralise la mise en tampon d'un eventuel proxy.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    abonnes.add(res);
    res.on('close', () => abonnes.delete(res));
  }

  function broadcast(type) {
    const message = `data: ${JSON.stringify({ type })}\n\n`;
    for (const res of abonnes) res.write(message);
  }

  return {
    subscribe,
    broadcast,
    get count() {
      return abonnes.size;
    },
  };
}
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

```bash
node --test test/events.test.js
```

Attendu : les 3 tests passent.

- [ ] **Step 5 : Brancher le hub sur le routeur**

Dans `src/routes.js`, remplacer la signature et la ligne d'ouverture de `createApiRouter` :

```js
export function createApiRouter({ storage, events }) {
```

Ajouter la route SSE juste après `router.get('/files', ...)` :

```js
  router.get('/events', (req, res) => {
    events.subscribe(res);
  });
```

Dans le gestionnaire `/upload`, juste avant `res.json({ saved: enregistres });` :

```js
    events.broadcast('files-changed');
```

Dans le gestionnaire `/files/:id` en DELETE, juste avant `res.json({ ok: true });` :

```js
      events.broadcast('files-changed');
```

- [ ] **Step 6 : Propager la signature dans `app.js` et dans les tests existants**

Dans `src/app.js` :

```js
export function createApp({ storage, token, events }) {
  const app = express();

  app.use('/api', createAuthMiddleware(token), createApiRouter({ storage, events }));
  app.use(express.static(DOSSIER_PUBLIC));

  return app;
}
```

Dans `test/routes.test.js`, ajouter l'import et passer le hub :

```js
import { createEventHub } from '../src/events.js';
```

```js
  const app = createApp({ storage, token: TOKEN, events: createEventHub() });
```

- [ ] **Step 7 : Lancer toute la suite de tests**

```bash
npm test
```

Attendu : tout passe. Si `routes.test.js` échoue avec `Cannot read properties of undefined (reading 'broadcast')`, c'est que le hub n'a pas été passé à `createApp` — corriger le Step 6.

- [ ] **Step 8 : Commit**

```bash
git add src/events.js src/routes.js src/app.js test/events.test.js test/routes.test.js
git commit -m "feat: diffusion SSE des changements du dossier partage"
```

---

### Task 6 : QR code et sélecteur d'adresse

**Files:**
- Modify: `src/routes.js` (signature, routes `/network`)
- Modify: `src/app.js` (signature)
- Test: `test/network-routes.test.js`

**Interfaces:**
- Consumes: `listCandidateAddresses` (Task 2), `createApiRouter` (Task 5)
- Produces:
  - `createApiRouter({ storage, events, network })` et `createApp({ storage, token, events, network })`
  - `network` est un objet mutable `{ candidates: Array<{name, address}>, active: string, port: number, token: string }` construit par `server.js` (Task 8) et par les tests
  - `GET /api/network` → `{ candidates, active, url, qr }` où `url` est l'URL complète avec token et `qr` une image PNG en data URL
  - `POST /api/network` avec `{ address }` → même charge utile recalculée ; répond `400 { error: 'Adresse inconnue' }` si l'adresse n'est pas dans `candidates`

- [ ] **Step 1 : Écrire les tests (ils doivent échouer)**

Créer `test/network-routes.test.js` :

```js
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

  const app = createApp({ storage, token: TOKEN, events: createEventHub(), network });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    network,
    api: (chemin, options = {}) =>
      fetch(`${base}${chemin}`, {
        ...options,
        headers: { 'X-Transfer-Token': TOKEN, ...(options.headers ?? {}) },
      }),
    fermer: () => new Promise((r) => server.close(r)),
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
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

```bash
node --test test/network-routes.test.js
```

Attendu : ÉCHEC — `network` n'est pas exploité, `/api/network` renvoie 404.

- [ ] **Step 3 : Implémenter les routes réseau**

Dans `src/routes.js`, ajouter l'import en tête de fichier :

```js
import QRCode from 'qrcode';
```

Changer la signature :

```js
export function createApiRouter({ storage, events, network }) {
```

Ajouter, avant le `return router;` :

```js
  async function etatReseau() {
    const url = `http://${network.active}:${network.port}/?t=${network.token}`;
    return {
      candidates: network.candidates,
      active: network.active,
      url,
      qr: await QRCode.toDataURL(url, { width: 320, margin: 1 }),
    };
  }

  router.get('/network', async (req, res) => {
    res.json(await etatReseau());
  });

  router.post('/network', async (req, res) => {
    const demandee = req.body?.address;
    if (!network.candidates.some((c) => c.address === demandee)) {
      res.status(400).json({ error: 'Adresse inconnue' });
      return;
    }
    network.active = demandee;
    res.json(await etatReseau());
  });
```

- [ ] **Step 4 : Propager la signature et activer le parsing JSON dans `app.js`**

```js
export function createApp({ storage, token, events, network }) {
  const app = express();

  app.use(express.json());
  app.use('/api', createAuthMiddleware(token), createApiRouter({ storage, events, network }));
  app.use(express.static(DOSSIER_PUBLIC));

  return app;
}
```

Dans `test/routes.test.js`, ajouter un `network` minimal à l'appel de `createApp` pour que la signature reste satisfaite :

```js
  const app = createApp({
    storage,
    token: TOKEN,
    events: createEventHub(),
    network: { candidates: [], active: '127.0.0.1', port: 4455, token: TOKEN },
  });
```

- [ ] **Step 5 : Lancer toute la suite de tests**

```bash
npm test
```

Attendu : tout passe.

- [ ] **Step 6 : Commit**

```bash
git add src/routes.js src/app.js test/network-routes.test.js test/routes.test.js
git commit -m "feat: QR code et selecteur d adresse reseau"
```

---

### Task 7 : Interface web

Une seule page servie aux deux appareils. Le CSS masque le bloc QR et le sélecteur d'IP sur écran étroit : ils n'ont aucun sens sur le téléphone qui vient de scanner.

**Files:**
- Create: `public/index.html`
- Create: `public/style.css`
- Create: `public/app.js`

**Interfaces:**
- Consumes: toutes les routes de l'API (Tasks 4, 5, 6)
- Produces: rien pour les tâches suivantes

- [ ] **Step 1 : Créer `public/index.html`**

```html
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>EasyTransfert</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <header>
      <h1>EasyTransfert</h1>
      <p id="etat" class="etat">Connexion…</p>
    </header>

    <main>
      <section id="bloc-qr" class="carte pc-seulement">
        <h2>Scanner depuis le téléphone</h2>
        <img id="qr" alt="QR code d'accès" />
        <p id="url" class="url"></p>
        <label for="selecteur-ip">Adresse du PC</label>
        <select id="selecteur-ip"></select>
        <p class="aide">
          Si le téléphone n'arrive pas à ouvrir la page, essayez une autre adresse.
        </p>
      </section>

      <section class="carte">
        <div id="zone-depot" class="zone-depot">
          <p class="pc-seulement">Glissez vos fichiers ici</p>
          <button id="bouton-parcourir" type="button">Envoyer des fichiers</button>
          <input id="champ-fichiers" type="file" multiple hidden />
        </div>

        <div id="progression" class="progression" hidden>
          <div id="barre" class="barre"></div>
          <span id="texte-progression"></span>
        </div>

        <h2>Fichiers partagés</h2>
        <ul id="liste" class="liste"></ul>
        <p id="liste-vide" class="aide">Aucun fichier pour l'instant.</p>
      </section>
    </main>

    <script src="/app.js" type="module"></script>
  </body>
</html>
```

- [ ] **Step 2 : Créer `public/style.css`**

```css
:root {
  --fond: #14161a;
  --carte: #1e2128;
  --bordure: #2e323c;
  --texte: #e8eaed;
  --attenue: #9aa0aa;
  --accent: #4f9cf9;
  --danger: #f2555a;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 1rem;
  background: var(--fond);
  color: var(--texte);
  font-family: "Segoe UI", system-ui, sans-serif;
  line-height: 1.5;
}

header { margin-bottom: 1rem; }
h1 { margin: 0; font-size: 1.4rem; }
h2 { margin: 0 0 0.75rem; font-size: 1rem; color: var(--attenue); font-weight: 600; }

.etat { margin: 0.25rem 0 0; color: var(--attenue); font-size: 0.85rem; }
.etat.hors-ligne { color: var(--danger); }

main {
  display: grid;
  gap: 1rem;
  grid-template-columns: 1fr;
  max-width: 1100px;
}

@media (min-width: 900px) {
  main { grid-template-columns: 340px 1fr; align-items: start; }
}

.carte {
  background: var(--carte);
  border: 1px solid var(--bordure);
  border-radius: 12px;
  padding: 1rem;
}

#qr {
  display: block;
  width: 100%;
  max-width: 280px;
  margin: 0 auto 0.75rem;
  border-radius: 8px;
  background: #fff;
}

.url {
  font-family: Consolas, monospace;
  font-size: 0.75rem;
  color: var(--attenue);
  word-break: break-all;
  margin: 0 0 0.75rem;
}

label { display: block; font-size: 0.8rem; color: var(--attenue); margin-bottom: 0.25rem; }

select {
  width: 100%;
  padding: 0.5rem;
  background: var(--fond);
  color: var(--texte);
  border: 1px solid var(--bordure);
  border-radius: 6px;
}

.aide { font-size: 0.8rem; color: var(--attenue); }

.zone-depot {
  border: 2px dashed var(--bordure);
  border-radius: 10px;
  padding: 1.5rem 1rem;
  text-align: center;
  margin-bottom: 1rem;
  transition: border-color 0.15s, background 0.15s;
}

.zone-depot.survol { border-color: var(--accent); background: rgba(79, 156, 249, 0.08); }

button {
  background: var(--accent);
  color: #08121f;
  border: 0;
  border-radius: 8px;
  padding: 0.65rem 1.2rem;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  width: 100%;
}

@media (min-width: 900px) { button { width: auto; } }

.progression { margin-bottom: 1rem; font-size: 0.85rem; color: var(--attenue); }

.barre {
  height: 6px;
  width: 0%;
  background: var(--accent);
  border-radius: 3px;
  margin-bottom: 0.35rem;
  transition: width 0.1s linear;
}

.liste { list-style: none; margin: 0; padding: 0; }

.liste li {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0;
  border-bottom: 1px solid var(--bordure);
}

.liste li:last-child { border-bottom: 0; }

.nom { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.meta { display: block; font-size: 0.75rem; color: var(--attenue); }

.liste a {
  color: var(--accent);
  text-decoration: none;
  font-size: 0.85rem;
  white-space: nowrap;
}

.supprimer {
  background: none;
  color: var(--danger);
  border: 1px solid var(--bordure);
  border-radius: 6px;
  padding: 0.3rem 0.6rem;
  font-size: 0.8rem;
  width: auto;
}

/* Sur telephone, le QR et le selecteur d'IP n'ont aucun sens : l'appareil vient de scanner. */
@media (max-width: 720px) {
  .pc-seulement { display: none; }
}
```

- [ ] **Step 3 : Créer `public/app.js`**

```js
const params = new URLSearchParams(location.search);
const token = params.get('t') || sessionStorage.getItem('easytransfert-token');

if (params.get('t')) {
  sessionStorage.setItem('easytransfert-token', params.get('t'));
  // On retire le token de la barre d'adresse : il reste en sessionStorage.
  history.replaceState({}, '', location.pathname);
}

const etat = document.querySelector('#etat');
const liste = document.querySelector('#liste');
const listeVide = document.querySelector('#liste-vide');
const zoneDepot = document.querySelector('#zone-depot');
const champFichiers = document.querySelector('#champ-fichiers');
const boutonParcourir = document.querySelector('#bouton-parcourir');
const progression = document.querySelector('#progression');
const barre = document.querySelector('#barre');
const texteProgression = document.querySelector('#texte-progression');
const blocQr = document.querySelector('#bloc-qr');
const imageQr = document.querySelector('#qr');
const champUrl = document.querySelector('#url');
const selecteurIp = document.querySelector('#selecteur-ip');

function afficherEtat(message, horsLigne = false) {
  etat.textContent = message;
  etat.classList.toggle('hors-ligne', horsLigne);
}

if (!token) {
  afficherEtat('Aucun jeton d\u2019accès : rescannez le QR code depuis le PC.', true);
  throw new Error('token absent');
}

function api(chemin, options = {}) {
  return fetch(chemin, {
    ...options,
    headers: { 'X-Transfer-Token': token, ...(options.headers ?? {}) },
  });
}

function tailleLisible(octets) {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(1)} Ko`;
  if (octets < 1024 * 1024 * 1024) return `${(octets / 1024 / 1024).toFixed(1)} Mo`;
  return `${(octets / 1024 / 1024 / 1024).toFixed(2)} Go`;
}

function heureLisible(mtime) {
  return new Date(mtime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

async function rafraichirListe() {
  const reponse = await api('/api/files');
  if (!reponse.ok) {
    afficherEtat('Impossible de lire la liste des fichiers.', true);
    return;
  }
  const fichiers = await reponse.json();

  liste.replaceChildren();
  listeVide.hidden = fichiers.length > 0;

  for (const fichier of fichiers) {
    const li = document.createElement('li');

    const nom = document.createElement('span');
    nom.className = 'nom';
    nom.textContent = fichier.name;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${tailleLisible(fichier.size)} — ${heureLisible(fichier.mtime)}`;
    nom.append(meta);

    const lien = document.createElement('a');
    lien.href = `/api/download/${fichier.id}?t=${encodeURIComponent(token)}`;
    lien.textContent = 'Télécharger';
    lien.setAttribute('download', fichier.name);

    const supprimer = document.createElement('button');
    supprimer.className = 'supprimer';
    supprimer.type = 'button';
    supprimer.textContent = 'Supprimer';
    supprimer.addEventListener('click', async () => {
      supprimer.disabled = true;
      await api(`/api/files/${fichier.id}`, { method: 'DELETE' });
      await rafraichirListe();
    });

    li.append(nom, lien, supprimer);
    liste.append(li);
  }
}

function envoyer(fichiers) {
  if (!fichiers || fichiers.length === 0) return;

  const formulaire = new FormData();
  for (const fichier of fichiers) formulaire.append('files', fichier);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload');
  xhr.setRequestHeader('X-Transfer-Token', token);

  progression.hidden = false;
  barre.style.width = '0%';
  texteProgression.textContent = `Envoi de ${fichiers.length} fichier(s)…`;

  xhr.upload.addEventListener('progress', (evenement) => {
    if (!evenement.lengthComputable) return;
    const pourcent = Math.round((evenement.loaded / evenement.total) * 100);
    barre.style.width = `${pourcent}%`;
    texteProgression.textContent =
      `${pourcent} % — ${tailleLisible(evenement.loaded)} / ${tailleLisible(evenement.total)}`;
  });

  xhr.addEventListener('load', () => {
    progression.hidden = true;
    if (xhr.status === 200) {
      afficherEtat('Envoi terminé.');
      rafraichirListe();
    } else {
      afficherEtat(`Échec de l'envoi (code ${xhr.status}).`, true);
    }
  });

  xhr.addEventListener('error', () => {
    progression.hidden = true;
    afficherEtat('Échec de l\u2019envoi : connexion interrompue.', true);
  });

  xhr.send(formulaire);
}

boutonParcourir.addEventListener('click', () => champFichiers.click());
champFichiers.addEventListener('change', () => {
  envoyer(champFichiers.files);
  champFichiers.value = '';
});

for (const evenement of ['dragenter', 'dragover']) {
  zoneDepot.addEventListener(evenement, (e) => {
    e.preventDefault();
    zoneDepot.classList.add('survol');
  });
}
for (const evenement of ['dragleave', 'drop']) {
  zoneDepot.addEventListener(evenement, (e) => {
    e.preventDefault();
    zoneDepot.classList.remove('survol');
  });
}
zoneDepot.addEventListener('drop', (e) => envoyer(e.dataTransfer.files));

async function chargerReseau(etatReseau) {
  const donnees = etatReseau ?? (await (await api('/api/network')).json());
  imageQr.src = donnees.qr;
  champUrl.textContent = donnees.url;

  selecteurIp.replaceChildren();
  for (const candidat of donnees.candidates) {
    const option = document.createElement('option');
    option.value = candidat.address;
    option.textContent = `${candidat.address} (${candidat.name})`;
    option.selected = candidat.address === donnees.active;
    selecteurIp.append(option);
  }
  blocQr.hidden = donnees.candidates.length === 0;
}

selecteurIp.addEventListener('change', async () => {
  const reponse = await api('/api/network', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: selecteurIp.value }),
  });
  if (reponse.ok) await chargerReseau(await reponse.json());
});

function ecouterEvenements() {
  const source = new EventSource(`/api/events?t=${encodeURIComponent(token)}`);
  source.addEventListener('open', () => afficherEtat('Connecté.'));
  source.addEventListener('message', (evenement) => {
    if (JSON.parse(evenement.data).type === 'files-changed') rafraichirListe();
  });
  source.addEventListener('error', () => {
    afficherEtat('Connexion perdue, nouvelle tentative…', true);
    // EventSource se reconnecte seul ; on se contente de le signaler.
  });
}

await chargerReseau();
await rafraichirListe();
ecouterEvenements();
```

- [ ] **Step 4 : Vérifier l'interface dans le navigateur du PC**

`server.js` n'existe pas encore (Task 8). Créer un lanceur jetable `dev-preview.mjs`
à la racine du projet :

```js
import { createApp } from './src/app.js';
import { createStorage } from './src/storage.js';
import { createEventHub } from './src/events.js';
import { listCandidateAddresses } from './src/network.js';

const storage = createStorage('./partage');
await storage.ensureRoot();

const candidates = listCandidateAddresses();
const token = 'c'.repeat(32);
const network = {
  candidates,
  active: candidates[0]?.address ?? '127.0.0.1',
  port: 4455,
  token,
};

createApp({ storage, token, events: createEventHub(), network })
  .listen(4455, '0.0.0.0', () => console.log(`http://127.0.0.1:4455/?t=${token}`));
```

Le lancer :

```bash
node dev-preview.mjs
```

Ouvrir l'URL affichée dans le navigateur et vérifier :
- le QR code s'affiche et le sélecteur d'IP liste les adresses ;
- un glisser-déposer envoie le fichier et la barre de progression bouge ;
- le fichier apparaît dans la liste avec sa taille et son heure ;
- le lien « Télécharger » restitue le fichier ;
- « Supprimer » le retire ;
- en réduisant la fenêtre sous 720 px de large, le bloc QR disparaît.

Arrêter le serveur avec Ctrl+C, puis supprimer le lanceur jetable :

```bash
rm dev-preview.mjs
```

- [ ] **Step 5 : Commit**

```bash
git add public/index.html public/style.css public/app.js
git commit -m "feat: interface web responsive commune au PC et au telephone"
```

---

### Task 8 : Démarrage, pare-feu et lanceurs

Dernière tâche : `server.js` assemble tout, avertit si le pare-feu bloque, et ouvre le navigateur. Les deux `.bat` rendent l'outil utilisable au double-clic.

**Files:**
- Create: `server.js`
- Create: `easytransfert.bat`
- Create: `setup-firewall.bat`
- Create: `README.md`

**Interfaces:**
- Consumes: `createApp` (Task 6), `createStorage` (Task 1), `createEventHub` (Task 5), `listCandidateAddresses` (Task 2), `createToken` (Task 3)
- Produces: rien

- [ ] **Step 1 : Créer `server.js`**

```js
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

import { createApp } from './src/app.js';
import { createStorage } from './src/storage.js';
import { createEventHub } from './src/events.js';
import { createToken } from './src/security.js';
import { listCandidateAddresses } from './src/network.js';

const PORT = 4455;
const NOM_REGLE_PARE_FEU = 'EasyTransfert';
const RACINE = path.dirname(fileURLToPath(import.meta.url));
const DOSSIER_PARTAGE = path.join(RACINE, 'partage');

function commande(binaire, args) {
  return new Promise((resolve) => {
    execFile(binaire, args, (err, stdout) => resolve({ ok: !err, stdout: stdout ?? '' }));
  });
}

async function regleParFeuPresente() {
  const { ok } = await commande('netsh', [
    'advfirewall', 'firewall', 'show', 'rule', `name=${NOM_REGLE_PARE_FEU}`,
  ]);
  return ok;
}

function ouvrirNavigateur(url) {
  // Le premier argument vide de "start" est le titre de fenetre, obligatoire ici.
  execFile('cmd', ['/c', 'start', '', url]);
}

async function demarrer() {
  const storage = createStorage(DOSSIER_PARTAGE);
  await storage.ensureRoot();

  const candidates = listCandidateAddresses();
  if (candidates.length === 0) {
    console.error(
      'Aucune adresse réseau locale détectée. Vérifiez que le PC est bien connecté au Wi-Fi ou en Ethernet.',
    );
    process.exit(1);
  }

  const token = createToken();
  const network = { candidates, active: candidates[0].address, port: PORT, token };
  const app = createApp({ storage, token, events: createEventHub(), network });

  const server = app.listen(PORT, '0.0.0.0');

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `Le port ${PORT} est déjà utilisé. Fermez l'autre instance d'EasyTransfert, ou changez PORT dans server.js.`,
      );
    } else {
      console.error(`Démarrage impossible : ${err.message}`);
    }
    process.exit(1);
  });

  server.on('listening', async () => {
    const url = `http://${network.active}:${PORT}/?t=${token}`;

    console.log('EasyTransfert est démarré.');
    console.log(`  Dossier partagé : ${storage.rootDir}`);
    console.log(`  Adresse         : ${url}`);
    console.log('  Arrêt           : Ctrl+C');

    if (!(await regleParFeuPresente())) {
      console.warn('');
      console.warn(
        `Le pare-feu Windows n'a pas de règle "${NOM_REGLE_PARE_FEU}" : le téléphone ne pourra sans doute pas`,
      );
      console.warn(
        '  se connecter. Faites un clic droit sur setup-firewall.bat > "Exécuter en tant qu\'administrateur",',
      );
      console.warn('  une seule fois, puis relancez EasyTransfert.');
      console.warn('');
    }

    ouvrirNavigateur(url);
  });
}

demarrer();
```

- [ ] **Step 2 : Créer `setup-firewall.bat`**

```bat
@echo off
chcp 65001 >nul
echo Ajout de la regle de pare-feu EasyTransfert (port 4455, profil prive uniquement).
netsh advfirewall firewall delete rule name="EasyTransfert" >nul 2>&1
netsh advfirewall firewall add rule name="EasyTransfert" dir=in action=allow protocol=TCP localport=4455 profile=private
if %errorlevel% neq 0 (
  echo.
  echo Echec. Ce script doit etre lance en tant qu'administrateur :
  echo clic droit sur setup-firewall.bat, puis "Executer en tant qu'administrateur".
) else (
  echo.
  echo Regle ajoutee. Vous pouvez lancer easytransfert.bat.
)
pause
```

- [ ] **Step 3 : Créer `easytransfert.bat`**

```bat
@echo off
chcp 65001 >nul
cd /d "%~dp0"
node server.js
pause
```

- [ ] **Step 4 : Vérifier le démarrage et le pare-feu**

Lancer d'abord `setup-firewall.bat` par clic droit → « Exécuter en tant qu'administrateur ». Attendu : « Regle ajoutee ».

Puis, dans un terminal :

```bash
npm start
```

Attendu : la console affiche le dossier partagé et l'URL, aucun avertissement de pare-feu, et le navigateur s'ouvre sur l'interface avec le QR code.

Relancer `npm start` dans un second terminal pendant que le premier tourne. Attendu : le message « Le port 4455 est déjà utilisé. » et un arrêt propre, sans trace d'exception.

- [ ] **Step 5 : Vérifier le transfert réel avec le téléphone**

Avec le PC et le Honor Magic 6 Pro sur le même Wi-Fi, EasyTransfert démarré :

1. Scanner le QR code avec l'appareil photo du téléphone et ouvrir le lien.
2. Vérifier que l'interface s'affiche sans le bloc QR ni le sélecteur d'IP.
3. Depuis le téléphone, envoyer une photo. Vérifier qu'elle apparaît **sans rechargement** dans la liste du PC, et qu'elle est bien présente dans `C:\Easytransfert\partage\`.
4. Depuis le PC, glisser un fichier au nom accentué (par exemple `résumé été.pdf`). Vérifier qu'il apparaît sans rechargement sur le téléphone, avec ses accents intacts, et qu'il se télécharge correctement.
5. Supprimer un fichier depuis le téléphone. Vérifier qu'il disparaît de la liste du PC.

Si l'étape 1 échoue (page inaccessible depuis le téléphone), changer d'adresse dans le sélecteur d'IP côté PC, rescanner le nouveau QR, et recommencer.

- [ ] **Step 6 : Créer `README.md`**

```markdown
# EasyTransfert

Transfert de fichiers entre un PC Windows et un smartphone, sur le réseau local,
sans rien installer sur le téléphone.

## Installation

1. `npm install`
2. Clic droit sur `setup-firewall.bat` → « Exécuter en tant qu'administrateur ». Une seule fois.

## Utilisation

Double-cliquer sur `easytransfert.bat`. Le navigateur s'ouvre sur l'interface,
qui affiche un QR code. Le scanner avec le téléphone ouvre la même interface.

Les fichiers déposés depuis l'un ou l'autre appareil atterrissent dans `partage/`
et sont visibles des deux côtés en direct.

## Si le téléphone n'arrive pas à ouvrir la page

Le PC a probablement plusieurs adresses réseau et le QR encode la mauvaise.
Utiliser le sélecteur « Adresse du PC » sur l'écran du PC pour en essayer une autre :
le QR code se régénère immédiatement.

Vérifier aussi que la règle de pare-feu a bien été créée, et que le PC est sur un
réseau déclaré **privé** dans Windows (la règle ne s'applique pas aux réseaux publics,
volontairement).

## Tests

`npm test`
```

- [ ] **Step 7 : Lancer toute la suite de tests une dernière fois**

```bash
npm test
```

Attendu : tous les fichiers de tests passent, aucun échec.

- [ ] **Step 8 : Commit**

```bash
git add server.js easytransfert.bat setup-firewall.bat README.md
git commit -m "feat: demarrage, verification du pare-feu et lanceurs Windows"
```

---

## Couverture du spec

| Exigence du spec | Tâche |
|---|---|
| Dossier partagé unique, créé au démarrage | 1, 8 |
| Sanitisation des noms, collisions `(1)`, `(2)` | 1 |
| Confinement au dossier partagé (path traversal) | 1, 4 |
| Détection des adresses LAN, exclusion des interfaces virtuelles | 2 |
| Token de session, en-tête ou paramètre d'URL, comparaison en temps constant | 3 |
| Routes `/api/files`, `/api/upload`, `/api/download/:id`, `DELETE /api/files/:id` | 4 |
| Écriture en `.part` puis renommage | 4 |
| Limite de taille 2 Go | 4 |
| Flux SSE `/api/events` | 5 |
| `GET` et `POST /api/network`, QR code | 6 |
| Interface unique responsive, QR masqué sur mobile | 7 |
| Sélecteur d'IP régénérant le QR | 6, 7 |
| Barre de progression à l'envoi | 7 |
| Vérification du pare-feu au démarrage, `profile=private` | 8 |
| Port occupé, aucune adresse LAN : messages explicites | 8 |
| Ouverture automatique du navigateur du PC | 8 |
| Transfert réel PC ↔ Honor Magic 6 Pro | 8, étape 5 |
