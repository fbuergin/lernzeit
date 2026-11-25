'use strict';
/* =========================================================
   Lernzeit – Zeit-Tracker für den Unialltag
   Alle Daten liegen lokal auf dem Gerät (localStorage).
   ========================================================= */

const STORE_KEY = 'lernzeit.v1';
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------------- Zustand ---------------- */
function defaultState() {
  return {
    v: 1,
    settings: { goalMin: 240 },
    categories: [
      {
        id: 'lernen', name: 'Lernen', emoji: '📚', color: '#5E5CE6', study: true, archived: false,
        subs: [
          { id: 'lernen', name: 'Lernen', emoji: '📖', color: '#5E5CE6' },
          { id: 'serie', name: 'Serie bearbeiten', emoji: '✍️', color: '#BF5AF2' },
          { id: 'vorlesung', name: 'Vorlesung schauen', emoji: '🎧', color: '#32ADE6' }
        ]
      },
      { id: 'hoersaal', name: 'Vorlesung (Hörsaal)', emoji: '🏛️', color: '#FF9F0A', study: true, archived: false, subs: [] },
      { id: 'gym', name: 'Gym', emoji: '🏋️', color: '#FF375F', study: false, archived: false, subs: [] }
    ],
    subjects: [],
    sessions: [],
    active: null
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      const d = defaultState();
      return { ...d, ...s, settings: { ...d.settings, ...(s.settings || {}) } };
    }
  } catch (e) { console.warn(e); }
  return defaultState();
}
let state = load();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('Speichern fehlgeschlagen'); }
}

const ui = {
  tab: sessionStorage.getItem('tab') || 'today',
  statsMode: 'week',
  statsAnchor: Date.now(),
  statsFilter: 'all',
  histDays: 21,
  pendingStart: null
};

/* ---------------- Datum ---------------- */
const sod = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
const sow = (t) => { const d = sod(t); const wd = (new Date(d).getDay() + 6) % 7; return addDays(d, -wd); };
const som = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); };
const addMonths = (t, n) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime(); };
const wdIdx = (t) => (new Date(t).getDay() + 6) % 7;
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtClock = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtDate = (t, o) => new Date(t).toLocaleDateString('de-DE', o);

