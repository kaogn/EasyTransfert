import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import express from 'express';
import multer from 'multer';
import QRCode from 'qrcode';

import { createToken } from './security.js';

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

export function createApiRouter({ storage, events, network, persisterToken }) {
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

  router.get('/events', (req, res) => {
    events.subscribe(res);
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
    events.broadcast('files-changed');
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

  router.delete('/files', async (req, res) => {
    const deleted = await storage.removeAll();
    events.broadcast('files-changed');
    res.json({ deleted });
  });

  router.delete('/files/:id', async (req, res) => {
    try {
      await storage.remove(req.params.id);
      events.broadcast('files-changed');
      res.json({ ok: true });
    } catch (err) {
      res.status(statutDepuisErreur(err)).json({ error: err.message });
    }
  });

  async function etatReseau() {
    const url = `http://${network.active}:${network.port}/?t=${network.token}`;
    return {
      candidates: network.candidates,
      active: network.active,
      token: network.token,
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

  // Regenere le jeton d'acces : les appareils deja connectes sont ejectes et
  // devront rescanner le nouveau QR code.
  router.post('/network/token', async (req, res) => {
    network.token = createToken();
    if (persisterToken) await persisterToken(network.token);
    // Les routes HTTP revalident le jeton a chaque appel, mais un flux SSE
    // n'est verifie qu'a son ouverture : il faut le couper explicitement pour
    // que la revocation soit reellement totale, comme l'annonce l'interface.
    events.disconnectAll();
    res.json(await etatReseau());
  });

  return router;
}
