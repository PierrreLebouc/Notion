// Mes tâches — application monopage (sans build)

// ---------- État & utilitaires ----------
const state = { user: null, data: { categories: [], tasks: [] }, open: new Set() };
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => crypto.randomUUID();
const plural = (n, word) => `${n} ${word}${n > 1 ? "s" : ""}`;
function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

async function api(path, opts = {}) {
  const res = await fetch("/api/" + path, {
    method: opts.method || "GET",
    headers: opts.body ? { "content-type": "application/json" } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "login") { showLogin(); throw new Error(data.error || "Session expirée"); }
  if (!res.ok) throw new Error(data.error || "Erreur " + res.status);
  return data;
}

let toastTimer;
function toast(text, err = false) {
  const t = $("#toast");
  t.textContent = text;
  t.className = "toast on" + (err ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "toast"), err ? 5000 : 2400);
}

const ago = (t) => {
  if (!t) return "jamais";
  const m = Math.round((Date.now() - t) / 6e4);
  return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`;
};
const fmtTime = (t) => new Date(t).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// ---------- Avancement ----------
// Une tâche terminée compte pour 100 %, sinon la part de ses points cochés.
function taskProgress(t) {
  if (t.done) return 1;
  const subs = t.subtasks || [];
  return subs.length ? subs.filter((s) => s.done).length / subs.length : 0;
}
function statsOf(tasks) {
  const subs = tasks.flatMap((t) => t.subtasks || []);
  return {
    total: tasks.length,
    done: tasks.filter((t) => t.done).length,
    pct: tasks.length ? Math.round((tasks.reduce((a, t) => a + taskProgress(t), 0) / tasks.length) * 100) : 0,
    subTotal: subs.length,
    subDone: subs.filter((s) => s.done).length,
  };
}
const tasksOf = (catId) => state.data.tasks.filter((t) => t.categoryId === catId);

// Couleurs proposées pour les catégories (lisibles en mode jour comme en mode nuit).
const COLORS = [
  ["#e5484d", "Rouge"], ["#f76b15", "Orange"], ["#f5a524", "Ambre"], ["#30a46c", "Vert"], ["#12a594", "Turquoise"],
  ["#0090ff", "Bleu"], ["#6e56cf", "Violet"], ["#d6409f", "Rose"], ["#8d8d86", "Gris"],
];
const isColor = (c) => /^#[0-9a-f]{6}$/i.test(c || "");
// Couleur d'une catégorie, utilisable dans un attribut style (noir / blanc du thème si aucune n'est choisie).
const colorOf = (cat) => (isColor(cat?.color) ? cat.color : "var(--text)");
const nextColor = () => (COLORS.find(([c]) => !state.data.categories.some((x) => x.color === c)) || COLORS[0])[0];

const ring = (pct, cls = "", color) => `<div class="ring ${cls}" style="--p:${pct}${color ? `;--c:${color}` : ""}"><div>${pct}%</div></div>`;
const meter = (pct, color) => `<div class="meter"${color ? ` style="--c:${color}"` : ""}><div style="width:${pct}%"></div></div>`;
const dot = (cat) => `<span class="dot" style="--c:${colorOf(cat)}"></span>`;

// ---------- Connexion ----------
function showLogin() {
  if ($("#sheet").open) $("#sheet").close();
  $("#app").classList.add("hidden");
  $("#login").classList.remove("hidden");
}
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const err = $("#loginErr");
  err.classList.add("hidden");
  try {
    const { user } = await api("login", { method: "POST", body: { email: f.get("email"), password: f.get("password") } });
    state.user = user;
    await boot();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove("hidden");
  }
});
$("#logoutBtn").addEventListener("click", async () => {
  await api("logout", { method: "POST" }).catch(() => {});
  location.hash = "";
  showLogin();
});
$("#themeBtn").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localSet("theme", next);
});
addEventListener("scroll", () => document.documentElement.classList.toggle("scrolled", scrollY > 8), { passive: true });

async function boot() {
  state.data = await api("data");
  $("#who").textContent = state.user.name;
  $("#adminLink").classList.toggle("hidden", !state.user.admin);
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
  render();
}

(async () => {
  try {
    state.user = (await api("me")).user;
    await boot();
  } catch {
    showLogin();
  }
})();

// ---------- Routeur ----------
const ROUTES = { "": viewDashboard, taches: viewTasks, admin: viewAdmin };
addEventListener("hashchange", render);
function render() {
  if (!state.user) return;
  const [route = "", arg] = location.hash.replace(/^#\/?/, "").split("/");
  $$(".links a").forEach((a) => a.classList.toggle("on", a.dataset.route === route));
  (ROUTES[route] || viewDashboard)($("#view"), arg);
}

// ---------- Données ----------
const saveTimers = {};
// Enregistre un document ; les saisies au clavier sont regroupées (delay) pour ne pas envoyer chaque lettre.
function save(coll, doc, delay = 0) {
  clearTimeout(saveTimers[doc.id]);
  saveTimers[doc.id] = setTimeout(async () => {
    try {
      const saved = await api(`items/${coll}/${doc.id}`, { method: "PUT", body: doc });
      doc.created = saved.created;
      doc.updated = saved.updated;
    } catch (e) { toast(e.message, true); }
  }, delay);
}
async function remove(coll, id) {
  clearTimeout(saveTimers[id]);
  await api(`items/${coll}/${id}`, { method: "DELETE" });
}

// Fenêtre de création / modification d'une catégorie (nom + couleur) ; renvoie { name, color } ou null si annulé.
function askCategory(title, { name = "", color = nextColor() } = {}, okLabel = "Enregistrer") {
  const sheet = $("#sheet");
  let picked = isColor(color) ? color.toLowerCase() : COLORS[0][0];
  sheet.classList.add("small");
  sheet.innerHTML = `<form class="in" method="dialog">
    <div class="top"><h3>${esc(title)}</h3><button type="button" class="x" aria-label="Fermer">×</button></div>
    <label class="t" for="catName">Nom</label>
    <input id="catName" name="v" value="${esc(name)}" placeholder="Perso, Travail, Maison…" required autocomplete="off">
    <label class="t">Couleur</label>
    <div class="swatches" role="radiogroup" aria-label="Couleur">
      ${COLORS.map(([c, l]) => `<button type="button" class="sw" data-c="${c}" style="--c:${c}" role="radio" title="${l}" aria-label="${l}"></button>`).join("")}
      <label class="sw custom" title="Autre couleur" aria-label="Autre couleur"><input type="color" id="catColor" value="${picked}"></label>
    </div>
    <div class="preview" id="catPreview"></div>
    <button class="go" type="submit">${esc(okLabel)}</button>
  </form>`;
  const paint = () => {
    $$(".sw[data-c]", sheet).forEach((b) => { const on = b.dataset.c === picked; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); });
    const custom = $(".sw.custom", sheet);
    custom.classList.toggle("on", !COLORS.some(([c]) => c === picked));
    custom.style.setProperty("--c", picked);
    $("#catColor", sheet).value = picked;
    const label = $("#catName", sheet).value.trim() || "Aperçu";
    $("#catPreview", sheet).innerHTML = `<span class="chip on" style="--c:${picked}">${dot({ color: picked })} ${esc(label)}</span>${ring(62, "", picked)}`;
  };
  return new Promise((resolve) => {
    let result = null;
    $$(".sw[data-c]", sheet).forEach((b) => (b.onclick = () => { picked = b.dataset.c; paint(); }));
    $("#catColor", sheet).oninput = (e) => { picked = e.target.value.toLowerCase(); paint(); };
    $("#catName", sheet).oninput = paint;
    $(".x", sheet).onclick = () => sheet.close();
    $("form", sheet).onsubmit = (e) => {
      e.preventDefault();
      const v = e.target.elements.v.value.trim();
      result = v ? { name: v, color: picked } : null;
      sheet.close();
    };
    sheet.onclose = () => { sheet.classList.remove("small"); sheet.onclose = null; resolve(result); };
    paint();
    sheet.showModal();
    $("#catName", sheet).select();
  });
}

async function newCategory() {
  const answer = await askCategory("Nouvelle catégorie", {}, "Créer");
  if (!answer) return;
  const cat = { id: uid(), ...answer, order: Date.now() };
  state.data.categories.push(cat);
  save("categories", cat);
  location.hash = `#/taches/${cat.id}`;
}

