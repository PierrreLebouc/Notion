const COOKIE = "session";
const TTL = 60 * 60 * 24 * 30; // 30 jours

export async function createSession(env, username) {
  const token = crypto.randomUUID();
  await env.DATA.put(`session:${token}`, username, { expirationTtl: TTL });
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TTL}`;
}

export async function getUser(request, env) {
  const token = readToken(request);
  if (!token) return null;
  return env.DATA.get(`session:${token}`);
}

export async function destroySession(request, env) {
  const token = readToken(request);
  if (token) await env.DATA.delete(`session:${token}`);
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function readToken(request) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return match ? match[1] : null;
}

export function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
}