function fmtDur(min) {
  min = Math.round(min);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
function fmtShort(min) {
  min = Math.round(min);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60), m = min % 60;
  return `${h}:${pad(m)}h`;
}
function fmtTimer(ms) {
  ms = Math.max(0, ms);
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
function dayLabel(t) {
  const d = sod(t), today = sod(Date.now());
  if (d === today) return 'Heute';
  if (d === addDays(today, -1)) return 'Gestern';
  return fmtDate(t, { weekday: 'long', day: 'numeric', month: 'long' });
}

/* ---------------- Aktivitäten ---------------- */
// Eine "Aktivität" = Kategorie ohne Unterteilung, oder eine Unterkategorie.
function buildActs() {
  const map = {};
  for (const c of state.categories) {
    map[c.id] = { key: c.id, cat: c.id, sub: null, name: c.name, emoji: c.emoji, color: c.color, study: !!c.study, catName: c.name, archived: !!c.archived };
    for (const s of c.subs || []) {
      map[c.id + '/' + s.id] = { key: c.id + '/' + s.id, cat: c.id, sub: s.id, name: s.name, emoji: s.emoji || c.emoji, color: s.color || c.color, study: !!c.study, catName: c.name, archived: !!c.archived };
    }
  }
  return map;
}
let ACTS = buildActs();
const actKey = (cat, sub) => (sub ? cat + '/' + sub : cat);
const actOf = (s) => ACTS[actKey(s.cat, s.sub)] || ACTS[s.cat] || { key: '?', name: 'Gelöscht', emoji: '❔', color: '#8E8E93', study: false };
const selectableActs = () => state.categories.filter((c) => !c.archived).flatMap((c) =>
  c.subs && c.subs.length ? c.subs.map((s) => ACTS[c.id + '/' + s.id]) : [ACTS[c.id]]);

/* ---------------- Aktive Session ---------------- */
const activePauseMs = (a = state.active, now = Date.now()) => a ? a.pauseMs + (a.pausedAt ? now - a.pausedAt : 0) : 0;
const activeNetMs = (now = Date.now()) => state.active ? now - state.active.start - activePauseMs(state.active, now) : 0;

function allSessions() {
  const list = state.sessions.slice();
  const a = state.active;
  if (a) {
    const now = Date.now();
    list.push({ id: a.id, cat: a.cat, sub: a.sub, subject: a.subject, start: a.start, end: now, pauseMin: activePauseMs(a, now) / MIN, live: true });
  }
  return list;
}

/* ---------------- Aggregation ---------------- */
// Netto-Minuten einer Session innerhalb [a, b). Pausen werden anteilig abgezogen.
function netIn(s, a, b) {
  const gross = s.end - s.start;
  if (gross <= 0) return 0;
  const ov = Math.min(b, s.end) - Math.max(a, s.start);
  if (ov <= 0) return 0;
  const net = Math.max(0, gross - (s.pauseMin || 0) * MIN);
  return (ov * net / gross) / MIN;
}

function aggregate(a, b, sessions = allSessions()) {
  const r = { total: 0, study: 0, pause: 0, count: 0, byAct: {}, bySubject: {}, longest: 0 };
  for (const s of sessions) {
    if (s.end <= a || s.start >= b) continue;
    const m = netIn(s, a, b);
    const act = actOf(s);
    r.total += m;
    if (act.study) r.study += m;
    r.byAct[act.key] = (r.byAct[act.key] || 0) + m;
    if (s.subject) r.bySubject[s.subject] = (r.bySubject[s.subject] || 0) + m;
    if (s.start >= a) {
      r.count++;
      r.pause += s.pauseMin || 0;
      r.longest = Math.max(r.longest, (s.end - s.start) / MIN - (s.pauseMin || 0));
    }
  }
  return r;
}

function filteredMin(ag) { return ui.statsFilter === 'study' ? ag.study : ag.total; }
function filterActs(byAct) {
  return Object.entries(byAct)
    .filter(([k, v]) => v > 0.5 && (ui.statsFilter === 'all' || (ACTS[k] || {}).study))
    .map(([k, v]) => ({ act: ACTS[k] || { key: k, name: 'Gelöscht', emoji: '❔', color: '#8E8E93' }, min: v }))
    .sort((x, y) => y.min - x.min);
}

// Lernminuten pro Tag (für Streaks & Kalender)
function studyByDay(sessions = allSessions()) {
  const out = {};
  for (const s of sessions) {
    if (!actOf(s).study) continue;
    for (let d = sod(s.start); d < s.end; d = addDays(d, 1)) {
      const m = netIn(s, d, addDays(d, 1));
      if (m > 0) out[dayKey(d)] = (out[dayKey(d)] || 0) + m;
    }
  }
  return out;
}

function streaks() {
  const byDay = studyByDay();
  const has = (t) => (byDay[dayKey(t)] || 0) >= 1;
  let cur = 0, t = sod(Date.now());
  if (!has(t)) t = addDays(t, -1);
  while (has(t)) { cur++; t = addDays(t, -1); }
  const keys = Object.keys(byDay).filter((k) => byDay[k] >= 1).sort();
  let best = 0, run = 0, prev = null;
  for (const k of keys) {
    const [y, m, d] = k.split('-').map(Number);
    const ts = new Date(y, m - 1, d).getTime();
    run = prev !== null && sod(addDays(prev, 1)) === ts ? run + 1 : 1;
    best = Math.max(best, run); prev = ts;
  }
  return { cur, best, byDay };
}

function hourDistribution(a, b) {
  const hours = new Array(24).fill(0);
  for (const s of allSessions()) {
    if (!actOf(s).study || s.end <= a || s.start >= b) continue;
    let t = Math.max(a, s.start);
    const end = Math.min(b, s.end);
    while (t < end) {
      const d = new Date(t); d.setMinutes(0, 0, 0);
      const hEnd = Math.min(end, d.getTime() + HOUR);
      hours[new Date(t).getHours()] += netIn(s, t, hEnd);
      t = hEnd;
    }
  }
  return hours;
}

/* ---------------- Rendering ---------------- */
const main = $('#main');

function render() {
  ACTS = buildActs();
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
  const titles = { today: 'Heute', stats: 'Statistik', history: 'Verlauf', settings: 'Einstellungen' };
  $('#title').textContent = titles[ui.tab];
  $('#eyebrow').textContent = ui.tab === 'today' ? fmtDate(Date.now(), { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  $('#topAction').style.visibility = ui.tab === 'today' || ui.tab === 'history' ? 'visible' : 'hidden';
  const views = { today: viewToday, stats: viewStats, history: viewHistory, settings: viewSettings };
  main.innerHTML = views[ui.tab]();
}

const playIcon = '<svg viewBox="0 0 12 12"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor"/></svg>';
const chevL = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const chevR = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function ringSvg(p, color, size = 96, stroke = 10) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--fill)" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${c * clamp(p, 0, 1)} ${c}" style="transition:stroke-dasharray .6s"/></svg>`;
}

function activeCard() {
  const a = state.active;
  if (!a) return '';
  const act = actOf(a);
  const chips = state.subjects.length && act.study
    ? `<div class="chips" style="margin-top:4px">${state.subjects.map((s) => `<button class="chip ${a.subject === s ? 'on' : ''}" data-action="activeSubject" data-v="${esc(s)}">${esc(s)}</button>`).join('')}</div>`
    : '';
  return `<section class="glass card active-card" style="--c:${act.color}">
    <div class="active-top"><span class="pulse ${a.pausedAt ? 'paused' : ''}"></span><span>${a.pausedAt ? 'Pausiert' : 'Läuft'} · seit ${fmtClock(a.start)}</span></div>
    <div class="active-name">${act.emoji} ${esc(act.name)}</div>
    <div class="timer" id="timer">${fmtTimer(activeNetMs())}</div>
    <div class="timer-sub" id="timerSub">${pauseText()}</div>
    ${chips}
    <div class="active-btns">
      <button class="btn" data-action="pause">${a.pausedAt ? '▶︎ Weiter' : '❚❚ Pause'}</button>
      <button class="btn danger" data-action="stop">■ Beenden</button>
    </div>
  </section>`;
}
function pauseText() {
  const p = activePauseMs();
  if (!state.active) return '';
  return p >= 1000 ? `davon ${fmtDur(p / MIN)} Pause` : 'Netto-Zeit ohne Pausen';
}

function viewToday() {
  const now = Date.now(), d0 = sod(now), d1 = addDays(d0, 1);
  const ag = aggregate(d0, d1);
  const goal = state.settings.goalMin;
  const p = goal ? ag.study / goal : 0;
  let h = '<div class="fade-in">' + activeCard();

  h += `<section class="glass card goal">
    <div class="ring">${ringSvg(p, 'var(--accent)')}<div class="ring-txt">${Math.round(p * 100)}%</div></div>
    <div class="goal-info">
      <div class="muted small">Lernzeit heute</div>
      <div class="big">${fmtDur(ag.study)}</div>
      <div class="row"><div><b>${fmtDur(goal)}</b>Ziel</div><div><b>${fmtDur(ag.total)}</b>Gesamt</div></div>
    </div>
  </section>`;

  const runKey = state.active ? actKey(state.active.cat, state.active.sub) : null;
  // Kategorien mit Unterteilung bekommen eigene Gruppe, der Rest wird zusammengefasst
  const cats = state.categories.filter((c) => !c.archived);
  const groups = [];
  let rest = null;
  for (const c of cats) {
    if (c.subs && c.subs.length) groups.push({ title: c.name, acts: c.subs.map((s) => ACTS[c.id + '/' + s.id]) });
    else { if (!rest) { rest = { title: 'Weitere', acts: [] }; groups.push(rest); } rest.acts.push(ACTS[c.id]); }
  }
  for (const grp of groups) {
    const acts = grp.acts;
    h += `<div class="section-title">${esc(grp.title)}</div>`;
    h += `<div class="tiles">${acts.map((act) => {
      const m = ag.byAct[act.key] || 0;
      const running = runKey === act.key;
      return `<button class="tile glass ${running ? 'running' : ''}" style="--c:${act.color}" data-action="tile" data-key="${act.key}">
        <div class="emoji">${act.emoji}</div>
        <div><div class="name">${esc(act.name)}</div><div class="today">${running ? 'läuft …' : m >= 1 ? fmtDur(m) + ' heute' : 'Tippen zum Starten'}</div></div>
        ${running ? '' : `<span class="play">${playIcon}</span>`}
      </button>`;
    }).join('')}</div>`;
  }

  h += `<div class="section-title">Tagesverlauf</div><section class="glass card">${timelineHtml(d0)}</section>`;

  const todays = allSessions().filter((s) => s.end > d0 && s.start < d1).sort((x, y) => y.start - x.start);
  if (todays.length) h += `<div class="list glass">${todays.map(sessionRow).join('')}</div>`;
  return h + '</div>';
}

function sessionRow(s) {
  const act = actOf(s);
  const net = (s.end - s.start) / MIN - (s.pauseMin || 0);
  const sub = [s.subject, `${fmtClock(s.start)}–${s.live ? 'jetzt' : fmtClock(s.end)}`, s.pauseMin >= 1 ? `${Math.round(s.pauseMin)} min Pause` : '', s.note].filter(Boolean).map(esc).join(' · ');
  return `<button class="list-item" ${s.live ? '' : `data-action="edit" data-id="${s.id}"`}>
    <span class="li-ico" style="background:color-mix(in srgb, ${act.color} 22%, transparent)">${act.emoji}</span>
    <span class="li-main"><div class="li-title">${esc(act.name)}</div><div class="li-sub">${sub}</div></span>
    <span class="li-right"><b>${fmtShort(net)}</b></span>
  </button>`;
}

function timelineHtml(d0) {
  const d1 = addDays(d0, 1), now = Date.now();
  const ss = allSessions().filter((s) => s.end > d0 && s.start < d1);
  let sh = 7, eh = 22;
  for (const s of ss) {
    sh = Math.min(sh, Math.floor((Math.max(s.start, d0) - d0) / HOUR));
    eh = Math.max(eh, Math.ceil((Math.min(s.end, d1) - d0) / HOUR));
  }
  sh = clamp(sh, 0, 23); eh = clamp(eh, sh + 1, 24);
  const a = d0 + sh * HOUR, span = (eh - sh) * HOUR;
  const pct = (t) => clamp((t - a) / span * 100, 0, 100);
  let segs = ss.map((s) => {
    const l = pct(Math.max(s.start, d0)), r = pct(Math.min(s.end, d1));
    return `<div class="seg" style="left:${l}%;width:${Math.max(r - l, 0.6)}%;background:${actOf(s).color}"></div>`;
  }).join('');
  if (now >= a && now < a + span) segs += `<div class="now" style="left:${pct(now)}%"></div>`;
  const step = eh - sh > 12 ? 3 : 2;
  let axis = '';
  for (let hh = sh; hh <= eh; hh += step) axis += `<span style="left:${(hh - sh) / (eh - sh) * 100}%">${hh}</span>`;
  const legend = [...new Set(ss.map((s) => actOf(s).key))].map((k) => ACTS[k] || actOf({ cat: k }));
  return `<div class="timeline">${segs}</div><div class="tl-axis">${axis}</div>
    ${ss.length ? `<div class="chips left" style="margin-top:8px">${legend.map((x) => `<span class="small muted" style="display:inline-flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:50%;background:${x.color}"></span>${esc(x.name)}</span>`).join('')}</div>`
      : '<div class="small muted" style="margin-top:6px">Noch nichts erfasst.</div>'}`;
}

/* ---------- Statistik ---------- */
function statsRange() {
  const t = ui.statsAnchor;
  if (ui.statsMode === 'day') { const a = sod(t); return [a, addDays(a, 1)]; }
  if (ui.statsMode === 'week') { const a = sow(t); return [a, addDays(a, 7)]; }
  const a = som(t); return [a, addMonths(a, 1)];
}
function statsLabel([a, b]) {
  if (ui.statsMode === 'day') return dayLabel(a);
  if (ui.statsMode === 'week') {
    if (a === sow(Date.now())) return 'Diese Woche';
    const e = addDays(b, -1);
    return `${fmtDate(a, { day: 'numeric', month: 'short' })} – ${fmtDate(e, { day: 'numeric', month: 'short' })}`;
  }
  return fmtDate(a, { month: 'long', year: 'numeric' });
}
function prevRange([a]) {
  if (ui.statsMode === 'day') return [addDays(a, -1), a];
  if (ui.statsMode === 'week') return [addDays(a, -7), a];
  return [addMonths(a, -1), a];
}

function donutHtml(items, centerTop, centerSub) {
  const total = items.reduce((s, x) => s + x.min, 0);
  const r = 15.915;
  let off = 25, arcs = '';
  for (const x of items) {
    const p = total ? x.min / total * 100 : 0;
    arcs += `<circle cx="21" cy="21" r="${r}" fill="none" stroke="${x.act.color}" stroke-width="5.2" stroke-dasharray="${Math.max(p - 0.8, 0.1)} ${100 - Math.max(p - 0.8, 0.1)}" stroke-dashoffset="${off}"/>`;
    off -= p;
  }
  return `<div class="donut-wrap">
    <div class="donut"><svg viewBox="0 0 42 42" width="132" height="132"><circle cx="21" cy="21" r="${r}" fill="none" stroke="var(--fill)" stroke-width="5.2"/>${arcs}</svg>
      <div class="center"><div>${centerTop}<small>${centerSub}</small></div></div></div>
    <div class="legend">${items.slice(0, 6).map((x) => `<div class="li"><span class="dot" style="background:${x.act.color}"></span><span class="nm">${esc(x.act.name)}</span><span class="val">${fmtShort(x.min)}</span></div>`).join('') || '<div class="muted small">Keine Daten</div>'}</div>
  </div>`;
}

function barsHtml(days, showGoal) {
  const goal = state.settings.goalMin;
  const max = Math.max(60, ...days.map((d) => d.total), showGoal ? goal * 1.08 : 0);
  const H = 130;
  const goalLine = showGoal && goal ? `<div class="goal-line" style="bottom:${goal / max * H + 19}px"><span>Ziel</span></div>` : '';
  return `<div class="bars">${goalLine}${days.map((d) => `<div class="bar-col ${d.today ? 'today' : ''}" ${d.ts ? `data-action="gotoDay" data-ts="${d.ts}"` : ''}>
      <div class="bar-val">${d.total >= 1 ? fmtShort(d.total) : ''}</div>
      <div class="bar-stack" style="height:${Math.max(d.total / max * H, 4)}px">${d.segs.map((s) => `<div style="height:${s.min / Math.max(d.total, 1) * 100}%;background:${s.color}"></div>`).join('')}</div>
      <div class="bar-lbl">${d.label}</div></div>`).join('')}</div>`;
}

function breakdownHtml(items) {
  const total = items.reduce((s, x) => s + x.min, 0);
  if (!items.length) return '<div class="empty">Keine Daten in diesem Zeitraum</div>';
  return `<div class="breakdown">${items.map((x) => `<div class="row">
    <div class="top"><span>${x.act.emoji} ${esc(x.act.name)}</span><span>${fmtDur(x.min)} · ${Math.round(x.min / total * 100)}%</span></div>
    <div class="track"><div class="fill" style="width:${x.min / items[0].min * 100}%;background:${x.act.color}"></div></div></div>`).join('')}</div>`;
}

function kpi(k, v, d) { return `<div class="kpi glass"><div class="k">${k}</div><div class="v">${v}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`; }
function delta(cur, prev) {
  if (prev < 1 && cur < 1) return '';
  if (prev < 1) return '<span class="up">neu ↑</span>';
  const p = Math.round((cur - prev) / prev * 100);
  return `<span class="${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '↑' : '↓'} ${Math.abs(p)}% vs. vorher</span>`;
}

function viewStats() {
  const range = statsRange(), [a, b] = range;
  const now = Date.now();
  const ag = aggregate(a, b), pg = aggregate(...prevRange(range));
  const items = filterActs(ag.byAct);
  const isFuture = b > now;
  let h = `<div class="fade-in">
    <div class="segment">${[['day', 'Tag'], ['week', 'Woche'], ['month', 'Monat']].map(([m, l]) => `<button class="${ui.statsMode === m ? 'on' : ''}" data-action="statsMode" data-v="${m}">${l}</button>`).join('')}</div>
    <div class="period-nav">
      <button class="arrow glass" data-action="statsPrev">${chevL}</button>
      <div class="lbl">${statsLabel(range)}</div>
      <button class="arrow glass" data-action="statsNext" ${isFuture ? 'disabled' : ''}>${chevR}</button>
    </div>
    <div class="segment" style="max-width:240px;margin:0 auto 14px">${[['all', 'Alles'], ['study', 'Nur Lernen']].map(([m, l]) => `<button class="${ui.statsFilter === m ? 'on' : ''}" data-action="statsFilter" data-v="${m}">${l}</button>`).join('')}</div>`;

  // Tage im Zeitraum (bis heute) für Durchschnitt
  const elapsedDays = Math.max(1, Math.ceil((Math.min(b, addDays(sod(now), 1)) - a) / DAY));
  const sbd = studyByDay();
  let goalDays = 0, totalDays = 0;
  for (let d = a; d < b && d <= now; d = addDays(d, 1)) { totalDays++; if ((sbd[dayKey(d)] || 0) >= state.settings.goalMin) goalDays++; }

  h += '<div class="kpis">';
  h += kpi('Lernzeit', fmtShort(ag.study), delta(ag.study, pg.study));
  if (ui.statsMode === 'day') {
    h += kpi('Gesamt erfasst', fmtShort(ag.total), delta(ag.total, pg.total));
    h += kpi('Sessions', ag.count, ag.count ? `Ø ${fmtDur(ag.total / ag.count)}` : '');
    h += kpi('Pausen', fmtDur(ag.pause), ag.total ? `${Math.round(ag.pause / (ag.total + ag.pause) * 100)}% der Zeit` : '');
  } else {
    h += kpi('Ø Lernzeit / Tag', fmtShort(ag.study / elapsedDays), `über ${elapsedDays} Tage`);
    h += kpi('Ziel erreicht', `${goalDays}/${totalDays}`, 'Tage');
    h += kpi('Sessions', ag.count, ag.longest ? `längste ${fmtShort(ag.longest)}` : '');
  }
  h += '</div>';

  if (ui.statsMode === 'day') {
    h += `<section class="glass card"><h3>Verteilung</h3>${donutHtml(items, fmtShort(filteredMin(ag)), ui.statsFilter === 'study' ? 'Lernen' : 'gesamt')}</section>`;
    h += `<section class="glass card"><h3>Zeitstrahl</h3>${timelineHtml(a)}</section>`;
  } else if (ui.statsMode === 'week') {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(a, i), dg = aggregate(d, addDays(d, 1));
      const segs = filterActs(dg.byAct).map((x) => ({ color: x.act.color, min: x.min }));
      days.push({ label: WD[i], ts: d, today: d === sod(now), total: filteredMin(dg), segs });
    }
    h += `<section class="glass card"><h3>Wochenverlauf</h3>${barsHtml(days, ui.statsFilter === 'study')}</section>`;
    h += `<section class="glass card"><h3>Verteilung</h3>${donutHtml(items, fmtShort(filteredMin(ag)), ui.statsFilter === 'study' ? 'Lernen' : 'gesamt')}</section>`;
  } else {
    h += `<section class="glass card"><h3>Lernkalender</h3>${calendarHtml(a, b, sbd)}</section>`;
    // Wochen im Monat als Balken
    const weeks = [];
    for (let w = sow(a); w < b; w = addDays(w, 7)) {
      const wa = Math.max(w, a), wb = Math.min(addDays(w, 7), b), wg = aggregate(wa, wb);
      weeks.push({ label: `KW${isoWeek(w)}`, total: filteredMin(wg), today: now >= w && now < addDays(w, 7), segs: filterActs(wg.byAct).map((x) => ({ color: x.act.color, min: x.min })) });
    }
    h += `<section class="glass card"><h3>Pro Woche</h3>${barsHtml(weeks, false)}</section>`;
    h += `<section class="glass card"><h3>Verteilung</h3>${donutHtml(items, fmtShort(filteredMin(ag)), ui.statsFilter === 'study' ? 'Lernen' : 'gesamt')}</section>`;
  }

  h += `<section class="glass card"><h3>Aufschlüsselung</h3>${breakdownHtml(items)}</section>`;

  const subj = Object.entries(ag.bySubject).filter(([, v]) => v >= 1).sort((x, y) => y[1] - x[1]);
  if (subj.length) {
    const palette = ['#5E5CE6', '#BF5AF2', '#32ADE6', '#30D158', '#FF9F0A', '#FF375F', '#64D2FF', '#FFD60A'];
    h += `<section class="glass card"><h3>Nach Fach</h3>${breakdownHtml(subj.map(([k, v], i) => ({ act: { name: k, emoji: '📘', color: palette[i % palette.length] }, min: v })))}</section>`;
  }

  // Insights
  const st = streaks();
  const last30 = aggregate(addDays(sod(now), -29), addDays(sod(now), 1));
  const studySessions = state.sessions.filter((s) => actOf(s).study);
  const avgLen = studySessions.length ? studySessions.reduce((s, x) => s + (x.end - x.start) / MIN - (x.pauseMin || 0), 0) / studySessions.length : 0;
  const longest = studySessions.reduce((m, x) => Math.max(m, (x.end - x.start) / MIN - (x.pauseMin || 0)), 0);
  const hours = hourDistribution(addDays(sod(now), -29), addDays(sod(now), 1));
  const hmax = Math.max(...hours, 1);
  const peak = hours.indexOf(Math.max(...hours));

  h += `<div class="section-title">Insights</div><div class="insights">
    ${kpi('🔥 Lern-Streak', `${st.cur} ${st.cur === 1 ? 'Tag' : 'Tage'}`, `Rekord: ${st.best}`)}
    ${kpi('Ø Session', fmtShort(avgLen), 'Lernen')}
    ${kpi('Längste Session', fmtShort(longest), 'Lernen, gesamt')}
    ${kpi('Letzte 30 Tage', fmtShort(last30.study), `Ø ${fmtShort(last30.study / 30)} / Tag`)}
  </div>
  <section class="glass card"><h3>Produktivste Uhrzeit</h3>
    <div class="small muted" style="margin:-6px 0 12px">Lernzeit nach Tageszeit, letzte 30 Tage${hours[peak] > 0 ? ` · Peak ${peak}–${peak + 1} Uhr` : ''}</div>
    <div class="hours">${hours.map((v) => `<div style="height:${v / hmax * 100}%;opacity:${v ? 0.35 + 0.65 * v / hmax : 0.15}"></div>`).join('')}</div>
    <div class="hours-axis"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
  </section>`;
  return h + '</div>';
}

