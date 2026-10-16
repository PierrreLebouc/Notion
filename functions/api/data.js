import { json } from "../../lib/session.js";

const MAX_SIZE = 1024 * 1024; // 1 Mo

const EMPTY = { categories: [] };

// GET : renvoie l'espace de l'utilisateur connecté (catégories, tâches, sous-tâches).
export async function onRequestGet({ env, data }) {
  const stored = await env.DATA.get(`data:${data.user}`, "json");
  return json({ username: data.user, workspace: stored || EMPTY });
}

// PUT : remplace l'espace complet de l'utilisateur.
export async function onRequestPut({ request, env, data }) {
  const text = await request.text();
  if (text.length > MAX_SIZE) return json({ error: "Données trop volumineuses" }, { status: 413 });

  let workspace;
  try {
    workspace = JSON.parse(text);
  } catch {
    return json({ error: "JSON invalide" }, { status: 400 });
  }
  if (!workspace || !Array.isArray(workspace.categories)) {
    return json({ error: "Format invalide" }, { status: 400 });
  }

  await env.DATA.put(`data:${data.user}`, JSON.stringify(workspace));
  return json({ ok: true });
}
