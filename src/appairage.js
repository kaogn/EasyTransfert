import crypto from 'node:crypto';

const DUREE_PAR_DEFAUT_MS = 5 * 60 * 1000;
const ESSAIS_PAR_DEFAUT = 5;
const VERROU_PAR_DEFAUT_MS = 30 * 1000;

function tirerCode() {
  // randomInt est uniforme et cryptographique : un code previsible se devinerait
  // sans meme avoir a le forcer.
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function egaliteConstante(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Code court et jetable servant a appairer un nouvel appareil sans recopier le
 * jeton de session.
 *
 * Six chiffres, c'est un million de combinaisons. Faire tourner le code apres
 * quelques echecs ne suffit pas : chaque essai garde une chance sur un million,
 * independamment des autres, si bien qu'un attaquant capable d'enchainer les
 * requetes finirait par tomber juste — quelques minutes suffisent sur un reseau
 * local.
 *
 * Ce qui protege reellement, c'est donc de brider le DEBIT : passe la limite
 * d'essais, plus rien n'est accepte pendant un temps mort. Quelques dizaines de
 * tentatives par heure au lieu de plusieurs milliers par seconde ramenent la
 * force brute a des annees, bien au-dela de la duree de vie d'un code.
 */
export function createCodeAppairage({
  dureeMs = DUREE_PAR_DEFAUT_MS,
  essaisMax = ESSAIS_PAR_DEFAUT,
  verrouMs = VERROU_PAR_DEFAUT_MS,
  maintenant = Date.now,
} = {}) {
  let code = tirerCode();
  let emisA = maintenant();
  let essaisRates = 0;
  let verrouilleJusqua = 0;

  function renouveler() {
    code = tirerCode();
    emisA = maintenant();
    essaisRates = 0;
  }

  function estVerrouille() {
    return maintenant() < verrouilleJusqua;
  }

  /** Emet un nouveau code si le precedent a fait son temps. */
  function codeCourant() {
    if (maintenant() - emisA >= dureeMs) renouveler();
    return code;
  }

  function verifier(fourni) {
    // Le verrou s'applique avant toute comparaison, donc aussi au bon code :
    // sans cela, il suffirait de tenter le code exact pendant le temps mort.
    if (estVerrouille()) return false;
    if (typeof fourni !== 'string' || fourni === '') return false;

    const attendu = codeCourant();
    if (egaliteConstante(fourni, attendu)) {
      // Appairage reussi : le compteur repart, l'appareil legitime ne doit pas
      // pousser le code a tourner pour les suivants.
      essaisRates = 0;
      return true;
    }

    essaisRates += 1;
    if (essaisRates >= essaisMax) {
      verrouilleJusqua = maintenant() + verrouMs;
      renouveler();
    }
    return false;
  }

  return {
    get code() {
      return codeCourant();
    },
    verifier,
    estVerrouille,
    verrouRestantMs() {
      return Math.max(0, verrouilleJusqua - maintenant());
    },
    expireDansMs() {
      codeCourant();
      return Math.max(0, dureeMs - (maintenant() - emisA));
    },
  };
}