function isoWeek(t) {
  const d = new Date(t); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / DAY - 3 + ((w1.getDay() + 6) % 7)) / 7);
}

function calendarHtml(a, b, sbd) {
  const goal = state.settings.goalMin || 240;
  const today = sod(Date.now());
  let h = '<div class="cal">' + WD.map((w) => `<div class="wd">${w}</div>`).join('');
  for (let i = 0; i < wdIdx(a); i++) h += '<div></div>';
  for (let d = a; d < b; d = addDays(d, 1)) {
    const m = sbd[dayKey(d)] || 0;
    const p = clamp(m / goal, 0, 1);
    const bg = m > 0 ? `background:color-mix(in srgb, var(--accent) ${Math.round(18 + p * 82)}%, transparent);color:${p > 0.45 ? '#fff' : 'inherit'}` : '';
    h += `<button class="day ${d === today ? 'today' : ''} ${d > today ? 'future' : ''}" style="${bg}" data-action="gotoDay" data-ts="${d}">${new Date(d).getDate()}</button>`;
  }
  return h + `</div><div class="small muted" style="margin-top:10px">Je kräftiger, desto näher am Tagesziel (${fmtDur(goal)}).</div>`;
}

/* ---------- Verlauf ---------- */
function viewHistory() {
  const now = Date.now();
  const from = addDays(sod(now), -ui.histDays + 1);
  const ss = allSessions().filter((s) => s.end > from).sort((x, y) => y.start - x.start);
  if (!ss.length && !state.sessions.length) {
    return `<div class="glass card empty fade-in">Noch keine Sessions.<br>Starte auf „Heute“ einen Block oder trage oben mit <b>+</b> etwas nach.</div>`;
  }
  const groups = {};
  for (const s of ss) (groups[sod(s.start)] ||= []).push(s);
  let h = '<div class="fade-in">';
  for (const d of Object.keys(groups).map(Number).sort((x, y) => y - x)) {
    const ag = aggregate(d, addDays(d, 1));
    h += `<div class="section-title"><span>${dayLabel(d)}</span><span style="text-transform:none;letter-spacing:0">📚 ${fmtShort(ag.study)} · Σ ${fmtShort(ag.total)}</span></div>`;
    h += `<div class="list glass">${groups[d].map(sessionRow).join('')}</div>`;
  }
  if (state.sessions.some((s) => s.start < from)) h += `<button class="btn block glass" data-action="moreHistory">Ältere laden</button>`;
  return h + '</div>';
}

