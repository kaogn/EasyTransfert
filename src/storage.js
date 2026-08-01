import { promises as fs } from 'node:fs';
import path from 'node:path';

const CARACTERES_INTERDITS = /[<>:"/\|?*\u0000-\u001f]/g;
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

  /**
   * Vide le dossier partage. S'appuie sur list(), donc les envois en cours
   * (fichiers .part) sont epargnes : les detruire casserait un transfert
   * lance depuis l'autre appareil.
   */
  async function removeAll() {
    const fichiers = await list();
    await Promise.all(fichiers.map((fichier) => remove(fichier.id)));
    return fichiers.length;
  }

  return { rootDir: root, ensureRoot, list, resolve, uniqueName, remove, removeAll };
}
