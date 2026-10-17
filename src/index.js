import usersFile from "../users.json";
import { Store } from "./store.js";
import { hashPassword, verifyPassword } from "./password.js";

export { Store };

const COOKIE = "mt_session";
const SESSION_DAYS = 30;
const COLLECTIONS = ["categories", "tasks"];

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
const fail = (message, status = 400) => json({ error: message }, status);

// --- Comptes et sessions signées ---
// Les comptes vivent dans une base dédiée (le « registre »), gérée depuis le menu Admin.
// users.json ne sert qu'à la remplir la toute première fois.
const registry = (env) => env.STORE.get(env.STORE.idFromName("__registre_comptes__"));
const seedUsers = () => (usersFile.users || []).filter((u) => u.email && u.passwordHash);
const users = async (env) => (await registry(env).accounts(seedUsers())).filter((u) => u.email && u.passwordHash);
const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const findUser = async (env, email) => (await users(env)).find((u) => same(u.email, email));
const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function sign(env, text) {
  // Sans SESSION_SECRET, la clé dérive du fichier des comptes : changer un mot de passe déconnecte ce compte.
  const secret = env.SESSION_SECRET || JSON.stringify(usersFile);
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}

// La session porte la clé fixe du compte : elle reste valide si l'email change, pas si le mot de passe change.
async function makeToken(env, user) {
  const payload = b64url(enc.encode(JSON.stringify({ e: user.key, x: Date.now() + SESSION_DAYS * 864e5 })));
  return `${payload}.${await sign(env, payload + user.passwordHash)}`;
}