/* ---------- Einstellungen ---------- */
function viewSettings() {
  const g = state.settings.goalMin;
  let h = `<div class="fade-in">
  <div class="section-title">Tagesziel Lernzeit</div>
  <section class="glass card"><div class="stepper" style="margin:0">
    <button data-action="goal" data-v="-15">−</button>
    <div class="val">${Math.floor(g / 60)}:${pad(g % 60)}<small>h</small></div>
    <button data-action="goal" data-v="15">+</button></div></section>

  <div class="section-title"><span>Kategorien</span><button class="link" data-action="editCat" data-id="">+ Neu</button></div>
  <div class="list glass">${state.categories.map((c) => `<button class="list-item" data-action="editCat" data-id="${c.id}" style="${c.archived ? 'opacity:.45' : ''}">
      <span class="li-ico" style="background:color-mix(in srgb, ${c.color} 22%, transparent)">${c.emoji}</span>
      <span class="li-main"><div class="li-title">${esc(c.name)}${c.archived ? ' (archiviert)' : ''}</div>
      <div class="li-sub">${c.subs && c.subs.length ? c.subs.map((s) => esc(s.name)).join(', ') : 'Keine Unterteilung'}${c.study ? ' · zählt als Lernzeit' : ''}</div></span>
      <span class="chev">${chevR}</span></button>`).join('')}</div>

  <div class="section-title">Fächer / Module</div>
  <section class="glass card">
    <div class="small muted" style="margin-bottom:10px">Optional: Während einer Lern-Session kannst du ein Fach antippen – so siehst du in der Statistik, wie viel Zeit in welches Modul fließt.</div>
    <div class="chips left">${state.subjects.map((s, i) => `<button class="chip" data-action="delSubject" data-i="${i}">${esc(s)} ✕</button>`).join('') || '<span class="small muted">Noch keine Fächer</span>'}</div>
    <div class="subject-add"><input id="subjectIn" placeholder="z. B. Analysis I" maxlength="40" enterkeyhint="done"><button class="btn sm primary" data-action="addSubject">Hinzufügen</button></div>
  </section>

  <div class="section-title">Daten</div>
  <div class="list glass">
    <button class="list-item" data-action="export"><span class="li-ico" style="background:var(--fill)">⬆️</span><span class="li-main"><div class="li-title">Backup exportieren</div><div class="li-sub">Als JSON-Datei sichern (z. B. in Dateien/iCloud)</div></span></button>
    <button class="list-item" data-action="import"><span class="li-ico" style="background:var(--fill)">⬇️</span><span class="li-main"><div class="li-title">Backup importieren</div><div class="li-sub">Ersetzt die aktuellen Daten</div></span></button>
    <button class="list-item" data-action="csv"><span class="li-ico" style="background:var(--fill)">📄</span><span class="li-main"><div class="li-title">Als CSV exportieren</div><div class="li-sub">Für Excel / Numbers</div></span></button>
    <button class="list-item" data-action="reset"><span class="li-ico" style="background:rgba(255,59,48,.14)">🗑️</span><span class="li-main"><div class="li-title" style="color:var(--danger)">Alle Daten löschen</div></span></button>
  </div>
  <input type="file" id="importFile" accept="application/json,.json" hidden>

  <div class="section-title">Über</div>
  <section class="glass card install-hint">
    ${isStandalone() ? '✅ Läuft als App vom Home-Bildschirm – funktioniert komplett offline.' : '<b>Als App installieren:</b> In Safari auf <b>Teilen</b> ⎋ tippen → <b>„Zum Home-Bildschirm“</b>. Danach startet Lernzeit wie eine normale App und läuft komplett offline.'}
    <br><br>Alle Daten bleiben lokal auf deinem iPhone. ${state.sessions.length} Sessions gespeichert. Mach ab und zu ein Backup.
  </section></div>`;
  return h;
}
const isStandalone = () => window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

