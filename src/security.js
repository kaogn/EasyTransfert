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
 *
 * `porteeInvite` permet de reconnaitre les jetons de depot, aux droits reduits.
 * Le middleware ne repond plus seulement « qui es-tu ? » mais attache une
 * portee a la requete ; c'est `exigerPortee` qui decide ensuite du droit.
 */
export function createAuthMiddleware(obtenirToken, porteeInvite = () => null) {
  return function verifierToken(req, res, next) {
    const fourni = extractToken(req);
    if (!fourni) {
      res.status(401).json({ error: 'Token invalide ou absent' });
      return;
    }

    const attendu = obtenirToken();
    if (attendu && egaliteConstante(fourni, attendu)) {
      req.portee = 'complet';
      next();
      return;
    }

    const portee = porteeInvite(fourni);
    if (portee) {
      req.portee = portee;
      next();
      return;
    }

    res.status(401).json({ error: 'Token invalide ou absent' });
  };
}

/**
 * Garde a poser sur toute route qui n'est pas ouverte aux invites. Liste
 * blanche volontaire : une route oubliee est refusee aux invites plutot que
 * de leur etre ouverte par megarde.
 */
export function exigerPortee(...poreesAutorisees) {
  return function verifierPortee(req, res, next) {
    if (!poreesAutorisees.includes(req.portee)) {
      res.status(403).json({ error: 'Cette action n’est pas autorisée pour cet accès.' });
      return;
    }
    next();
  };
}
