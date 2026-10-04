# Sténo

Un outil de bureau qui corrige automatiquement vos textes en français à l'aide de l'API OpenAI.

## 🚀 Fonctionnalités

-   Correction orthographique, grammaticale et de ponctuation en français
-   Raccourci clavier global pour une correction rapide
-   Fonctionne directement avec le presse-papiers
-   Compatible Windows et macOS

## 📋 Prérequis

-   Node.js (version 14 ou supérieure)
-   Une clé API OpenAI

## 🛠️ Installation

1. Clonez le dépôt :

```bash
git clone [URL_DU_REPO]
cd spell-check-electron
```

2. Installez les dépendances :

```bash
npm install
```

3. Créez un fichier `.env` à la racine du projet et ajoutez votre clé API OpenAI :

```env
OPENAI_API_KEY=votre_clé_api_ici
```

## 🚀 Utilisation

1. Démarrez l'application :

```bash
npm run dev
```

2. L'application s'exécute en arrière-plan (pas d'interface visible)
3. Copiez le texte que vous souhaitez corriger (Ctrl+C ou Cmd+C)
4. Utilisez le raccourci global :
    - Windows : `Ctrl + O`
    - macOS : `Cmd + O`
5. Le texte corrigé remplace automatiquement le contenu de votre presse-papiers

## ⚙️ Configuration

Le raccourci clavier est configuré par défaut sur :

-   Windows/Linux : `Control+O`
-   macOS : `Command+O`

## 🤖 Fonctionnement

L'application utilise l'API GPT-3.5 Turbo d'OpenAI pour effectuer les corrections. Elle est configurée pour :

-   Corriger l'orthographe
-   Corriger la grammaire
-   Corriger la ponctuation
-   Préserver le sens du texte original

## 📝 Notes

-   L'application nécessite une connexion Internet pour fonctionner
-   Chaque correction consomme un appel à l'API OpenAI
-   L'application fonctionne uniquement avec des textes en français

## 🔒 Sécurité

-   Ne partagez jamais votre fichier `.env` contenant votre clé API
-   Le fichier `.env` est automatiquement ignoré par Git

## 📄 Licence

Antonin Ricard

## 🤝 Contribution

Les contributions sont les bienvenues ! N'hésitez pas à ouvrir une issue ou à proposer une pull request.
