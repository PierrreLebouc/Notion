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

// ---------- Liens ----------
// Repère les adresses web (http(s)://… ou www.…) écrites dans un texte ; renvoie [{ href, label }] sans doublon.
function findLinks(text) {
  const seen = new Set();
  const out = [];
  for (const [raw] of String(text || "").matchAll(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi)) {
    const clean = raw.replace(/[.,;:!?)\]}»]+$/, "");
    let url;
    try { url = new URL(/^www\./i.test(clean) ? "https://" + clean : clean); } catch { continue; }
    if (!/^https?:$/.test(url.protocol) || seen.has(url.href)) continue;
    seen.add(url.href);
    const path = (url.pathname + url.search).replace(/\/$/, "");
    const label = url.hostname.replace(/^www\./, "") + (path.length > 28 ? path.slice(0, 27) + "…" : path);
    out.push({ href: url.href, label });
  }
  return out;
}
const linkIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>`;
const linksHTML = (text) => findLinks(text).map((l) => `<a class="link" href="${esc(l.href)}" target="_blank" rel="noopener noreferrer" title="${esc(l.href)}">${linkIcon}${esc(l.label)}</a>`).join("");

// ---------- Rôles ----------
// "perso" : catégories personnelles · "manager" : gestionnaire d'une entreprise · "worker" : salarié.
const role = () => state.user?.role || "perso";
const isManager = () => role() === "manager";
const isWorker = () => role() === "worker";
const inCompany = () => role() !== "perso";
// Vocabulaire : un compte d'entreprise parle de projets, un compte personnel de catégories.
const W = () => inCompany()
  ? { one: "projet", One: "Projet", many: "projets", Many: "Projets", the: "le projet", this: "ce projet", New: "Nouveau projet", done: "terminé", all: "tous projets", none: "Aucun projet" }
  : { one: "catégorie", One: "Catégorie", many: "catégories", Many: "Catégories", the: "la catégorie", this: "cette catégorie", New: "Nouvelle catégorie", done: "terminée", all: "toutes catégories", none: "Aucune catégorie" };
const people = () => state.data.people || [];
const workers = () => people().filter((p) => p.role === "worker").sort((a, b) => a.name.localeCompare(b.name, "fr"));
const nameOf = (key) => people().find((p) => p.key === key)?.name || "Ancien salarié";
const initials = (name) => String(name || "?").split(/[\s.@-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
const avatars = (keys) => keys.length ? `<span class="avs">${keys.map((k) => `<span class="av" title="${esc(nameOf(k))}">${esc(initials(nameOf(k)))}</span>`).join("")}</span>` : "";
const canEditProjects = () => !isWorker();
const canCreateTaskIn = (cat) => !isWorker() || (cat.members || []).includes(state.user.key);
const canDeleteTask = (t) => !isWorker() || t.createdBy === state.user.key;

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
  state.user = null;
  state.open.clear();
  showLogin();
});
$("#themeBtn").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localSet("theme", next);
});
addEventListener("scroll", () => document.documentElement.classList.toggle("scrolled", scrollY > 8), { passive: true });

// Menus selon le rôle (+ Admin pour les administrateurs du site).
function navLinks() {
  const links = isManager()
    ? [["", "Tableau de bord entreprise"], ["taches", "Projets"], ["entreprise", "Gestion de mon entreprise"]]
    : isWorker() ? [["", "Tableau de bord"], ["taches", "Mes tâches"]] : [["", "Tableau de bord"], ["taches", "Tâches"]];
  if (state.user.admin) links.push(["admin", "Admin"]);
  return links.map(([r, l]) => `<a href="#/${r}" data-route="${r}">${l}</a>`).join("");
}

async function boot() {
  state.data = await api("data");
  $("#who").textContent = state.user.name;
  $(".brand small").textContent = state.user.companyName || "Espace personnel";
  $(".links").innerHTML = navLinks();
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
const ROUTES = { "": () => (isManager() ? viewCompanyDashboard : viewDashboard), taches: () => viewTasks, entreprise: () => viewCompany, admin: () => viewAdmin };
addEventListener("hashchange", render);
function render() {
  if (!state.user) return;
  const [route = "", arg] = location.hash.replace(/^#\/?/, "").split("/");
  $$(".links a").forEach((a) => a.classList.toggle("on", a.dataset.route === route));
  (ROUTES[route] || ROUTES[""])()($("#view"), arg);
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

// Fenêtre de création / modification d'une catégorie ou d'un projet (nom, couleur et, pour un projet, ses salariés).
// Renvoie { name, color, members? } ou null si annulé.
function askCategory(title, { name = "", color = nextColor(), members = [] } = {}, okLabel = "Enregistrer") {
  const sheet = $("#sheet");
  const withMembers = isManager();
  let picked = isColor(color) ? color.toLowerCase() : COLORS[0][0];
  const chosen = new Set(members);
  sheet.classList.add("small");
  sheet.innerHTML = `<form class="in" method="dialog">
    <div class="top"><h3>${esc(title)}</h3><button type="button" class="x" aria-label="Fermer">×</button></div>
    <label class="t" for="catName">Nom</label>
    <input id="catName" name="v" value="${esc(name)}" placeholder="${inCompany() ? "Site web, Salon 2027, Refonte…" : "Perso, Travail, Maison…"}" required autocomplete="off">
    <label class="t">Couleur</label>
    <div class="swatches" role="radiogroup" aria-label="Couleur">
      ${COLORS.map(([c, l]) => `<button type="button" class="sw" data-c="${c}" style="--c:${c}" role="radio" title="${l}" aria-label="${l}"></button>`).join("")}
      <label class="sw custom" title="Autre couleur" aria-label="Autre couleur"><input type="color" id="catColor" value="${picked}"></label>
    </div>
    ${withMembers ? `<label class="t">Salariés du projet <span class="muted">(ils peuvent y créer des tâches)</span></label>
      ${workers().length ? `<div class="chips" id="catMembers">${workers().map((w) => `<button type="button" class="chip ${chosen.has(w.key) ? "on" : ""}" data-k="${esc(w.key)}">${esc(w.name)}</button>`).join("")}</div>`
      : `<div class="muted" style="font-size:13px">Aucun salarié pour l'instant : crée-les dans « Gestion de mon entreprise ».</div>`}` : ""}
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
    $$("#catMembers .chip", sheet).forEach((b) => (b.onclick = () => {
      chosen.has(b.dataset.k) ? chosen.delete(b.dataset.k) : chosen.add(b.dataset.k);
      b.classList.toggle("on", chosen.has(b.dataset.k));
    }));
    $("#catColor", sheet).oninput = (e) => { picked = e.target.value.toLowerCase(); paint(); };
    $("#catName", sheet).oninput = paint;
    $(".x", sheet).onclick = () => sheet.close();
    $("form", sheet).onsubmit = (e) => {
      e.preventDefault();
      const v = e.target.elements.v.value.trim();
      result = v ? { name: v, color: picked, ...(withMembers ? { members: [...chosen] } : {}) } : null;
      sheet.close();
    };
    sheet.onclose = () => { sheet.classList.remove("small"); sheet.onclose = null; resolve(result); };
    paint();
    sheet.showModal();
    $("#catName", sheet).select();
  });
}

