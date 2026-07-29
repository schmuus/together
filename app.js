import { firebaseConfig, ALLOWED_EMAILS, DISPLAY_NAMES } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getFirestore, collection, addDoc, doc, updateDoc, deleteDoc, onSnapshot,
  serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const CATEGORY_LABELS = {
  kommunikation: "Kommunikation",
  zeit: "Gemeinsame Zeit",
  naehe: "Nähe & Intimität",
  haushalt: "Haushalt & Alltag",
  familie: "Familie & Freunde",
  zukunft: "Zukunft & Pläne",
  finanzen: "Finanzen",
  sonstiges: "Sonstiges"
};
const TYPE_LABELS = {
  konflikt: "Streitigkeit",
  vermisst: "Vermisst",
  positiv: "Schöner Moment",
  sonstiges: "Sonstiges"
};
const STATUS_LABELS = {
  offen: "Offen",
  klaerung: "In Klärung",
  geloest: "Gelöst"
};

let currentUser = null;
let allEntries = []; // live cache from Firestore
let partnerAccentAssigned = {}; // uid -> 'a' | 'b'

// ---------- DOM refs ----------
const viewLogin = document.getElementById("view-login");
const viewApp = document.getElementById("view-app");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const userBadge = document.getElementById("user-badge");

const tabsNav = document.getElementById("tabs");
const tabPanels = {
  neu: document.getElementById("tab-neu"),
  uebersicht: document.getElementById("tab-uebersicht"),
  auswertung: document.getElementById("tab-auswertung"),
};

const entryForm = document.getElementById("entry-form");
const fRating = document.getElementById("f-rating");
const fRatingValue = document.getElementById("f-rating-value");

const entryListEl = document.getElementById("entry-list");
const entryListEmpty = document.getElementById("entry-list-empty");
const filterCategory = document.getElementById("filter-category");
const filterStatus = document.getElementById("filter-status");
const filterType = document.getElementById("filter-type");
const filterWaiting = document.getElementById("filter-waiting");

const modalOverlay = document.getElementById("modal-overlay");
const modalContent = document.getElementById("modal-content");
const modalClose = document.getElementById("modal-close");

// ---------- Auth ----------
const loginToggle = document.getElementById("login-toggle");
const loginDropdown = document.getElementById("login-dropdown");

loginToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  const willOpen = loginDropdown.hidden;
  loginDropdown.hidden = !willOpen;
  loginToggle.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) document.getElementById("login-email").focus();
});

document.addEventListener("click", (e) => {
  if (!loginDropdown.hidden && !e.target.closest(".login-dropdown-wrap")) {
    loginDropdown.hidden = true;
    loginToggle.setAttribute("aria-expanded", "false");
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !loginDropdown.hidden) {
    loginDropdown.hidden = true;
    loginToggle.setAttribute("aria-expanded", "false");
  }
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.hidden = true;
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    loginError.textContent = "Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort prüfen.";
    loginError.hidden = false;
  }
});

document.getElementById("btn-logout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (user && ALLOWED_EMAILS.includes(user.email)) {
    currentUser = user;
    viewLogin.hidden = true;
    viewApp.hidden = false;
    userBadge.textContent = DISPLAY_NAMES[user.email] || user.email;
    assignAccents();
    subscribeToEntries();
  } else {
    if (user && !ALLOWED_EMAILS.includes(user.email)) {
      signOut(auth);
      loginError.textContent = "Dieser Account ist für die App nicht freigeschaltet.";
      loginError.hidden = false;
    }
    currentUser = null;
    viewApp.hidden = true;
    viewLogin.hidden = false;
    loginDropdown.hidden = true;
    loginToggle.setAttribute("aria-expanded", "false");
  }
});

function assignAccents() {
  // Stable accent color per email (independent of login order): sorted alphabetically.
  const sorted = [...ALLOWED_EMAILS].sort();
  partnerAccentAssigned = {};
  sorted.forEach((email, i) => { partnerAccentAssigned[email] = i === 0 ? "a" : "b"; });
}

function partnerEmail() {
  return ALLOWED_EMAILS.find((e) => e !== currentUser.email);
}

