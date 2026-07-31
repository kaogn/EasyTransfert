# EasyTransfert — Design

Date : 2026-07-31
Statut : validé, prêt pour la planification d'implémentation

## Objectif

Transférer des fichiers entre un PC Windows 11 (Dell) et un smartphone Android
(Honor Magic 6 Pro) sur le même réseau Wi-Fi domestique, sans installer d'application
sur le téléphone. Le téléphone scanne un QR code affiché sur le PC et arrive
directement sur l'interface de transfert dans son navigateur.

### Contraintes retenues

- **Réseau** : LAN uniquement. Les deux appareils sont toujours sur le même Wi-Fi.
  Aucune donnée ne transite par un service tiers.
- **Sens** : les deux, à parts égales.
- **Volume** : fichiers de moins de 500 Mo (photos, PDF, documents, vidéos courtes).
- **Zéro installation côté téléphone** : tout passe par le navigateur.

### Hors périmètre

- Transfert hors du réseau local (4G, relais cloud, tunnel, WebRTC).
- Fichiers de plusieurs gigaoctets, reprise après coupure.
- Installation en PWA et intégration au bouton « Partager » d'Android (imposerait HTTPS).
- Démarrage automatique avec Windows.
- Synchronisation, historique, versionnage.

## Modèle conceptuel : un espace partagé

L'outil n'implémente pas de notion de « direction ». Il expose un **dossier partagé
unique**, `C:\Easytransfert\partage\`.

Tout fichier déposé — depuis le PC ou depuis le téléphone — y atterrit. Les deux
appareils voient la même liste et peuvent télécharger ou supprimer n'importe quel
élément. C'est un presse-papier partagé.

Ce modèle est symétrique par construction : le besoin « transférer dans les deux
sens » est satisfait sans code dédié, et il n'y a qu'une seule interface à
comprendre et à maintenir.

Conséquence assumée : un glisser-déposer sur le PC **copie** le fichier dans le
dossier partagé plutôt que de le référencer à son emplacement d'origine. Le coût
disque est négligeable à cette échelle et cela évite les références vers des
fichiers déplacés ou supprimés entre-temps.

## Architecture

Un seul processus Node.js. Aucune étape de build, aucun framework front.

```
C:\Easytransfert\
  server.js              assemblage, démarrage, ouverture du navigateur PC
  package.json
  easytransfert.bat      lanceur (double-clic)
  setup-firewall.bat     règle pare-feu, à lancer une fois en administrateur
  src/
    network.js           détection des adresses IP LAN candidates
    storage.js           dossier partagé : lister, écrire, supprimer, sanitiser
    security.js          génération et vérification du token de session
    routes.js            API HTTP
  public/
    index.html           interface unique, responsive (PC et mobile)
    app.js
    style.css
  partage/               créé au démarrage s'il n'existe pas
  test/
    network.test.js
    storage.test.js
    routes.test.js
  docs/superpowers/specs/
```

### Dépendances

Trois, et rien d'autre :

| Paquet | Rôle |
|---|---|
| `express` | serveur HTTP et routage |
| `multer` | réception multipart avec écriture disque directe |
| `qrcode` | génération du QR code en data URL |

Les tests utilisent `node:test`, intégré à Node 22 : aucune dépendance de test.

### Responsabilité de chaque module

**`src/network.js`** — expose `listCandidateAddresses()` qui retourne les adresses
IPv4 LAN utilisables, triées de la plus probable à la moins probable.

Il lit `os.networkInterfaces()`, écarte les adresses internes et non-IPv4, puis
écarte les interfaces virtuelles dont le nom contient `vEthernet`, `VirtualBox`,
`VMware`, `WSL`, `Hyper-V` ou `Loopback`. Les interfaces dont le nom contient
`Wi-Fi`, `Wireless` ou `Ethernet` sont remontées en tête du tri.

Ce module ne décide pas seul : aucune heuristique n'est fiable sur toutes les
configurations Windows. Il retourne une liste ordonnée, et l'interface PC laisse
l'utilisateur changer d'adresse (voir « Sélecteur d'IP »).

**`src/storage.js`** — encapsule le dossier partagé. Expose `list()`, `resolve(id)`,
`remove(id)` et la logique de nommage à l'écriture.

- Chaque fichier est identifié par un `id` opaque (nom encodé), jamais par un chemin
  brut fourni par le client.
- `resolve(id)` construit le chemin absolu puis **vérifie que le chemin résolu est
  bien contenu dans le dossier partagé**. Sinon il lève une erreur. C'est la
  protection contre le path traversal côté téléchargement et suppression.
- À l'écriture, les noms sont sanitisés (`path.basename`, puis remplacement des
  caractères interdits sous Windows : `< > : " / \ | ? *` et les caractères de
  contrôle). Un nom vide après sanitisation est remplacé par `fichier`.