// Petite fenêtre qui demande un texte (ex. le nom d'une tâche) ; renvoie le texte ou null si annulé.
function askText(title, { label = "Nom", placeholder = "", okLabel = "Créer" } = {}) {
  const sheet = $("#sheet");
  sheet.classList.add("small");
  sheet.innerHTML = `<form class="in" method="dialog">
    <div class="top"><h3>${esc(title)}</h3><button type="button" class="x" aria-label="Fermer">×</button></div>
    <label class="t" for="askText">${esc(label)}</label>
    <input id="askText" name="v" placeholder="${esc(placeholder)}" required autocomplete="off">
    <button class="go" type="submit">${esc(okLabel)}</button>
  </form>`;
  return new Promise((resolve) => {
    let result = null;
    $(".x", sheet).onclick = () => sheet.close();
    $("form", sheet).onsubmit = (e) => {
      e.preventDefault();
      result = e.target.elements.v.value.trim() || null;
      sheet.close();
    };
    sheet.onclose = () => { sheet.classList.remove("small"); sheet.onclose = null; resolve(result); };
    sheet.showModal();
    $("#askText", sheet).focus();
  });
}

async function newCategory() {
  const answer = await askCategory(W().New, {}, "Créer");
  if (!answer) return;
  const cat = { id: uid(), ...answer, order: Date.now() };
  state.data.categories.push(cat);
  save("categories", cat);
  location.hash = `#/taches/${cat.id}`;
}

