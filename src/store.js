import { DurableObject } from "cloudflare:workers";

// Base SQLite d'un compte personnel (catégories) ou d'une entreprise (projets partagés) :
// catégories / projets, tâches (avec leurs sous-tâches) et journal d'activité.
export class Store extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.init();
  }

  init() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS docs (coll TEXT, id TEXT, data TEXT, updated INTEGER, PRIMARY KEY (coll, id));
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, kind TEXT, label TEXT);
      CREATE INDEX IF NOT EXISTS events_at ON events (at);
    `);
  }

  // --- Journal d'activité ---
  addEvent(ev) {
    const now = Date.now();
    // Les modifications répétées (ex. sauvegarde auto d'une tâche) sont regroupées sur 10 minutes.
    const last = this.sql.exec("SELECT id, kind, label, at FROM events ORDER BY id DESC LIMIT 1").toArray()[0];
    if (last && last.kind === ev.kind && last.label === ev.label && now - last.at < 600_000) {
      this.sql.exec("UPDATE events SET at = ? WHERE id = ?", now, last.id);
      return;
    }
    this.sql.exec("INSERT INTO events (at, kind, label) VALUES (?, ?, ?)", now, ev.kind, ev.label || "");
  }

  // Date de la dernière connexion (pour la liste des comptes de la page admin).
  lastLogin() {
    return this.sql.exec("SELECT at FROM events WHERE kind = 'login' ORDER BY at DESC LIMIT 1").toArray()[0]?.at || null;
  }

  // --- Comptes (uniquement dans l'instance « registre » du site) ---
  // Chaque compte a une clé fixe (key) qui rattache ses données : changer son email ne les perd pas.
  // Au premier appel, la liste est remplie avec les comptes de users.json.
  accounts(seed = []) {
    this.sql.exec("CREATE TABLE IF NOT EXISTS accounts (key TEXT PRIMARY KEY, data TEXT)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)");
    if (!this.sql.exec("SELECT v FROM meta WHERE k = 'seeded'").toArray().length) {
      for (const u of seed) this.putAccount({ ...u, key: u.email.toLowerCase(), created: Date.now() });
      this.sql.exec("INSERT INTO meta (k, v) VALUES ('seeded', ?)", String(Date.now()));
    }
    return this.sql.exec("SELECT data FROM accounts").toArray().map((r) => JSON.parse(r.data));
  }

  putAccount(account) {
    this.sql.exec("INSERT OR REPLACE INTO accounts (key, data) VALUES (?, ?)", account.key, JSON.stringify(account));
    return account;
  }

  removeAccount(key) {
    this.sql.exec("DELETE FROM accounts WHERE key = ?", key);
  }

  // --- Entreprises (registre) : { id, name, created } ---
  companies() {
    this.sql.exec("CREATE TABLE IF NOT EXISTS companies (id TEXT PRIMARY KEY, data TEXT)");
    return this.sql.exec("SELECT data FROM companies").toArray().map((r) => JSON.parse(r.data));
  }

  putCompany(company) {
    this.companies();
    this.sql.exec("INSERT OR REPLACE INTO companies (id, data) VALUES (?, ?)", company.id, JSON.stringify(company));
    return company;
  }

  removeCompany(id) {
    this.companies();
    this.sql.exec("DELETE FROM companies WHERE id = ?", id);
  }

  // Efface toutes les données de ce compte (catégories, tâches, journal).
  async wipe() {
    await this.ctx.storage.deleteAll();
    this.init();
  }

  all() {
    const out = { categories: [], tasks: [] };
    for (const row of this.sql.exec("SELECT coll, data FROM docs ORDER BY updated DESC")) {
      if (out[row.coll]) out[row.coll].push(JSON.parse(row.data));
    }
    out.categories.sort((a, b) => (a.order ?? a.created) - (b.order ?? b.created));
    out.tasks.sort((a, b) => b.created - a.created);
    return out;
  }

  get(coll, id) {
    const row = this.sql.exec("SELECT data FROM docs WHERE coll = ? AND id = ?", coll, id).toArray()[0];
    return row ? JSON.parse(row.data) : null;
  }

  put(coll, id, doc) {
    const now = Date.now();
    const saved = { ...doc, id, updated: now, created: doc.created || now };
    this.sql.exec("INSERT OR REPLACE INTO docs (coll, id, data, updated) VALUES (?, ?, ?, ?)", coll, id, JSON.stringify(saved), now);
    return saved;
  }

  remove(coll, id) {
    this.sql.exec("DELETE FROM docs WHERE coll = ? AND id = ?", coll, id);
  }

  // Entreprise : retire un salarié supprimé des membres des projets et des assignations des tâches.
  forgetPerson(key) {
    const { categories, tasks } = this.all();
    for (const c of categories) if ((c.members || []).includes(key)) this.put("categories", c.id, { ...c, members: c.members.filter((k) => k !== key) });
    for (const t of tasks) if ((t.assignees || []).includes(key)) this.put("tasks", t.id, { ...t, assignees: t.assignees.filter((k) => k !== key) });
  }

  // Supprime une catégorie et toutes ses tâches ; renvoie le nombre de tâches supprimées.
  removeCategory(id) {
    const ids = this.all().tasks.filter((t) => t.categoryId === id).map((t) => t.id);
    for (const t of ids) this.remove("tasks", t);
    this.remove("categories", id);
    return ids.length;
  }
}

