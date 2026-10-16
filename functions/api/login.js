import { USERS } from "../../lib/users.js";
import { createSession, json } from "../../lib/session.js";

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requête invalide" }, { status: 400 });
  }

  const user = USERS.find(
    (u) => u.username === body.username && u.password === body.password
  );
  if (!user) return json({ error: "Identifiants incorrects" }, { status: 401 });

  const cookie = await createSession(env, user.username);
  return json({ ok: true, username: user.username }, { headers: { "Set-Cookie": cookie } });
}
