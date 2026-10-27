# NaturaLift

Appli web (PWA) de nutrition pour la musculation naturelle : calcul des calories et des macros, journal alimentaire, suivi du poids et bilans. Tout en français, utilisable hors-ligne, installable sur l'écran d'accueil du téléphone.

## Fonctionnalités

- **Objectif** : calcul des besoins (formule Mifflin-St Jeor × niveau d'activité) et des macros selon l'objectif (sèche, prise de masse, maintien, recomposition), avec un plancher de lipides.
- **Dépense réelle** : après quelques semaines de journal et de pesées, l'appli calcule ta vraie dépense (apports moyens + évolution du poids) et propose de l'utiliser à la place de la formule.
- **Journal du jour** : toucher un aliment pour modifier sa quantité ; quantités en grammes ou en portions (« 2 œufs ») ; recherche dans ta base d'aliments (sans tenir compte des accents), scan de code-barres (Open Food Facts), saisie manuelle avec photo, repas favoris, copie du journal de la veille.
- **Toutes les journées** : flèches ‹ › pour passer d'un jour à l'autre et compléter un oubli.
- **Type de journée** : glucides ajustés les jours d'entraînement (+15 %) et de repos (−15 %).
- **Historique** : liste, calendrier coloré et bilans sur 7 et 30 jours.
- **Poids** : pesées datées, courbe de tendance sur 7 jours, suggestion d'ajustement, mise à jour des cibles quand le poids change, mensurations.
- **Annuler** : chaque suppression peut être annulée pendant quelques secondes.
- **Sauvegarde** : export / import JSON de toutes les données, avec rappel si la dernière sauvegarde est ancienne.

## Appli Android

Le dossier `android/` contient une petite appli Android qui affiche NaturaLift et ajoute ce qu'une PWA ne peut pas faire :

- **Rappel de coucher** : l'appli lit le prochain réveil de l'Horloge du téléphone, calcule l'heure de coucher (réveil − sommeil voulu − temps d'endormissement) et envoie une vraie notification avant.
- **Sauvegarde** : l'export JSON est enregistré dans Téléchargements.

Le code de l'appli web reste à la racine : il est copié dans l'APK à chaque construction. L'APK est construit automatiquement par GitHub Actions (`.github/workflows/android.yml`) et se télécharge dans l'onglet **Actions** du dépôt. Il faut deux secrets dans *Settings → Secrets and variables → Actions* : `KEYSTORE_B64` (la clé de signature en base64) et `KEYSTORE_PASSWORD`. Garde le fichier `naturalift.jks` en lieu sûr : sans lui, impossible de mettre l'appli à jour sur le téléphone.

## Technique

- HTML, CSS et JavaScript « vanilla » : aucun framework, aucune installation, aucune étape de build.
- Compatible avec les anciens navigateurs Android (pas de `?.`, `??`, `=>`, `let`/`const`).
- Données stockées uniquement sur l'appareil (`localStorage`). Rien n'est envoyé sur un serveur, sauf le code-barres scanné, transmis à Open Food Facts.
- Scanner : détecteur natif du navigateur (`BarcodeDetector`) quand il existe, sinon la bibliothèque [html5-qrcode](https://github.com/mebjas/html5-qrcode) v2.3.8 (licence Apache-2.0), hébergée dans le dépôt et chargée seulement à la demande.
- Sécurité : tout fichier importé est vérifié champ par champ ; les textes affichés sont échappés ; aucun script externe.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `index.html` | Structure de toutes les pages |
| `style.css` | Apparence (couleurs dans `:root` en haut du fichier) |
| `app.js` | Toute la logique de l'appli |
| `sw.js` | Service worker : fonctionnement hors-ligne |
| `manifest.json` | Nom, icônes et couleurs de l'appli installée |
| `html5-qrcode.min.js` | Module de secours du scanner (bibliothèque externe, ne pas modifier) |

## Mettre à jour

Remplace simplement les fichiers modifiés sur GitHub. Le service worker va toujours chercher la dernière version en ligne : plus besoin de changer un numéro de version.

Sur le téléphone, ferme complètement l'appli puis rouvre-la pour charger la nouvelle version.

## Avertissement

Outil indicatif : il ne remplace pas l'avis d'un professionnel de santé ou d'un coach diplômé.