async function readSession(request, env) {
  const cookie = request.headers.get("cookie") || "";
  const token = cookie.split(/;\s*/).find((c) => c.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
  if (!token) return null;
  const [payload, sig] = token.split(".");
  try {
    const data = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    const user = (await users(env)).find((u) => same(u.key, data.e));
    if (!user || data.x < Date.now()) return null;
    return (await sign(env, payload + user.passwordHash)) === sig ? user : null;
  } catch {
    return null;
  }
}

const sessionCookie = (value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

const storeFor = (env, user) => env.STORE.get(env.STORE.idFromName(user.key));
const companyStore = (env, companyId) => env.STORE.get(env.STORE.idFromName("entreprise:" + companyId));

// Rôles : "perso" (catégories personnelles), "manager" (gestionnaire d'une entreprise), "worker" (salarié).
// L'accès admin (gestion de tous les comptes du site) est indépendant du rôle.
const ROLES = ["perso", "manager", "worker"];
const roleOf = (u) => (ROLES.includes(u.role) ? u.role : "perso");
const inCompany = (u) => roleOf(u) !== "perso" && u.companyId;
const companies = async (env) => registry(env).companies();
const companyOf = async (env, u) => (inCompany(u) ? (await companies(env)).find((c) => c.id === u.companyId) || null : null);
const publicUser = (u, company) => ({
  key: u.key, email: u.email, name: u.name || u.email, admin: u.admin === true,
  role: roleOf(u), companyId: u.companyId || null, companyName: company?.name || null,
});
const person = (u) => ({ key: u.key, name: u.name || u.email, email: u.email, role: roleOf(u) });
const companyPeople = (all, companyId) => all.filter((u) => inCompany(u) && u.companyId === companyId);

// Création / modification d'un compte ; renvoie [compte, null] ou [null, message d'erreur].
// `force` impose certains champs (ex. rôle salarié et entreprise pour les comptes créés par un gestionnaire).
async function editAccount(env, all, prev, body, force = {}) {
  const next = { ...(prev || { key: null, created: Date.now() }) };
  if (body.email !== undefined || !prev) {
    const email = String(body.email || "").trim();
    if (!isEmail(email)) return [null, "Adresse email invalide."];
    if (all.some((u) => u !== prev && same(u.email, email))) return [null, `Un compte utilise déjà ${email}.`];
    next.email = email;
  }
  if (body.name !== undefined || !prev) next.name = String(body.name || "").trim() || next.email.split("@")[0];
  if (body.admin !== undefined) next.admin = body.admin === true;
  if (body.password || !prev) {
    if (String(body.password || "").length < 8) return [null, "Le mot de passe doit faire au moins 8 caractères."];
    next.passwordHash = await hashPassword(String(body.password));
  }
  Object.assign(next, force);
  if (!prev) {
    // Clé fixe du compte : son email de départ, sauf si une ancienne donnée l'occupe déjà.
    next.key = all.some((u) => same(u.key, next.email)) ? `${next.email.toLowerCase()}#${crypto.randomUUID().slice(0, 8)}` : next.email.toLowerCase();
  }
  next.updated = Date.now();
  return [next, null];
}

// Supprime un compte et ses données personnelles ; pour un salarié, le retire aussi des projets et tâches.
async function deleteAccount(env, account) {
  await registry(env).removeAccount(account.key);
  await storeFor(env, account).wipe();
  if (roleOf(account) === "worker" && account.companyId) await companyStore(env, account.companyId).forgetPerson(account.key);
}

// Libellé du journal pour l'enregistrement d'une catégorie / d'un projet ou d'une tâche.
function changeLabel(coll, prev, saved, word = "Catégorie") {
  if (coll === "categories") {
    if (!prev) return ["cat_add", `${word} créé${word === "Projet" ? "" : "e"} · ${saved.name}`];
    return ["cat_edit", prev.name !== saved.name ? `${word} renommé${word === "Projet" ? "" : "e"} · ${prev.name} → ${saved.name}` : `${word} modifié${word === "Projet" ? "" : "e"} · ${saved.name}`];
  }
  if (!prev) return ["task_add", `Tâche ajoutée · ${saved.title}`];
  if (!prev.done && saved.done) return ["task_done", `Tâche terminée · ${saved.title}`];
  if (prev.done && !saved.done) return ["task_reopen", `Tâche rouverte · ${saved.title}`];
  return ["task_edit", `Tâche modifiée · ${saved.title}`];
}

const list = (v) => (Array.isArray(v) ? [...new Set(v.map(String))] : []);
// Un salarié voit les tâches qui lui sont assignées, et les projets dont il est membre ou où il a une tâche.
const assignedTo = (t, key) => list(t.assignees).includes(key);
function workerView(data, key) {
  const tasks = data.tasks.filter((t) => assignedTo(t, key));
  const ids = new Set(tasks.map((t) => t.categoryId));
  return { categories: data.categories.filter((c) => list(c.members).includes(key) || ids.has(c.id)), tasks };
}

// Enregistrement / suppression dans l'espace d'une entreprise, avec les droits du gestionnaire ou du salarié.
async function companyItems(request, env, user, all, coll, id, method) {
  const store = companyStore(env, user.companyId);
  const manager = roleOf(user) === "manager";
  const workers = companyPeople(all, user.companyId).filter((u) => roleOf(u) === "worker").map((u) => u.key);
  const prev = id ? await store.get(coll, id) : null;
  const log = (kind, label) => store.addEvent({ kind, label: `${user.name || user.email} · ${label}` });

  if (coll === "categories") {
    if (!manager) return fail("Seul le gestionnaire peut gérer les projets.", 403);
    if (method === "PUT") {
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== "object") return fail("Données invalides.");
      const saved = await store.put(coll, id, { ...body, members: list(body.members).filter((k) => workers.includes(k)) });
      const [kind, label] = changeLabel(coll, prev, saved, "Projet");
      await log(kind, label);
      return json(saved);
    }
    if (method === "DELETE") {
      const n = await store.removeCategory(id);
      await log("cat_delete", `Projet supprimé · ${prev?.name || ""}${n ? ` (${n} tâche${n > 1 ? "s" : ""})` : ""}`);
      return json({ ok: true });
    }
  }

  if (coll === "tasks") {
    if (method === "PUT") {
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== "object") return fail("Données invalides.");
      const project = await store.get("categories", body.categoryId);
      if (!project) return fail("Projet introuvable.");
      let doc;
      if (manager) {
        doc = { ...body, assignees: list(body.assignees).filter((k) => workers.includes(k)), createdBy: prev?.createdBy || user.key };
        // Les salariés assignés deviennent membres du projet (ils pourront y créer des tâches).
        const members = list(project.members);
        const added = doc.assignees.filter((k) => !members.includes(k));
        if (added.length) await store.put("categories", project.id, { ...project, members: [...members, ...added] });
      } else {
        if (prev && !assignedTo(prev, user.key)) return fail("Cette tâche ne t'est pas assignée.", 403);
        if (!list(project.members).includes(user.key) && !(prev && prev.categoryId === project.id)) return fail("Tu n'es pas membre de ce projet.", 403);
        // Un salarié ne change pas les assignations ; une tâche qu'il crée lui est assignée.
        doc = { ...body, assignees: prev ? list(prev.assignees) : [user.key], createdBy: prev?.createdBy || user.key };
      }
      const saved = await store.put(coll, id, doc);
      const [kind, label] = changeLabel(coll, prev, saved);
      await log(kind, label);
      return json(saved);
    }
    if (method === "DELETE") {
      if (!prev) return json({ ok: true });
      if (!manager && !(prev.createdBy === user.key && assignedTo(prev, user.key))) return fail("Tu ne peux supprimer que les tâches que tu as créées.", 403);
      await store.remove(coll, id);
      await log("task_delete", `Tâche supprimée · ${prev.title || ""}`);
      return json({ ok: true });
    }
  }
  return fail("Route inconnue.", 404);
}

