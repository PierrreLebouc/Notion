import usersFile from "../users.json";
import { Store } from "./store.js";
import { verifyPassword } from "./password.js";

export { Store };

const COOKIE = "mt_session";
const SESSION_DAYS = 30;
const COLLECTIONS = ["categories", "tasks"];

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
const fail = (message, status = 400) => json({ error: message }, status);

// --- Comptes (users.json) et sessions signées ---
const users = () => (usersFile.users || []).filter((u) => u.email && u.passwordHash);
const findUser = (email) => users().find((u) => u.email.toLowerCase() === String(email || "").trim().toLowerCase());

const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function sign(env, text) {
  // Sans SESSION_SECRET, la clé dérive du fichier des comptes : changer un mot de passe déconnecte ce compte.
  const secret = env.SESSION_SECRET || JSON.stringify(usersFile);
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}

async function makeToken(env, user) {
  const payload = b64url(enc.encode(JSON.stringify({ e: user.email, x: Date.now() + SESSION_DAYS * 864e5 })));
  return `${payload}.${await sign(env, payload + user.passwordHash)}`;
}

async function readSession(request, env) {
  const cookie = request.headers.get("cookie") || "";
  const token = cookie.split(/;\s*/).find((c) => c.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
  if (!token) return null;
  const [payload, sig] = token.split(".");
  try {
    const data = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    const user = findUser(data.e);
    if (!user || data.x < Date.now()) return null;
    return (await sign(env, payload + user.passwordHash)) === sig ? user : null;
  } catch {
    return null;
  }
}

const sessionCookie = (value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

const storeFor = (env, email) => env.STORE.get(env.STORE.idFromName(email.toLowerCase()));
const publicUser = (u) => ({ email: u.email, name: u.name || u.email, admin: u.admin === true });

// Libellé du journal pour l'enregistrement d'une catégorie ou d'une tâche.
function changeLabel(coll, prev, saved) {
  if (coll === "categories") {
    if (!prev) return ["cat_add", `Catégorie créée · ${saved.name}`];
    return ["cat_edit", prev.name !== saved.name ? `Catégorie renommée · ${prev.name} → ${saved.name}` : `Catégorie modifiée · ${saved.name}`];
  }
  if (!prev) return ["task_add", `Tâche ajoutée · ${saved.title}`];
  if (!prev.done && saved.done) return ["task_done", `Tâche terminée · ${saved.title}`];
  if (prev.done && !saved.done) return ["task_reopen", `Tâche rouverte · ${saved.title}`];
  return ["task_edit", `Tâche modifiée · ${saved.title}`];
}

// --- API ---
async function handleApi(request, env, url) {
  const path = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const method = request.method;

  if (path[0] === "login" && method === "POST") {
    const { email, password } = await request.json().catch(() => ({}));
    const user = findUser(email);
    if (!user || !(await verifyPassword(password || "", user.passwordHash))) return fail("Email ou mot de passe incorrect.", 401);
    await storeFor(env, user.email).addEvent({ kind: "login", label: "Connexion" });
    return json({ user: publicUser(user) }, 200, {
      "set-cookie": sessionCookie(await makeToken(env, user), SESSION_DAYS * 86400),
    });
  }
  if (path[0] === "logout") return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });

  const user = await readSession(request, env);
  if (!user) return fail("Session expirée, reconnecte-toi.", 401);
  const store = storeFor(env, user.email);

  if (path[0] === "me") return json({ user: publicUser(user) });
  if (path[0] === "data" && method === "GET") return json(await store.all());

  if (path[0] === "admin") {
    if (user.admin !== true) return fail("Accès réservé aux administrateurs.", 403);
    const profiles = await Promise.all(users().map(async (u) => ({ ...publicUser(u), ...(await storeFor(env, u.email).stats()) })));
    return json({ profiles });
  }

  if (path[0] === "items" && COLLECTIONS.includes(path[1])) {
    const [, coll, id] = path;
    const prev = id ? await store.get(coll, id) : null;
    if (method === "PUT") {
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== "object") return fail("Données invalides.");
      const saved = await store.put(coll, id || crypto.randomUUID(), body);
      const [kind, label] = changeLabel(coll, prev, saved);
      await store.addEvent({ kind, label });
      return json(saved);
    }
    if (method === "DELETE" && id) {
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