// ---------- Tabs ----------
tabsNav.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("is-active"));
  btn.classList.add("is-active");
  const key = btn.dataset.tab;
  Object.entries(tabPanels).forEach(([k, el]) => el.classList.toggle("is-active", k === key));
  if (key === "auswertung") renderStats();
});

// ---------- New entry form ----------
fRating.addEventListener("input", () => { fRatingValue.textContent = fRating.value; });

const DRAFT_KEY = "zwischenuns-entwurf";
const draftFieldIds = ["f-title", "f-category", "f-type", "f-description", "f-cause", "f-prevention", "f-helped", "f-rating"];

function saveDraft() {
  const draft = {};
  draftFieldIds.forEach((id) => { draft[id] = document.getElementById(id).value; });
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* Speicher voll o.ä. - kein Drama */ }
}

function loadDraft() {
  let raw;
  try { raw = localStorage.getItem(DRAFT_KEY); } catch { return; }
  if (!raw) return;
  let draft;
  try { draft = JSON.parse(raw); } catch { return; }
  draftFieldIds.forEach((id) => {
    if (draft[id] !== undefined) document.getElementById(id).value = draft[id];
  });
  fRatingValue.textContent = fRating.value;
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}

let draftSaveTimeout;
entryForm.addEventListener("input", () => {
  clearTimeout(draftSaveTimeout);
  draftSaveTimeout = setTimeout(saveDraft, 400);
});

loadDraft();

entryForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("f-title").value.trim();
  const category = document.getElementById("f-category").value;
  const type = document.getElementById("f-type").value;
  const description = document.getElementById("f-description").value.trim();
  const cause = document.getElementById("f-cause").value.trim();
  const prevention = document.getElementById("f-prevention").value.trim();
  const helped = document.getElementById("f-helped").value.trim();
  const ratingValue = Number(fRating.value);

  const submitBtn = entryForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    await addDoc(collection(db, "entries"), {
      title, category, type, description,
      status: "offen",
      createdBy: currentUser.uid,
      createdByEmail: currentUser.email,
      createdAt: serverTimestamp(),
      ratings: {
        [currentUser.uid]: {
          value: ratingValue,
          helped: helped,
          cause: cause,
          prevention: prevention,
          email: currentUser.email,
          ratedAt: new Date().toISOString()
        }
      }
    });
    entryForm.reset();
    fRatingValue.textContent = "5";
    fRating.value = 5;
    clearDraft();
    document.querySelector('[data-tab="uebersicht"]').click();
  } catch (err) {
    alert("Speichern fehlgeschlagen: " + err.message);
  } finally {
    submitBtn.disabled = false;
  }
});

// ---------- Live data ----------
function subscribeToEntries() {
  const q = query(collection(db, "entries"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snap) => {
    allEntries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderEntryList();
    if (document.querySelector('[data-tab="auswertung"]').classList.contains("is-active")) {
      renderStats();
    }
  });
}

// ---------- Entry list ----------
[filterCategory, filterStatus, filterType, filterWaiting].forEach((el) =>
  el.addEventListener("change", renderEntryList)
);

function renderEntryList() {
  const cat = filterCategory.value;
  const status = filterStatus.value;
  const type = filterType.value;
  const waiting = filterWaiting.value;

  let list = allEntries.filter((e) => {
    if (cat && e.category !== cat) return false;
    if (status && e.status !== status) return false;
    if (type && e.type !== type) return false;
    const bothRated = e.ratings && Object.keys(e.ratings).length >= 2;
    if (waiting === "waiting" && bothRated) return false;
    if (waiting === "both" && !bothRated) return false;
    return true;
  });

  entryListEl.innerHTML = "";
  entryListEmpty.hidden = list.length > 0;

  list.forEach((entry) => {
    entryListEl.appendChild(buildEntryCard(entry));
  });
}

