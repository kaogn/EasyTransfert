import { createToken } from './security.js';

const DUREE_PAR_DEFAUT_MS = 30 * 60 * 1000;
const QUOTA_OCTETS_PAR_DEFAUT = 2 * 1024 * 1024 * 1024;
const QUOTA_FICHIERS_PAR_DEFAUT = 50;

/**
 * Sessions de depot : des acces temporaires qui ne permettent que d'envoyer.
 *
 * C'est la reponse a la faiblesse principale du modele d'origine, ou l'unique
 * jeton donnait tous les droits, suppression comprise. Un invite a qui on veut
 * simplement faire deposer des photos n'a aucune raison de pouvoir lister ni
 * effacer le dossier.
 */
export function createSessionsDepot({ maintenant = Date.now } = {}) {
  const sessions = new Map();

  function valable(session) {
    return session !== undefined && maintenant() < session.expireA;
  }

  function creer({
    dureeMs = DUREE_PAR_DEFAUT_MS,
    quotaOctets = QUOTA_OCTETS_PAR_DEFAUT,
    quotaFichiers = QUOTA_FICHIERS_PAR_DEFAUT,
  } = {}) {
    const token = createToken();
    const session = {
      token,
      creeeA: maintenant(),
      expireA: maintenant() + dureeMs,
      octetsRestants: quotaOctets,
      fichiersRestants: quotaFichiers,
    };
    sessions.set(token, session);
    return session;
  }

  /** Portee associee a un jeton, ou null s'il ne vaut plus rien. */
  function portee(token) {
    if (typeof token !== 'string') return null;
    return valable(sessions.get(token)) ? 'depot' : null;
  }

  /**
   * Verifie qu'un envoi annonce tient dans ce qu'il reste. Appele avant
   * d'ecrire quoi que ce soit sur le disque : refuser apres coup laisserait
   * la place deja consommee.
   */
  function reserver(token, octets) {
    const session = sessions.get(token);
    if (!valable(session)) return { ok: false, raison: 'Session de dépôt expirée.' };
    if (session.fichiersRestants <= 0) {
      return { ok: false, raison: 'Nombre de fichiers autorisés atteint.' };
    }
    if (octets > session.octetsRestants) {
      return { ok: false, raison: 'Taille autorisée dépassée.' };
    }
    return { ok: true, octetsRestants: session.octetsRestants - octets };
  }

  /**
   * Decompte ce qui a reellement ete ecrit. La taille annoncee par le client
   * n'engage que lui : seule celle constatee sur le disque fait foi.
   */
  function enregistrerFichier(token, octetsEcrits) {
    const session = sessions.get(token);
    if (session === undefined) return;
    session.octetsRestants = Math.max(0, session.octetsRestants - octetsEcrits);
    session.fichiersRestants = Math.max(0, session.fichiersRestants - 1);
  }

  function revoquer(token) {
    sessions.delete(token);
  }

  function lister() {
    const vivantes = [];
    for (const [token, session] of sessions) {
      if (!valable(session)) {
        sessions.delete(token);
        continue;
      }
      vivantes.push({
        token,
        expireDansMs: session.expireA - maintenant(),
        octetsRestants: session.octetsRestants,
        fichiersRestants: session.fichiersRestants,
      });
    }
    return vivantes;
  }

  return { creer, portee, reserver, enregistrerFichier, revoquer, lister };
}
