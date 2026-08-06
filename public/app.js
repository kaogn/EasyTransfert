const params = new URLSearchParams(location.search);
// localStorage et non sessionStorage : l'appareil garde son acces apres
// fermeture de l'onglet, et la page peut vivre en favori sans rescanner.
let token = params.get('t') || localStorage.getItem('easytransfert-token');

if (params.get('t')) {
  localStorage.setItem('easytransfert-token', params.get('t'));
  // On retire le token de la barre d'adresse : il reste en localStorage.
  history.replaceState({}, '', location.pathname);
}

const etat = document.querySelector('#etat');
const liste = document.querySelector('#liste');
const listeVide = document.querySelector('#liste-vide');
const boutonToutSupprimer = document.querySelector('#tout-supprimer');
const zoneDepot = document.querySelector('#zone-depot');
const champFichiers = document.querySelector('#champ-fichiers');
const boutonParcourir = document.querySelector('#bouton-parcourir');
const progression = document.querySelector('#progression');
const barre = document.querySelector('#barre');
const texteProgression = document.querySelector('#texte-progression');
const blocQr = document.querySelector('#bloc-qr');
const imageQr = document.querySelector('#qr');
const champUrl = document.querySelector('#url');
const selecteurIp = document.querySelector('#selecteur-ip');
const boutonRegenerer = document.querySelector('#regenerer-jeton');
const boutonCreerDepot = document.querySelector('#creer-depot');
const blocSessionDepot = document.querySelector('#session-depot');
const qrDepot = document.querySelector('#qr-depot');
const urlDepot = document.querySelector('#url-depot');
const infosDepot = document.querySelector('#infos-depot');
const boutonRevoquerDepot = document.querySelector('#revoquer-depot');

let jetonDepotCourant = null;

const blocAppairage = document.querySelector('#bloc-appairage');
const blocFichiers = document.querySelector('#bloc-fichiers');
const formulaireAppairage = document.querySelector('#formulaire-appairage');
const champCode = document.querySelector('#champ-code');
const erreurAppairage = document.querySelector('#erreur-appairage');
const codeAppairage = document.querySelector('#code-appairage');
const adresseCourte = document.querySelector('#adresse-courte');

function afficherEtat(message, horsLigne = false) {
  etat.textContent = message;
  etat.classList.toggle('hors-ligne', horsLigne);
}

function api(chemin, options = {}) {
  return fetch(chemin, {
    ...options,
    headers: { 'X-Transfer-Token': token, ...(options.headers ?? {}) },
  });
}

function tailleLisible(octets) {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(1)} Ko`;
  if (octets < 1024 * 1024 * 1024) return `${(octets / 1024 / 1024).toFixed(1)} Mo`;
  return `${(octets / 1024 / 1024 / 1024).toFixed(2)} Go`;
}

function heureLisible(mtime) {
  return new Date(mtime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

async function rafraichirListe() {
  const reponse = await api('/api/files');
  if (!reponse.ok) {
    afficherEtat('Impossible de lire la liste des fichiers.', true);
    return;
  }
  const fichiers = await reponse.json();

  liste.replaceChildren();
  listeVide.hidden = fichiers.length > 0;
  boutonToutSupprimer.hidden = fichiers.length === 0;

  for (const fichier of fichiers) {
    const li = document.createElement('li');

    const nom = document.createElement('span');
    nom.className = 'nom';
    nom.textContent = fichier.name;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${tailleLisible(fichier.size)} — ${heureLisible(fichier.mtime)}`;
    nom.append(meta);

    const lien = document.createElement('a');
    lien.href = `/api/download/${fichier.id}?t=${encodeURIComponent(token)}`;
    lien.textContent = 'Télécharger';
    lien.setAttribute('download', fichier.name);

    const supprimer = document.createElement('button');
    supprimer.className = 'supprimer';
    supprimer.type = 'button';
    supprimer.textContent = 'Supprimer';
    supprimer.addEventListener('click', async () => {
      supprimer.disabled = true;
      await api(`/api/files/${fichier.id}`, { method: 'DELETE' });
      await rafraichirListe();
    });

    li.append(nom, lien, supprimer);
    liste.append(li);
  }
}