function buildEntryCard(entry) {
  const card = document.createElement("div");
  card.className = "entry-card";
  card.addEventListener("click", () => openDetail(entry.id));

  const bothRated = entry.ratings && Object.keys(entry.ratings).length >= 2;
  const date = entry.createdAt?.toDate ? entry.createdAt.toDate() : null;
  const dateStr = date ? date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";

  card.innerHTML = `
    <div class="entry-card-top">
      <div>
        <h3 class="entry-card-title">${escapeHtml(entry.title)}</h3>
        <div class="entry-card-meta">
          <span class="pill">${CATEGORY_LABELS[entry.category] || entry.category}</span>
          <span class="pill">${TYPE_LABELS[entry.type] || entry.type}</span>
          <span class="pill pill-status-${entry.status}">${STATUS_LABELS[entry.status] || entry.status}</span>
          ${!bothRated ? '<span class="pill pill-waiting">Wartet auf Bewertung</span>' : ""}
        </div>
      </div>
      <span class="pill" style="white-space:nowrap;">${dateStr}</span>
    </div>
    <p class="entry-card-desc">${escapeHtml(entry.description)}</p>
  `;
  card.appendChild(buildDualGauge(entry));
  return card;
}

// ---------- Dual gauge (signature comparison component) ----------
function buildDualGauge(entry, opts = {}) {
  const wrap = document.createElement("div");
  wrap.className = "dual-gauge";

  const emailA = [...ALLOWED_EMAILS].sort()[0];
  const emailB = [...ALLOWED_EMAILS].sort()[1];
  const uidByEmail = {};
  Object.entries(entry.ratings || {}).forEach(([uid, r]) => { uidByEmail[r.email] = { uid, ...r }; });

  const rA = uidByEmail[emailA];
  const rB = uidByEmail[emailB];

  if (!rA && !rB) {
    wrap.innerHTML = `<span class="dual-gauge-waiting">Noch keine Bewertung</span>`;
    return wrap;
  }
  if (!rA || !rB) {
    const who = rA ? DISPLAY_NAMES[emailB] || "Partner" : DISPLAY_NAMES[emailA] || "Partner";
    const have = rA ? rA.value : rB.value;
    wrap.innerHTML = `
      <div class="dual-gauge-track">
        <div class="dual-gauge-marker ${rA ? "a" : "b"}" style="left:${have * 10 - 5}%"></div>
      </div>
      <div class="dual-gauge-legend">
        <span>${rA ? rA.value : "–"} / ${rB ? rB.value : "–"}</span>
        <span class="dual-gauge-waiting">wartet auf ${escapeHtml(who)}</span>
      </div>`;
    return wrap;
  }

  const posA = rA.value * 10 - 5;
  const posB = rB.value * 10 - 5;
  const left = Math.min(posA, posB);
  const width = Math.abs(posA - posB);

  wrap.innerHTML = `
    <div class="dual-gauge-track">
      <div class="dual-gauge-fill" style="left:${left}%; width:${width}%;"></div>
      <div class="dual-gauge-marker a" style="left:${posA}%"></div>
      <div class="dual-gauge-marker b" style="left:${posB}%"></div>
    </div>
    <div class="dual-gauge-legend">
      <span class="value-a">${DISPLAY_NAMES[emailA] || "P1"}: ${rA.value}</span>
      <span>Δ ${Math.abs(rA.value - rB.value)}</span>
      <span class="value-b">${DISPLAY_NAMES[emailB] || "P2"}: ${rB.value}</span>
    </div>`;
  return wrap;
}

// ---------- Detail modal ----------
function openDetail(entryId) {
  const entry = allEntries.find((e) => e.id === entryId);
  if (!entry) return;
  renderDetail(entry);
  modalOverlay.hidden = false;
}
modalClose.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) closeModal(); });
function closeModal() { modalOverlay.hidden = true; modalContent.innerHTML = ""; }

function renderRaterDetails(rating) {
  return `
    <div class="rater-score">${rating.value}/10</div>
    ${rating.cause ? `<div class="rater-note"><strong>Wie kam es dazu?</strong><br>${escapeHtml(rating.cause)}</div>` : ""}
    ${rating.prevention ? `<div class="rater-note"><strong>Vermeidung:</strong><br>${escapeHtml(rating.prevention)}</div>` : ""}
    ${rating.helped ? `<div class="rater-note"><strong>Bemerkung:</strong><br>${escapeHtml(rating.helped)}</div>` : ""}
  `;
}

