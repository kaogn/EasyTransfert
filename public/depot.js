const params = new URLSearchParams(location.search);
// Cle distincte du jeton principal : sur un meme navigateur, un acces de depot
// ne doit jamais ecraser ni recuperer l'acces complet du PC.
let token = params.get('t') || localStorage.getItem('easytransfert-depot');

if (params.get('t')) {
  localStorage.setItem('easytransfert-depot', params.get('t'));
  history.replaceState({}, '', location.pathname);
}

const etat = document.querySelector('#etat');
const zoneDepot = document.querySelector('#zone-depot');
const champFichiers = document.querySelector('#champ-fichiers');
const boutonParcourir = document.querySelector('#bouton-parcourir');
const progression = document.querySelector('#progression');
const barre = document.querySelector('#barre');
const texteProgression = document.querySelector('#texte-progression');
const envoyes = document.querySelector('#envoyes');
const limites = document.querySelector('#limites');

function afficherEtat(message, probleme = false) {
  etat.textContent = message;
  etat.classList.toggle('hors-ligne', probleme);
}

function tailleLisible(octets) {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(1)} Ko`;
  if (octets < 1024 * 1024 * 1024) return `${(octets / 1024 / 1024).toFixed(1)} Mo`;
  return `${(octets / 1024 / 1024 / 1024).toFixed(2)} Go`;
}

if (!token) {
  afficherEtat('Lien de dépôt invalide. Demandez-en un nouveau.', true);
  boutonParcourir.disabled = true;
}

function noterEnvoi(nom) {
  const li = document.createElement('li');
  const span = document.createElement('span');
  span.className = 'nom';
  span.textContent = `${nom} — envoyé`;
  li.append(span);
  envoyes.append(li);
}

function envoyer(fichiers) {
  if (!token || !fichiers || fichiers.length === 0) return;

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
      const { saved = [] } = JSON.parse(xhr.responseText || '{}');
      for (const nom of saved) noterEnvoi(nom);
      afficherEtat('Envoi terminé. Merci !');
      return;
    }
    // Les refus de quota et d'expiration ont un message explicite : le relayer
    // tel quel evite de laisser l'invite deviner pourquoi cela a echoue.
    let message = `Échec de l'envoi (code ${xhr.status}).`;
    try {
      const corps = JSON.parse(xhr.responseText || '{}');
      if (corps.error) message = corps.error;
    } catch { /* reponse illisible : on garde le message generique */ }
    afficherEtat(message, true);
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

limites.textContent =
  'Cet accès est temporaire et limité en nombre de fichiers et en taille.';