boutonToutSupprimer.addEventListener('click', async () => {
  const nombre = liste.childElementCount;
  const question = nombre === 1
    ? 'Supprimer le fichier partagé ? C’est définitif.'
    : `Supprimer les ${nombre} fichiers partagés ? C’est définitif.`;
  if (!confirm(question)) return;

  boutonToutSupprimer.disabled = true;
  const reponse = await api('/api/files', { method: 'DELETE' });
  boutonToutSupprimer.disabled = false;

  if (!reponse.ok) {
    afficherEtat('Suppression impossible.', true);
    return;
  }
  const { deleted } = await reponse.json();
  afficherEtat(deleted === 1 ? '1 fichier supprimé.' : `${deleted} fichiers supprimés.`);
  await rafraichirListe();
});

boutonCreerDepot.addEventListener('click', async () => {
  boutonCreerDepot.disabled = true;
  const reponse = await api('/api/depot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dureeMs: 30 * 60_000, quotaOctets: 2 * 1024 ** 3, quotaFichiers: 50 }),
  });
  boutonCreerDepot.disabled = false;

  if (!reponse.ok) {
    afficherEtat('Impossible de créer la session de dépôt.', true);
    return;
  }

  const session = await reponse.json();
  jetonDepotCourant = session.token;
  qrDepot.src = session.qr;
  urlDepot.textContent = session.url;
  infosDepot.textContent =
    `Valable ${Math.round(session.expireDansMs / 60000)} min · `
    + `${session.fichiersRestants} fichiers max · ${tailleLisible(session.octetsRestants)} max`;
  blocSessionDepot.hidden = false;
  afficherEtat('Session de dépôt ouverte. Faites scanner ce QR code.');
});

boutonRevoquerDepot.addEventListener('click', async () => {
  if (!jetonDepotCourant) return;
  await api(`/api/depot/${jetonDepotCourant}`, { method: 'DELETE' });
  jetonDepotCourant = null;
  blocSessionDepot.hidden = true;
  afficherEtat('Session de dépôt fermée.');
});

function envoyer(fichiers) {
  if (!fichiers || fichiers.length === 0) return;

  const formulaire = new FormData();
  for (const fichier of fichiers) formulaire.append('files', fichier);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload');
  xhr.setRequestHeader('X-Transfer-Token', token);

  progression.hidden = false;
  barre.style.width = '0%';
  texteProgression.textContent = `Envoi de ${fichiers.length} fichier(s)…`;

  xhr.upload.addEventListener('progress', (evenement) => {
    if (!evenement.lengthComputable) return;
    const pourcent = Math.round((evenement.loaded / evenement.total) * 100);
    barre.style.width = `${pourcent}%`;
    texteProgression.textContent =
      `${pourcent} % — ${tailleLisible(evenement.loaded)} / ${tailleLisible(evenement.total)}`;
  });

  xhr.addEventListener('load', () => {
    progression.hidden = true;
    if (xhr.status === 200) {
      afficherEtat('Envoi terminé.');
      rafraichirListe();
    } else {
      afficherEtat(`Échec de l'envoi (code ${xhr.status}).`, true);
    }
  });

  xhr.addEventListener('error', () => {
    progression.hidden = true;
    afficherEtat('Échec de l’envoi : connexion interrompue.', true);
  });

  xhr.send(formulaire);
}

boutonParcourir.addEventListener('click', () => champFichiers.click());
champFichiers.addEventListener('change', () => {
  envoyer(champFichiers.files);
  champFichiers.value = '';
});

for (const evenement of ['dragenter', 'dragover']) {
  zoneDepot.addEventListener(evenement, (e) => {
    e.preventDefault();
    zoneDepot.classList.add('survol');
  });
}
for (const evenement of ['dragleave', 'drop']) {
  zoneDepot.addEventListener(evenement, (e) => {
    e.preventDefault();
    zoneDepot.classList.remove('survol');
  });
}
zoneDepot.addEventListener('drop', (e) => envoyer(e.dataTransfer.files));

