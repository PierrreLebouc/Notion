// Connexion automatique depuis le Hub (https://github.com/PierrreLebouc/Hub, docs/connexion-automatique.md).
// Le Hub signe un jeton Ed25519 avec sa clé privée ; on le vérifie ici avec sa clé PUBLIQUE, qui ne permet
// que de vérifier (elle peut être publique sans risque). Même fichier dans chaque outil.
export const HUB_PUBLIC_KEY = {"kty":"OKP","crv":"Ed25519","x":"Njxk2YtQ-hcJuymZGxxVMECVQAFxXSWuQXdXq2Urzaw"};

const fromB64url = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

// Vérifie le jeton reçu sur <outil>/api/sso?token=… ; renvoie { sub (email), next, jti, exp } ou lance une erreur.
// Reste à l'appelant : refuser un jti déjà utilisé, puis ouvrir la session du compte « sub ».
export async function verifyHubToken(token, origin, publicKey = HUB_PUBLIC_KEY) {
  const [payload, sig] = String(token || "").split(".");
  if (!payload || !sig) throw new Error("Jeton manquant");
  const { kty, crv, x } = typeof publicKey === "string" ? JSON.parse(publicKey) : publicKey;
  const key = await crypto.subtle.importKey("jwk", { kty, crv, x }, { name: "Ed25519" }, false, ["verify"]);
  if (!(await crypto.subtle.verify({ name: "Ed25519" }, key, fromB64url(sig), new TextEncoder().encode(payload)))) throw new Error("Jeton invalide");
  const t = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
  if (t.aud !== origin) throw new Error("Jeton destiné à un autre site");
  if (!(t.exp > Date.now()) || t.exp > Date.now() + 5 * 60_000) throw new Error("Jeton expiré");
  const next = typeof t.next === "string" && t.next.startsWith("/") && !t.next.startsWith("//") && !t.next.includes("\\") ? t.next : "/";
  return { sub: String(t.sub || ""), next, jti: String(t.jti || ""), exp: t.exp };
}