// ========== Tableau de bord ==========
function viewDashboard(el) {
  const cats = state.data.categories;
  const all = statsOf(state.data.tasks);
  const name = (state.user.name || "").split(" ")[0];
  const inProgress = state.data.tasks
    .filter((t) => !t.done)
    .map((t) => ({ t, p: taskProgress(t), cat: cats.find((c) => c.id === t.categoryId) }))
    .sort((a, b) => b.p - a.p || (b.t.updated || 0) - (a.t.updated || 0))
    .slice(0, 8);
  const perCat = cats.map((c) => ({ c, s: statsOf(tasksOf(c.id)) }));

  el.innerHTML = `
    <div class="page-head">
      <div><h1>Bonjour${name ? " " + esc(name) : ""}.</h1><p>${all.total ? `${plural(all.total - all.done, "tâche")} en cours dans ${plural(cats.length, "catégorie")}.` : "Crée une catégorie pour commencer à suivre tes tâches."}</p></div>
      <div class="acts"><button class="btn" id="newCat">+ Nouvelle catégorie</button>${cats.length ? `<a class="btn dark" href="#/taches">Voir les tâches</a>` : ""}</div>
    </div>
    <div class="kpis">
      <div class="kpi dark"><div class="l">Avancement global</div><div class="v">${all.pct}%</div><div class="s">toutes catégories</div></div>
      <div class="kpi"><div class="l">Tâches en cours</div><div class="v">${all.total - all.done}</div><div class="s">${plural(all.total, "tâche")} au total</div></div>
      <div class="kpi"><div class="l">Tâches terminées</div><div class="v">${all.done}</div><div class="s">${all.total ? Math.round((all.done / all.total) * 100) : 0}% des tâches</div></div>
      <div class="kpi"><div class="l">Points cochés</div><div class="v">${all.subDone}<span class="muted" style="font-size:18px"> / ${all.subTotal}</span></div>${meter(all.subTotal ? Math.round((all.subDone / all.subTotal) * 100) : 0)}</div>
      <div class="kpi"><div class="l">Catégories</div><div class="v">${cats.length}</div><div class="s">${perCat.filter((x) => x.s.total && x.s.done === x.s.total).length} terminée(s) à 100 %</div></div>
    </div>

    <h2 class="section-title">Catégories</h2>
    <div class="cards">
      ${perCat.map(({ c, s }) => `
        <a class="lcard ccard" href="#/taches/${c.id}">
          ${ring(s.pct, "", colorOf(c))}
          <div class="t"><b>${dot(c)} ${esc(c.name)}</b><div class="sub">${s.total ? `${s.done} terminée${s.done > 1 ? "s" : ""} sur ${plural(s.total, "tâche")}` : "Aucune tâche"}${s.subTotal ? ` · ${s.subDone}/${s.subTotal} points` : ""}</div>${meter(s.total ? Math.round((s.done / s.total) * 100) : 0, colorOf(c))}</div>
        </a>`).join("")}
      <button class="lcard ccard add" id="newCat2">+ Nouvelle catégorie</button>
    </div>

    <div class="panels">
      <div class="panel"><h2>Avancement par catégorie <small>tâches et points cochés</small></h2>
        ${perCat.length ? `<div class="funnel">${perCat.map(({ c, s }) => `<a class="r" href="#/taches/${c.id}"><span>${dot(c)} ${esc(c.name)}</span><div class="track"><div class="fill" style="width:${s.pct}%;--c:${colorOf(c)}"></div></div><span class="n">${s.pct}%</span></a>`).join("")}</div>`
        : `<div class="empty-s">Aucune catégorie pour l'instant.</div>`}
      </div>
      <div class="panel"><h2>En cours <small>les plus avancées</small></h2>
        ${inProgress.length ? `<div class="tbl-wrap"><table class="tbl"><tbody>${inProgress.map(({ t, p, cat }) => `
          <tr class="click" data-cat="${t.categoryId}" data-id="${t.id}"><td><b>${esc(t.title)}</b><div class="sub">${dot(cat)} ${esc(cat?.name || "")}</div></td>
          <td style="width:40%">${meter(Math.round(p * 100), colorOf(cat))}</td><td class="tnum">${Math.round(p * 100)}%</td></tr>`).join("")}</tbody></table></div>`
        : `<div class="empty-s">Aucune tâche en cours.</div>`}
      </div>
    </div>`;

  $("#newCat").onclick = newCategory;
  $("#newCat2").onclick = newCategory;
  $$("tr[data-id]", el).forEach((tr) => (tr.onclick = () => {
    state.open.add(tr.dataset.id);
    location.hash = `#/taches/${tr.dataset.cat}`;
  }));
}

