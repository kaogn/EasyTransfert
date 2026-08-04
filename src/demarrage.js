/**
 * Logique de demarrage : choisir un port utilisable et reconnaitre une instance
 * d'EasyTransfert deja lancee. Isolee de server.js pour rester testable.
 */

const DELAI_PING_MS = 1000;

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
 */
export async function instanceExistante(port, hote) {
  try {
    const reponse = await fetch(`http://${hote}:${port}/ping`, {
      signal: AbortSignal.timeout(DELAI_PING_MS),
    });
    if (!reponse.ok) return false;
    const corps = await reponse.json();
    return corps?.app === 'easytransfert';
  } catch {
    // Personne au bout du fil, service etranger, ou reponse illisible.
    return false;
  }
}
