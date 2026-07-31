import os from 'node:os';

// Interfaces creees par les hyperviseurs et les VPN : joignables depuis le PC,
// mais jamais depuis le telephone.
const INTERFACES_VIRTUELLES = /vethernet|virtualbox|vmware|hyper-v|wsl|loopback|docker|tailscale|zerotier/i;

// Une interface dont le nom evoque une carte physique est le candidat le plus probable.
const INTERFACES_PHYSIQUES = /wi-?fi|wireless|sans fil|ethernet/i;

function score(nom) {
  if (/wi-?fi|wireless|sans fil/i.test(nom)) return 0;
  if (INTERFACES_PHYSIQUES.test(nom)) return 1;
  return 2;
}

/**
 * Retourne les adresses IPv4 du reseau local utilisables pour joindre ce PC,
 * de la plus probable a la moins probable.
 *
 * Aucune heuristique n'etant fiable sur toutes les configurations Windows,
 * l'interface web laisse l'utilisateur choisir dans cette liste.
 */
export function listCandidateAddresses(interfaces = os.networkInterfaces()) {
  const candidats = [];
  for (const [nom, adresses] of Object.entries(interfaces)) {
    if (!adresses || INTERFACES_VIRTUELLES.test(nom)) continue;
    for (const adresse of adresses) {
      if (adresse.family !== 'IPv4' || adresse.internal) continue;
      candidats.push({ name: nom, address: adresse.address });
    }
  }
  candidats.sort((a, b) => score(a.name) - score(b.name));
  return candidats;
}
