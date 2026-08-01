# EasyTransfert

Transfert de fichiers entre un PC Windows et un smartphone, sur le réseau local,
sans rien installer sur le téléphone.

## Installation

1. `npm install`
2. Clic droit sur `setup-firewall.bat` → « Exécuter en tant qu'administrateur ». Une seule fois.

## Utilisation

Double-cliquer sur `easytransfert.bat`. Le navigateur s'ouvre sur l'interface,
qui affiche un QR code. Le scanner avec le téléphone ouvre la même interface.

Les fichiers déposés depuis l'un ou l'autre appareil atterrissent dans `partage/`
et sont visibles des deux côtés en direct.

## Si le téléphone n'arrive pas à ouvrir la page

Le PC a probablement plusieurs adresses réseau et le QR encode la mauvaise.
Utiliser le sélecteur « Adresse du PC » sur l'écran du PC pour en essayer une autre :
le QR code se régénère immédiatement.

Vérifier aussi que la règle de pare-feu a bien été créée, et que le PC est sur un
réseau déclaré **privé** dans Windows (la règle ne s'applique pas aux réseaux publics,
volontairement).

## Tests

`npm test`
