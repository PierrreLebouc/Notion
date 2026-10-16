// État de l'espace : { categories: [{ id, name, tasks: [{ id, title, notes, done, subtasks: [{ id, text, done }] }] }] }
let workspace = { categories: [] };
let currentId = null;
const expanded = new Set();

const $ = (sel, root = document) => root.querySelector(sel);
const uid = () => crypto.randomUUID();

// ---------- Chargement / sauvegarde ----------

async function load() {
  const res = await fetch("/api/data");
  if (res.status === 401) return (location.href = "/login");
  const body = await res.json();
  workspace = body.workspace;
  $("#username").textContent = body.username;
  currentId = workspace.categories[0]?.id ?? null;
  render();
}

let saveTimer;
function save() {
  setStatus("Enregistrement…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const res = await fetch("/api/data", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(workspace),
    });
    if (res.status === 401) return (location.href = "/login");
    setStatus(res.ok ? "Enregistré ✓" : "Erreur d'enregistrement", !res.ok);
  }, 400);
}

function setStatus(text, isError = false) {
  const el = $("#save-status");
  el.textContent = text;
  el.classList.toggle("error", isError);
  el.classList.add("visible");
  clearTimeout(el._hide);
  if (!isError) el._hide = setTimeout(() => el.classList.remove("visible"), 1500);
}

const current = () => workspace.categories.find((c) => c.id === currentId);

// ---------- Rendu ----------

function render() {
  renderCategories();
  const cat = current();
  $("#empty").hidden = !!cat;
  $("#category-view").hidden = !cat;
  if (!cat) return;
  $("#category-name").value = cat.name;
  renderTasks(cat);
}

function renderCategories() {
  const list = $("#categories");
  list.innerHTML = "";
  for (const cat of workspace.categories) {
    const li = document.createElement("li");
    li.className = cat.id === currentId ? "active" : "";
    const remaining = cat.tasks.filter((t) => !t.done).length;
    li.innerHTML = `<span class="cat-name"></span><span class="count">${remaining || ""}</span>`;
    li.querySelector(".cat-name").textContent = cat.name;
    li.onclick = () => { currentId = cat.id; render(); };
    list.appendChild(li);
  }
}

function renderTasks(cat) {
  const container = $("#tasks");
  container.innerHTML = "";
  if (!cat.tasks.length) {
    container.innerHTML = `<p class="muted">Aucune tâche dans cette catégorie.</p>`;
    return;
  }
  for (const task of cat.tasks) container.appendChild(renderTask(cat, task));
}

function renderTask(cat, task) {
  const el = $("#task-template").content.firstElementChild.cloneNode(true);
  const isOpen = expanded.has(task.id);
  el.classList.toggle("done", task.done);
  el.classList.toggle("open", isOpen);

  const toggle = $(".toggle", el);
  toggle.textContent = isOpen ? "▾" : "▸";
  $(".task-body", el).hidden = !isOpen;
  const flip = () => {
    isOpen ? expanded.delete(task.id) : expanded.add(task.id);
    renderTasks(cat);
  };
  toggle.onclick = flip;

  const title = $(".task-title", el);
  title.value = task.title;
  title.oninput = () => { task.title = title.value; save(); };
  title.onkeydown = (e) => { if (e.key === "Enter") flip(); };

  const done = $(".task-done", el);
  done.checked = task.done;
  done.onchange = () => { task.done = done.checked; save(); render(); };

  $(".delete-task", el).onclick = () => {
    if (!confirm(`Supprimer « ${task.title} » ?`)) return;
    cat.tasks = cat.tasks.filter((t) => t.id !== task.id);
    save(); render();
  };

  // Progression des sous-tâches
  const total = task.subtasks.length;
  const checked = task.subtasks.filter((s) => s.done).length;
  $(".progress-label", el).textContent = total ? `${checked}/${total}` : "";
  $(".progress", el).hidden = !total;
  $(".progress-bar", el).style.width = total ? `${(checked / total) * 100}%` : "0";

  const notes = $(".task-notes", el);
  notes.value = task.notes || "";
  notes.oninput = () => { task.notes = notes.value; save(); };

  const list = $(".subtasks", el);
  for (const sub of task.subtasks) {
    const li = document.createElement("li");
    li.className = sub.done ? "checked" : "";
    li.innerHTML = `
      <input type="checkbox">
      <input class="sub-text">
      <button class="btn-ghost danger" title="Supprimer">✕</button>`;
    const [box, text, del] = li.children;
    box.checked = sub.done;
    box.onchange = () => { sub.done = box.checked; save(); renderTasks(cat); };
    text.value = sub.text;
    text.oninput = () => { sub.text = text.value; save(); };
    del.onclick = () => {
      task.subtasks = task.subtasks.filter((s) => s.id !== sub.id);
      save(); renderTasks(cat);
    };
    list.appendChild(li);
  }

  $(".new-subtask", el).onsubmit = (e) => {
    e.preventDefault();
    const input = e.target.elements.text;
    const value = input.value.trim();
    if (!value) return;
    task.subtasks.push({ id: uid(), text: value, done: false });
    save(); renderTasks(cat);
    // Garder le focus pour enchaîner les ajouts
    $(`[data-id="${task.id}"] .new-subtask input`)?.focus();
  };
  el.dataset.id = task.id;

  return el;
}

// ---------- Actions ----------

$("#new-category").onsubmit = (e) => {
  e.preventDefault();
  const input = e.target.elements.name;
  const name = input.value.trim();
  if (!name) return;
  const cat = { id: uid(), name, tasks: [] };
  workspace.categories.push(cat);
  currentId = cat.id;
  input.value = "";
  save(); render();
};

$("#category-name").oninput = (e) => {
  current().name = e.target.value;
  save(); renderCategories();
};

$("#delete-category").onclick = () => {
  const cat = current();
  if (!confirm(`Supprimer la catégorie « ${cat.name} » et toutes ses tâches ?`)) return;
  workspace.categories = workspace.categories.filter((c) => c.id !== cat.id);
  currentId = workspace.categories[0]?.id ?? null;
  save(); render();
};

$("#new-task").onsubmit = (e) => {
  e.preventDefault();
  const input = e.target.elements.title;
  const title = input.value.trim();
  if (!title) return;
  const task = { id: uid(), title, notes: "", done: false, subtasks: [] };
  current().tasks.unshift(task);
  expanded.add(task.id);
  input.value = "";
  save(); render();
};

$("#logout").onclick = async () => {
  await fetch("/api/logout", { method: "POST" });
  location.href = "/login";
};

load();
