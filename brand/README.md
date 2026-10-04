# Identité de Sténo

Sténo écoute ce que tu dis et le rend bien écrit. Le logo raconte ça : une onde sonore qui devient des lignes de texte.

## Fichiers

| Fichier | Usage |
| --- | --- |
| `logo/steno-logo.svg` | Logo terracotta, fond transparent. Version de référence |
| `logo/steno-logo-black.svg` | Logo noir, pour les fonds clairs en une couleur |
| `logo/steno-logo-white.svg` | Logo blanc, pour les fonds sombres ou colorés |
| `logo/*.png` | Les trois logos en PNG transparent, 1080 x 1000 px |
| `icon/steno-icon.svg` | Icône macOS avec relief. Source de toutes les tailles |
| `icon/steno-icon.icns` | Icône macOS prête à l'emploi (16 à 1024 px), pour une app empaquetée |
| `icon/png/steno-icon-*.png` | Icône en PNG transparent : 16, 32, 64, 128, 256, 512 et 1024 px |

Les SVG sont les fichiers maîtres. Après une modification, on régénère les PNG et le `.icns` avec :

```bash
pnpm run build:brand
```

## Couleurs

| Nom | Valeur | Usage |
| --- | --- | --- |
| Terracotta | `#c96d4e` | Couleur du logo |
| Encre | `#1f1f1e` | Logo noir, texte de l'app |
| Papier | `#f3f2ef` | Fond de l'app |

## Construction

- **Logo :** dessiné dans un carré de 54 x 50 avec un trait de 8 aux bouts arrondis. L'onde fait une période et demie, sur 46 de large et 6 d'amplitude. En dessous, une ligne pleine largeur et une ligne de 28.
- **Icône :** forme des icônes macOS (824 px à coins continus, centrée dans 1024 px). Le relief est calé sur les icônes macOS 26 de Slack et Figma :
  - fond en dégradé du blanc à `#ebeae6`, avec un bord blanc d'environ 1,5 % de la largeur ;
  - traits terracotta bordés d'un liseré plus clair, marqué en haut à gauche ;
  - ombre neutre très légère sous les traits.

  Mieux vaut garder ces effets discrets.
