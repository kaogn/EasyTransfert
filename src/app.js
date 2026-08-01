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

  return app;
}
