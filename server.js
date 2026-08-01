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
