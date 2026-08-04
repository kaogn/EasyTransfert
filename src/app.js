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
export function createApp({ storage, token, events, network }) {
  const app = express();

  app.use(express.json());
  app.use('/api', createAuthMiddleware(token), createApiRouter({ storage, events, network }));
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