/* ---------------- Sheets ---------------- */
let sheetCtx = null;
function openSheet(html, ctx = {}) {
  sheetCtx = ctx;
  $('#sheetContent').innerHTML = html;
  $('#sheet').scrollTop = 0;
  document.body.classList.add('sheet-open');
}
function closeSheet() {
  document.body.classList.remove('sheet-open');
  if (sheetCtx && sheetCtx.onClose) sheetCtx.onClose();
  sheetCtx = null;
  ui.pendingStart = null;
}

/* Stop-Dialog: fragt nach Pausenzeit */
function openStop() {
  const a = state.active;
  if (!a) return;
  const end = Date.now();
  const gross = (end - a.start) / MIN;
  const ctx = { end, gross, pause: Math.round(activePauseMs(a, end) / MIN), subject: a.subject };
  sheetCtx = ctx;
  renderStopSheet();
  document.body.classList.add('sheet-open');
}
function renderStopSheet() {
  const c = sheetCtx, a = state.active, act = actOf(a);
  c.pause = clamp(c.pause, 0, Math.floor(c.gross));
  const quick = [0, 5, 10, 15, 20, 30, 45, 60].filter((q) => q <= c.gross);
  const subjects = state.subjects.length && act.study
    ? `<div class="form-title">Fach (optional)</div><div class="chips left">${state.subjects.map((s) => `<button class="chip ${c.subject === s ? 'on' : ''}" data-action="stopSubject" data-v="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : '';
  $('#sheetContent').innerHTML = `
    <h2>${act.emoji} ${esc(act.name)} beenden</h2>
    <div class="sub">${fmtClock(a.start)} – ${fmtClock(c.end)} · ${fmtDur(c.gross)} gesamt</div>
    <div class="lbl-q">Wie lange hast du zwischendurch Pause gemacht?</div>
    <div class="stepper">
      <button data-action="stopPause" data-v="-5">−</button>
      <div class="val">${c.pause}<small>min</small></div>
      <button data-action="stopPause" data-v="5">+</button>
    </div>
    <div class="chips">${quick.map((q) => `<button class="chip ${c.pause === q ? 'on' : ''}" data-action="stopPauseSet" data-v="${q}">${q}</button>`).join('')}</div>
    <div class="net-preview">Netto ${act.study ? 'gelernt' : 'erfasst'}: <b>${fmtDur(c.gross - c.pause)}</b></div>
    ${subjects}
    <div class="form-title">Notiz (optional)</div>
    <div class="form"><div class="field field-full"><input id="stopNote" placeholder="z. B. Blatt 5, Aufgabe 1–3" maxlength="120" value="${esc(c.note || '')}"></div></div>
    <div class="actions">
      <button class="btn primary block" data-action="stopSave">${ui.pendingStart ? 'Speichern & wechseln' : 'Speichern'}</button>
      <div class="row2">
        <button class="btn" data-action="closeSheet">Weiterlaufen</button>
        <button class="btn ghost-danger" data-action="stopDiscard">Verwerfen</button>
      </div>
    </div>`;
}