// ========== Tâches ==========
function viewTasks(el, catId) {
  const cats = state.data.categories;
  if (!cats.length) {
    el.innerHTML = `<div class="page-head"><div><h1>Tâches</h1><p>Range tes tâches par catégorie.</p></div></div>
      <div class="empty"><b>Aucune catégorie</b>Crée ta première catégorie (Perso, Travail, Maison…) pour y ajouter des fiches de tâche.<div style="margin-top:16px"><button class="btn dark" id="newCat">+ Nouvelle catégorie</button></div></div>`;
    $("#newCat").onclick = newCategory;
    return;
  }
  const cat = cats.find((c) => c.id === catId) || cats.find((c) => c.id === localGet("lastCat")) || cats[0];
  localSet("lastCat", cat.id);
  const tasks = tasksOf(cat.id);
  const s = statsOf(tasks);
  const filter = localGet("taskFilter") || "all";
  const shown = tasks
    .filter((t) => filter === "all" || (filter === "done" ? t.done : !t.done))
    .sort((a, b) => a.done - b.done || b.created - a.created);
  const color = colorOf(cat);

  el.innerHTML = `
    <div class="page-head">
      <div style="display:flex;gap:18px;align-items:center">${ring(s.pct, "lg", colorOf(cat))}
        <div><h1>${esc(cat.name)}</h1><p>${s.total ? `${s.done} terminée${s.done > 1 ? "s" : ""} sur ${plural(s.total, "tâche")}${s.subTotal ? ` · ${s.subDone} sur ${plural(s.subTotal, "point")} cochés` : ""}` : "Aucune tâche dans cette catégorie."}</p></div></div>
      <div class="acts"><button class="btn" id="editCat">${dot(cat)} Modifier</button><button class="btn danger" id="deleteCat">Supprimer</button></div>
    </div>
    <div class="catbar">
      ${cats.map((c) => `<a class="chip ${c.id === cat.id ? "on" : ""}" href="#/taches/${c.id}" style="text-decoration:none">${dot(c)} ${esc(c.name)} <span class="${c.id === cat.id ? "" : "muted"}">${tasksOf(c.id).filter((t) => !t.done).length || ""}</span></a>`).join("")}
      <button class="chip ghost" id="newCat">+ Catégorie</button>
    </div>
    <form class="newtask" id="newTask"><input name="title" placeholder="Nouvelle fiche de tâche…" autocomplete="off" required><button class="btn dark" type="submit">Ajouter</button></form>
    <div class="toolbar"><span class="seg" id="filter">${[["all", "Toutes", s.total], ["todo", "En cours", s.total - s.done], ["done", "Terminées", s.done]].map(([k, l, n]) => `<button class="${filter === k ? "on" : ""}" data-f="${k}">${l} · ${n}</button>`).join("")}</span></div>
    <div class="tasks" id="tasks">
      ${shown.length ? shown.map((t) => taskHTML(t, color)).join("") : `<div class="empty"><b>${tasks.length ? "Rien ici" : "Aucune tâche"}</b>${tasks.length ? "Aucune tâche ne correspond à ce filtre." : "Ajoute une fiche de tâche avec le champ ci-dessus."}</div>`}
    </div>`;

  $("#newCat").onclick = newCategory;
  $("#editCat").onclick = async () => {
    const answer = await askCategory("Modifier la catégorie", { name: cat.name, color: cat.color || COLORS[0][0] });
    if (!answer) return;
    Object.assign(cat, answer);
    save("categories", cat);
    render();
  };
  $("#deleteCat").onclick = async () => {
    if (!confirm(`Supprimer la catégorie « ${cat.name} »${tasks.length ? ` et ses ${plural(tasks.length, "tâche")}` : ""} ?`)) return;
    try {
      await remove("categories", cat.id);
      state.data.categories = cats.filter((c) => c.id !== cat.id);
      state.data.tasks = state.data.tasks.filter((t) => t.categoryId !== cat.id);
      localSet("lastCat", "");
      location.hash = "#/taches";
      render();
      toast("Catégorie supprimée");
    } catch (e) { toast(e.message, true); }
  };
  $("#newTask").onsubmit = (e) => {
    e.preventDefault();
    const title = e.target.elements.title.value.trim();
    if (!title) return;
    const t = { id: uid(), categoryId: cat.id, title, notes: "", done: false, subtasks: [], created: Date.now() };
    state.data.tasks.unshift(t);
    state.open.add(t.id);
    save("tasks", t);
    render();
    $("#newTask input").focus();
  };
  $$("#filter button").forEach((b) => (b.onclick = () => { localSet("taskFilter", b.dataset.f); render(); }));
  $$(".tcard", el).forEach(bindTask);
}

