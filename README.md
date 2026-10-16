# Mes tâches — suivi de tâches personnel

Espace privé façon Notion pour suivre ses tâches, hébergé sur Cloudflare Workers. Même DA que Work_It (Geist, noir / blanc, blocs arrondis, pilules, mode jour / nuit).

## Fonctionnalités

- **Tableau de bord** : avancement global, tâches en cours / terminées, points cochés, carte de chaque catégorie avec son avancement, tâches en cours les plus avancées.
- **Tâches** : catégories (créer, renommer, supprimer), fiches de tâche dans chaque catégorie, filtre toutes / en cours / terminées.
- **Fiche de tâche** : se déplie pour modifier le titre, ajouter des notes et une liste de points à cocher (sous-tâches) avec barre de progression. Enregistrement automatique.
- **Admin** (comptes admin uniquement) : liste des profils avec leur avancement, nombre de catégories / tâches / points cochés, dernière connexion et dernière activité ; détail par profil avec l'avancement de chaque catégorie et le journal d'activité.

L'avancement d'une tâche vaut 100 % quand elle est terminée, sinon la part de ses points cochés. Celui d'une catégorie est la moyenne de ses tâches.

## Comptes

Les comptes sont dans [`users.json`](users.json) ; les mots de passe y sont **chiffrés** (jamais en clair). On les gère avec une commande, depuis le dossier du projet :

```bash
npm run user -- list                              # voir les comptes (★ = admin)
npm run user -- add marie@exemple.fr "Marie"      # ajouter un compte (le mot de passe est demandé)
npm run user -- add paul@exemple.fr "Paul" --admin
npm run user -- password marie@exemple.fr         # changer un mot de passe
npm run user -- admin marie@exemple.fr oui        # donner (oui) ou retirer (non) l'accès admin
npm run user -- rename marie@exemple.fr "Marie D."
npm run user -- remove marie@exemple.fr           # supprimer l'accès (les données restent stockées)
```

Puis commit + push (Cloudflare redéploie). Chaque compte a ses propres données, rattachées à son email.

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

- `src/index.js` — API, connexion, sessions, accès admin
- `src/store.js` — base SQLite privée par compte (catégories, tâches, journal)
- `src/password.js` — chiffrement des mots de passe (PBKDF2)
- `scripts/user.mjs` — gestion des comptes (`npm run user`)
- `public/` — interface (HTML / CSS / JS, sans build)