/* Session bearbeiten / nachtragen */
function openEdit(id) {
  const now = Date.now();
  const s = id ? state.sessions.find((x) => x.id === id) : null;
  const acts = selectableActs();
  const base = s || { cat: acts[0]?.cat, sub: acts[0]?.sub, start: now - HOUR, end: now, pauseMin: 0, subject: null, note: '' };
  const curKey = actKey(base.cat, base.sub);
  const opts = [...acts];
  if (s && !opts.find((x) => x.key === curKey)) opts.push(actOf(s));
  const d = new Date(base.start);
  openSheet(`
    <h2>${s ? 'Session bearbeiten' : 'Session nachtragen'}</h2>
    <div class="sub">${s ? dayLabel(s.start) : 'Vergessen zu starten? Kein Problem.'}</div>
    <div class="form">
      <div class="field"><label>Aktivität</label><select id="eAct">${opts.map((x) => `<option value="${x.key}" ${x.key === curKey ? 'selected' : ''}>${x.emoji} ${esc(x.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Fach</label><select id="eSubj"><option value="">—</option>${state.subjects.concat(base.subject && !state.subjects.includes(base.subject) ? [base.subject] : []).map((x) => `<option ${x === base.subject ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
    </div>
    <div class="form">
      <div class="field"><label>Datum</label><input type="date" id="eDate" value="${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}"></div>
      <div class="field"><label>Beginn</label><input type="time" id="eStart" value="${fmtClock(base.start)}"></div>
      <div class="field"><label>Ende</label><input type="time" id="eEnd" value="${fmtClock(base.end)}"></div>
      <div class="field"><label>Pause (min)</label><input type="number" id="ePause" inputmode="numeric" min="0" value="${Math.round(base.pauseMin || 0)}"></div>
    </div>
    <div class="form"><div class="field field-full"><input id="eNote" placeholder="Notiz" maxlength="120" value="${esc(base.note || '')}"></div></div>
    <div class="actions">
      <button class="btn primary block" data-action="editSave" data-id="${s ? s.id : ''}">Speichern</button>
      ${s ? `<button class="btn ghost-danger block" data-action="editDelete" data-id="${s.id}">Session löschen</button>` : ''}
    </div>`);
}

function saveEdit(id) {
  const key = $('#eAct').value;
  const act = ACTS[key];
  const [y, mo, d] = $('#eDate').value.split('-').map(Number);
  const [sh, sm] = ($('#eStart').value || '0:0').split(':').map(Number);
  const [eh, em] = ($('#eEnd').value || '0:0').split(':').map(Number);
  if (!y || !act) return toast('Bitte Datum & Aktivität prüfen');
  const start = new Date(y, mo - 1, d, sh, sm).getTime();
  let end = new Date(y, mo - 1, d, eh, em).getTime();
  if (end <= start) end = addDays(end, 1); // über Mitternacht
  const gross = (end - start) / MIN;
  const pauseMin = clamp(parseInt($('#ePause').value, 10) || 0, 0, gross);
  const data = { cat: act.cat, sub: act.sub, subject: $('#eSubj').value || null, start, end, pauseMin, note: $('#eNote').value.trim() };
  if (id) Object.assign(state.sessions.find((x) => x.id === id), data);
  else state.sessions.push({ id: uid(), ...data });
  save(); closeSheet(); render();
  toast(id ? 'Gespeichert' : 'Session nachgetragen');
}

/* Kategorie bearbeiten */
function openCat(id) {
  const c = id ? state.categories.find((x) => x.id === id) : null;
  sheetCtx = { draft: JSON.parse(JSON.stringify(c || { id: '', name: '', emoji: '⭐️', color: '#30D158', study: false, archived: false, subs: [] })) };
  renderCatSheet();
  document.body.classList.add('sheet-open');
}
function readCatDraft() {
  const d = sheetCtx.draft;
  d.name = $('#cName').value.trim();
  d.emoji = $('#cEmoji').value.trim() || '⭐️';
  d.color = $('#cColor').value;
  d.study = $('#cStudy').checked;
  $$('.sub-row').forEach((row, i) => {
    const s = d.subs[i];
    s.name = $('.sname', row).value.trim();
    s.emoji = $('.semoji', row).value.trim();
    s.color = $('.scolor', row).value;
  });
}
function renderCatSheet() {
  const d = sheetCtx.draft;
  const used = d.id && state.sessions.some((s) => s.cat === d.id);
  $('#sheetContent').innerHTML = `
    <h2>${d.id ? 'Kategorie bearbeiten' : 'Neue Kategorie'}</h2><div class="sub">Name, Symbol, Farbe & Unterteilungen</div>
    <div class="form">
      <div class="field"><label>Name</label><input id="cName" value="${esc(d.name)}" placeholder="z. B. Laufen" maxlength="30"></div>
      <div class="field"><label>Emoji</label><input id="cEmoji" class="emoji-in" value="${esc(d.emoji)}" maxlength="4"></div>
      <div class="field"><label>Farbe</label><input type="color" id="cColor" value="${d.color}"></div>
      <div class="field"><label>Zählt als Lernzeit</label><label class="toggle"><input type="checkbox" id="cStudy" ${d.study ? 'checked' : ''}><span></span></label></div>
    </div>
    <div class="form-title">Unterteilungen (optional)</div>
    <div class="form">
      ${d.subs.map((s, i) => `<div class="sub-row"><input class="semoji emoji-in" value="${esc(s.emoji || '')}" maxlength="4"><input type="text" class="sname" value="${esc(s.name)}" placeholder="Name" maxlength="30"><input type="color" class="scolor" value="${s.color || d.color}"><button class="del-x" data-action="catDelSub" data-i="${i}">⊖</button></div>`).join('')}
      <button class="field" data-action="catAddSub" style="color:var(--accent);width:100%"><span>+ Unterteilung hinzufügen</span></button>
    </div>
    <div class="small muted" style="margin:-4px 6px 0">Mit Unterteilungen bekommt jede eine eigene Start-Kachel (wie „Serie bearbeiten“ / „Vorlesung schauen“).</div>
    <div class="actions">
      <button class="btn primary block" data-action="catSave">Speichern</button>
      ${d.id ? `<button class="btn ghost-danger block" data-action="catDelete">${used ? (d.archived ? 'Wiederherstellen' : 'Archivieren') : 'Löschen'}</button>` : ''}
    </div>`;
}
function saveCat() {
  readCatDraft();
  const d = sheetCtx.draft;
  if (!d.name) return toast('Bitte einen Namen eingeben');
  d.subs = d.subs.filter((s) => s.name);
  d.subs.forEach((s) => { if (!s.id) s.id = uid(); });
  if (d.id) {
    const i = state.categories.findIndex((x) => x.id === d.id);
    state.categories[i] = d;
  } else {
    d.id = uid();
    state.categories.push(d);
  }
  save(); closeSheet(); render(); toast('Kategorie gespeichert');
}
function deleteCat() {
  const d = sheetCtx.draft;
  const used = state.sessions.some((s) => s.cat === d.id);
  if (state.active && state.active.cat === d.id) return toast('Läuft gerade – erst beenden');
  if (used) {
    const c = state.categories.find((x) => x.id === d.id);
    c.archived = !c.archived;
    toast(c.archived ? 'Archiviert – Statistik bleibt erhalten' : 'Wiederhergestellt');
  } else {
    if (!confirm(`„${d.name}“ löschen?`)) return;
    state.categories = state.categories.filter((x) => x.id !== d.id);
    toast('Gelöscht');
  }
  save(); closeSheet(); render();
}

/* ---------------- Aktionen ---------------- */
function startAct(key) {
  const act = ACTS[key];
  if (!act) return;
  state.active = { id: uid(), cat: act.cat, sub: act.sub, subject: null, start: Date.now(), pauseMs: 0, pausedAt: null };
  save(); render();
  toast(`${act.emoji} ${act.name} gestartet`);
}

function finishActive(discard) {
  const a = state.active, c = sheetCtx;
  if (!a) return;
  if (!discard) {
    const note = ($('#stopNote')?.value || '').trim();
    state.sessions.push({ id: a.id, cat: a.cat, sub: a.sub, subject: c.subject || null, start: a.start, end: c.end, pauseMin: c.pause, note });
  }
  state.active = null;
  const next = ui.pendingStart;
  save();
  sheetCtx = null; ui.pendingStart = null;
  document.body.classList.remove('sheet-open');
  if (next) startAct(next);
  else { render(); toast(discard ? 'Verworfen' : `Gespeichert · ${fmtDur(c.gross - c.pause)}`); }
}

function share(filename, text, mime) {
  const file = new File([text], filename, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: filename }).catch(() => {});
    return;
  }
  const url = URL.createObjectURL(file);
  const aEl = document.createElement('a');
  aEl.href = url; aEl.download = filename; document.body.appendChild(aEl); aEl.click();
  setTimeout(() => { URL.revokeObjectURL(url); aEl.remove(); }, 1000);
}

function exportCsv() {
  const rows = [['Datum', 'Start', 'Ende', 'Kategorie', 'Aktivität', 'Fach', 'Brutto (min)', 'Pause (min)', 'Netto (min)', 'Notiz']];
  for (const s of state.sessions.slice().sort((a, b) => a.start - b.start)) {
    const act = actOf(s), g = (s.end - s.start) / MIN;
    rows.push([dayKey(s.start), fmtClock(s.start), fmtClock(s.end), act.catName || '', act.name, s.subject || '', Math.round(g), Math.round(s.pauseMin || 0), Math.round(g - (s.pauseMin || 0)), s.note || '']);
  }
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
  share(`lernzeit-${dayKey(Date.now())}.csv`, '﻿' + csv, 'text/csv');
}

const actions = {
  tile(el) {
    const key = el.dataset.key;
    if (!state.active) return startAct(key);
    if (actKey(state.active.cat, state.active.sub) === key) return openStop();
    ui.pendingStart = key;
    openStop();
  },
  pause() {
    const a = state.active; if (!a) return;
    if (a.pausedAt) { a.pauseMs += Date.now() - a.pausedAt; a.pausedAt = null; }
    else a.pausedAt = Date.now();
    save(); render();
  },
  stop() { ui.pendingStart = null; openStop(); },
  activeSubject(el) { const v = el.dataset.v; state.active.subject = state.active.subject === v ? null : v; save(); render(); },
  stopPause(el) { sheetCtx.note = $('#stopNote').value; sheetCtx.pause += Number(el.dataset.v); renderStopSheet(); },
  stopPauseSet(el) { sheetCtx.note = $('#stopNote').value; sheetCtx.pause = Number(el.dataset.v); renderStopSheet(); },
  stopSubject(el) { sheetCtx.note = $('#stopNote').value; sheetCtx.subject = sheetCtx.subject === el.dataset.v ? null : el.dataset.v; renderStopSheet(); },
  stopSave() { finishActive(false); },
  stopDiscard() { if (confirm('Session wirklich verwerfen?')) finishActive(true); },
  closeSheet() { closeSheet(); },
  addManual() { openEdit(null); },
  edit(el) { openEdit(el.dataset.id); },
  editSave(el) { saveEdit(el.dataset.id); },
  editDelete(el) {
    if (!confirm('Session löschen?')) return;
    state.sessions = state.sessions.filter((s) => s.id !== el.dataset.id);
    save(); closeSheet(); render(); toast('Gelöscht');
  },
  statsMode(el) { ui.statsMode = el.dataset.v; render(); },
  statsFilter(el) { ui.statsFilter = el.dataset.v; render(); },
  statsPrev() { ui.statsAnchor = ui.statsMode === 'day' ? addDays(ui.statsAnchor, -1) : ui.statsMode === 'week' ? addDays(ui.statsAnchor, -7) : addMonths(som(ui.statsAnchor), -1); render(); },
  statsNext() { ui.statsAnchor = ui.statsMode === 'day' ? addDays(ui.statsAnchor, 1) : ui.statsMode === 'week' ? addDays(ui.statsAnchor, 7) : addMonths(som(ui.statsAnchor), 1); render(); },
  gotoDay(el) { ui.statsMode = 'day'; ui.statsAnchor = Number(el.dataset.ts); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
  moreHistory() { ui.histDays += 30; render(); },
  goal(el) { state.settings.goalMin = clamp(state.settings.goalMin + Number(el.dataset.v), 15, 16 * 60); save(); render(); },
  addSubject() {
    const v = $('#subjectIn').value.trim();
    if (!v || state.subjects.includes(v)) return;
    state.subjects.push(v); save(); render();
  },
  delSubject(el) {
    const s = state.subjects[Number(el.dataset.i)];
    if (!confirm(`Fach „${s}“ entfernen? (Erfasste Zeiten bleiben erhalten)`)) return;
    state.subjects.splice(Number(el.dataset.i), 1); save(); render();
  },
  editCat(el) { openCat(el.dataset.id || null); },
  catAddSub() { readCatDraft(); sheetCtx.draft.subs.push({ id: '', name: '', emoji: '', color: sheetCtx.draft.color }); renderCatSheet(); },
  catDelSub(el) {
    readCatDraft();
    const d = sheetCtx.draft, s = d.subs[Number(el.dataset.i)];
    if (s.id && state.sessions.some((x) => x.cat === d.id && x.sub === s.id) && !confirm('Für diese Unterteilung gibt es Sessions. Sie werden dann der Hauptkategorie zugeordnet. Fortfahren?')) return;
    d.subs.splice(Number(el.dataset.i), 1); renderCatSheet();
  },
  catSave() { saveCat(); },
  catDelete() { deleteCat(); },
  export() { share(`lernzeit-backup-${dayKey(Date.now())}.json`, JSON.stringify(state, null, 1), 'application/json'); },
  csv() { exportCsv(); },
  import() { $('#importFile').click(); },
  reset() {
    if (!confirm('Wirklich ALLE Daten löschen? Das kann nicht rückgängig gemacht werden.')) return;
    if (!confirm('Ganz sicher? Vorher ein Backup machen?\nOK = endgültig löschen')) return;
    state = defaultState(); save(); render(); toast('Alles gelöscht');
  }
};

document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    ui.tab = tab.dataset.tab; sessionStorage.setItem('tab', ui.tab);
    if (ui.tab === 'stats') ui.statsAnchor = Date.now();
    render(); window.scrollTo(0, 0); return;
  }
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) actions[el.dataset.action](el, e);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'subjectIn') actions.addSubject();
});