function taskHTML(t, color) {
  const subs = t.subtasks || [];
  const done = subs.filter((s) => s.done).length;
  const pct = subs.length ? Math.round((done / subs.length) * 100) : 0;
  const open = state.open.has(t.id);
  const hint = subs.length ? `${done} sur ${plural(subs.length, "point")} cochés` : t.notes ? t.notes.split("\n")[0].slice(0, 90) : "Clique pour ajouter des points à cocher";
  return `<article class="tcard ${open ? "open" : ""} ${t.done ? "done" : ""}" data-id="${t.id}">
    <div class="h">
      <input type="checkbox" class="check" data-done ${t.done ? "checked" : ""} title="${t.done ? "Rouvrir" : "Marquer terminée"}" aria-label="Terminée">
      <div class="t"><b>${esc(t.title) || "Sans titre"}</b><div class="sub">${esc(hint)}</div></div>
      ${subs.length ? `<div class="mini"><div class="n">${done}/${subs.length}</div>${meter(t.done ? 100 : pct, color)}</div>` : ""}
      <span class="chev"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></span>
    </div>
    ${open ? `<div class="body">
      <input class="title" value="${esc(t.title)}" aria-label="Titre de la tâche">
      <textarea placeholder="Notes, liens, détails…">${esc(t.notes)}</textarea>
      <label class="t">Points à cocher</label>
      <ul class="checklist">
        ${subs.map((s) => `<li class="${s.done ? "on" : ""}" data-sid="${s.id}"><input type="checkbox" class="check sq" ${s.done ? "checked" : ""} aria-label="Cocher"><input class="txt" value="${esc(s.text)}" aria-label="Point"><button class="rm" title="Supprimer ce point" aria-label="Supprimer">×</button></li>`).join("")}
        <li class="add"><span>+</span><input data-add placeholder="Ajouter un point… (Entrée)" autocomplete="off"></li>
      </ul>
      <div class="acts"><button class="btn danger sm" data-del>Supprimer la tâche</button><button class="btn dark sm" data-toggle>${t.done ? "Rouvrir la tâche" : "✓ Marquer terminée"}</button></div>
    </div>` : ""}
  </article>`;
}