function renderDetail(entry) {
  const myRating = entry.ratings?.[currentUser.uid];
  const pEmail = partnerEmail();
  const partnerUidEntry = Object.entries(entry.ratings || {}).find(([, r]) => r.email === pEmail);
  const partnerRating = partnerUidEntry ? partnerUidEntry[1] : null;

  modalContent.innerHTML = `
    <h2 class="detail-title">${escapeHtml(entry.title)}</h2>
    <div class="detail-meta">
      <span class="pill">${CATEGORY_LABELS[entry.category] || entry.category}</span>
      <span class="pill">${TYPE_LABELS[entry.type] || entry.type}</span>
    </div>
    <p class="detail-desc">${escapeHtml(entry.description)}</p>
    ${entry.cause && !myRating?.cause && !partnerRating?.cause ? `<div class="detail-subblock"><h4>Wie kam es dazu?</h4><p>${escapeHtml(entry.cause)}</p></div>` : ""}
    ${entry.prevention && !myRating?.prevention && !partnerRating?.prevention ? `<div class="detail-subblock"><h4>Wie kann man es vermeiden?</h4><p>${escapeHtml(entry.prevention)}</p></div>` : ""}

    <div class="status-row">
      <span style="font-size:0.85rem;color:var(--text-dim);">Status:</span>
      <select id="detail-status">
        <option value="offen" ${entry.status === "offen" ? "selected" : ""}>Offen</option>
        <option value="klaerung" ${entry.status === "klaerung" ? "selected" : ""}>In Klärung</option>
        <option value="geloest" ${entry.status === "geloest" ? "selected" : ""}>Gelöst</option>
      </select>
      <button class="btn btn-ghost btn-small btn-delete" id="detail-delete" style="margin-left:auto;">Eintrag löschen</button>
    </div>

    <div id="detail-gauge"></div>

    <div class="rater-columns">
      <div class="rater-col mine">
        <h4>Ich</h4>
        ${myRating ? renderRaterDetails(myRating) : `<div class="rater-empty">Noch nicht bewertet</div>`}
      </div>
      <div class="rater-col">
        <h4>${escapeHtml(DISPLAY_NAMES[pEmail] || "Partner")}</h4>
        ${partnerRating ? renderRaterDetails(partnerRating) : `<div class="rater-empty">Noch nicht bewertet</div>`}
      </div>
    </div>

    <div class="own-rating-form">
      <h3>${myRating ? "Meine Bewertung anpassen" : "Ich reagiere auch darauf"}</h3>

      <label class="field">
        <span>Wie kam es dazu? / Woran hat es gelegen? <em>(optional)</em></span>
        <textarea id="detail-cause" rows="2">${myRating?.cause ? escapeHtml(myRating.cause) : ""}</textarea>
      </label>

      <label class="field">
        <span>Wie kann man es in Zukunft vermeiden? <em>(optional)</em></span>
        <textarea id="detail-prevention" rows="2">${myRating?.prevention ? escapeHtml(myRating.prevention) : ""}</textarea>
      </label>

      <div class="field">
        <span>Wie empfinde ich das? <strong id="detail-rating-value">${myRating?.value ?? 5}</strong>/10</span>
        <div class="rating-slider-wrap">
          <span class="rating-endlabel">belastend</span>
          <input type="range" id="detail-rating" min="1" max="10" value="${myRating?.value ?? 5}">
          <span class="rating-endlabel">gut</span>
        </div>
      </div>

      <label class="field">
        <span>Bemerkung <em>(optional)</em></span>
        <textarea id="detail-helped" rows="2">${myRating?.helped ? escapeHtml(myRating.helped) : ""}</textarea>
      </label>

      <button class="btn btn-primary" id="detail-save-rating">Bewertung speichern</button>
    </div>
  `;

  document.getElementById("detail-gauge").appendChild(buildDualGauge(entry));

  document.getElementById("detail-rating").addEventListener("input", (e) => {
    document.getElementById("detail-rating-value").textContent = e.target.value;
  });

  document.getElementById("detail-status").addEventListener("change", async (e) => {
    await updateDoc(doc(db, "entries", entry.id), { status: e.target.value });
  });

  document.getElementById("detail-delete").addEventListener("click", async () => {
    const sure = window.confirm(`"${entry.title}" wirklich unwiderruflich löschen?`);
    if (!sure) return;
    const btn = document.getElementById("detail-delete");
    btn.disabled = true;
    try {
      await deleteDoc(doc(db, "entries", entry.id));
      closeModal();
    } catch (err) {
      alert("Löschen fehlgeschlagen: " + err.message);
      btn.disabled = false;
    }
  });

  document.getElementById("detail-save-rating").addEventListener("click", async () => {
    const value = Number(document.getElementById("detail-rating").value);
    const helped = document.getElementById("detail-helped").value.trim();
    const cause = document.getElementById("detail-cause").value.trim();
    const prevention = document.getElementById("detail-prevention").value.trim();
    const btn = document.getElementById("detail-save-rating");
    btn.disabled = true;
    try {
      await updateDoc(doc(db, "entries", entry.id), {
        [`ratings.${currentUser.uid}`]: {
          value, helped, cause, prevention, email: currentUser.email, ratedAt: new Date().toISOString()
        }
      });
      closeModal();
    } catch (err) {
      alert("Speichern fehlgeschlagen: " + err.message);
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- Auswertung / Stats ----------
function renderStats() {
  const total = allEntries.length;
  const open = allEntries.filter((e) => e.status === "offen").length;
  const resolved = allEntries.filter((e) => e.status === "geloest").length;
  const positive = allEntries.filter((e) => e.type === "positiv").length;

  document.getElementById("stats-summary").innerHTML = `
    <div class="stat-box"><span class="num">${total}</span><span class="label">Einträge gesamt</span></div>
    <div class="stat-box"><span class="num">${open}</span><span class="label">Offen</span></div>
    <div class="stat-box"><span class="num">${resolved}</span><span class="label">Gelöst</span></div>
    <div class="stat-box"><span class="num">${positive}</span><span class="label">Schöne Momente</span></div>
  `;

  // Average rating per category (across all ratings from both partners)
  const catBars = document.getElementById("category-bars");
  catBars.innerHTML = "";
  Object.entries(CATEGORY_LABELS).forEach(([key, label]) => {
    const entries = allEntries.filter((e) => e.category === key);
    const values = entries.flatMap((e) => Object.values(e.ratings || {}).map((r) => r.value));
    if (values.length === 0) return;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const row = document.createElement("div");
    row.className = "cat-bar-row";
    row.innerHTML = `
      <span class="cat-bar-label">${label}</span>
      <span class="cat-bar-track"><span class="cat-bar-fill" style="width:${avg * 10}%"></span></span>
      <span class="cat-bar-val">${avg.toFixed(1)}</span>
    `;
    catBars.appendChild(row);
  });
  if (!catBars.children.length) {
    catBars.innerHTML = `<p class="empty-state">Noch keine bewerteten Einträge.</p>`;
  }

  // Biggest discrepancies between partners
  const gapList = document.getElementById("gap-list");
  gapList.innerHTML = "";
  const withBoth = allEntries
    .filter((e) => e.ratings && Object.keys(e.ratings).length >= 2)
    .map((e) => {
      const vals = Object.values(e.ratings).map((r) => r.value);
      const diff = Math.abs(vals[0] - vals[1]);
      return { entry: e, diff };
    })
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 6);

  if (withBoth.length === 0) {
    gapList.innerHTML = `<p class="empty-state">Sobald beide einen Eintrag bewertet haben, seht ihr hier die größten Unterschiede.</p>`;
  } else {
    withBoth.forEach(({ entry, diff }) => {
      const row = document.createElement("div");
      row.className = "gap-row";
      row.addEventListener("click", () => openDetail(entry.id));
      row.innerHTML = `
        <span class="gap-row-title">${escapeHtml(entry.title)}</span>
        <span class="gap-row-diff">Δ ${diff}</span>
      `;
      gapList.appendChild(row);
    });
  }
}

// ---------- Export ----------
document.getElementById("btn-export").addEventListener("click", () => {
  const data = JSON.stringify(allEntries, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `zwischen-uns-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

// ---------- Utils ----------
function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
