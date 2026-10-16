import { DurableObject } from "cloudflare:workers";

// Base SQLite privée d'un compte : catégories, tâches (avec leurs sous-tâches) et journal d'activité.
export class Store extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
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

  // Résumé pour la page admin : avancement par catégorie, compteurs, activité récente.
  stats(limit = 300) {
    const { categories, tasks } = this.all();
    const progress = (list) => (list.length ? list.reduce((a, t) => a + taskProgress(t), 0) / list.length : 0);
    const subs = tasks.flatMap((t) => t.subtasks || []);
    const events = this.sql.exec("SELECT * FROM events ORDER BY at DESC LIMIT ?", limit).toArray();
    const lastLogin = this.sql.exec("SELECT at FROM events WHERE kind = 'login' ORDER BY at DESC LIMIT 1").toArray()[0]?.at || null;
    return {
      counts: {
        categories: categories.length,
        tasks: tasks.length,
        done: tasks.filter((t) => t.done).length,
        subtasks: subs.length,
        subtasksDone: subs.filter((s) => s.done).length,
      },
      progress: progress(tasks),
      categories: categories.map((c) => {
        const list = tasks.filter((t) => t.categoryId === c.id);
        return { name: c.name, tasks: list.length, done: list.filter((t) => t.done).length, progress: progress(list) };
      }),
      lastActive: events[0]?.at || null,
      lastLogin,
      events,
    };
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

  // Supprime une catégorie et toutes ses tâches ; renvoie le nombre de tâches supprimées.
  removeCategory(id) {
    const ids = this.all().tasks.filter((t) => t.categoryId === id).map((t) => t.id);
    for (const t of ids) this.remove("tasks", t);
    this.remove("categories", id);
    return ids.length;
  }
}

// Avancement d'une tâche (0 à 1) : terminée = 1, sinon part des sous-tâches cochées.
export function taskProgress(t) {
  if (t.done) return 1;
  const subs = t.subtasks || [];
  return subs.length ? subs.filter((s) => s.done).length / subs.length : 0;
}