function bindTask(card) {
  const t = state.data.tasks.find((x) => x.id === card.dataset.id);
  const setDone = (v) => { t.done = v; save("tasks", t); render(); };

  $(".h", card).onclick = (e) => {
    if (e.target.matches("[data-done]")) return;
    state.open.has(t.id) ? state.open.delete(t.id) : state.open.add(t.id);
    render();
  };
  $("[data-done]", card).onchange = (e) => setDone(e.target.checked);
  if (!state.open.has(t.id)) return;

  const title = $("input.title", card);
  title.oninput = () => { t.title = title.value; $(".h b", card).textContent = t.title || "Sans titre"; save("tasks", t, 600); };
  $("textarea", card).oninput = (e) => { t.notes = e.target.value; save("tasks", t, 600); };

  $$("li[data-sid]", card).forEach((li) => {
    const sub = t.subtasks.find((s) => s.id === li.dataset.sid);
    $(".check", li).onchange = (e) => { sub.done = e.target.checked; save("tasks", t); render(); };
    const txt = $(".txt", li);
    txt.oninput = () => { sub.text = txt.value; save("tasks", t, 600); };
    txt.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $("[data-add]", card).focus(); } };
    $(".rm", li).onclick = () => { t.subtasks = t.subtasks.filter((s) => s !== sub); save("tasks", t); render(); };
  });

  $("[data-add]", card).onkeydown = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const text = e.target.value.trim();
    if (!text) return;
    t.subtasks.push({ id: uid(), text, done: false });
    save("tasks", t);
    render();
    $(`.tcard[data-id="${t.id}"] [data-add]`)?.focus();
  };
  $("[data-toggle]", card).onclick = () => setDone(!t.done);
  $("[data-del]", card).onclick = async () => {
    if (!confirm(`Supprimer la tâche « ${t.title} » ?`)) return;
    try {
      await remove("tasks", t.id);
      state.data.tasks = state.data.tasks.filter((x) => x !== t);
      render();
      toast("Tâche supprimée");
    } catch (e) { toast(e.message, true); }
  };
}