// --- API ---
async function handleApi(request, env, url) {
  const path = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const method = request.method;

  if (path[0] === "login" && method === "POST") {
    const { email, password } = await request.json().catch(() => ({}));
    const user = await findUser(env, email);
    if (!user || !(await verifyPassword(password || "", user.passwordHash))) return fail("Email ou mot de passe incorrect.", 401);
    await storeFor(env, user).addEvent({ kind: "login", label: "Connexion" });
    return json({ user: publicUser(user, await companyOf(env, user)) }, 200, {
      "set-cookie": sessionCookie(await makeToken(env, user), SESSION_DAYS * 86400),
    });
  }
  if (path[0] === "logout") return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });

  const user = await readSession(request, env);
  if (!user) return fail("Session expirée, reconnecte-toi.", 401);
  const store = storeFor(env, user);
  const role = roleOf(user);
  const body = () => request.json().catch(() => ({}));

  if (path[0] === "me") return json({ user: publicUser(user, await companyOf(env, user)) });

  if (path[0] === "data" && method === "GET") {
    if (!inCompany(user)) return json(await store.all());
    const all = await users(env);
    const data = await companyStore(env, user.companyId).all();
    const people = companyPeople(all, user.companyId).map(person);
    return json({ ...(role === "manager" ? data : workerView(data, user.key)), people });
  }

  if (path[0] === "items" && COLLECTIONS.includes(path[1])) {
    const [, coll, id] = path;
    if (!id) return fail("Identifiant manquant.");
    if (inCompany(user)) return companyItems(request, env, user, await users(env), coll, id, method);
    const prev = await store.get(coll, id);
    if (method === "PUT") {
      const doc = await request.json().catch(() => null);
      if (!doc || typeof doc !== "object") return fail("Données invalides.");
      const saved = await store.put(coll, id, doc);
      const [kind, label] = changeLabel(coll, prev, saved);
      await store.addEvent({ kind, label });
      return json(saved);
    }
    if (method === "DELETE") {
      if (coll === "categories") {
        const n = await store.removeCategory(id);
        await store.addEvent({ kind: "cat_delete", label: `Catégorie supprimée · ${prev?.name || ""}${n ? ` (${n} tâche${n > 1 ? "s" : ""})` : ""}` });
      } else {
        await store.remove(coll, id);
        await store.addEvent({ kind: "task_delete", label: `Tâche supprimée · ${prev?.title || ""}` });
      }
      return json({ ok: true });
    }
  }

  // --- Gestion de mon entreprise (gestionnaire) : nom de l'entreprise et comptes salariés ---
  if (path[0] === "company") {
    if (role !== "manager" || !user.companyId) return fail("Accès réservé aux gestionnaires.", 403);
    const company = await companyOf(env, user);
    if (!company) return fail("Entreprise introuvable.", 404);
    const all = await users(env);
    const workers = companyPeople(all, user.companyId).filter((u) => roleOf(u) === "worker");

    if (!path[1] && method === "GET") {
      return json({ company, workers: await Promise.all(workers.map(async (u) => ({ ...person(u), lastLogin: await storeFor(env, u).lastLogin() }))) });
    }
    if (!path[1] && method === "PUT") {
      const name = String((await body()).name || "").trim();
      if (!name) return fail("Le nom de l'entreprise est obligatoire.");
      return json({ company: await registry(env).putCompany({ ...company, name }) });
    }
    if (path[1] === "workers") {
      const key = path[2] ? decodeURIComponent(path[2]) : null;
      const prev = key ? workers.find((u) => u.key === key) : null;
      if (key && !prev) return fail("Salarié introuvable.", 404);
      const force = { role: "worker", companyId: user.companyId, admin: false };
      if (method === "POST" && !key) {
        const { admin, ...b } = await body();
        const [account, error] = await editAccount(env, all, null, b, force);
        if (error) return fail(error);
        await registry(env).putAccount(account);
        return json({ account: person(account) });
      }
      if (method === "PUT" && prev) {
        const { admin, ...b } = await body();
        const [account, error] = await editAccount(env, all, prev, b, { ...force, admin: prev.admin === true });
        if (error) return fail(error);
        await registry(env).putAccount(account);
        return json({ account: person(account) });
      }
      if (method === "DELETE" && prev) {
        await deleteAccount(env, prev);
        return json({ ok: true });
      }
    }
    return fail("Route inconnue.", 404);
  }

  // --- Admin : tous les comptes du site ---
  if (path[0] === "admin") {
    if (user.admin !== true) return fail("Accès réservé aux administrateurs.", 403);
    const all = await users(env);
    const comps = await companies(env);

    // Gestion des comptes : POST /api/admin/accounts, PUT|DELETE /api/admin/accounts/<clé>
    if (path[1] === "accounts") {
      const key = path[2] ? decodeURIComponent(path[2]) : null;
      const prev = key ? all.find((u) => u.key === key) : null;
      if (key && !prev) return fail("Compte introuvable.", 404);

      if (method === "POST" || method === "PUT") {
        if ((method === "POST") === Boolean(key)) return fail("Route inconnue.", 404);
        const b = await body();
        const force = {};
        const was = prev ? roleOf(prev) : null;
        const wanted = b.role === undefined ? was || "perso" : b.role;
        if (was === "worker" && wanted !== "worker") return fail("Un salarié dépend de son gestionnaire : modifie-le depuis l'espace de son entreprise.");
        if (wanted === "worker" && was !== "worker") return fail("Les comptes salariés sont créés par le gestionnaire de l'entreprise.");
        if (wanted === "manager" && was !== "manager") {
          const companyName = String(b.companyName || "").trim();
          if (!companyName) return fail("Indique le nom de l'entreprise du gestionnaire.");
          force.role = "manager";
          force.companyId = crypto.randomUUID();
          force._newCompany = companyName;
        }
        if (wanted === "perso" && was === "manager") {
          if (companyPeople(all, prev.companyId).some((u) => roleOf(u) === "worker")) return fail("Ce gestionnaire a encore des salariés : supprime-les d'abord.");
          force.role = "perso";
          force.companyId = null;
        }
        if (prev && prev.key === user.key && b.admin === false) return fail("Tu ne peux pas retirer ton propre accès admin.");
        const [account, error] = await editAccount(env, all, prev, b, force);
        if (error) return fail(error);
        const companyName = account._newCompany;
        delete account._newCompany;
        if (companyName) await registry(env).putCompany({ id: account.companyId, name: companyName, created: Date.now() });
        if (was === "manager" && account.role === "perso") {
          await companyStore(env, prev.companyId).wipe();
          await registry(env).removeCompany(prev.companyId);
        }
        await registry(env).putAccount(account);
        await store.addEvent({ kind: prev ? "account_edit" : "account_add", label: `Compte ${prev ? "modifié" : "créé"} · ${account.email}` });
        // Si on change son propre mot de passe, on renouvelle sa session pour ne pas être déconnecté.
        const headers = prev && prev.key === user.key && b.password ? { "set-cookie": sessionCookie(await makeToken(env, account), SESSION_DAYS * 86400) } : {};
        return json({ account: publicUser(account, await companyOf(env, account)) }, 200, headers);
      }
      if (method === "DELETE" && prev) {
        if (prev.key === user.key) return fail("Tu ne peux pas supprimer ton propre compte.");
        // Supprimer un gestionnaire supprime aussi son entreprise : salariés, projets et tâches.
        if (roleOf(prev) === "manager" && prev.companyId) {
          for (const w of companyPeople(all, prev.companyId).filter((u) => u.key !== prev.key)) await deleteAccount(env, w);
          await companyStore(env, prev.companyId).wipe();
          await registry(env).removeCompany(prev.companyId);
        }
        await deleteAccount(env, prev);
        await store.addEvent({ kind: "account_delete", label: `Compte supprimé · ${prev.email}` });
        return json({ ok: true });
      }
      return fail("Route inconnue.", 404);
    }

    const accounts = await Promise.all(all.map(async (u) => ({
      ...publicUser(u, comps.find((c) => c.id === u.companyId)),
      lastLogin: await storeFor(env, u).lastLogin(),
      workers: roleOf(u) === "manager" ? companyPeople(all, u.companyId).filter((w) => roleOf(w) === "worker").length : 0,
    })));
    return json({ accounts });
  }

  return fail("Route inconnue.", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        console.error(err);
        return fail("Erreur serveur : " + (err.message || err), 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
