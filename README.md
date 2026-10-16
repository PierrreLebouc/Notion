# Notion perso

Petit gestionnaire de tâches façon Notion, hébergé sur **Cloudflare Pages**.

- Catégories de tâches (barre latérale)
- Fiches de tâche dans chaque catégorie, à cocher quand elles sont terminées
- Chaque fiche se déplie : notes + liste de sous-tâches à cocher avec barre de progression
- Page de connexion ; comptes stockés en dur dans `lib/users.js`
- Données et sessions stockées dans Cloudflare KV (un espace par utilisateur)

## Structure

```
public/            fichiers statiques (login.html, index.html, app.js, style.css)
functions/         Pages Functions (API + middleware d'authentification)
  _middleware.js   redirige vers /login si pas de session
  api/login.js     POST  /api/login
  api/logout.js    POST  /api/logout
  api/data.js      GET / PUT /api/data
lib/users.js       utilisateurs (username / mot de passe en dur)
lib/session.js     gestion des sessions (cookie + KV)
```

## Utilisateurs

Modifier `lib/users.js` :

```js
export const USERS = [
  { username: "pierre", password: "changeme" },
];
```

⚠️ Si le dépôt GitHub est public, ces identifiants sont visibles : passe le dépôt en privé.

## Développement local

```bash
npm install
npm run dev        # http://localhost:8788
```

## Déploiement sur Cloudflare

1. Créer un namespace KV : Cloudflare dashboard → **Storage & Databases → KV → Create**
   (ou `npx wrangler kv namespace create DATA`), puis mettre son id dans `wrangler.toml`.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**, choisir ce dépôt.
   - Framework preset : *None*
   - Build command : *(vide)*
   - Build output directory : `public`
3. Si le binding n'est pas repris de `wrangler.toml` : **Settings → Bindings → Add → KV namespace**,
   nom de variable `DATA`, puis redéployer.

Chaque push sur `main` redéploie automatiquement.
