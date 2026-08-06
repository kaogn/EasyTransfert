/**
 * Logique de demarrage : choisir un port utilisable et reconnaitre une instance
 * d'EasyTransfert deja lancee. Isolee de server.js pour rester testable.
 */

import { randomBytes } from 'node:crypto';

import { verifierPreuve } from './security.js';

// Marge volontairement large : ce delai n'est subi que si le port est occupe,
// et une seconde suffit a expirer a tort sur une machine chargee — ce qui ferait
// conclure a tort qu'aucune instance ne tourne, puis demarrer un second serveur.
const DELAI_PING_MS = 3000;

/**
 * Fait ecouter le serveur sur le premier port disponible de la liste, dans
 * l'ordre. Leve une erreur `ENOPORT` si aucun ne convient.
 *
 * Le port n'est pas choisi au hasard : il figure dans le favori du telephone et
 * dans la regle de pare-feu. On reste donc sur une petite plage connue, et on
 * revient au port prefere des qu'il se libere.
 */
export function ecouterSurPremierPortLibre(server, hote, ports) {
  return new Promise((resolve, reject) => {
    const restants = [...ports];

    function essayer() {
      const port = restants.shift();
      if (port === undefined) {
        const err = new Error(`Aucun port disponible parmi : ${ports.join(', ')}`);
        err.code = 'ENOPORT';
        reject(err);
        return;
      }

      function surEchec(err) {
        server.removeListener('listening', surSucces);
        if (err.code === 'EADDRINUSE') {
          essayer();
          return;
        }
        reject(err);
      }

      function surSucces() {
        server.removeListener('error', surEchec);
        resolve({ server, port });
      }

      server.once('error', surEchec);
      server.once('listening', surSucces);
      server.listen(port, hote);
    }

    essayer();
  });
}

/**
 * Determine si le port est occupe par une autre instance d'EasyTransfert,
 * auquel cas il ne faut surtout pas en demarrer une seconde : les deux
 * serviraient le meme dossier sans se synchroniser.
 *
 * Se declarer "easytransfert" ne suffit pas : n'importe quel programme local
 * peut renvoyer cette chaine. L'instance doit prouver qu'elle connait le meme
 * jeton, sans quoi le lanceur s'appreterait a confier ce jeton a un imposteur.
 */
export async function instanceExistante(port, hote, token) {
  const nonce = randomBytes(16).toString('hex');
  try {
    const reponse = await fetch(`http://${hote}:${port}/ping?n=${nonce}`, {
      signal: AbortSignal.timeout(DELAI_PING_MS),
    });
    if (!reponse.ok) return false;
    const corps = await reponse.json();
    if (corps?.app !== 'easytransfert') return false;
    return verifierPreuve(token, nonce, corps.preuve);
  } catch {
    // Personne au bout du fil, service etranger, ou reponse illisible.
    return false;
  }
}
