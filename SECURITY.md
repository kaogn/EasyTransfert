# Sécurité / Security

*(English below)*

## Ce que ce projet ne prétend pas être

EasyTransfert est un outil de transfert de fichiers **sur un réseau domestique de
confiance**. Ce n'est pas un outil sécurisé pour Internet, et il n'a pas vocation à le
devenir.

Concrètement, et par conception :

- tout circule en **HTTP simple**, sans chiffrement ;
- le **jeton d'accès transite dans l'URL**, donc lisible par qui observe le réseau ;
- ce jeton donne **tous les droits** sur le dossier partagé, y compris la suppression ;
- un **code à six chiffres** permet d'obtenir ce jeton sans authentification préalable,
  protégé uniquement par une limitation du débit des tentatives.

**Ne l'utilisez pas sur un Wi-Fi que vous ne maîtrisez pas** — résidence étudiante,
bureau, café, hôtel, coworking. **N'y déposez pas de fichiers sensibles** : documents
d'identité, données bancaires, mots de passe, dossiers médicaux.

Pour transférer des fichiers sur un réseau non maîtrisé, utilisez un outil chiffré de bout
en bout, par exemple [LocalSend](https://localsend.org).

Le détail complet des limites figure dans le [README](README.fr.md).

## Signaler un problème

Les issues de ce dépôt sont **désactivées** : c'est un projet personnel, publié tel quel,
sans support.

Si vous découvrez une faille qui sort du cadre décrit ci-dessus — c'est-à-dire autre chose
que « le trafic n'est pas chiffré » ou « le jeton est dans l'URL », qui sont des choix
assumés — utilisez l'onglet **Security → Report a vulnerability** de GitHub, qui permet un
signalement privé.

Aucun délai de réponse n'est garanti, et aucun correctif n'est promis. Vous êtes libre de
forker le projet et de le corriger vous-même : c'est à cela que sert la licence MIT.

## Versions

Seule la dernière version publiée reçoit d'éventuelles corrections. Les versions
antérieures ne sont pas maintenues.

---

# Security policy

## What this project does not claim to be

EasyTransfert transfers files **over a trusted home network**. It is not a secure tool for
the Internet, and it is not meant to become one.

By design:

- everything travels over **plain HTTP**, unencrypted;
- the **access token travels in the URL**, readable by anyone observing the network;
- that token grants **full rights** over the shared folder, deletion included;
- a **six-digit code** hands out that token without prior authentication, protected only
  by rate limiting.

**Do not use it on a Wi-Fi network you do not control** — student housing, office, café,
hotel, coworking space. **Do not put sensitive files in it**: identity documents, banking
data, passwords, medical records.

To send files over an untrusted network, use an end-to-end encrypted tool such as
[LocalSend](https://localsend.org).

The full list of limitations is in the [README](README.md).

## Reporting a problem

Issues are **disabled** on this repository: it is a personal project, published as-is,
without support.

If you find a flaw that falls outside the scope described above — meaning something other
than "traffic is unencrypted" or "the token is in the URL", which are deliberate choices —
use GitHub's **Security → Report a vulnerability** tab for a private report.

No response time is guaranteed and no fix is promised. You are free to fork the project
and fix it yourself: that is what the MIT licence is for.

## Versions

Only the latest published release receives any fixes. Earlier versions are not maintained.