// ========== Admin ==========
async function viewAdmin(el) {
  if (!state.user.admin) { location.hash = "#/"; return; }
  el.innerHTML = `<div class="page-head"><div><h1>Admin</h1><p>Suivi des profils et de leur activité.</p></div></div><div class="loading"><span class="spin"></span> Chargement…</div>`;
  let profiles;
  try { ({ profiles } = await api("admin")); } catch (e) { el.querySelector(".loading").outerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
  if (!location.hash.startsWith("#/admin")) return;
  const sum = (f) => profiles.reduce((a, p) => a + f(p), 0);
  const active7 = profiles.filter((p) => p.lastActive && Date.now() - p.lastActive < 7 * 864e5).length;
  const withTasks = profiles.filter((p) => p.counts.tasks);
  const avg = withTasks.length ? Math.round((withTasks.reduce((a, p) => a + p.progress, 0) / withTasks.length) * 100) : 0;
  const sorted = [...profiles].sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));

  el.innerHTML = `
    <div class="page-head"><div><h1>Admin</h1><p>Suivi des profils et de leur activité. Les comptes se gèrent dans <code>users.json</code> (<code>npm run user</code>).</p></div>
      <div class="acts"><button class="btn" id="refresh">Actualiser</button></div></div>
    <div class="kpis">
      <div class="kpi dark"><div class="l">Profils</div><div class="v">${profiles.length}</div><div class="s">${plural(profiles.filter((p) => p.admin).length, "admin")}</div></div>
      <div class="kpi"><div class="l">Actifs (7 j)</div><div class="v">${active7} / ${profiles.length}</div><div class="s">profils connectés ou actifs</div></div>
      <div class="kpi"><div class="l">Tâches</div><div class="v">${sum((p) => p.counts.tasks)}</div><div class="s">${sum((p) => p.counts.done)} terminée(s)</div></div>
      <div class="kpi"><div class="l">Catégories</div><div class="v">${sum((p) => p.counts.categories)}</div><div class="s">tous profils</div></div>
      <div class="kpi"><div class="l">Avancement moyen</div><div class="v">${avg}%</div>${meter(avg)}</div>
    </div>
    <div class="panels">
      <div class="panel full"><h2>Profils <small>clique sur une ligne pour le détail</small></h2>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Profil</th><th>Avancement</th><th class="tnum">Catégories</th><th class="tnum">Tâches</th><th class="tnum">Terminées</th><th class="tnum">Points cochés</th><th>Dernière connexion</th><th>Dernière activité</th></tr></thead><tbody>
        ${sorted.map((p) => {
          const pct = Math.round(p.progress * 100);
          return `<tr class="click" data-u="${esc(p.email)}">
          <td><b>${esc(p.name)}</b> ${p.admin ? `<span class="st">admin</span>` : ""}<div class="sub">${esc(p.email)}</div></td>
          <td style="min-width:160px"><div class="vec"><b>${pct}%</b><span></span><div class="track" style="background:var(--panel)"><div class="fill" style="width:${pct}%"></div></div></div></td>
          <td class="tnum">${p.counts.categories}</td><td class="tnum">${p.counts.tasks}</td><td class="tnum">${p.counts.done}</td>
          <td class="tnum">${p.counts.subtasksDone} / ${p.counts.subtasks}</td>
          <td>${ago(p.lastLogin)}</td><td>${ago(p.lastActive)}</td></tr>`;
        }).join("")}
        </tbody></table></div>
      </div>
    </div>`;

  $("#refresh").onclick = () => render();
  $$("[data-u]", el).forEach((tr) => (tr.onclick = () => openProfileDetail(profiles.find((p) => p.email === tr.dataset.u))));
}