async function chargerReseau(etatReseau) {
  const donnees = etatReseau ?? (await (await api('/api/network')).json());
  imageQr.src = donnees.qr;
  champUrl.textContent = donnees.url;

  if (donnees.appairage) {
    codeAppairage.textContent = donnees.appairage.code;
    // L'adresse sans le jeton : c'est elle qu'on dicte a l'autre ordinateur.
    adresseCourte.textContent = donnees.url.replace(/^https?:\/\//, '').replace(/\/\?t=.*$/, '');
  }

  selecteurIp.replaceChildren();
  for (const candidat of donnees.candidates) {
    const option = document.createElement('option');
    option.value = candidat.address;
    option.textContent = `${candidat.address} (${candidat.name})`;
    option.selected = candidat.address === donnees.active;
    selecteurIp.append(option);
  }
  blocQr.hidden = donnees.candidates.length === 0;
}

selecteurIp.addEventListener('change', async () => {
  const reponse = await api('/api/network', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: selecteurIp.value }),
  });
  if (reponse.ok) await chargerReseau(await reponse.json());
});

let fluxEvenements = null;

function ecouterEvenements({ annoncer = true } = {}) {
  // Le flux porte le jeton dans son URL : apres une regeneration, il faut le
  // refermer et en ouvrir un neuf, sinon la reconnexion echouerait en 401.
  if (fluxEvenements) fluxEvenements.close();

  const source = new EventSource(`/api/events?t=${encodeURIComponent(token)}`);
  fluxEvenements = source;
  // Sans ce garde-fou, le "Connecte." de la reconnexion effacerait aussitot la
  // consigne de rescanner le QR code, qui est l'information utile a ce moment-la.
  source.addEventListener('open', () => { if (annoncer) afficherEtat('Connecté.'); });
  source.addEventListener('message', (evenement) => {
    if (JSON.parse(evenement.data).type === 'files-changed') rafraichirListe();
  });
  source.addEventListener('error', () => {
    afficherEtat('Connexion perdue, nouvelle tentative…', true);
    // EventSource se reconnecte seul ; on se contente de le signaler.
  });
}

boutonRegenerer.addEventListener('click', async () => {
  const question =
    'Générer un nouveau jeton d’accès ?\n\n'
    + 'Les appareils déjà connectés seront déconnectés et devront rescanner le QR code.';
  if (!confirm(question)) return;

  boutonRegenerer.disabled = true;
  const reponse = await api('/api/network/token', { method: 'POST' });
  boutonRegenerer.disabled = false;

  if (!reponse.ok) {
    afficherEtat('Impossible de générer un nouveau jeton.', true);
    return;
  }

  const donnees = await reponse.json();
  token = donnees.token;
  localStorage.setItem('easytransfert-token', token);
  await chargerReseau(donnees);
  ecouterEvenements({ annoncer: false });
  afficherEtat('Nouveau jeton en place. Rescannez le QR code depuis le téléphone.');
});

/** Rythme de rafraichissement du code d'appairage affiche sur le PC. */
const INTERVALLE_CODE_MS = 60_000;

async function demarrer() {
  blocAppairage.hidden = true;
  blocQr.hidden = false;
  blocFichiers.hidden = false;

  await chargerReseau();
  await rafraichirListe();
  ecouterEvenements();

  // Le code d'appairage a une duree de vie limitee : sans ce rafraichissement,
  // le PC afficherait un code perime et l'autre ordinateur ne pourrait pas se
  // connecter.
  setInterval(() => {
    chargerReseau().catch(() => {});
  }, INTERVALLE_CODE_MS);
}

function demanderAppairage(message) {
  blocAppairage.hidden = false;
  blocQr.hidden = true;
  blocFichiers.hidden = true;
  erreurAppairage.hidden = !message;
  if (message) erreurAppairage.textContent = message;
  afficherEtat('Cet appareil n’est pas encore connecté.');
  champCode.focus();
}

formulaireAppairage.addEventListener('submit', async (evenement) => {
  evenement.preventDefault();
  const code = champCode.value.trim();
  if (code === '') return;

  const reponse = await fetch('/appairage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });

  if (!reponse.ok) {
    champCode.value = '';
    const corps = await reponse.json().catch(() => ({}));
    // Le serveur bride les tentatives : mieux vaut dire l'attente que laisser
    // croire a un code faux et pousser a réessayer en boucle.
    demanderAppairage(
      corps.error ?? 'Code incorrect ou expiré. Vérifiez le code affiché sur l’autre ordinateur.',
    );
    return;
  }

  token = (await reponse.json()).token;
  localStorage.setItem('easytransfert-token', token);
  champCode.value = '';
  await demarrer();
});

if (token) {
  await demarrer();
} else {
  // Plutot qu'une impasse, on propose la seule action utile : saisir le code
  // affiche sur l'ordinateur qui partage les fichiers.
  demanderAppairage();
}
