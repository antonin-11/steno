# Sténo

Une app macOS qui corrige vos textes en français et transcrit votre voix : dictée, appels et mémos vocaux. Les modèles d'IA sont appelés via [Vercel AI Gateway](https://vercel.com/ai-gateway).

## 🚀 Fonctionnalités

-   **Correction (`Cmd+O`)** : copiez un texte, appuyez sur `Cmd+O`, le texte corrigé (orthographe, grammaire, ponctuation, sans reformulation) est collé à la place du curseur.
-   **Dictée (Option droite + Cmd droite)** : maintenez les deux touches ensemble, parlez, relâchez : le texte transcrit est collé à la place du curseur. Une seule des deux ne déclenche rien. Le son du Mac est coupé pendant la dictée. La langue se règle dans la page Dictées (français par défaut).
-   **Appels** : les appels Slack, Teams et Google Meet (dans Chrome, Arc, Dia, Comet, Brave ou Edge) sont enregistrés automatiquement (micro et son du Mac), puis transcrits avec séparation des interlocuteurs. Un indicateur s'affiche pendant l'enregistrement : pilule flottante ou point rouge dans la barre de menus.
-   **Mémos vocaux** : les nouveaux mémos de Dictaphone sont récupérés, transcrits (transcription d'Apple si elle existe, sinon via le Gateway), puis corrigés.
-   **Dictionnaire** : mots et expressions à ne jamais corriger, aussi fournis à la dictée pour les reconnaître.
-   **Historique** : la fenêtre de l'app regroupe les corrections, les dictées, les mémos vocaux et les réunions, avec le coût de chaque appel au Gateway.

Les modèles utilisés sont définis en haut de `index.js`.

## 📋 Prérequis

-   macOS 14.2 ou plus récent (nécessaire pour enregistrer le son du Mac)
-   Node.js et pnpm
-   Les outils en ligne de commande de Xcode (`xcode-select --install`), pour compiler le helper natif en Swift
-   ffmpeg (`brew install ffmpeg`), pour compresser les enregistrements d'appels
-   Une clé API Vercel AI Gateway

## 🛠️ Installation

1. Clonez le dépôt et installez les dépendances :

```bash
git clone git@github.com:antonin-11/steno.git
cd steno
pnpm install
```

pnpm bloque les scripts d'installation des paquets tant qu'ils ne sont pas approuvés : la liste est dans `pnpm-workspace.yaml` (`allowBuilds`).

2. Créez un fichier `.env` à la racine du projet avec votre clé :

```env
AI_GATEWAY_API_KEY=votre_clé_api_ici
```

3. Compilez le helper natif (écoute du clavier, collage, enregistrement audio) dans `bin/` :

```bash
pnpm run build:native
```

4. Créez le certificat de signature « Steno Dev », une seule fois (recommandé, voir [Permissions macOS](#-permissions-macos)) :
    1. Ouvrez Keychain Access, puis le menu Keychain Access › Certificate Assistant › Create a Certificate…
    2. Name : `Steno Dev`, Identity Type : Self Signed Root, Certificate Type : Code Signing.
    3. Cochez « Let me override defaults » et indiquez une longue durée de validité (par exemple 3650 jours) : un nouveau certificat obligerait à réautoriser les permissions.
    4. Une fois créé, ouvrez le certificat (double-clic), section Trust, et réglez Code Signing sur Always Trust. electron-builder ignore les certificats non approuvés.

    Au premier build signé, macOS demande l'accès à la clé du certificat : choisissez « Always Allow ».

## 🧑‍💻 Développement et app installée

Deux modes, qui ne tournent jamais en même temps (une deuxième instance s'arrête aussitôt) :

| Commande | Effet |
| --- | --- |
| `pnpm run dev` | Mode dev : lance l'app depuis le dossier du projet, sans empaquetage. |
| `steno` | Fonction zsh qui lance le mode dev en arrière-plan, avec les logs dans `/tmp/steno.log`. |
| `pnpm run release` | Construit `Sténo.app` avec electron-builder, arrête Sténo (app installée et mode dev), copie le `.env` dans le dossier de données, remplace `/Applications/Sténo.app` et la relance. |
| `pnpm run package` | Construit seulement `dist/mac-arm64/Sténo.app`, sans l'installer. |

La configuration d'electron-builder est dans la clé `build` de `package.json`. `pnpm run release` et `pnpm run package` recompilent le helper ; en mode dev, relancez `pnpm run build:native` après une modification de `native/`.

Les logs n'existent qu'en mode dev (`/tmp/steno.log` avec `steno`, sinon dans le terminal) : pour déboguer, reproduisez le problème en mode dev.

## 🔐 Permissions macOS

| Permission | Pour |
| --- | --- |
| Accessibilité | Écouter le raccourci de dictée (Option droite + Cmd droite), et coller le texte via System Events |
| Micro | Dictée et appels |
| Enregistrement audio système | Son des autres participants pendant les appels |
| Automatisation | Piloter System Events pour coller, et lire l'adresse des onglets du navigateur pour repérer un appel |
| Accès complet au disque | Lire les mémos de Dictaphone |

-   **App installée** : toutes les permissions sont accordées à « Sténo ».
-   **Mode dev** : le raccourci de dictée, le micro et le son système passent par `steno-recorder` (le helper), qui reçoit ces permissions ; le collage, l'Automatisation et l'Accès complet au disque passent par le terminal qui lance Sténo.

Le collage passe par System Events, et non par le helper : macOS refuse à un exécutable nu comme `steno-recorder` d'envoyer lui-même des frappes clavier, même avec l'Accessibilité.

macOS reconnaît une app à sa signature. Avec le certificat « Steno Dev », elle reste la même d'une version à l'autre et les permissions sont conservées. Sans certificat, la signature est ad hoc : macOS redemande les permissions après chaque compilation.

## 🗂️ Données

Tout est dans `~/Library/Application Support/spell-check-electron/`, un dossier qui garde volontairement l'ancien nom de l'app pour ne pas perdre les données : historique, dictionnaire, réunions, réglages, et le `.env` de l'app installée.

## 🔒 Sécurité

-   La clé API n'est jamais incluse dans `Sténo.app` : l'app installée la lit dans son dossier de données. Partager l'app ne partage donc pas la clé.
-   Ne partagez jamais votre fichier `.env`. Il est ignoré par Git.

## 📄 Licence

Antonin Ricard

## 🤝 Contribution

Les contributions sont les bienvenues ! N'hésitez pas à ouvrir une issue ou à proposer une pull request.