- En cas de collision, un suffixe est ajouté : `photo.jpg` → `photo (1).jpg` →
  `photo (2).jpg`.

**`src/security.js`** — génère un token aléatoire de 32 caractères hexadécimaux
(`crypto.randomBytes(16)`) au démarrage du processus, et expose un middleware
Express qui refuse toute requête API sans token valide avec un code 401.

Le token est comparé en temps constant (`crypto.timingSafeEqual`) pour ne pas
fournir d'oracle par mesure de temps.

Le token change à chaque lancement : un QR code photographié lors d'une session
précédente ne donne accès à rien.

**`src/routes.js`** — définit l'API et émet les événements SSE lors des
modifications du dossier.

**`server.js`** — crée le dossier partagé si absent, génère le token, choisit
l'adresse par défaut, démarre Express sur `0.0.0.0:4455`, vérifie la règle de
pare-feu, puis ouvre le navigateur par défaut du PC sur l'URL complète (token
inclus).

## API HTTP

Toutes les routes `/api/*` exigent le token. Le middleware l'accepte **soit dans
l'en-tête `X-Transfer-Token`, soit dans le paramètre d'URL `?t=`**, dans cet ordre
de priorité.

Les deux formes sont nécessaires : les appels `fetch` et `XMLHttpRequest` passent
le token en en-tête, mais `EventSource` (le flux SSE) n'autorise aucun en-tête
personnalisé, et un téléchargement déclenché par un lien `<a href>` non plus. Ces
deux routes — `/api/events` et `/api/download/:id` — utilisent donc le paramètre
d'URL.

La route `GET /` reçoit également le token en paramètre d'URL, puisque c'est le QR
code qui l'apporte. La page le stocke ensuite en `sessionStorage`.

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/` | sert l'interface |
| `GET` | `/api/files` | liste : nom, taille, date de dépôt, id |
| `POST` | `/api/upload` | réception multipart, un ou plusieurs fichiers |
| `GET` | `/api/download/:id` | téléchargement d'un fichier (token en `?t=`) |
| `DELETE` | `/api/files/:id` | suppression |
| `GET` | `/api/events` | flux SSE des changements du dossier (token en `?t=`) |
| `GET` | `/api/network` | adresses candidates + QR de l'adresse active |
| `POST` | `/api/network` | change l'adresse active, renvoie le nouveau QR |

`GET /api/network` et `POST /api/network` servent le sélecteur d'IP côté PC.

## Flux d'utilisation

**Démarrage.** Double-clic sur `easytransfert.bat`. Le serveur génère un token,
détecte les adresses LAN, prend la première, et ouvre le navigateur du PC sur
`http://192.168.x.x:4455/?t=<token>`. La page affiche le QR encodant cette même URL.

**Depuis le téléphone.** L'utilisateur scanne le QR avec l'appareil photo, ouvre le
lien, et arrive sur l'interface. Il envoie des fichiers via le sélecteur natif
Android, ou télécharge ceux déjà présents d'un tap.

**Depuis le PC.** Glisser-déposer sur la zone dédiée, ou clic pour ouvrir
l'explorateur. Les fichiers envoyés depuis le téléphone apparaissent dans la liste
sans rechargement, via le flux SSE.

## Interface

Une seule page HTML responsive, thème sombre, servie aux deux appareils. Le CSS
adapte la mise en page à la largeur ; il n'y a pas deux interfaces distinctes à
maintenir.

**Sur écran large (PC)** : le QR code et le sélecteur d'IP à gauche, la zone de
glisser-déposer et la liste des fichiers à droite.

**Sur écran étroit (téléphone)** : le QR et le sélecteur d'IP sont masqués — ils
n'ont aucun sens sur l'appareil qui vient de scanner. Un bouton « Envoyer des
fichiers » pleine largeur, puis la liste.

Chaque ligne de la liste affiche le nom, la taille lisible, l'heure de dépôt, et
deux actions : télécharger et supprimer. L'upload affiche une barre de progression
alimentée par `XMLHttpRequest.upload.onprogress`.

### Sélecteur d'IP

L'interface PC affiche l'adresse active et la liste des autres candidates. En
changer régénère immédiatement le QR code.

C'est le mécanisme de secours essentiel du projet : si l'heuristique de
`network.js` se trompe (carte Hyper-V active, VPN, double carte réseau), le
téléphone scanne un QR qui ne mène nulle part. Le sélecteur rend ce cas résoluble
en deux clics au lieu d'exiger un débogage.

## Sécurité

