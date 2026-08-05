import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';

const FORME_TOKEN = /^[0-9a-f]{32}$/;

export function createToken() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Ecrit le token sur disque. Le fichier est cree en lecture seule pour son
 * proprietaire : sous Windows le mode est ignore, mais le programme peut aussi
 * tourner ailleurs.
 */
export async function ecrireToken(chemin, token) {
  await fs.writeFile(chemin, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
}

/**
 * Rend le token persiste s'il est exploitable, sinon en cree un et l'enregistre.
 * C'est ce qui permet au telephone de garder la page en favori : l'URL reste
 * valable d'un demarrage a l'autre, au lieu d'exiger un nouveau scan.
 */
export async function lireOuCreerToken(chemin) {
  try {
    const contenu = (await fs.readFile(chemin, 'utf8')).trim();
    if (FORME_TOKEN.test(contenu)) return contenu;
  } catch {
    // Fichier absent ou illisible : on retombe sur la creation.
  }
  const token = createToken();
  await ecrireToken(chemin, token);
  return token;
}

/**
 * Preuve qu'on connait le token, sans le divulguer : HMAC du nonce fourni par
 * celui qui interroge. Sert au lanceur a s'assurer que le service occupant le
 * port est bien une instance d'EasyTransfert, et non un imposteur local a qui
 * il s'appreterait a confier le token.
 */
export function preuveDeToken(token, nonce) {
  return crypto.createHmac('sha256', String(token)).update(String(nonce)).digest('hex');
}

export function verifierPreuve(token, nonce, preuve) {
  if (typeof preuve !== 'string') return false;
  return egaliteConstante(preuveDeToken(token, nonce), preuve);
}

/** Reconnait les adresses locales, y compris la forme IPv4 mappee en IPv6. */
export function estAdresseLoopback(adresse) {
  if (typeof adresse !== 'string') return false;
  const nue = adresse.replace(/^::ffff:/, '');
  return nue === '127.0.0.1' || adresse === '::1' || nue.startsWith('127.');
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
  // timingSafeEqual leve si les longueurs differ : on tranche avant.
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * `obtenirToken` est une fonction, et non une chaine : le token peut etre
 * regenere en cours d'execution, et le middleware doit alors refuser
 * immediatement l'ancien.
 */
export function createAuthMiddleware(obtenirToken) {
  return function verifierToken(req, res, next) {
    const fourni = extractToken(req);
    const attendu = obtenirToken();
    if (!fourni || !attendu || !egaliteConstante(fourni, attendu)) {
      res.status(401).json({ error: 'Token invalide ou absent' });
      return;
    }
    next();
  };
}