// ========== Tableau de bord (compte personnel ou salarié) ==========
function viewDashboard(el) {
  const w = W();
  const cats = state.data.categories;
  const all = statsOf(state.data.tasks);
  const name = (state.user.name || "").split(" ")[0];
  const inProgress = state.data.tasks
    .filter((t) => !t.done)
    .map((t) => ({ t, p: taskProgress(t), cat: cats.find((c) => c.id === t.categoryId) }))
    .sort((a, b) => b.p - a.p || (b.t.updated || 0) - (a.t.updated || 0))
    .slice(0, 8);
  const perCat = cats.map((c) => ({ c, s: statsOf(tasksOf(c.id)) }));
  const intro = all.total ? `${plural(all.total - all.done, "tâche")} en cours dans ${plural(cats.length, w.one)}.`
    : isWorker() ? "Aucune tâche ne t'est encore assignée." : "Crée une catégorie pour commencer à suivre tes tâches.";

  el.innerHTML = `
    <div class="page-head">
      <div><h1>Bonjour${name ? " " + esc(name) : ""}.</h1><p>${intro}</p></div>
      <div class="acts">${canEditProjects() ? `<button class="btn" id="newCat">+ ${w.New}</button>` : ""}${cats.length ? `<a class="btn dark" href="#/taches">Voir les tâches</a>` : ""}</div>
    </div>
    <div class="kpis">
      <div class="kpi dark"><div class="l">Avancement global</div><div class="v">${all.pct}%</div><div class="s">${w.all}</div></div>
      <div class="kpi"><div class="l">Tâches en cours</div><div class="v">${all.total - all.done}</div><div class="s">${plural(all.total, "tâche")} au total</div></div>
      <div class="kpi"><div class="l">Tâches terminées</div><div class="v">${all.done}</div><div class="s">${all.total ? Math.round((all.done / all.total) * 100) : 0}% des tâches</div></div>
      <div class="kpi"><div class="l">Points cochés</div><div class="v">${all.subDone}<span class="muted" style="font-size:18px"> / ${all.subTotal}</span></div>${meter(all.subTotal ? Math.round((all.subDone / all.subTotal) * 100) : 0)}</div>
      <div class="kpi"><div class="l">${w.Many}</div><div class="v">${cats.length}</div><div class="s">${perCat.filter((x) => x.s.total && x.s.done === x.s.total).length} ${w.done}(s) à 100 %</div></div>
    </div>

    <h2 class="section-title">${isWorker() ? "Mes projets" : w.Many}</h2>
    <div class="cards">
      ${perCat.map(({ c, s }) => `
        <a class="lcard ccard" href="#/taches/${c.id}">
          ${ring(s.pct, "", colorOf(c))}
          <div class="t"><b>${dot(c)} ${esc(c.name)}</b><div class="sub">${s.total ? `${s.done} terminée${s.done > 1 ? "s" : ""} sur ${plural(s.total, "tâche")}` : "Aucune tâche"}${s.subTotal ? ` · ${s.subDone}/${s.subTotal} points` : ""}</div>${meter(s.total ? Math.round((s.done / s.total) * 100) : 0, colorOf(c))}</div>
        </a>`).join("")}
      ${canEditProjects() ? `<button class="lcard ccard add" id="newCat2">+ ${w.New}</button>` : ""}
    </div>

    <div class="panels">
      <div class="panel"><h2>Avancement par ${w.one} <small>tâches et points cochés</small></h2>
        ${perCat.length ? `<div class="funnel">${perCat.map(({ c, s }) => `<a class="r" href="#/taches/${c.id}"><span>${dot(c)} ${esc(c.name)}</span><div class="track"><div class="fill" style="width:${s.pct}%;--c:${colorOf(c)}"></div></div><span class="n">${s.pct}%</span></a>`).join("")}</div>`
        : `<div class="empty-s">${w.none} pour l'instant.</div>`}
      </div>
      <div class="panel"><h2>En cours <small>les plus avancées</small></h2>
        ${inProgress.length ? `<div class="tbl-wrap"><table class="tbl"><tbody>${inProgress.map(({ t, p, cat }) => `
          <tr class="click" data-cat="${t.categoryId}" data-id="${t.id}"><td><b>${esc(t.title)}</b><div class="sub">${dot(cat)} ${esc(cat?.name || "")}</div></td>
          <td style="width:40%">${meter(Math.round(p * 100), colorOf(cat))}</td><td class="tnum">${Math.round(p * 100)}%</td></tr>`).join("")}</tbody></table></div>`
        : `<div class="empty-s">Aucune tâche en cours.</div>`}
      </div>
    </div>`;

  if ($("#newCat")) $("#newCat").onclick = newCategory;
  if ($("#newCat2")) $("#newCat2").onclick = newCategory;
  $$("tr[data-id]", el).forEach((tr) => (tr.onclick = () => {
    state.open.add(tr.dataset.id);
    location.hash = `#/taches/${tr.dataset.cat}`;
  }));
}

