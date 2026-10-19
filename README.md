# Mes tâches — suivi de tâches personnel

Espace privé façon Notion pour suivre ses tâches, hébergé sur Cloudflare Workers. Même DA que Work_It (Geist, noir / blanc, blocs arrondis, pilules, mode jour / nuit).

## Fonctionnalités

- **Tableau de bord** : avancement global, tâches en cours / terminées, points cochés, carte de chaque catégorie avec son avancement, tâches en cours les plus avancées.
- **Tâches** : catégories (créer, renommer, supprimer), fiches de tâche dans chaque catégorie, filtre toutes / en cours / terminées.
- **Fiche de tâche** : se déplie pour modifier le titre, ajouter des notes et une liste de points à cocher (sous-tâches) avec barre de progression. Enregistrement automatique.
- **Admin** (comptes admin uniquement) : gestion de tous les comptes — liste (nom, email, rôle, entreprise, dernière connexion), création (personnel ou gestionnaire d’entreprise), modification et suppression.

L'avancement d'une tâche vaut 100 % quand elle est terminée, sinon la part de ses points cochés. Celui d'une catégorie est la moyenne de ses tâches.

## Rôles

- **Personnel** : espace privé avec ses catégories et ses tâches (tableau de bord, tâches).
- **Gestionnaire** : gère une entreprise. Ses menus :
  - **Tableau de bord entreprise** : avancement global, par projet et par salarié, tâches non assignées.
  - **Projets** : les projets de l'entreprise (à la place des catégories), leurs tâches et à qui elles sont assignées (une tâche peut avoir plusieurs salariés). Un salarié assigné à une tâche devient membre du projet ; on peut aussi choisir les salariés d'un projet dans « Modifier ».
  - **Gestion de mon entreprise** : nom de l'entreprise, création / modification (nom, email, mot de passe) / suppression des comptes salariés.
- **Salarié (worker)** : compte créé par un gestionnaire. Il voit uniquement les tâches qui lui sont assignées, peut les modifier et les cocher, et peut créer des tâches dans les projets dont il est membre (elles lui sont assignées). Il ne supprime que les tâches qu'il a créées et ne change pas les assignations.

## Comptes

Les comptes se gèrent **depuis le site**, menu **Admin** (réservé aux comptes admin) :

- **+ Nouveau compte** : nom, email, mot de passe, rôle (Personnel ou Gestionnaire — avec le nom de son entreprise), accès admin.
- Sur chaque ligne : **Modifier** (nom, email, nouveau mot de passe, rôle, accès admin) ou **Supprimer**.
- Les salariés sont créés par leur gestionnaire ; l'admin peut modifier leur nom, email et mot de passe.
- Changer l'email garde les données du compte. Changer un mot de passe déconnecte les sessions ouvertes de ce compte.
- Supprimer un compte personnel efface ses catégories et tâches ; supprimer un gestionnaire supprime aussi son entreprise (salariés, projets, tâches) ; supprimer un salarié le retire de ses tâches et projets.
- Par sécurité, on ne peut ni supprimer son propre compte, ni retirer son propre accès admin.

Les comptes et entreprises sont stockés dans une base Cloudflare dédiée (Durable Object « registre »), avec les mots de passe chiffrés (PBKDF2). Chaque entreprise a sa propre base partagée (projets, tâches). [`users.json`](users.json) ne sert qu'à **remplir le registre au tout premier démarrage** ; le modifier ensuite (à la main ou avec `npm run user`) n'a plus d'effet.

## Lien avec le Hub

- **Tâches sur l'accueil du Hub** : le Hub lit les catégories et tâches d'un compte par le point d'entrée privé `HubLink` (`src/index.js`), appelé par « service binding ». Il n'a aucune adresse publique : seul un Worker du même compte Cloudflare peut l'appeler. Le Worker doit donc s'appeler `mes-taches`.
- **Connexion automatique** : `GET /api/sso?token=…` ouvre une session pour le compte désigné par un jeton signé par le Hub (Ed25519, 60 s, usage unique, destiné à ce site). Ajouter la variable `HUB_PUBLIC_KEY` (Settings → Variables and Secrets), obtenue avec `npm run sso-keys` dans le Hub.

## Configuration Cloudflare (une seule fois)

Projet **Workers** relié au dépôt GitHub (Workers & Pages → Create → Import a repository) :

1. Le nom du Worker dans Cloudflare doit être identique à `name` dans [`wrangler.jsonc`](wrangler.jsonc) (`mes-taches`), ou modifie ce champ.
2. Build : commande de build vide, commande de déploiement `npx wrangler deploy`.
3. Settings → Variables and Secrets, ajoute en **Secret** `SESSION_SECRET` : une longue chaîne aléatoire.

Le stockage (Durable Object SQLite, une base par compte) est créé automatiquement au premier déploiement, rien d'autre à configurer.

## Développement local

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev                       # http://localhost:8787
```

## Structure

- `src/index.js` — API, connexion, sessions, rôles et droits, gestion des comptes et des entreprises
- `src/store.js` — base SQLite par compte ou par entreprise (catégories / projets, tâches, journal) et registre des comptes et entreprises
- `src/password.js` — chiffrement des mots de passe (PBKDF2)
- `scripts/user.mjs` — gestion des comptes (`npm run user`)
- `public/` — interface (HTML / CSS / JS, sans build)
