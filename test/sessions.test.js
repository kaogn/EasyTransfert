import test from 'node:test';
import assert from 'node:assert/strict';

import { createSessionsDepot } from '../src/sessions.js';

/** Horloge pilotable : l'expiration doit etre testable sans attendre. */
function horlogeFactice(depart = 0) {
  let maintenant = depart;
  return {
    lire: () => maintenant,
    avancerDe: (ms) => { maintenant += ms; },
  };
}

test('creer produit un jeton distinct du jeton principal', () => {
  const sessions = createSessionsDepot();
  const a = sessions.creer();
  const b = sessions.creer();

  assert.match(a.token, /^[0-9a-f]{32}$/);
  assert.notEqual(a.token, b.token);
});

test('un jeton de depot donne la portee depot, un jeton inconnu ne donne rien', () => {
  const sessions = createSessionsDepot();
  const { token } = sessions.creer();

  assert.equal(sessions.portee(token), 'depot');
  assert.equal(sessions.portee('a'.repeat(32)), null);
  assert.equal(sessions.portee(undefined), null);
});

test('une session expiree ne donne plus aucune portee', () => {
  const horloge = horlogeFactice();
  const sessions = createSessionsDepot({ maintenant: horloge.lire });
  const { token } = sessions.creer({ dureeMs: 30 * 60_000 });

  horloge.avancerDe(29 * 60_000);
  assert.equal(sessions.portee(token), 'depot');

  horloge.avancerDe(2 * 60_000);
  assert.equal(sessions.portee(token), null, 'passe l echeance, la session ne vaut plus rien');
});

test('reserver refuse ce qui depasse le quota de taille', () => {
  const sessions = createSessionsDepot();
  const { token } = sessions.creer({ quotaOctets: 1000, quotaFichiers: 10 });

  // reserver ne fait que verifier : c'est enregistrerFichier qui decompte,
  // une fois la taille reellement ecrite connue.
  assert.equal(sessions.reserver(token, 600).ok, true);
  assert.equal(sessions.reserver(token, 1200).ok, false, 'plus gros que le quota total');

  sessions.enregistrerFichier(token, 600);
  assert.equal(sessions.reserver(token, 600).ok, false, 'il ne reste que 400 octets');
  assert.equal(sessions.reserver(token, 400).ok, true);
});

test('reserver refuse au-dela du nombre de fichiers autorise', () => {
  const sessions = createSessionsDepot();
  const { token } = sessions.creer({ quotaOctets: 1_000_000, quotaFichiers: 2 });

  sessions.enregistrerFichier(token, 10);
  sessions.enregistrerFichier(token, 10);

  const refus = sessions.reserver(token, 10);
  assert.equal(refus.ok, false);
  assert.match(refus.raison, /fichiers/i);
});

test('enregistrerFichier decompte reellement ce qui a ete ecrit', () => {
  const sessions = createSessionsDepot();
  const { token } = sessions.creer({ quotaOctets: 1000, quotaFichiers: 10 });

  // Un envoi annonce 100 octets mais en ecrit 900 : c'est la taille reelle
  // qui doit etre decomptee, sans quoi le quota serait contournable.
  sessions.enregistrerFichier(token, 900);
  assert.equal(sessions.reserver(token, 200).ok, false);
});

test('revoquer coupe la session immediatement', () => {
  const sessions = createSessionsDepot();
  const { token } = sessions.creer();

  sessions.revoquer(token);
  assert.equal(sessions.portee(token), null);
});

test('lister ne montre que les sessions encore valables', () => {
  const horloge = horlogeFactice();
  const sessions = createSessionsDepot({ maintenant: horloge.lire });
  sessions.creer({ dureeMs: 10_000 });
  const vivante = sessions.creer({ dureeMs: 60_000 });

  horloge.avancerDe(20_000);
  const liste = sessions.lister();

  assert.equal(liste.length, 1);
  assert.equal(liste[0].token, vivante.token);
  assert.ok(liste[0].expireDansMs > 0);
});

test('lister n expose pas de compteurs incoherents apres consommation', () => {
  const sessions = createSessionsDepot();
  const { token } = sessions.creer({ quotaOctets: 1000, quotaFichiers: 5 });
  sessions.enregistrerFichier(token, 250);

  const [session] = sessions.lister();
  assert.equal(session.octetsRestants, 750);
  assert.equal(session.fichiersRestants, 4);
});
