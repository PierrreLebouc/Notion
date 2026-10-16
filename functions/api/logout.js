import { destroySession, json } from "../../lib/session.js";

export async function onRequestPost({ request, env }) {
  const cookie = await destroySession(request, env);
  return json({ ok: true }, { headers: { "Set-Cookie": cookie } });
}
