// Gestion des comptes de users.json (les mots de passe y sont enregistrés chiffrés).
//   npm run user -- list
//   npm run user -- add <email> "<Nom>" [--admin]
//   npm run user -- password <email>
//   npm run user -- admin <email> oui|non
//   npm run user -- rename <email> "<Nouveau nom>"
//   npm run user -- remove <email>
import { readFileSync, writeFileSync } from "node:fs";
import readline from "node:readline";
import { hashPassword } from "../src/password.js";

const FILE = new URL("../users.json", import.meta.url);
const HELP = "Comptes autorisés. Pour ajouter un compte, changer un mot de passe ou donner l'accès admin : npm run user (voir README). Redéploie ensuite.";

const data = JSON.parse(readFileSync(FILE, "utf8"));
data.users ||= [];
const [cmd, email, ...rest] = process.argv.slice(2);
const find = (e) => data.users.find((u) => u.email.toLowerCase() === String(e || "").toLowerCase());

function save() {
  const line = (u) => "{ " + Object.entries(u).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ") + " }";
  writeFileSync(FILE, `{\n  "_aide": ${JSON.stringify(HELP)},\n  "users": [\n${data.users.map((u) => "    " + line(u)).join(",\n")}\n  ]\n}\n`);
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(question); }; // saisie masquée
    rl.question(question, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
}

async function askPassword() {
  const first = await ask("Mot de passe : ");
  if (first.length < 8) throw new Error("8 caractères minimum.");
  if ((await ask("Confirme le mot de passe : ")) !== first) throw new Error("Les deux saisies ne correspondent pas.");
  return hashPassword(first);
}

function need(user) {
  if (!user) throw new Error(`Aucun compte « ${email} ». Comptes : ${data.users.map((u) => u.email).join(", ")}`);
  return user;
}

try {
  switch (cmd) {
    case "list":
      for (const u of data.users) console.log(`${u.admin ? "★" : " "} ${u.email.padEnd(32)} ${u.name || ""}`);
      break;
    case "add": {
      if (!email || !email.includes("@")) throw new Error('Usage : npm run user -- add <email> "<Nom>" [--admin]');
      if (find(email)) throw new Error(`Le compte ${email} existe déjà (utilise « password » pour changer son mot de passe).`);
      const name = rest.filter((r) => r !== "--admin").join(" ") || email.split("@")[0];
      data.users.push({ email, name, admin: rest.includes("--admin"), passwordHash: await askPassword() });
      save();
      console.log(`✓ Compte ${email} ajouté. Redéploie pour l'activer.`);
      break;
    }
    case "password": {
      need(find(email)).passwordHash = await askPassword();
      save();
      console.log(`✓ Mot de passe de ${email} changé (ses sessions ouvertes sont déconnectées). Redéploie pour l'activer.`);
      break;
    }
    case "admin": {
      const on = ["oui", "yes", "true", "on"].includes(String(rest[0]).toLowerCase());
      need(find(email)).admin = on;
      save();
      console.log(`✓ ${email} ${on ? "est maintenant admin" : "n'est plus admin"}. Redéploie pour l'activer.`);
      break;
    }
    case "rename": {
      need(find(email)).name = rest.join(" ");
      save();
      console.log(`✓ Nom mis à jour. Redéploie pour l'activer.`);
      break;
    }
    case "remove": {
      need(find(email));
      data.users = data.users.filter((u) => u !== find(email));
      save();
      console.log(`✓ Compte ${email} supprimé (ses données restent stockées, mais plus personne n'y accède).`);
      break;
    }
    case "migrate": {
      // Convertit d'anciens mots de passe en clair ("password") en mots de passe chiffrés.
      let n = 0;
      for (const u of data.users) {
        if (u.password) { const { password, ...keep } = u; Object.assign(u, keep, { passwordHash: await hashPassword(password) }); delete u.password; n++; }
      }
      save();
      console.log(`✓ ${n} mot(s) de passe chiffré(s).`);
      break;
    }
    default:
      console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(0, 7).join("\n").replace(/^\/\/ ?/gm, ""));
  }
} catch (err) {
  console.error("✗ " + err.message);
  process.exit(1);
}
