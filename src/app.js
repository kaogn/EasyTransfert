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
export function createApp({ storage, events, network, persisterToken }) {
  const app = express();

  app.use(express.json());

  // Permet a un second lancement de reconnaitre une instance deja en place,
  // plutot que d'echouer sur un port occupe. Volontairement sans jeton : ne
  // revele que l'existence du service, que la page d'accueil expose deja.
  app.get('/ping', (req, res) => {
    res.json({ app: 'easytransfert' });
  });

  app.use(
    '/api',
    createAuthMiddleware(() => network.token),
    createApiRouter({ storage, events, network, persisterToken }),
  );
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
