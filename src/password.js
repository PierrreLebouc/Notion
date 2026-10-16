// Mots de passe chiffrés (PBKDF2-SHA256), partagés par le site et la commande `npm run user`.
// Format stocké dans users.json : "pbkdf2$<itérations>$<sel base64>$<empreinte base64>"
const ITERATIONS = 100_000; // maximum accepté par Cloudflare Workers
const enc = new TextEncoder();
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(await derive(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, iterations, salt, hash] = String(stored || "").split("$");
  if (scheme !== "pbkdf2" || !hash) return false;
  const actual = new Uint8Array(await derive(String(password), fromB64(salt), Number(iterations)));
  const expected = fromB64(hash);
  let diff = actual.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}
