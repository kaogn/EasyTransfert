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
  // timingSafeEqual leve si les longueurs differ : on tranche avant.
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