document.addEventListener('change', (e) => {
  if (e.target.id !== 'importFile') return;
  const f = e.target.files[0];
  if (!f) return;
  f.text().then((t) => {
    const data = JSON.parse(t);
    if (!Array.isArray(data.sessions) || !Array.isArray(data.categories)) throw new Error('Format');
    if (!confirm(`Backup mit ${data.sessions.length} Sessions importieren? Aktuelle Daten werden ersetzt.`)) return;
    state = { ...defaultState(), ...data };
    save(); render(); toast('Backup importiert');
  }).catch(() => toast('Ungültige Backup-Datei')).finally(() => { e.target.value = ''; });
});

/* ---------------- Toast ---------------- */
let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------------- Live-Timer ---------------- */
let lastMinute = -1;
setInterval(() => {
  if (!state.active || document.hidden) return;
  const t = $('#timer');
  if (t) t.textContent = fmtTimer(activeNetMs());
  const sub = $('#timerSub');
  if (sub) sub.textContent = pauseText();
  const m = Math.floor(Date.now() / MIN);
  if (m !== lastMinute) {
    if (lastMinute !== -1 && !document.body.classList.contains('sheet-open') && ui.tab !== 'settings') render();
    lastMinute = m;
  }
}, 1000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { state = load(); render(); }
});

/* ---------------- Start ---------------- */
render();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
