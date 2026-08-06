import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { createAuthMiddleware, preuveDeToken, estAdresseLoopback } from './security.js';
import { createCodeAppairage } from './appairage.js';
import { createSessionsDepot } from './sessions.js';
import { createApiRouter } from './routes.js';

const RACINE = path.dirname(fileURLToPath(import.meta.url));
const DOSSIER_PUBLIC = path.join(RACINE, '..', 'public');

/**
 * Assemble l'application sans la demarrer, pour que les tests puissent
 * l'ecouter sur un port ephemere.
 */
export function createApp({
  storage,
  events,
  network,
  persisterToken,
  appairage = createCodeAppairage(),
  sessions = createSessionsDepot(),
}) {
  const app = express();

  app.use(express.json());

  // Point d'entree d'un appareil qui ne connait encore rien : il echange un
  // code court, affiche sur le PC, contre le jeton de session. Necessairement
  // hors du middleware d'authentification — c'est justement ce qu'il vient
  // chercher. La protection contre la force brute est dans createCodeAppairage.
  app.post('/appairage', (req, res) => {
    if (appairage.estVerrouille()) {
      const secondes = Math.ceil(appairage.verrouRestantMs() / 1000);
      res.status(429).json({
        error: `Trop de tentatives. Patientez ${secondes} seconde(s) avant de réessayer.`,
        reessayerDansMs: appairage.verrouRestantMs(),
      });
      return;
    }
    if (!appairage.verifier(req.body?.code)) {
      res.status(401).json({ error: 'Code incorrect ou expiré.' });
      return;
    }
    res.json({ token: network.token });
  });

  // Permet a un second lancement de reconnaitre une instance deja en place,
  // plutot que d'echouer sur un port occupe. Reserve au loopback : le lanceur
  // est sur la meme machine, et personne d'autre n'a de raison de sonder.
  // Repond a un nonce par un HMAC du jeton, ce qui prouve l'identite sans
  // divulguer quoi que ce soit d'exploitable.
  app.get('/ping', (req, res) => {
    if (!estAdresseLoopback(req.socket.remoteAddress)) {
      res.status(404).end();
      return;
    }
    const nonce = req.query?.n;
    res.json({
      app: 'easytransfert',
      preuve: nonce ? preuveDeToken(network.token, nonce) : undefined,
    });
  });

  app.use(
    '/api',
    createAuthMiddleware(() => network.token, (jeton) => sessions.portee(jeton)),
    createApiRouter({ storage, events, network, persisterToken, appairage, sessions }),
  );
  // La page de depot est servie sans jeton : c'est l'API qu'elle appelle qui
  // verifie l'acces. Sans cette route, /depot ne resoudrait pas vers le fichier.
  app.get('/depot', (req, res) => {
    res.sendFile(path.join(DOSSIER_PUBLIC, 'depot.html'));
  });

  app.use(express.static(DOSSIER_PUBLIC));

  app.use((err, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'Un fichier dépasse la taille maximale autorisée.' });
      return;
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      res.status(413).json({ error: 'Trop de fichiers dans cet envoi.' });
      return;
    }
    console.error('Erreur serveur :', err);
    res.status(500).json({ error: 'Erreur interne du serveur.' });
  });

  return app;
}
