import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';

import { ecouterSurPremierPortLibre, instanceExistante } from './src/demarrage.js';

import { createApp } from './src/app.js';
import { createStorage } from './src/storage.js';
import { createEventHub } from './src/events.js';
import { lireOuCreerToken, ecrireToken } from './src/security.js';
import { listCandidateAddresses } from './src/network.js';

const PORT_PREFERE = 4455;
// Plage volontairement etroite : le port figure dans la regle de pare-feu et
// dans le favori du telephone, il ne peut pas etre choisi au hasard.
const PORTS = [4455, 4456, 4457, 4458, 4459];
const NOM_REGLE_PARE_FEU = 'EasyTransfert';
const RACINE = path.dirname(fileURLToPath(import.meta.url));
const DOSSIER_PARTAGE = path.join(RACINE, 'partage');
const FICHIER_TOKEN = path.join(RACINE, '.token');

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
  const partialsSupprimes = await storage.cleanupPartials();
  if (partialsSupprimes > 0) {
    console.log(`${partialsSupprimes} envoi(s) temporaire(s) abandonné(s) supprimé(s).`);
  }

  const candidates = listCandidateAddresses();
  if (candidates.length === 0) {
    console.error(
      'Aucune adresse réseau locale détectée. Vérifiez que le PC est bien connecté au Wi-Fi ou en Ethernet.',
    );
    process.exit(1);
  }

  // Le jeton survit aux redemarrages : le telephone peut garder la page en
  // favori au lieu de rescanner le QR code a chaque lancement.
  const token = await lireOuCreerToken(FICHIER_TOKEN);
  const network = { candidates, active: candidates[0].address, port: PORT_PREFERE, token };
  const app = createApp({
    storage,
    events: createEventHub(),
    network,
    persisterToken: (nouveau) => ecrireToken(FICHIER_TOKEN, nouveau),
  });

  // Relancer le programme alors qu'il tourne deja ne doit pas produire une
  // erreur : on ouvre simplement la page de l'instance en place. Deux serveurs
  // sur le meme dossier afficheraient des listes desynchronisees.
  if (await instanceExistante(PORT_PREFERE, '127.0.0.1')) {
    console.log('EasyTransfert tourne déjà : ouverture de la page existante.');
    ouvrirNavigateur(`http://${network.active}:${PORT_PREFERE}/?t=${token}`);
    return;
  }

  let server;
  let port;
  try {
    ({ server, port } = await ecouterSurPremierPortLibre(
      createServer(app),
      '0.0.0.0',
      PORTS,
    ));
  } catch (err) {
    if (err.code === 'ENOPORT') {
      console.error(`Aucun port libre entre ${PORTS[0]} et ${PORTS[PORTS.length - 1]}.`);
      console.error("Un autre programme les occupe. Redémarrez le PC, puis relancez EasyTransfert.");
    } else {
      console.error(`Démarrage impossible : ${err.message}`);
    }
    process.exit(1);
    return;
  }

  network.port = port;

  {
    const url = `http://${network.active}:${port}/?t=${token}`;

    console.log('EasyTransfert est démarré.');
    console.log(`  Dossier partagé : ${storage.rootDir}`);
    console.log(`  Adresse         : ${url}`);
    console.log('  Arrêt           : Ctrl+C');

    if (port !== PORT_PREFERE) {
      console.warn('');
      console.warn(
        `Le port habituel ${PORT_PREFERE} était occupé par un autre programme : EasyTransfert utilise`,
      );
      console.warn(`  le port ${port} cette fois-ci. Le téléphone devra rescanner le QR code.`);
      console.warn('');
    }

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
  }

  return server;
}

demarrer();