// ========== Tableau de bord de l'entreprise (gestionnaire) ==========
function viewCompanyDashboard(el) {
  const cats = state.data.categories;
  const tasks = state.data.tasks;
  const all = statsOf(tasks);
  const perCat = cats.map((c) => ({ c, s: statsOf(tasksOf(c.id)) }));
  const perWorker = workers().map((w) => ({ w, s: statsOf(tasks.filter((t) => (t.assignees || []).includes(w.key))) }));
  const unassigned = tasks.filter((t) => !(t.assignees || []).length);
  const ua = statsOf(unassigned);

  el.innerHTML = `
    <div class="page-head">
      <div><h1>${esc(state.user.companyName || "Mon entreprise")}</h1><p>Tableau de bord de l'entreprise · ${plural(cats.length, "projet")} · ${plural(workers().length, "salarié")}</p></div>
      <div class="acts"><button class="btn" id="newCat">+ Nouveau projet</button>${cats.length ? `<a class="btn dark" href="#/taches">Voir les projets</a>` : ""}</div>
    </div>
    <div class="kpis">
      <div class="kpi dark"><div class="l">Avancement global</div><div class="v">${all.pct}%</div><div class="s">tous projets</div></div>
      <div class="kpi"><div class="l">Tâches en cours</div><div class="v">${all.total - all.done}</div><div class="s">${plural(all.total, "tâche")} au total</div></div>
      <div class="kpi"><div class="l">Tâches terminées</div><div class="v">${all.done}</div><div class="s">${all.total ? Math.round((all.done / all.total) * 100) : 0}% des tâches</div></div>
      <div class="kpi"><div class="l">Non assignées</div><div class="v">${unassigned.length}</div><div class="s">${unassigned.length ? `dont ${ua.total - ua.done} en cours` : "toutes les tâches ont un salarié"}</div></div>
      <div class="kpi"><div class="l">Salariés</div><div class="v">${workers().length}</div><div class="s">${perWorker.filter((x) => x.s.total - x.s.done > 0).length} avec des tâches en cours</div></div>
    </div>

    <h2 class="section-title">Projets</h2>
    <div class="cards">
      ${perCat.map(({ c, s }) => `
        <a class="lcard ccard" href="#/taches/${c.id}">
          ${ring(s.pct, "", colorOf(c))}
          <div class="t"><b>${dot(c)} ${esc(c.name)}</b><div class="sub">${s.total ? `${s.done} terminée${s.done > 1 ? "s" : ""} sur ${plural(s.total, "tâche")}` : "Aucune tâche"}</div>
          ${meter(s.total ? Math.round((s.done / s.total) * 100) : 0, colorOf(c))}${(c.members || []).length ? `<div class="sub" style="margin-top:6px">${avatars(c.members)}</div>` : ""}</div>
        </a>`).join("")}
      <button class="lcard ccard add" id="newCat2">+ Nouveau projet</button>
    </div>

    <div class="panels">
      <div class="panel"><h2>Avancement par projet <small>tâches et points cochés</small></h2>
        ${perCat.length ? `<div class="funnel">${perCat.map(({ c, s }) => `<a class="r" href="#/taches/${c.id}"><span>${dot(c)} ${esc(c.name)} <span class="muted">· ${s.done}/${s.total}</span></span><div class="track"><div class="fill" style="width:${s.pct}%;--c:${colorOf(c)}"></div></div><span class="n">${s.pct}%</span></a>`).join("")}</div>`
        : `<div class="empty-s">Aucun projet pour l'instant.</div>`}
      </div>
      <div class="panel"><h2>Avancement par salarié <small>sur leurs tâches assignées</small></h2>
        ${perWorker.length || unassigned.length ? `<div class="funnel">
          ${perWorker.map(({ w, s }) => `<div class="r"><span><span class="av">${esc(initials(w.name))}</span> ${esc(w.name)} <span class="muted">· ${s.done}/${s.total}</span></span><div class="track"><div class="fill" style="width:${s.pct}%"></div></div><span class="n">${s.total ? s.pct + "%" : "—"}</span></div>`).join("")}
          ${unassigned.length ? `<div class="r"><span class="muted">Non assignées · ${ua.done}/${ua.total}</span><div class="track"><div class="fill" style="width:${ua.pct}%"></div></div><span class="n">${ua.pct}%</span></div>` : ""}
        </div>` : `<div class="empty-s">Aucun salarié pour l'instant. <a href="#/entreprise">Créer des comptes salariés</a></div>`}
      </div>
    </div>`;

  $("#newCat").onclick = newCategory;
  $("#newCat2").onclick = newCategory;
}

// ========== Tâches / projets ==========
function viewTasks(el, catId) {
  const w = W();
  const cats = state.data.categories;
  if (!cats.length) {
    el.innerHTML = `<div class="page-head"><div><h1>${isWorker() ? "Mes tâches" : inCompany() ? "Projets" : "Tâches"}</h1><p>${inCompany() ? "Les projets de l'entreprise." : "Range tes tâches par catégorie."}</p></div></div>
      <div class="empty"><b>${w.none}</b>${isWorker() ? "Ton gestionnaire ne t'a encore ajouté à aucun projet ni assigné de tâche."
        : inCompany() ? "Crée ton premier projet pour y ajouter des tâches et les assigner à tes salariés."
        : "Crée ta première catégorie (Perso, Travail, Maison…) pour y ajouter des fiches de tâche."}
      ${canEditProjects() ? `<div style="margin-top:16px"><button class="btn dark" id="newCat">+ ${w.New}</button></div>` : ""}</div>`;
    if ($("#newCat")) $("#newCat").onclick = newCategory;
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
  const canCreate = canCreateTaskIn(cat);

  el.innerHTML = `
    <div class="page-head">
      <div style="display:flex;gap:18px;align-items:center">${ring(s.pct, "lg", colorOf(cat))}
        <div><h1>${esc(cat.name)}</h1><p>${s.total ? `${s.done} terminée${s.done > 1 ? "s" : ""} sur ${plural(s.total, "tâche")}${s.subTotal ? ` · ${s.subDone} sur ${plural(s.subTotal, "point")} cochés` : ""}` : `Aucune tâche dans ${w.this}.`}
        ${isManager() ? `<br><span class="muted">${(cat.members || []).length ? `Salariés : ${cat.members.map((k) => esc(nameOf(k))).join(", ")}` : "Aucun salarié sur ce projet"}</span>` : ""}</p></div></div>
      ${canEditProjects() ? `<div class="acts"><button class="btn" id="editCat">${dot(cat)} Modifier</button><button class="btn danger" id="deleteCat">Supprimer</button></div>` : ""}
    </div>
    <div class="catbar">
      ${cats.map((c) => `<a class="chip ${c.id === cat.id ? "on" : ""}" href="#/taches/${c.id}" style="text-decoration:none">${dot(c)} ${esc(c.name)} <span class="${c.id === cat.id ? "" : "muted"}">${tasksOf(c.id).filter((t) => !t.done).length || ""}</span></a>`).join("")}
      ${canEditProjects() ? `<button class="chip ghost" id="newCat">+ ${w.One}</button>` : ""}
    </div>
    <div class="toolbar"><span class="seg" id="filter">${[["all", "Toutes", s.total], ["todo", "En cours", s.total - s.done], ["done", "Terminées", s.done]].map(([k, l, n]) => `<button class="${filter === k ? "on" : ""}" data-f="${k}">${l} · ${n}</button>`).join("")}</span>
      ${canCreate ? `<button class="btn dark" id="newTask">+ Nouvelle tâche</button>` : `<span class="muted toolbar-note">Tu n'es pas membre de ce projet : tu ne peux pas y créer de tâche.</span>`}</div>
    <div class="tasks" id="tasks">
      ${shown.length ? shown.map((t) => taskHTML(t, color)).join("") : `<div class="empty"><b>${tasks.length ? "Rien ici" : "Aucune tâche"}</b>${tasks.length ? "Aucune tâche ne correspond à ce filtre." : canCreate ? "Ajoute une fiche de tâche avec le bouton « + Nouvelle tâche »." : ""}</div>`}
    </div>`;

  if ($("#newCat")) $("#newCat").onclick = newCategory;
  if ($("#editCat")) $("#editCat").onclick = async () => {
    const answer = await askCategory(`Modifier ${w.the}`, { name: cat.name, color: cat.color || COLORS[0][0], members: cat.members || [] });
    if (!answer) return;
    Object.assign(cat, answer);
    save("categories", cat);
    render();
  };
  if ($("#deleteCat")) $("#deleteCat").onclick = async () => {
    if (!confirm(`Supprimer ${w.the} « ${cat.name} »${tasks.length ? ` et ses ${plural(tasks.length, "tâche")}` : ""} ?`)) return;
    try {
      await remove("categories", cat.id);
      state.data.categories = cats.filter((c) => c.id !== cat.id);
      state.data.tasks = state.data.tasks.filter((t) => t.categoryId !== cat.id);
      localSet("lastCat", "");
      location.hash = "#/taches";
      render();
      toast(`${w.One} supprimé${inCompany() ? "" : "e"}`);
    } catch (e) { toast(e.message, true); }
  };
  // La tâche est créée fermée : on la déplie soi-même pour y ajouter des notes ou des points.
  if ($("#newTask")) $("#newTask").onclick = async () => {
    const title = await askText("Nouvelle tâche", { label: "Nom de la tâche", placeholder: "Appeler le garage, préparer la réunion…" });
    if (!title) return;
    const t = { id: uid(), categoryId: cat.id, title, notes: "", done: false, subtasks: [], created: Date.now() };
    // Une tâche créée par un salarié lui est assignée.
    if (inCompany()) Object.assign(t, { assignees: isWorker() ? [state.user.key] : [], createdBy: state.user.key });
    state.data.tasks.unshift(t);
    save("tasks", t);
    render();
  };
  $$("#filter button").forEach((b) => (b.onclick = () => { localSet("taskFilter", b.dataset.f); render(); }));
  $$(".tcard", el).forEach(bindTask);
}

function taskHTML(t, color) {
  const subs = t.subtasks || [];
  const done = subs.filter((s) => s.done).length;
  const pct = subs.length ? Math.round((done / subs.length) * 100) : 0;
  const open = state.open.has(t.id);
  const links = linksHTML(t.notes);
  const assignees = t.assignees || [];
  const hint = subs.length ? `${done} sur ${plural(subs.length, "point")} cochés` : t.notes ? t.notes.split("\n")[0].slice(0, 90) : "Clique pour ajouter des points à cocher";
  // Tâche fermée : liens cliquables et points à cocher restent utilisables sans la déplier.
  const peek = !open && (links || subs.length) ? `<div class="peek">
      ${links ? `<div class="links-row">${links}</div>` : ""}
      ${subs.length ? `<ul class="checklist mini-list">${subs.map((s) => `<li class="${s.done ? "on" : ""}" data-sid="${s.id}"><input type="checkbox" class="check sq" ${s.done ? "checked" : ""} aria-label="Cocher"><span class="txt">${esc(s.text)}</span></li>`).join("")}</ul>` : ""}
    </div>` : "";
  // Assignation (entreprise) : le gestionnaire choisit les salariés, le salarié voit qui est assigné.
  const assign = !inCompany() ? "" : isManager()
    ? `<label class="t">Assignée à</label>${workers().length
      ? `<div class="chips" data-assign>${workers().map((w) => `<button type="button" class="chip ${assignees.includes(w.key) ? "on" : ""}" data-k="${esc(w.key)}">${esc(w.name)}</button>`).join("")}</div>`
      : `<div class="muted" style="font-size:13px">Aucun salarié : crée-les dans « Gestion de mon entreprise ».</div>`}`
    : `<label class="t">Assignée à</label><div class="muted" style="font-size:14px">${assignees.map((k) => esc(nameOf(k))).join(", ") || "Personne"}</div>`;
  return `<article class="tcard ${open ? "open" : ""} ${t.done ? "done" : ""}" data-id="${t.id}">
    <div class="h">
      <input type="checkbox" class="check" data-done ${t.done ? "checked" : ""} title="${t.done ? "Rouvrir" : "Marquer terminée"}" aria-label="Terminée">
      <div class="t"><b>${esc(t.title) || "Sans titre"}</b><div class="sub">${esc(hint)}</div></div>
      ${inCompany() ? (assignees.length ? avatars(assignees) : isManager() ? `<span class="st muted">non assignée</span>` : "") : ""}
      ${subs.length ? `<div class="mini"><div class="n">${done}/${subs.length}</div>${meter(t.done ? 100 : pct, color)}</div>` : ""}
      <span class="chev"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></span>
    </div>
    ${peek}
    ${open ? `<div class="body">
      <input class="title" value="${esc(t.title)}" aria-label="Titre de la tâche">
      <textarea placeholder="Notes, liens, détails…">${esc(t.notes)}</textarea>
      <div class="links-row">${links}</div>
      ${assign}
      <label class="t">Points à cocher</label>
      <ul class="checklist">
        ${subs.map((s) => `<li class="${s.done ? "on" : ""}" data-sid="${s.id}"><input type="checkbox" class="check sq" ${s.done ? "checked" : ""} aria-label="Cocher"><input class="txt" value="${esc(s.text)}" aria-label="Point"><button class="rm" title="Supprimer ce point" aria-label="Supprimer">×</button></li>`).join("")}
        <li class="add"><span>+</span><input data-add placeholder="Ajouter un point… (Entrée)" autocomplete="off"></li>
      </ul>
      <div class="acts">${canDeleteTask(t) ? `<button class="btn danger sm" data-del>Supprimer la tâche</button>` : "<span></span>"}<button class="btn dark sm" data-toggle>${t.done ? "Rouvrir la tâche" : "✓ Marquer terminée"}</button></div>
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
  if (!state.open.has(t.id)) {
    $$(".peek li[data-sid] .check", card).forEach((box) => (box.onchange = () => {
      t.subtasks.find((s) => s.id === box.closest("li").dataset.sid).done = box.checked;
      save("tasks", t);
      render();
    }));
    return;
  }

  const title = $("input.title", card);
  title.oninput = () => { t.title = title.value; $(".h b", card).textContent = t.title || "Sans titre"; save("tasks", t, 600); };
  $("textarea", card).oninput = (e) => { t.notes = e.target.value; $(".body .links-row", card).innerHTML = linksHTML(t.notes); save("tasks", t, 600); };

  // Assignation par le gestionnaire : un salarié assigné devient aussi membre du projet.
  $$("[data-assign] .chip", card).forEach((b) => (b.onclick = () => {
    const k = b.dataset.k;
    const list = t.assignees || [];
    t.assignees = list.includes(k) ? list.filter((x) => x !== k) : [...list, k];
    const cat = state.data.categories.find((c) => c.id === t.categoryId);
    if (cat && t.assignees.includes(k) && !(cat.members || []).includes(k)) cat.members = [...(cat.members || []), k];
    save("tasks", t);
    render();
  }));

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
  if ($("[data-del]", card)) $("[data-del]", card).onclick = async () => {
    if (!confirm(`Supprimer la tâche « ${t.title} » ?`)) return;
    try {
      await remove("tasks", t.id);
      state.data.tasks = state.data.tasks.filter((x) => x !== t);
      render();
      toast("Tâche supprimée");
    } catch (e) { toast(e.message, true); }
  };
}

// ========== Gestion de mon entreprise (gestionnaire) ==========
async function viewCompany(el) {
  if (!isManager()) { location.hash = "#/"; return; }
  el.innerHTML = `<div class="page-head"><div><h1>Gestion de mon entreprise</h1></div></div><div class="loading"><span class="spin"></span> Chargement…</div>`;
  let company, list;
  try { ({ company, workers: list } = await api("company")); } catch (e) { el.querySelector(".loading").outerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
  if (!location.hash.startsWith("#/entreprise")) return;
  list.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  // Garde la liste des salariés à jour pour les assignations.
  state.data.people = [...people().filter((p) => p.role !== "worker"), ...list.map(({ lastLogin, ...p }) => p)];

  el.innerHTML = `
    <div class="page-head"><div><h1>Gestion de mon entreprise</h1><p>Nom de l'entreprise et comptes salariés.</p></div></div>
    <div class="panel">
      <h2>Entreprise</h2>
      <form class="inline-form" id="companyForm"><input name="name" value="${esc(company.name)}" required autocomplete="off" aria-label="Nom de l'entreprise"><button class="btn dark" type="submit">Enregistrer</button></form>
    </div>
    <div class="page-head" style="margin-top:28px"><div><h2 class="section-title" style="margin:0">Comptes salariés</h2><p>${plural(list.length, "salarié")} · ils voient les tâches qui leur sont assignées.</p></div>
      <div class="acts"><button class="btn dark" id="newWorker">+ Nouveau salarié</button></div></div>
    <div class="panel">${list.length ? `<div class="tbl-wrap"><table class="tbl accounts"><thead><tr><th>Nom</th><th>Email</th><th>Tâches</th><th>Dernière connexion</th><th></th></tr></thead><tbody>
      ${list.map((a) => {
        const s = statsOf(state.data.tasks.filter((t) => (t.assignees || []).includes(a.key)));
        return `<tr data-k="${esc(a.key)}">
        <td><span class="av">${esc(initials(a.name))}</span> <b>${esc(a.name)}</b></td>
        <td>${esc(a.email)}</td>
        <td>${s.total ? `${s.done}/${s.total} terminée${s.done > 1 ? "s" : ""}` : `<span class="muted">aucune</span>`}</td>
        <td>${ago(a.lastLogin)}</td>
        <td class="row-acts"><button class="btn sm" data-edit>Modifier</button><button class="btn danger sm" data-del>Supprimer</button></td>
      </tr>`;
      }).join("")}
    </tbody></table></div>` : `<div class="empty-s">Aucun salarié pour l'instant. Crée un compte pour chaque salarié : il pourra se connecter avec son email et son mot de passe.</div>`}</div>`;

  $("#companyForm").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const { company: c } = await api("company", { method: "PUT", body: { name: e.target.elements.name.value.trim() } });
      state.user.companyName = c.name;
      $(".brand small").textContent = c.name;
      toast("Nom de l'entreprise enregistré");
    } catch (ex) { toast(ex.message, true); }
  };
  $("#newWorker").onclick = () => accountForm(null, "worker");
  $$("tr[data-k]", el).forEach((tr) => {
    const a = list.find((x) => x.key === tr.dataset.k);
    $("[data-edit]", tr).onclick = () => accountForm(a, "worker");
    $("[data-del]", tr).onclick = () => deleteAccount(a, "worker");
  });
}

// ========== Admin : gestion des comptes ==========
const ROLE_LABEL = { perso: "Personnel", manager: "Gestionnaire", worker: "Salarié" };
async function viewAdmin(el) {
  if (!state.user.admin) { location.hash = "#/"; return; }
  el.innerHTML = `<div class="page-head"><div><h1>Comptes</h1><p>Gestion des comptes qui ont accès au site.</p></div></div><div class="loading"><span class="spin"></span> Chargement…</div>`;
  let accounts;
  try { ({ accounts } = await api("admin")); } catch (e) { el.querySelector(".loading").outerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
  if (!location.hash.startsWith("#/admin")) return;
  accounts.sort((a, b) => (a.companyName || "").localeCompare(b.companyName || "", "fr") || (a.name || "").localeCompare(b.name || "", "fr"));

  el.innerHTML = `
    <div class="page-head"><div><h1>Comptes</h1><p>${plural(accounts.length, "compte")} · ${plural(accounts.filter((a) => a.role === "manager").length, "gestionnaire")} · ${plural(accounts.filter((a) => a.admin).length, "admin")}</p></div>
      <div class="acts"><button class="btn dark" id="newAccount">+ Nouveau compte</button></div></div>
    <div class="panel"><div class="tbl-wrap"><table class="tbl accounts"><thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Entreprise</th><th>Dernière connexion</th><th></th></tr></thead><tbody>
      ${accounts.map((a) => `<tr data-k="${esc(a.key)}">
        <td><b>${esc(a.name)}</b>${a.key === state.user.key ? ` <span class="muted">(toi)</span>` : ""}</td>
        <td>${esc(a.email)}</td>
        <td>${ROLE_LABEL[a.role] || "Personnel"}${a.admin ? ` <span class="st">admin</span>` : ""}</td>
        <td>${a.companyName ? `${esc(a.companyName)}${a.role === "manager" ? ` <span class="muted">· ${plural(a.workers, "salarié")}</span>` : ""}` : `<span class="muted">—</span>`}</td>
        <td>${ago(a.lastLogin)}</td>
        <td class="row-acts"><button class="btn sm" data-edit>Modifier</button>${a.key === state.user.key ? "" : `<button class="btn danger sm" data-del>Supprimer</button>`}</td>
      </tr>`).join("")}
    </tbody></table></div></div>`;

  $("#newAccount").onclick = () => accountForm(null, "admin");
  $$("tr[data-k]", el).forEach((tr) => {
    const a = accounts.find((x) => x.key === tr.dataset.k);
    $("[data-edit]", tr).onclick = () => accountForm(a, "admin");
    if ($("[data-del]", tr)) $("[data-del]", tr).onclick = () => deleteAccount(a, "admin");
  });
}

// Fenêtre de création (p = null) ou de modification d'un compte.
// mode "admin" : nom, email, mot de passe, rôle (personnel / gestionnaire + entreprise), accès admin.
// mode "worker" : compte salarié créé par le gestionnaire (nom, email, mot de passe).
function accountForm(p, mode) {
  const sheet = $("#sheet");
  const admin = mode === "admin";
  const self = p && p.key === state.user.key;
  const pRole = p?.role || "perso";
  const roleEditable = admin && pRole !== "worker";
  sheet.classList.add("small");
  sheet.innerHTML = `<form class="in" method="dialog" autocomplete="off">
    <div class="top"><h3>${p ? (admin ? "Modifier le compte" : "Modifier le salarié") : admin ? "Nouveau compte" : "Nouveau salarié"}</h3><button type="button" class="x" aria-label="Fermer">×</button></div>
    <label class="t" for="accName">Nom</label>
    <input id="accName" name="name" value="${esc(p?.name || "")}" placeholder="Marie">
    <label class="t" for="accEmail">Email</label>
    <input id="accEmail" name="email" type="email" value="${esc(p?.email || "")}" placeholder="marie@exemple.fr" required>
    <label class="t" for="accPw">${p ? "Nouveau mot de passe" : "Mot de passe"}</label>
    <input id="accPw" name="password" type="password" autocomplete="new-password" minlength="8" ${p ? `placeholder="Laisser vide pour ne pas le changer"` : `placeholder="8 caractères minimum" required`}>
    ${roleEditable ? `<label class="t" for="accRole">Rôle</label>
      <select id="accRole" name="role">
        <option value="perso" ${pRole === "perso" ? "selected" : ""}>Personnel (catégories personnelles)</option>
        <option value="manager" ${pRole === "manager" ? "selected" : ""}>Gestionnaire d'entreprise</option>
      </select>
      <div id="companyField" class="${pRole === "manager" ? "hidden" : ""}"><label class="t" for="accCompany">Nom de l'entreprise</label><input id="accCompany" name="companyName" placeholder="Mon entreprise" autocomplete="off"></div>`
      : admin && pRole === "worker" ? `<label class="t">Rôle</label><div class="muted" style="font-size:14px">Salarié de ${esc(p.companyName || "son entreprise")} · géré par son gestionnaire</div>` : ""}
    ${admin ? `<label class="opt"><input type="checkbox" class="check sq" name="admin" ${p?.admin ? "checked" : ""} ${self ? "disabled" : ""}> Accès admin${self ? ` <span class="muted">(ton compte)</span>` : ""}</label>` : ""}
    <div class="msg err hidden" id="accErr"></div>
    <button class="go" type="submit">${p ? "Enregistrer" : "Créer le compte"}</button>
  </form>`;
  const roleSel = $("#accRole", sheet);
  // Le nom de l'entreprise n'est demandé que si le compte devient gestionnaire.
  const syncRole = () => $("#companyField", sheet)?.classList.toggle("hidden", !(roleSel.value === "manager" && pRole !== "manager"));
  if (roleSel) { roleSel.onchange = syncRole; syncRole(); }
  $(".x", sheet).onclick = () => sheet.close();
  sheet.onclose = () => { sheet.classList.remove("small"); sheet.onclose = null; };
  $("form", sheet).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const body = { name: f.name.value.trim(), email: f.email.value.trim() };
    if (admin) body.admin = f.admin.checked;
    if (roleSel) { body.role = roleSel.value; body.companyName = f.companyName.value.trim(); }
    if (f.password.value) body.password = f.password.value;
    const base = admin ? "admin/accounts" : "company/workers";
    const btn = $("button.go", sheet);
    btn.disabled = true;
    try {
      const { account } = await api(p ? `${base}/${encodeURIComponent(p.key)}` : base, { method: p ? "PUT" : "POST", body });
      if (self) {
        state.user = { ...state.user, ...account };
        sheet.close();
        await boot(); // le rôle a pu changer : menus et données sont rechargés
      } else {
        sheet.close();
        render();
      }
      toast(p ? "Compte enregistré" : `Compte ${account.email} créé`);
    } catch (ex) {
      $("#accErr", sheet).textContent = ex.message;
      $("#accErr", sheet).classList.remove("hidden");
      btn.disabled = false;
    }
  };
  if (!sheet.open) sheet.showModal();
  $(p ? "#accName" : "#accEmail", sheet).focus();
}

async function deleteAccount(p, mode) {
  const what = p.role === "manager"
    ? "Son entreprise sera aussi supprimée : tous ses comptes salariés, ses projets et ses tâches."
    : p.role === "worker" ? "Il sera retiré de ses tâches et projets (les tâches restent dans l'entreprise)."
    : "Ses catégories, tâches et son historique seront définitivement effacés.";
  if (!confirm(`Supprimer le compte de ${p.name} (${p.email}) ?\n\n${what}`)) return;
  try {
    await api(`${mode === "admin" ? "admin/accounts" : "company/workers"}/${encodeURIComponent(p.key)}`, { method: "DELETE" });
    if (mode === "worker") {
      state.data.people = people().filter((x) => x.key !== p.key);
      for (const t of state.data.tasks) if ((t.assignees || []).includes(p.key)) t.assignees = t.assignees.filter((k) => k !== p.key);
      for (const c of state.data.categories) if ((c.members || []).includes(p.key)) c.members = c.members.filter((k) => k !== p.key);
    }
    toast("Compte supprimé");
    render();
  } catch (e) { toast(e.message, true); }
}