function openProfileDetail(p) {
  const sheet = $("#sheet");
  const pct = Math.round(p.progress * 100);
  sheet.innerHTML = `<div class="in">
    <div class="top"><div><h3>${esc(p.name)} ${p.admin ? `<span class="st">admin</span>` : ""}</h3><div class="muted">${esc(p.email)} · dernière activité ${ago(p.lastActive)}</div></div><button class="x" id="closeSheet" aria-label="Fermer">×</button></div>
    <div class="kpis" style="margin-top:18px">
      <div class="kpi dark"><div class="l">Avancement</div><div class="v">${pct}%</div><div class="s">toutes catégories</div></div>
      <div class="kpi"><div class="l">Tâches</div><div class="v">${p.counts.tasks}</div><div class="s">${p.counts.done} terminée(s)</div></div>
      <div class="kpi"><div class="l">Points cochés</div><div class="v">${p.counts.subtasksDone}</div><div class="s">sur ${p.counts.subtasks}</div></div>
      <div class="kpi"><div class="l">Dernière connexion</div><div class="v" style="font-size:20px">${ago(p.lastLogin)}</div><div class="s">${p.lastLogin ? fmtTime(p.lastLogin) : ""}</div></div>
    </div>
    <div class="panel" style="margin-top:12px"><h2>Catégories <small>${plural(p.categories.length, "catégorie")}</small></h2>
      ${p.categories.length ? `<div class="funnel">${p.categories.map((c) => `<div class="r"><span>${dot(c)} ${esc(c.name)} <span class="muted">· ${c.done}/${c.tasks}</span></span><div class="track"><div class="fill" style="width:${Math.round(c.progress * 100)}%;--c:${colorOf(c)}"></div></div><span class="n">${Math.round(c.progress * 100)}%</span></div>`).join("")}</div>`
      : `<div class="empty-s">Aucune catégorie.</div>`}
    </div>
    <h2 class="section-title">Activité</h2>
    <div class="panel">${p.events.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Action</th></tr></thead><tbody>
      ${p.events.map((e) => `<tr><td style="white-space:nowrap">${fmtTime(e.at)}</td><td>${esc(e.label)}</td></tr>`).join("")}
    </tbody></table></div>${p.events.length >= 300 ? `<p class="hint">300 derniers événements affichés.</p>` : ""}` : `<div class="empty-s">Aucune activité.</div>`}</div>
  </div>`;
  $("#closeSheet").onclick = () => sheet.close();
  if (!sheet.open) sheet.showModal();
}
