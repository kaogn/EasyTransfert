import test from 'node:test';
import assert from 'node:assert/strict';

import { createCodeAppairage } from '../src/appairage.js';

/** Horloge pilotable : l'expiration doit etre testable sans attendre. */
function horlogeFactice(depart = 0) {
  let maintenant = depart;
  return {
    lire: () => maintenant,
    avancerDe: (ms) => { maintenant += ms; },
  };
}

test('le code est fait de six chiffres', () => {
  const appairage = createCodeAppairage();
  assert.match(appairage.code, /^[0-9]{6}$/);
});

test('deux instances ne produisent pas le meme code', () => {
  const codes = new Set();
  for (let i = 0; i < 20; i += 1) codes.add(createCodeAppairage().code);
  assert.ok(codes.size > 1, 'le code ne doit pas etre previsible');
});

test('verifier accepte le code affiche', () => {
  const appairage = createCodeAppairage();
  assert.equal(appairage.verifier(appairage.code), true);
});

test('verifier refuse un code faux, vide ou mal forme', () => {
  const appairage = createCodeAppairage();
  const bon = appairage.code;
  const faux = bon === '000000' ? '111111' : '000000';

  assert.equal(appairage.verifier(faux), false);
  assert.equal(appairage.verifier(''), false);
  assert.equal(appairage.verifier(undefined), false);
  assert.equal(appairage.verifier(null), false);
});

test('le code tourne apres trop d essais rates, ce qui casse la force brute', () => {
  const appairage = createCodeAppairage({ essaisMax: 3 });
  const initial = appairage.code;
  const faux = initial === '000000' ? '111111' : '000000';

  appairage.verifier(faux);
  appairage.verifier(faux);
  assert.equal(appairage.code, initial, 'le code tient tant que la limite n est pas atteinte');

  appairage.verifier(faux);
  assert.notEqual(appairage.code, initial, 'au-dela de la limite, le code doit changer');
  assert.equal(appairage.verifier(initial), false, "l'ancien code ne vaut plus rien");
});

test('un appairage reussi remet le compteur d essais a zero', () => {
  const appairage = createCodeAppairage({ essaisMax: 3 });
  const faux = appairage.code === '000000' ? '111111' : '000000';

  appairage.verifier(faux);
  appairage.verifier(faux);
  assert.equal(appairage.verifier(appairage.code), true);

  // Le compteur etant repart de zero, deux echecs de plus ne font pas tourner le code.
  const courant = appairage.code;
  appairage.verifier(faux);
  appairage.verifier(faux);
  assert.equal(appairage.code, courant);
});

test('le code expire au bout de sa duree de vie', () => {
  const horloge = horlogeFactice();
  const appairage = createCodeAppairage({ dureeMs: 60_000, maintenant: horloge.lire });
  const initial = appairage.code;

  horloge.avancerDe(59_000);
  assert.equal(appairage.code, initial, 'avant l echeance, le code ne bouge pas');

  horloge.avancerDe(2_000);
  assert.notEqual(appairage.code, initial, 'passe l echeance, un nouveau code est emis');
  assert.equal(appairage.verifier(initial), false, "l'ancien code est refuse");
});

test('expireDansMs decroit avec le temps', () => {
  const horloge = horlogeFactice();
  const appairage = createCodeAppairage({ dureeMs: 60_000, maintenant: horloge.lire });

  assert.equal(appairage.expireDansMs(), 60_000);
  horloge.avancerDe(20_000);
  assert.equal(appairage.expireDansMs(), 40_000);
});

test('une rafale d essais rates verrouille les tentatives pendant un temps', () => {
  const horloge = horlogeFactice();
  const appairage = createCodeAppairage({
    essaisMax: 3,
    verrouMs: 30_000,
    maintenant: horloge.lire,
  });
  const faux = '000000' === appairage.code ? '111111' : '000000';

  for (let i = 0; i < 3; i += 1) appairage.verifier(faux);

  // Le verrou vaut pour tout le monde, y compris pour un code exact : c'est ce
  // qui borne le nombre de tentatives par minute et rend la force brute vaine.
  assert.equal(appairage.estVerrouille(), true);
  assert.equal(appairage.verifier(appairage.code), false, 'verrouille, meme le bon code attend');
});

test('le verrou se leve tout seul apres son delai', () => {
  const horloge = horlogeFactice();
  const appairage = createCodeAppairage({
    essaisMax: 3,
    verrouMs: 30_000,
    maintenant: horloge.lire,
  });
  const faux = '000000' === appairage.code ? '111111' : '000000';
  for (let i = 0; i < 3; i += 1) appairage.verifier(faux);

  horloge.avancerDe(29_000);
  assert.equal(appairage.estVerrouille(), true);

  horloge.avancerDe(2_000);
  assert.equal(appairage.estVerrouille(), false);
  assert.equal(appairage.verifier(appairage.code), true, 'apres le delai, l appairage redevient possible');
});

test('le debit reste borne meme sous une avalanche de tentatives', () => {
  const horloge = horlogeFactice();
  const appairage = createCodeAppairage({
    essaisMax: 5,
    verrouMs: 30_000,
    dureeMs: 5 * 60_000,
    maintenant: horloge.lire,
  });

  // Une heure d'attaque continue, en essayant sans relache.
  let tentativesRetenues = 0;
  for (let ms = 0; ms < 60 * 60_000; ms += 100) {
    horloge.avancerDe(100);
    if (!appairage.estVerrouille()) {
      appairage.verifier('999999');
      tentativesRetenues += 1;
    }
  }

  // Sans verrou, ce sont des dizaines de milliers d'essais qui passeraient.
  assert.ok(
    tentativesRetenues < 700,
    `une heure d'attaque ne doit laisser passer qu'une poignee d'essais, obtenu : ${tentativesRetenues}`,
  );
});