Le serveur écoute sur toutes les interfaces (`0.0.0.0`), ce qui est nécessaire pour
que le téléphone l'atteigne. Le token de session est donc la seule barrière d'accès,
ce qui est proportionné à la menace : un réseau Wi-Fi domestique de confiance.

- **Token obligatoire** sur toutes les routes `/api/*`, comparé en temps constant,
  accepté en en-tête ou en paramètre d'URL selon ce que le mécanisme du navigateur
  permet.
- **Path traversal** : aucun chemin fourni par le client n'est utilisé directement ;
  `storage.resolve()` vérifie systématiquement le confinement dans le dossier partagé.
- **Pare-feu en profil privé uniquement.** La règle créée par `setup-firewall.bat`
  précise `profile=private`. Le port n'est jamais ouvert sur un profil `public` :
  branché sur le Wi-Fi d'un hôtel ou d'un aéroport, l'outil reste injoignable.
- **Pas de HTTPS.** En HTTP, l'upload de fichiers fonctionne sans restriction dans
  les navigateurs Android. HTTPS n'apporterait ici que des avertissements de
  certificat auto-signé. Le trafic reste confiné au LAN.

## Gestion des erreurs

| Situation | Comportement |
|---|---|
| Port 4455 déjà utilisé | message explicite en console nommant le port, et arrêt propre |
| Aucune adresse LAN détectée | message indiquant que le PC ne semble pas connecté à un réseau, et arrêt |
| Règle de pare-feu absente | avertissement au démarrage invitant à lancer `setup-firewall.bat` en administrateur ; le serveur démarre quand même (l'accès local fonctionne) |
| Upload interrompu | écriture sous un nom temporaire `.part`, renommage seulement à la complétion ; le fichier partiel est supprimé en cas d'erreur |
| Collision de nom | suffixe incrémental `(1)`, `(2)` |
| Disque plein ou écriture refusée | erreur 500 avec message lisible affiché dans l'interface, pas une trace d'exception |
| Téléchargement d'un id inexistant | 404 |
| Id sortant du dossier partagé | 403 |

## Pare-feu Windows

`setup-firewall.bat`, à exécuter une seule fois via clic droit → « Exécuter en tant
qu'administrateur » :

```bat
netsh advfirewall firewall add rule name="EasyTransfert" dir=in action=allow ^
  protocol=TCP localport=4455 profile=private
```

Au démarrage, `server.js` vérifie la présence de la règle
(`netsh advfirewall firewall show rule name="EasyTransfert"`) et avertit si elle
manque. Le programme ne tente jamais d'élévation de privilèges silencieuse :
l'utilisateur lance explicitement le script quand il le décide.

## Tests

Tests automatisés avec `node:test`, sans dépendance externe.

**`network.test.js`** — `listCandidateAddresses()` sur des sorties simulées de
`os.networkInterfaces()` : écarte les adresses internes, écarte les interfaces
virtuelles (`vEthernet (WSL)`, `VirtualBox Host-Only Network`), remonte Wi-Fi et
Ethernet en tête, retourne une liste vide sans erreur quand aucune interface ne
convient.

**`storage.test.js`** — sur un dossier temporaire : sanitisation des noms contenant
des caractères interdits Windows, nom vide après sanitisation remplacé par
`fichier`, collisions produisant `(1)` puis `(2)`, et `resolve()` levant une erreur
pour un id qui pointe hors du dossier partagé.

**`routes.test.js`** — serveur démarré sur un port éphémère : 401 sans token, 401
avec un mauvais token, acceptation du token aussi bien en en-tête qu'en paramètre
d'URL, upload suivi d'un `GET /api/files` montrant le fichier,
download restituant le contenu exact, 404 sur un id inexistant, 403 sur un id qui
s'échappe du dossier, suppression retirant bien le fichier.

**Vérification manuelle** — le transfert réel entre le PC et le Honor Magic 6 Pro
n'est pas automatisable ici et sera validé à la main : scan du QR, envoi dans les
deux sens, apparition en direct dans la liste de l'autre appareil.

## Décisions et leurs raisons

| Décision | Raison |
|---|---|
| Dossier partagé unique | symétrie gratuite, une seule interface, pas de notion de direction à coder |
| Le glisser-déposer PC copie le fichier | évite les références vers des fichiers déplacés ou supprimés |
| Node + Express, sans framework front | c'est l'écosystème quotidien de l'utilisateur ; zéro build à maintenir |
| SSE plutôt que polling | une vingtaine de lignes, et les fichiers reçus apparaissent instantanément |
| Port 4455, lancement à la demande | rien à configurer, pas de service résident |
| Pas de HTTPS | inutile sur LAN pour cet usage ; n'apporterait que des avertissements de certificat |
| Sélecteur d'IP dans l'interface | aucune heuristique de détection n'est fiable sur toutes les configurations Windows |
