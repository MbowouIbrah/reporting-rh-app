# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- DRH et DOP (lecteurs globaux, marge et fiches nominatives): ouvrent un mois, lisent masse salariale, effectifs, variations M-1, et les présentent.
- Directeurs de périmètre (Equipment, Commerce VN): agrégats de leur périmètre seulement, sans marge ni nominatif.
- Admin RH: importe la paie, contrôle les écarts, clôture les périodes.
- Usage bureau d'abord ; écrans aussi projetés ou imprimés en comité de direction.

## Product Purpose
Remplacer le classeur Excel de reporting RH (CFAO) par une application web : masse salariale, effectifs, rotation, absentéisme, commissions, primes, marge, comparatifs mensuel et annuel, fiche individuelle. Le travail principal est de lire et présenter les chiffres du mois ; le contrôle des données est secondaire. Réussite : lecture immédiate des chiffres et de leurs variations, valeurs identiques à l'Excel au FCFA près.

## Positioning
Reprend fidèlement les indicateurs de l'Excel d'origine, avec droits par rôle et périmètre appliqués côté serveur, contrôles de cohérence et traçabilité des lectures nominatives.

## Operating Context
Données financières et nominatives sensibles. Import mensuel de la paie. Montants en FCFA, libellés en français. Hébergé derrière le nginx d'Academy, sous `/reporting-rh/`.

## Capabilities and Constraints
- Pages: Résumé, Mensuel (blocs A type de charge, B service/activité, C site, D contrat), Annuel, Graphes, Individuel, Connexion ; pages d'administration à venir (P6).
- Présentation seulement : ne pas toucher à `api/`, `auth/`, `hooks/`, `lib/format.ts`, ni aux règles de masquage (marge sans `marge:read`, fiche sans `nominatif:read`).
- Un montant absent s'affiche « — », jamais 0 ; « n/a » pour une division par zéro ; filtres indépendants par page, portés par l'URL.
- Stack: React 19, TypeScript, Vite, TanStack Query, react-router, recharts.

## Brand Commitments
Identité CFAO Academy à conserver: rouge #e3001b, marine #1a1f3c, Space Grotesk / DM Sans / JetBrains Mono (tokens dans `src/styles/tokens.css`).

## Evidence on Hand
Pages fonctionnelles et testées (14 vitest, 7 Playwright par rôle). Données de démo: 2 mois (2026-01, 2026-02). Aucune capture « avant » encore faite. Comptes de démo: voir PASSATION.md.

## Product Principles
- Le chiffre est le héros ; la variation se lit d'un coup d'œil, jamais par la couleur seule.
- Fidélité aux chiffres avant l'expression : aucune valeur ni règle de masquage altérée par la présentation.
- Lisible en réunion : projeté ou imprimé, sans perdre la densité utile des tableaux.
- Le périmètre de l'utilisateur est évident à l'écran, sans jamais exposer ce qu'il ne peut pas voir.

## Accessibility & Inclusion
Contraste AA minimum, navigation clavier, focus visible, `prefers-reduced-motion`, libellés sémantiques ; impression d'un rapport.
