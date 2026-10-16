import { getUser, json } from "../lib/session.js";

const PUBLIC_PATHS = ["/login", "/login.html", "/style.css", "/api/login"];

// Protège toutes les pages et l'API : sans session valide, on renvoie vers /login.
export async function onRequest(context) {
  const { request, env, next, data } = context;
  const path = new URL(request.url).pathname;

  if (PUBLIC_PATHS.includes(path)) return next();

  const user = await getUser(request, env);
  if (!user) {
    if (path.startsWith("/api/")) return json({ error: "Non connecté" }, { status: 401 });
    return Response.redirect(new URL("/login", request.url), 302);
  }

  data.user = user;
  return next();
}
