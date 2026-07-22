import { useState, useEffect, useMemo, useRef } from "react";
import { auth, db, getMsg } from "./firebase";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, sendPasswordResetEmail, updatePassword } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, onSnapshot, runTransaction, increment } from "firebase/firestore";
import { getToken, onMessage } from "firebase/messaging";

/* ═══ CONSTANTS ═══ */
const SHIFTS = ["08:00", "09:00", "10:00"];
const DAYS = ["Po", "Út", "St", "Čt", "Pá"];
const DAYS_F = ["Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek"];
const ABS = [
  { id: "sick", label: "Sick Day", icon: "🤒", color: "#c04040" },
  { id: "doctor", label: "Lékař", icon: "🏥", color: "#d48020" },
  { id: "vacation", label: "Dovolená", icon: "🏖️", color: "#4080b0" },
  { id: "whatever", label: "Whatever", icon: "☕", color: "#8070b0" },
  { id: "training", label: "Školení", icon: "📚", color: "#308060" },
  { id: "half_vacation", label: "½ Dovolená", icon: "½🏖", color: "#4080b0" },
  { id: "half_ho", label: "½ HO", icon: "½🏠", color: "#50a060" },
];
const EVTS = [{ id: "training", label: "Školení", icon: "📚" }, { id: "dinner", label: "Večeře", icon: "🍽️" }, { id: "teambuilding", label: "Teambuilding", icon: "🎯" }, { id: "meeting", label: "Porada", icon: "💬" }, { id: "other", label: "Jiné", icon: "📌" }];
const HMAP = {
  '2025-01-01':'Nový rok','2025-04-18':'Velký pátek','2025-04-21':'Vel. pondělí','2025-05-01':'Svátek práce','2025-05-08':'Den vítězství','2025-07-05':'Cyril a Metoděj','2025-07-06':'Jan Hus','2025-09-28':'Den české státnosti','2025-10-28':'Den vzniku ČSR','2025-11-17':'Den svobody','2025-12-24':'Štědrý den','2025-12-25':'1. svátek vánoční','2025-12-26':'2. svátek vánoční',
  '2026-01-01':'Nový rok','2026-04-03':'Velký pátek','2026-04-06':'Vel. pondělí','2026-05-01':'Svátek práce','2026-05-08':'Den vítězství','2026-07-05':'Cyril a Metoděj','2026-07-06':'Jan Hus','2026-09-28':'Den české státnosti','2026-10-28':'Den vzniku ČSR','2026-11-17':'Den svobody','2026-12-24':'Štědrý den','2026-12-25':'1. svátek vánoční','2026-12-26':'2. svátek vánoční',
  '2027-01-01':'Nový rok','2027-03-26':'Velký pátek','2027-03-29':'Vel. pondělí','2027-05-01':'Svátek práce','2027-05-08':'Den vítězství','2027-07-05':'Cyril a Metoděj','2027-07-06':'Jan Hus','2027-09-28':'Den české státnosti','2027-10-28':'Den vzniku ČSR','2027-11-17':'Den svobody','2027-12-24':'Štědrý den','2027-12-25':'1. svátek vánoční','2027-12-26':'2. svátek vánoční',
};
const AE = "admin@shiftflow.app"; // admin se přihlašuje svým skutečným heslem (žádné heslo v kódu)

/* ═══ HELPERS ═══ */
const dc = o => JSON.parse(JSON.stringify(o));
const uid = () => "u" + Math.random().toString(36).slice(2, 9);
function getMon(d) { const dt = new Date(d); const dy = dt.getDay(); dt.setDate(dt.getDate() - dy + (dy === 0 ? -6 : 1)); dt.setHours(0, 0, 0, 0); return dt; }
function localISO(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
const wKey = d => localISO(getMon(d));
const fmtW = d => { const m = getMon(d), f = new Date(m); f.setDate(f.getDate() + 4); return `${m.getDate()}.${m.getMonth() + 1}. — ${f.getDate()}.${f.getMonth() + 1}.${f.getFullYear()}`; };
function buildDef(emps) { const s = {}; DAYS.forEach(day => { s[day] = {}; SHIFTS.forEach(sh => s[day][sh] = []); emps.forEach(emp => { if (!emp.defaultSchedule || !emp.setupDone) return; const shift = emp.defaultSchedule[day]; if (shift && SHIFTS.includes(shift)) s[day][shift].push({ empId: emp.id, ho: emp.defaultSchedule[`${day}_ho`] || false, isDefault: true }); }); }); return s; }

/* ═══ PŘEDVYPLNĚNÝ ROZVRH dle preferencí členů (upravitelný v editoru Default) ═══
   Entry na den: "08:00"/"09:00"/"10:00" = kancelář; s `${den}_ho:true` = home office.
   HO drží nominální čas ve svém slotu. Klíčováno jménem — seed napasuje na uživatele. */
const PRESET = {
  "Slavíček": { Po: "08:00", "Út": "08:00", St: "08:00", "Čt": "08:00", "Pá": "08:00" },
  "Víťa":     { Po: "09:00", "Út": "08:00", St: "09:00", "Čt": "09:00", "Pá": "08:00" },
  "Stibor":   { Po: "08:00", Po_ho: true, "Út": "08:00", St: "10:00", "Čt": "10:00", "Čt_ho": true, "Pá": "08:00" },
  "Lochman":  { Po: "08:00", "Út": "10:00", "Út_ho": true, St: "08:00", "Čt": "08:00", "Pá": "09:00", "Pá_ho": true },
  "Frťala":   { Po: "09:00", "Út": "10:00", St: "08:00", St_ho: true, "Čt": "08:00", "Čt_ho": true, "Pá": "10:00" },
  "Švarc":    { "Út": "09:00", St: "10:00", St_ho: true, "Čt": "10:00", "Pá": "09:00" }, // Vláďa — pondělí volno (bez klíče Po)
  "Andy":     { Po: "10:00", "Út": "09:00", "Út_ho": true, St: "09:00", "Čt": "09:00", "Pá": "10:00", "Pá_ho": true },
};
// Přejmenování člena při seedu (staré jméno v DB → nové). Bezpečné i když se nikdo nejmenuje "Franta".
const RENAME = { Franta: "Víťa" };
// Osobní preference/pravidla (silná, ale admin je může přebít úpravou). Klíč = jméno v appce.
const PERSONAL = {
  "Slavíček": { mustOpen: true },          // Jirka S. — 8:00 celý týden v kanceláři
  "Víťa":     { noHO: true },              // nemá nárok na HO
  "Andy":     { noOpen: true },            // nikdy 8:00 v kanceláři
  "Lochman":  { noTenOn: "St" },           // ve středu ne od 10:00
};
const personalOf = (employees, eid) => PERSONAL[(employees.find(e => e.id === eid) || {}).name] || {};

const RULE_DEFAULTS = { officeMin: 4, hoCapDay: 3, hoPerWeek: 2, cover8: true, cover10: true, min8: 2, min10: 2 };

/* Analýza týdne: porušení pravidel + problémy se VŠEMI proveditelnými alternativami řešení */
function dayStats(cs, absences, day, employees) {
  const absSet = new Set(Object.keys(absences).filter(k => k.endsWith(`__${day}`)).map(k => k.split("__")[0]));
  const office = [], ho = [];
  SHIFTS.forEach(sh => (cs[day]?.[sh] || []).forEach(en => {
    if (absSet.has(en.empId)) return;
    if (!employees.some(e => e.id === en.empId)) return;
    (en.ho ? ho : office).push({ empId: en.empId, shift: sh });
  }));
  return { office, ho, absSet };
}

function analyzeWeek(cs, absences, employees, rulesIn, intake = {}, intakeAllow = {}) {
  const R = { ...RULE_DEFAULTS, ...rulesIn };
  const stats = DAYS.map(d => dayStats(cs, absences, d, employees));
  const violations = [], problems = [];
  const weeklyHO = {};
  stats.forEach(st => st.ho.forEach(h => weeklyHO[h.empId] = (weeklyHO[h.empId] || 0) + 1));
  const allowed = (day, eid) => (intakeAllow[day] || []).includes(eid);
  const canOpen = eid => !personalOf(employees, eid).noOpen; // kdo smí 8:00 v kanceláři

  DAYS.forEach((day, di) => {
    const st = stats[di];
    const off8 = st.office.filter(x => x.shift === "08:00").length;
    const off10 = st.office.filter(x => x.shift === "10:00").length;
    const ho10 = st.ho.filter(x => x.shift === "10:00").length;
    const short = R.officeMin - st.office.length;
    const min8 = R.min8 ?? 2, min10 = R.min10 ?? 2;
    const cnt = t => st.office.filter(x => x.shift === t).length;
    const shiftMin = t => t === "08:00" ? min8 : t === "10:00" ? 1 : 0; // kolik musí v kanceláři zůstat

    // Alternativy: přesun člověka v kanceláři na cílovou směnu (bez rozbití zdrojové)
    const shiftAlts = toShift => st.office
      .filter(x => x.shift !== toShift && cnt(x.shift) > shiftMin(x.shift))
      .filter(x => toShift !== "08:00" || canOpen(x.empId))
      .sort((a, b) => ((a.shift === "09:00") ? 0 : 1) - ((b.shift === "09:00") ? 0 : 1))
      .map(x => ({ kind: "shift", empId: x.empId, day, fromShift: x.shift, toShift }));
    // Alternativy: stažení člověka z HO do kanceláře na cílovou směnu
    const pullAlts = toShift => {
      const out = [];
      st.ho.forEach(h => {
        if (toShift === "08:00" && !canOpen(h.empId)) return;
        for (let dj = 0; dj < 5; dj++) {
          if (dj === di || intake[DAYS[dj]]) continue;
          const stj = stats[dj];
          if (stj.absSet.has(h.empId)) continue;
          const mine = stj.office.find(x => x.empId === h.empId);
          if (!mine) continue;
          if (stj.ho.length >= R.hoCapDay) continue;
          if (stj.office.length - 1 < R.officeMin) continue;
          if (mine.shift === "08:00" && stj.office.filter(x => x.shift === "08:00").length <= min8) continue;
          if (mine.shift === "10:00" && stj.office.filter(x => x.shift === "10:00").length <= 1) continue;
          out.push({ kind: "pullHO", empId: h.empId, day, toShift, moveToDay: DAYS[dj] });
        }
        out.push({ kind: "pullHO", empId: h.empId, day, toShift, moveToDay: null });
      });
      return out;
    };

    if (short > 0) {
      violations.push({ sev: "crit", day, msg: `${day}: v kanceláři jen ${st.office.length} (minimum ${R.officeMin})` });
      const toShift = (R.cover8 && off8 < min8) ? "08:00" : (R.cover10 && off10 < 1) ? "10:00" : "09:00";
      problems.push({ key: `head:${day}`, day, title: `${day}: v kanceláři jen ${st.office.length} lidí (minimum ${R.officeMin})`, alts: pullAlts(toShift) });
    } else {
      // 8:00 — minimálně min8 v kanceláři
      if (R.cover8 && off8 < min8) {
        violations.push({ sev: "crit", day, msg: `${day}: v kanceláři od 8:00 jen ${off8} (potřeba ${min8})` });
        const alts = [...shiftAlts("08:00"), ...pullAlts("08:00")];
        if (alts.length) problems.push({ key: `08:00:${day}`, day, title: `${day}: potřeba ${min8} v kanceláři od 8:00`, alts });
      }
      // 10:00 — minimálně min10, aspoň 1 z kanceláře
      if (R.cover10 && (off10 < 1 || (off10 + ho10) < min10)) {
        const total = off10 + ho10;
        const noOffice = off10 < 1;
        const msg = noOffice ? `${day}: od 10:00 nikdo v kanceláři` : `${day}: na 10:00 jen ${total} (potřeba ${min10}, aspoň 1 v kanceláři)`;
        violations.push({ sev: noOffice ? "crit" : "warn", day, msg });
        const alts = [...shiftAlts("10:00"), ...pullAlts("10:00")];
        if (alts.length) problems.push({ key: `10:00:${day}`, day, title: msg, alts });
      }
    }
    if (st.ho.length > R.hoCapDay) violations.push({ sev: "warn", day, msg: `${day}: ${st.ho.length} lidí na HO (strop ${R.hoCapDay})` });

    // Osobní preference (upravitelné) — jen upozornění
    st.office.filter(x => x.shift === "08:00" && personalOf(employees, x.empId).noOpen).forEach(x =>
      violations.push({ sev: "warn", day, empId: x.empId, msg: `${day}: ${(employees.find(e => e.id === x.empId) || {}).name} nemá otevírat (8:00)` }));
    [...st.office, ...st.ho].filter(x => { const p = personalOf(employees, x.empId); return p.noTenOn === day && x.shift === "10:00"; }).forEach(x =>
      violations.push({ sev: "warn", day, empId: x.empId, msg: `${day}: ${(employees.find(e => e.id === x.empId) || {}).name} nemá mít 10:00` }));
    st.ho.filter(x => personalOf(employees, x.empId).noHO).forEach(x =>
      violations.push({ sev: "warn", day, empId: x.empId, msg: `${day}: ${(employees.find(e => e.id === x.empId) || {}).name} nemá mít HO` }));

    // Nástupy
    if (intake[day]) {
      const offenders = st.ho.filter(h => !allowed(day, h.empId));
      offenders.forEach(h => violations.push({ sev: "warn", day, empId: h.empId, intake: true, msg: `Nástupy (${day}): ${(employees.find(e => e.id === h.empId) || {}).name || "?"} má HO — doporučeno do kanceláře` }));
      if (offenders.length) problems.push({ key: `intake:${day}`, day, intake: true, title: `Nástupy ${day}: ${offenders.length}× HO (doporučeno bez HO)`, alts: offenders.map(h => ({ kind: "dropHO", empId: h.empId, day })) });
    }
  });
  Object.entries(weeklyHO).forEach(([eid, n]) => { if (n > R.hoPerWeek) violations.push({ sev: "warn", day: null, empId: eid, msg: `HO ${n}× v týdnu (strop ${R.hoPerWeek})` }); });
  return { violations, problems, stats, weeklyHO };
}

/* Aplikace schválené alternativy na entries (mutuje kopii) */
function applyAlt(s, alt) {
  if (alt.kind === "pullHO") {
    let en = null;
    SHIFTS.forEach(sh => { const arr = s[alt.day]?.[sh]; if (!arr) return; const i = arr.findIndex(e => e.empId === alt.empId && e.ho); if (i >= 0) en = arr.splice(i, 1)[0]; });
    if (!en) en = { empId: alt.empId };
    en.ho = false; en.isDefault = false;
    if (!s[alt.day]) s[alt.day] = {}; if (!s[alt.day][alt.toShift]) s[alt.day][alt.toShift] = [];
    s[alt.day][alt.toShift].push(en);
    if (alt.moveToDay) SHIFTS.forEach(sh => { const e2 = s[alt.moveToDay]?.[sh]?.find(e => e.empId === alt.empId); if (e2) { e2.ho = true; e2.isDefault = false; } });
  }
  if (alt.kind === "shift") {
    const arr = s[alt.day]?.[alt.fromShift] || []; const i = arr.findIndex(e => e.empId === alt.empId);
    if (i >= 0) { const [en] = arr.splice(i, 1); en.isDefault = false; if (!s[alt.day][alt.toShift]) s[alt.day][alt.toShift] = []; s[alt.day][alt.toShift].push(en); }
  }
  if (alt.kind === "grantHO") {
    SHIFTS.forEach(sh => { const e2 = s[alt.day]?.[sh]?.find(e => e.empId === alt.empId); if (e2) { e2.ho = true; e2.isDefault = false; } });
  }
  if (alt.kind === "dropHO") {
    SHIFTS.forEach(sh => { const e2 = s[alt.day]?.[sh]?.find(e => e.empId === alt.empId); if (e2) { e2.ho = false; e2.isDefault = false; } });
  }
  return s;
}

function altLabel(alt, ge) {
  const n = ge(alt.empId)?.name || "?";
  if (alt.kind === "pullHO") return `${alt.day}: ${n} z HO do kanceláře na ${alt.toShift}${alt.moveToDay ? `, HO náhradou v ${alt.moveToDay}` : " (bez náhrady)"}`;
  if (alt.kind === "shift") return `${alt.day}: ${n} ${alt.fromShift} → ${alt.toShift}`;
  if (alt.kind === "grantHO") return `${alt.day}: ${n} — Home Office`;
  if (alt.kind === "dropHO") return `${alt.day}: ${n} — zrušení Home Office`;
  return "";
}
function getWeekDates(wo) { const d = new Date(); d.setDate(d.getDate() + wo * 7); const mon = getMon(d); return DAYS.map((_, i) => { const x = new Date(mon); x.setDate(mon.getDate() + i); return localISO(x); }); }
function fmtDate(iso) { const p = iso.split('-'); return `${parseInt(p[2])}.${parseInt(p[1])}.`; }
const todayIdx = (() => { const d = new Date().getDay(); return d >= 1 && d <= 5 ? d - 1 : -1; })();
const isTd = (i, wo) => wo === 0 && todayIdx >= 0 && i === todayIdx;
const GAS = import.meta.env.VITE_GAS_URL;
async function callGAS(a, d) { if (!GAS) return; try { await fetch(GAS, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ action: a, data: d }) }); } catch { } }
async function initPush(u) { try { const m = await getMsg(); if (!m) return; if ((await Notification.requestPermission()) !== "granted") return; const v = import.meta.env.VITE_FIREBASE_VAPID_KEY; if (!v) return; const t = await getToken(m, { vapidKey: v }); await updateDoc(doc(db, "users", u), { fcmToken: t }); onMessage(m, p => { if (p.notification) new Notification(p.notification.title || "SF", { body: p.notification.body, icon: "/icon-192.png" }); }); } catch { } }

/* ═══ GOOGLE CALENDAR ═══ */
const GCAL_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
const GCAL_SCOPES = "https://www.googleapis.com/auth/calendar.events";

function loadGIS() {
  return new Promise(resolve => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
}

async function gcalAuth() {
  await loadGIS();
  if (!window.google?.accounts?.oauth2 || !GCAL_CLIENT_ID) return null;
  return new Promise((resolve) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GCAL_CLIENT_ID,
      scope: GCAL_SCOPES,
      callback: (resp) => {
        if (resp.access_token) {
          const tokenData = { token: resp.access_token, expires: Date.now() + (resp.expires_in || 3600) * 1000 };
          localStorage.setItem("sf_gcal_token", JSON.stringify(tokenData));
          resolve(tokenData);
        } else resolve(null);
      },
    });
    client.requestAccessToken();
  });
}

function getGcalToken() {
  try { const d = JSON.parse(localStorage.getItem("sf_gcal_token")); if (d && d.expires > Date.now() + 60000) return d.token; } catch { }
  return null;
}

async function gcalRequest(method, path, body) {
  let token = getGcalToken();
  if (!token) { const d = await gcalAuth(); token = d?.token; }
  if (!token) return null;
  const url = `https://www.googleapis.com/calendar/v3${path}`;
  const opts = { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  try { const r = await fetch(url, opts); if (r.ok) return r.status === 204 ? {} : r.json(); if (r.status === 401) { localStorage.removeItem("sf_gcal_token"); return null; } return null; } catch { return null; }
}

// Sync one week of shifts to Google Calendar
// Build events list from schedule for one week — used by week + range sync
function buildWeekEvents(userId, weekDates, schedule, employees, absences) {
  const emp = employees.find(e => e.id === userId);
  if (!emp) return [];
  const events = [];
  for (let i = 0; i < 5; i++) {
    const day = ["Po", "Út", "St", "Čt", "Pá"][i];
    const date = weekDates[i];
    const absKey = `${userId}__${day}`;
    if (absences[absKey]) {
      const absType = ABS.find(a => a.id === absences[absKey]);
      // For absence end date in all-day event, end must be next day
      const endDate = new Date(date + "T00:00:00"); endDate.setDate(endDate.getDate() + 1);
      const endStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
      events.push({
        summary: `${absType?.icon || "📋"} ${absType?.label || "Nepřítomnost"} — ShiftFlow`,
        description: `[ShiftFlow] ${absType?.label}`,
        start: { date },
        end: { date: endStr },
        colorId: "11",
        extendedProperties: { private: { shiftflow: "1", sfUser: userId } },
      });
      continue;
    }
    for (const shift of ["08:00", "09:00", "10:00"]) {
      const entry = schedule?.[day]?.[shift]?.find(e => e.empId === userId);
      if (entry) {
        const endH = parseInt(shift.split(":")[0]) + 8;
        const hoLabel = entry.ho ? " 🏠 HO" : "";
        events.push({
          summary: `${shift} Směna${hoLabel} — ShiftFlow`,
          description: `[ShiftFlow] ${shift}${hoLabel}`,
          start: { dateTime: `${date}T${shift}:00`, timeZone: "Europe/Prague" },
          end: { dateTime: `${date}T${String(endH).padStart(2, "0")}:00:00`, timeZone: "Europe/Prague" },
          colorId: entry.ho ? "10" : "9",
          extendedProperties: { private: { shiftflow: "1", sfUser: userId } },
        });
        break;
      }
    }
  }
  return events;
}

// Generate week dates from Monday ISO string
function weekDatesFromMonday(mondayISO) {
  const start = new Date(mondayISO + "T00:00:00");
  const dates = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  return dates;
}

// Get all Monday ISOs for `weeks` weeks starting from offset relative to today
function getMondaysForRange(weeksAhead = 52, weeksBack = 0) {
  const today = new Date();
  const dy = today.getDay();
  const currentMon = new Date(today);
  currentMon.setDate(today.getDate() - dy + (dy === 0 ? -6 : 1));
  currentMon.setHours(0, 0, 0, 0);
  const mondays = [];
  for (let w = -weeksBack; w < weeksAhead; w++) {
    const m = new Date(currentMon);
    m.setDate(currentMon.getDate() + w * 7);
    mondays.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-${String(m.getDate()).padStart(2, "0")}`);
  }
  return mondays;
}

// Sync ONE week (in-memory data already provided)
// Všechny GCal synchronizace jedou přes jednu frontu — dvě souběžné (např. dvě rychlé
// editace po sobě) by si jinak vzájemně proložily mazání a vytváření → duplicity.
let _gcalChain = Promise.resolve();
const gcalSerial = job => { const p = _gcalChain.then(job, job); _gcalChain = p.catch(() => { }); return p; };

// Spolehlivě smaže VŠECHNY ShiftFlow události v rozsahu — nezávisle na Google full-text indexu.
// Načte vše v okně (stránkovaně) a maže podle značky / textu / názvu → odstraní i staré a duplicitní.
async function clearShiftFlowEvents(timeMin, timeMax, userId) {
  let pageToken = null, deleted = 0, guard = 0;
  do {
    const url = `/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&maxResults=2500&showDeleted=false${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const res = await gcalRequest("GET", url);
    if (res?.items) {
      for (const ev of res.items) {
        const p = ev.extendedProperties?.private || {};
        const isSF = p.shiftflow === "1" || ev.description?.includes("[ShiftFlow]") || ev.summary?.includes("ShiftFlow");
        const mine = !userId || !p.sfUser || p.sfUser === userId; // starší události bez značky smažeme také
        if (isSF && mine) { try { await gcalRequest("DELETE", `/calendars/primary/events/${ev.id}`); deleted++; await new Promise(r => setTimeout(r, 60)); } catch { } }
      }
    }
    pageToken = res?.nextPageToken;
  } while (pageToken && ++guard < 30);
  return deleted;
}

function syncWeekToGCal(userId, weekDates, schedule, employees, absences) {
  return gcalSerial(() => _syncWeekCore(userId, weekDates, schedule, employees, absences));
}
async function _syncWeekCore(userId, weekDates, schedule, employees, absences) {
  const emp = employees.find(e => e.id === userId);
  if (!emp) return { ok: false, msg: "Profil nenalezen" };
  const timeMin = weekDates[0] + "T00:00:00+02:00";
  const timeMax = weekDates[4] + "T23:59:59+02:00";
  const deleted = await clearShiftFlowEvents(timeMin, timeMax, userId);
  const events = buildWeekEvents(userId, weekDates, schedule, employees, absences);
  for (const evt of events) await gcalRequest("POST", "/calendars/primary/events", evt);
  return { ok: true, msg: `Synchronizováno: ${events.length} událostí (smazáno ${deleted} starých)` };
}

// Sync FULL RANGE (default: 52 weeks ahead) — fetches each week from Firestore
function syncRangeToGCal(userId, employees, db, weeksAhead = 52, onProgress) {
  return gcalSerial(() => _syncRangeCore(userId, employees, db, weeksAhead, onProgress));
}
async function _syncRangeCore(userId, employees, db, weeksAhead = 52, onProgress) {
  const { doc, getDoc } = await import("firebase/firestore");
  const emp = employees.find(e => e.id === userId);
  if (!emp) return { ok: false, msg: "Profil nenalezen" };
  const mondays = getMondaysForRange(weeksAhead, 0);

  // Step 1: Delete ALL existing ShiftFlow events in the range (spolehlivě, bez závislosti na q-indexu)
  const startStr = mondays[0] + "T00:00:00+02:00";
  const endDate = weekDatesFromMonday(mondays[mondays.length - 1])[4];
  const endStr = endDate + "T23:59:59+02:00";
  const deleted = await clearShiftFlowEvents(startStr, endStr, userId);

  if (onProgress) onProgress(`Smazáno ${deleted} starých událostí, vytvářím nové...`);

  // Step 2: For each week, fetch from Firestore + create events
  let created = 0;
  for (let wi = 0; wi < mondays.length; wi++) {
    const monISO = mondays[wi];
    const weekDates = weekDatesFromMonday(monISO);
    let weekData = null;
    try {
      const snap = await getDoc(doc(db, "schedules", monISO));
      if (snap.exists()) weekData = snap.data();
    } catch { }
    // Build effective schedule: saved entries + default fallback
    let schedule = weekData?.entries || null;
    if (!schedule) {
      // Use default schedule from emp
      schedule = {};
      ["Po", "Út", "St", "Čt", "Pá"].forEach(day => {
        schedule[day] = { "08:00": [], "09:00": [], "10:00": [] };
        if (emp.defaultSchedule?.[day] && emp.setupDone) {
          const sh = emp.defaultSchedule[day];
          if (["08:00", "09:00", "10:00"].includes(sh)) {
            schedule[day][sh].push({ empId: userId, ho: emp.defaultSchedule[`${day}_ho`] || false, isDefault: true });
          }
        }
      });
    } else {
      // Merge: if employee not in saved schedule and not in absences, add default
      const inSched = ["Po", "Út", "St", "Čt", "Pá"].some(d => ["08:00", "09:00", "10:00"].some(sh => schedule[d]?.[sh]?.some(e => e.empId === userId)));
      const inAbs = Object.keys(weekData.absences || {}).some(k => k.startsWith(`${userId}__`));
      if (!inSched && !inAbs && emp.defaultSchedule && emp.setupDone) {
        ["Po", "Út", "St", "Čt", "Pá"].forEach(day => {
          const sh = emp.defaultSchedule[day];
          if (sh && ["08:00", "09:00", "10:00"].includes(sh)) {
            if (!schedule[day]) schedule[day] = {};
            if (!schedule[day][sh]) schedule[day][sh] = [];
            schedule[day][sh].push({ empId: userId, ho: emp.defaultSchedule[`${day}_ho`] || false, isDefault: true });
          }
        });
      }
    }
    const absences = weekData?.absences || {};
    const events = buildWeekEvents(userId, weekDates, schedule, employees, absences);
    for (const evt of events) {
      await gcalRequest("POST", "/calendars/primary/events", evt);
      created++;
    }
    if (onProgress && wi % 4 === 0) onProgress(`Týden ${wi + 1}/${mondays.length} — ${created} událostí`);
  }
  return { ok: true, msg: `Synchronizováno ${created} událostí v ${mondays.length} týdnech (smazáno ${deleted} starých)` };
}
// Firestore-safe key: no dots, slashes or special chars
const fsKey = (...parts) => parts.join("__");

/* ═══ CSS ═══ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@300;400;500;600;700&family=Barlow:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
:root,[data-theme="light"]{
  --bg:#bec4d0;--bg2:rgba(210,215,225,.45);--bg3:rgba(200,208,222,.35);--bg4:rgba(190,198,215,.48);
  --panel:rgba(215,220,230,.65);--card:rgba(220,225,235,.42);--card-h:rgba(210,218,230,.6);
  --brd:rgba(50,60,85,.22);--brd2:rgba(40,50,75,.35);--bt:rgba(35,45,70,.45);
  --tx:#2e3440;--tx2:#555e70;--tx3:#7a8290;--w:#1a1e28;
  --acc:#3a4558;--acc2:#d47820;--acc3:#c05828;--adim:rgba(212,120,32,.1);--abrd:rgba(212,120,32,.32);
  --l1:#5050d0;--sd:#2878a8;--red:#b83030;--grn:#388040;--amb:#c87020;
  --sel:#2e3848;--stx:#e8eaf0;--blur:blur(24px);--glass:rgba(215,220,230,.65);
  --sheen:linear-gradient(135deg,rgba(255,255,255,.28) 0%,rgba(255,255,255,.02) 38%,rgba(255,255,255,.07) 65%,rgba(255,255,255,.20) 100%);
  --grid:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cdefs%3E%3Cpattern id='g' width='40' height='40' patternUnits='userSpaceOnUse'%3E%3Cpath d='M40 0H0v40' fill='none' stroke='rgba(80,90,120,.06)' stroke-width='.5'/%3E%3Ccircle cx='0' cy='0' r='.8' fill='rgba(80,90,120,.05)'/%3E%3C/pattern%3E%3C/defs%3E%3Crect width='200' height='200' fill='url(%23g)'/%3E%3C/svg%3E");
  --moon:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='800'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='.012' numOctaves='8' seed='3' type='fractalNoise'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3CfeComponentTransfer%3E%3CfeFuncR type='linear' slope='.18' intercept='.68'/%3E%3CfeFuncG type='linear' slope='.18' intercept='.7'/%3E%3CfeFuncB type='linear' slope='.18' intercept='.76'/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3Ccircle cx='120' cy='180' r='45' fill='rgba(0,0,0,.06)'/%3E%3Ccircle cx='380' cy='100' r='70' fill='rgba(0,0,0,.05)'/%3E%3Ccircle cx='550' cy='300' r='85' fill='rgba(0,0,0,.045)'/%3E%3C/svg%3E");
}
[data-theme="dark"]{
  --bg:#0c0c12;--bg2:rgba(18,18,28,.85);--bg3:rgba(24,24,36,.8);--bg4:rgba(30,30,44,.8);
  --panel:rgba(16,16,26,.88);--card:rgba(20,20,32,.7);--card-h:rgba(28,28,42,.8);
  --brd:rgba(255,255,255,.08);--brd2:rgba(255,255,255,.12);--bt:rgba(255,255,255,.14);
  --tx:#c0c4d0;--tx2:#7880a0;--tx3:#4a5070;--w:#e8eaf0;
  --acc:#7b8fad;--acc2:#d47820;--acc3:#c05828;--adim:rgba(212,120,32,.12);--abrd:rgba(212,120,32,.3);
  --l1:#7c7cf5;--sd:#50a0d0;--red:#c04040;--grn:#50a060;--amb:#c87020;
  --sel:rgba(123,143,173,.15);--stx:#e8eaf0;--blur:blur(16px);--glass:rgba(16,16,26,.82);
  --sheen:linear-gradient(135deg,rgba(255,255,255,.06) 0%,transparent 50%,rgba(255,255,255,.03) 100%);
  --grid:none;--moon:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='800'%3E%3Crect width='800' height='800' fill='%23060610'/%3E%3Cdefs%3E%3CradialGradient id='n1' cx='.3' cy='.4' r='.5'%3E%3Cstop offset='0' stop-color='rgba(40,50,100,.12)'/%3E%3Cstop offset='1' stop-color='transparent'/%3E%3C/radialGradient%3E%3CradialGradient id='n2' cx='.7' cy='.6' r='.4'%3E%3Cstop offset='0' stop-color='rgba(80,40,60,.08)'/%3E%3Cstop offset='1' stop-color='transparent'/%3E%3C/radialGradient%3E%3C/defs%3E%3Crect width='800' height='800' fill='url(%23n1)'/%3E%3Crect width='800' height='800' fill='url(%23n2)'/%3E%3Ccircle cx='65' cy='90' r='1.2' fill='rgba(255,255,255,.6)'/%3E%3Ccircle cx='180' cy='40' r='.5' fill='rgba(255,255,255,.3)'/%3E%3Ccircle cx='310' cy='120' r='1.4' fill='rgba(255,255,255,.55)'/%3E%3Ccircle cx='450' cy='60' r='.7' fill='rgba(255,255,255,.4)'/%3E%3Ccircle cx='590' cy='130' r='1' fill='rgba(255,255,255,.45)'/%3E%3Ccircle cx='720' cy='50' r='.6' fill='rgba(255,255,255,.35)'/%3E%3Ccircle cx='100' cy='220' r='.8' fill='rgba(255,255,255,.5)'/%3E%3Ccircle cx='240' cy='190' r='1.1' fill='rgba(255,255,255,.4)'/%3E%3Ccircle cx='370' cy='250' r='.6' fill='rgba(255,255,255,.55)'/%3E%3Ccircle cx='520' cy='200' r='1.3' fill='rgba(255,255,255,.35)'/%3E%3Ccircle cx='660' cy='240' r='.9' fill='rgba(255,255,255,.45)'/%3E%3Ccircle cx='780' cy='180' r='.5' fill='rgba(255,255,255,.3)'/%3E%3Ccircle cx='50' cy='350' r='1' fill='rgba(255,255,255,.5)'/%3E%3Ccircle cx='150' cy='380' r='.7' fill='rgba(255,255,255,.35)'/%3E%3Ccircle cx='280' cy='330' r='1.2' fill='rgba(255,255,255,.45)'/%3E%3Ccircle cx='410' cy='370' r='.8' fill='rgba(255,255,255,.5)'/%3E%3Ccircle cx='550' cy='340' r='1.5' fill='rgba(255,255,255,.3)'/%3E%3Ccircle cx='680' cy='390' r='.6' fill='rgba(255,255,255,.4)'/%3E%3Ccircle cx='750' cy='320' r='1.1' fill='rgba(255,255,255,.35)'/%3E%3Ccircle cx='90' cy='480' r='.9' fill='rgba(255,255,255,.45)'/%3E%3Ccircle cx='210' cy='510' r='1.3' fill='rgba(255,255,255,.4)'/%3E%3Ccircle cx='340' cy='460' r='.7' fill='rgba(255,255,255,.5)'/%3E%3Ccircle cx='470' cy='520' r='1' fill='rgba(255,255,255,.35)'/%3E%3Ccircle cx='600' cy='480' r='.8' fill='rgba(255,255,255,.45)'/%3E%3Ccircle cx='730' cy='510' r='1.2' fill='rgba(255,255,255,.3)'/%3E%3Ccircle cx='130' cy='620' r='1.1' fill='rgba(255,255,255,.4)'/%3E%3Ccircle cx='260' cy='650' r='.6' fill='rgba(255,255,255,.5)'/%3E%3Ccircle cx='400' cy='600' r='1.4' fill='rgba(255,255,255,.35)'/%3E%3Ccircle cx='530' cy='660' r='.9' fill='rgba(255,255,255,.45)'/%3E%3Ccircle cx='670' cy='620' r='.7' fill='rgba(255,255,255,.4)'/%3E%3Ccircle cx='770' cy='680' r='1' fill='rgba(255,255,255,.3)'/%3E%3Ccircle cx='40' cy='740' r='.8' fill='rgba(255,255,255,.45)'/%3E%3Ccircle cx='190' cy='770' r='1.2' fill='rgba(255,255,255,.35)'/%3E%3Ccircle cx='350' cy='730' r='.5' fill='rgba(255,255,255,.5)'/%3E%3Ccircle cx='500' cy='760' r='1.1' fill='rgba(255,255,255,.4)'/%3E%3Ccircle cx='640' cy='750' r='.7' fill='rgba(255,255,255,.45)'/%3E%3Ccircle cx='760' cy='780' r='1.3' fill='rgba(255,255,255,.3)'/%3E%3C/svg%3E");
}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{background:var(--bg)}
::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-thumb{background:var(--brd2)}
@keyframes fi{from{opacity:0}to{opacity:1}}
@keyframes su{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes vi{from{opacity:0;transform:translateX(30px)}to{opacity:1;transform:translateX(0)}}
@keyframes mu{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:translateY(0)}}
@keyframes sr{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:translateX(0)}}
@keyframes sl2{from{opacity:0;transform:translateX(-24px)}to{opacity:1;transform:translateX(0)}}
@keyframes tp{0%,100%{box-shadow:0 0 0 0 rgba(212,120,32,.4)}50%{box-shadow:0 0 0 4px rgba(212,120,32,0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes st{from{transform:translateY(-30px);opacity:0}to{transform:translateY(0);opacity:1}}
.avi{animation:vi .35s cubic-bezier(.22,.68,.36,1)}.asr{animation:sr .26s both}.asl{animation:sl2 .26s both}
.atp{animation:tp 2.5s ease-in-out infinite}
.chg{box-shadow:inset 3px 0 0 var(--acc2)}
.ent{transition:all .15s;cursor:pointer;min-height:48px;display:flex;align-items:center}.ent:hover,.ent:active{background:var(--card-h)!important}
.gl{background:var(--card);backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);border:1px solid var(--bt)}
.pg{background:var(--panel);backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur)}
.dz{transition:background .15s}.dz.over{background:var(--adim)!important;outline:2px dashed var(--abrd)}
@media(max-width:768px){.gl,.pg{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}}
`;

/* ═══ UI ═══ */
const Badge = ({ children, color = "var(--acc)", small, style: sx }) => <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: small ? "2px 8px" : "4px 12px", fontSize: small ? 11 : 13, fontWeight: 500, fontFamily: "'Barlow Condensed',sans-serif", color, letterSpacing: .8, textTransform: "uppercase", border: `1px solid ${color}`, whiteSpace: "nowrap", ...sx }}>{children}</span>;
const Btn = ({ children, onClick, primary, danger, small, ghost, warm, disabled, style: sx }) => <button disabled={disabled} onClick={onClick} style={{ padding: small ? "8px 14px" : "12px 24px", border: `1px solid ${danger ? "var(--red)" : warm ? "var(--acc2)" : primary ? "var(--acc)" : "var(--brd2)"}`, fontWeight: 500, cursor: disabled ? "not-allowed" : "pointer", fontSize: small ? 13 : 15, fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 1, background: warm ? "var(--adim)" : primary ? "var(--sel)" : "transparent", color: danger ? "var(--red)" : warm ? "var(--acc2)" : primary ? "var(--stx)" : "var(--tx2)", opacity: disabled ? .3 : 1, transition: "all .2s", minHeight: 44, ...sx }}>{children}</button>;
const Input = ({ label, ...p }) => <div style={{ marginBottom: 18 }}>{label && <label style={{ fontSize: 12, color: "var(--tx3)", display: "block", marginBottom: 6, fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 1.5 }}>{label}</label>}<input {...p} style={{ width: "100%", padding: "12px 14px", border: "1px solid var(--brd2)", background: "var(--bg)", color: "var(--w)", fontSize: 16, fontFamily: "'Barlow',sans-serif", outline: "none", boxSizing: "border-box", minHeight: 48, ...(p.style || {}) }} onFocus={e => e.target.style.borderColor = "var(--acc2)"} onBlur={e => e.target.style.borderColor = ""} /></div>;
const Sel = ({ label, options, ...p }) => <div style={{ marginBottom: 18 }}>{label && <label style={{ fontSize: 12, color: "var(--tx3)", display: "block", marginBottom: 6, fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 1.5 }}>{label}</label>}<select {...p} style={{ width: "100%", padding: "12px 14px", border: "1px solid var(--brd2)", background: "var(--bg)", color: "var(--w)", fontSize: 16, fontFamily: "'Barlow',sans-serif", outline: "none", minHeight: 48 }}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>;
const Toggle = ({ checked, onChange, label }) => <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 15, color: "var(--tx)", marginBottom: 14, minHeight: 44 }}><div onClick={() => onChange(!checked)} style={{ width: 40, height: 20, border: `1px solid ${checked ? "var(--acc2)" : "var(--brd2)"}`, position: "relative", cursor: "pointer", flexShrink: 0, background: checked ? "var(--adim)" : "transparent", transition: "all .25s" }}><div style={{ width: 16, height: 16, background: checked ? "var(--acc2)" : "var(--tx3)", position: "absolute", top: 1, left: checked ? 21 : 1, transition: "all .25s" }} /></div>{label}</label>;
const Modal = ({ open, onClose, title, children, wide }) => { if (!open) return null; return <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.35)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-end", justifyContent: "center", animation: "fi .2s" }} onClick={onClose}><div onClick={e => e.stopPropagation()} className="gl" style={{ borderBottom: "none", padding: "28px 24px 36px", width: "100%", maxWidth: wide ? 760 : 520, maxHeight: "85vh", overflowY: "auto", animation: "mu .3s cubic-bezier(.22,.68,.36,1)" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, borderBottom: "1px solid var(--brd)", paddingBottom: 16 }}><h3 style={{ margin: 0, fontSize: 18, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600, textTransform: "uppercase", letterSpacing: 2 }}>{title}</h3><button onClick={onClose} style={{ background: "none", border: "1px solid var(--brd2)", color: "var(--tx3)", width: 40, height: 40, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button></div>{children}</div></div>; };
const Card = ({ children, style: sx }) => <div className="gl" style={{ padding: 20, ...sx }}>{children}</div>;

/* ═══ PARALLAX ═══ */
function ParallaxBg() {
  const ref = useRef(null);
  const mob = typeof window !== 'undefined' && window.innerWidth < 900;
  useEffect(() => {
    if (mob) return;
    const el = ref.current; if (!el) return;
    const upd = (x, y) => { el.style.transform = `translate(${x * 20}px,${y * 14}px) scale(1.08)`; };
    const onM = e => requestAnimationFrame(() => upd(e.clientX / window.innerWidth - .5, e.clientY / window.innerHeight - .5));
    window.addEventListener('mousemove', onM, { passive: true });
    return () => window.removeEventListener('mousemove', onM);
  }, [mob]);
  return <div ref={ref} style={{ position: 'fixed', inset: mob ? '0' : '-60px', zIndex: 0, pointerEvents: 'none', backgroundImage: 'var(--moon)', backgroundSize: mob ? '400px' : 'cover', willChange: mob ? 'auto' : 'transform' }} />;
}

/* ═══ NAV ═══ */
function SideNav({ view, setView, NAV, theme, setTheme }) {
  return <aside className="pg" style={{ width: 200, height: "100vh", position: "fixed", left: 0, top: 0, zIndex: 50, display: "flex", flexDirection: "column", borderRight: "1px solid var(--bt)" }}>
    <div style={{ padding: "20px 20px 16px", fontSize: 20, fontWeight: 700, color: "var(--w)", letterSpacing: 4, fontFamily: "'Barlow Condensed',sans-serif", borderBottom: "1px solid var(--brd)" }}>SHIFTFLOW</div>
    <div style={{ flex: 1, padding: "12px 0", overflowY: "auto" }}>
      {NAV.map(n => <button key={n.id} onClick={() => setView(n.id)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "12px 20px", border: "none", background: view === n.id ? "var(--adim)" : "transparent", borderLeft: view === n.id ? "3px solid var(--acc2)" : "3px solid transparent", color: view === n.id ? "var(--acc2)" : "var(--tx2)", cursor: "pointer", fontSize: 14, fontWeight: 600, fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 1, transition: "all .2s", minHeight: 44, textAlign: "left", position: "relative" }}>
        <span style={{ fontSize: 16, fontFamily: "'IBM Plex Mono',monospace", width: 20, textAlign: "center", opacity: .8 }}>{n.ic}</span>{n.l}
        {n.b > 0 && <span style={{ background: "var(--red)", color: "#fff", fontSize: 10, fontWeight: 700, width: 18, height: 18, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", marginLeft: "auto" }}>{n.b}</span>}
      </button>)}
    </div>
    <div style={{ padding: "12px 20px", borderTop: "1px solid var(--brd)" }}>
      <button onClick={() => setTheme(t => t === "light" ? "dark" : "light")} style={{ background: "none", border: "1px solid var(--brd2)", width: "100%", height: 38, cursor: "pointer", fontSize: 14, color: "var(--tx2)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 1 }}>{theme === "light" ? "● Dark" : "○ Light"}</button>
    </div>
  </aside>;
}
function PillNav({ view, setView, NAV }) {
  return <nav className="pg" style={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 100, display: 'flex', gap: 2, padding: 4, border: '1px solid var(--bt)', boxShadow: '0 8px 32px rgba(0,0,0,.22)' }}>
    {NAV.map(n => <button key={n.id} onClick={() => setView(n.id)} style={{ display: 'flex', alignItems: 'center', gap: view === n.id ? 7 : 0, padding: view === n.id ? '10px 16px' : '10px 13px', border: 'none', background: view === n.id ? 'var(--adim)' : 'transparent', outline: view === n.id ? '1px solid var(--abrd)' : 'none', cursor: 'pointer', color: view === n.id ? 'var(--acc2)' : 'var(--tx3)', transition: 'all .28s', minHeight: 44, position: 'relative' }}>
      <span style={{ fontSize: 16, fontFamily: "'IBM Plex Mono',monospace" }}>{n.ic}</span>
      <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, overflow: 'hidden', maxWidth: view === n.id ? 80 : 0, whiteSpace: 'nowrap', transition: 'max-width .28s' }}>{n.l}</span>
      {n.b > 0 && view !== n.id && <span style={{ position: 'absolute', top: 2, right: 2, background: 'var(--red)', color: '#fff', fontSize: 8, fontWeight: 700, width: 14, height: 14, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{n.b}</span>}
    </button>)}
  </nav>;
}

/* ═══ COMPONENTS (before App) ═══ */
function Setup({ profile, onDone }) {
  const [sched, setSched] = useState(() => { const s = {}; DAYS.forEach(d => { s[d] = "09:00"; s[`${d}_ho`] = false; }); return s; });
  const [saving, setSaving] = useState(false);
  return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", padding: 16 }}><style>{CSS}</style><ParallaxBg />
    <div className="gl" style={{ width: "100%", maxWidth: 520, padding: "36px 24px", animation: "mu .5s", position: "relative", zIndex: 1 }}>
      <div style={{ textAlign: "center", marginBottom: 32, borderBottom: "1px solid var(--brd)", paddingBottom: 24 }}>
        <h2 style={{ fontSize: 24, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2 }}>Stálý rozvrh</h2>
      </div>
      {DAYS.map(day => <div key={day} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--bg3)", border: "1px solid var(--brd)", marginBottom: 4 }}>
        <span style={{ fontWeight: 600, fontSize: 16, minWidth: 50, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif" }}>{day}</span>
        <div style={{ display: "flex", gap: 2, flex: 1 }}>{SHIFTS.map(sh => <button key={sh} onClick={() => setSched(s => ({ ...s, [day]: sh }))} style={{ flex: 1, padding: "10px 0", border: `1px solid ${sched[day] === sh ? "var(--acc2)" : "var(--brd)"}`, fontSize: 15, fontFamily: "'IBM Plex Mono',monospace", cursor: "pointer", background: sched[day] === sh ? "var(--adim)" : "transparent", color: sched[day] === sh ? "var(--w)" : "var(--tx3)", minHeight: 44 }}>{sh}</button>)}</div>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--tx3)", cursor: "pointer" }}><input type="checkbox" checked={sched[`${day}_ho`] || false} onChange={e => setSched(s => ({ ...s, [`${day}_ho`]: e.target.checked }))} style={{ width: 18, height: 18 }} />HO</label>
      </div>)}
      <Btn warm disabled={saving} onClick={async () => { setSaving(true); await updateDoc(doc(db, "users", profile.id), { defaultSchedule: sched, setupDone: true }); onDone(); }} style={{ width: "100%", marginTop: 20, padding: "14px 0", fontSize: 17 }}>{saving ? "..." : "POTVRDIT"}</Btn>
    </div>
  </div>;
}

function AuthScreen() {
  const [mode, setMode] = useState("login"); const [login, setLogin] = useState(""); const [pass, setPass] = useState("");
  const [err, setErr] = useState(""); const [loading, setLoading] = useState(false);
  const [rn, setRn] = useState(""); const [rEmail, setREmail] = useState(""); const [rp, setRp] = useState(""); const [rp2, setRp2] = useState("");
  const [rNotify, setRNotify] = useState(false); const [rNotifEmail, setRNotifEmail] = useState("");
  const doLogin = async () => {
    setErr(""); setLoading(true);
    try {
      const id = login.trim();
      const email = id.toLowerCase() === "admin" ? AE : id; // zkratka "Admin" → admin účet, heslo VŽDY to zadané
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (e) { setErr(e.code === "auth/invalid-credential" || e.code === "auth/wrong-password" ? "Neplatné údaje" : e.message); }
    setLoading(false);
  };
  const doReg = async () => { setErr(""); setLoading(true); try { if (!rn.trim() || !rEmail || !rp) { setErr("Vyplňte pole"); setLoading(false); return; } if (rp !== rp2) { setErr("Hesla neshodují"); setLoading(false); return; } if (rp.length < 6) { setErr("Min. 6 znaků"); setLoading(false); return; } const c = await createUserWithEmailAndPassword(auth, rEmail, rp); await updateProfile(c.user, { displayName: rn.trim() }); await setDoc(doc(db, "users", c.user.uid), { name: rn.trim(), email: rEmail, role: "employee", notify: rNotify, notifyEmail: rNotify ? rNotifEmail : "", fcmToken: null, defaultSchedule: null, setupDone: false, vacationTotal: 20, sickTotal: 5, whateverTotal: 3, vacationUsed: 0, sickUsed: 0, whateverUsed: 0, createdAt: new Date().toISOString() }); } catch (e) { setErr(e.message); } setLoading(false); };
  return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", padding: 16 }}><style>{CSS}</style><ParallaxBg />
    <div className="gl" style={{ width: "100%", maxWidth: 440, padding: "40px 28px", animation: "mu .5s", position: "relative", zIndex: 1 }}>
      <div style={{ textAlign: "center", marginBottom: 36, borderBottom: "1px solid var(--brd)", paddingBottom: 28 }}>
        <div style={{ fontSize: 36, letterSpacing: 8, fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 300, color: "var(--w)" }}>SHIFTFLOW</div>
        <div style={{ width: 40, height: 2, background: "var(--acc2)", margin: "8px auto" }} />
      </div>
      <div style={{ display: "flex", marginBottom: 28, border: "1px solid var(--brd)" }}>{["login", "register"].map(m => <button key={m} onClick={() => { setMode(m); setErr(""); }} style={{ flex: 1, padding: "12px 0", border: "none", fontSize: 14, fontFamily: "'Barlow Condensed',sans-serif", cursor: "pointer", background: mode === m ? "var(--sel)" : "transparent", color: mode === m ? "var(--stx)" : "var(--tx3)", textTransform: "uppercase", letterSpacing: 1.5, minHeight: 48 }}>{m === "login" ? "Přihlášení" : "Registrace"}</button>)}</div>
      {mode === "login" ? <>
        <Input label="Email" value={login} onChange={e => setLogin(e.target.value)} />
        <Input label="Heslo" type="password" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === "Enter" && doLogin()} />
        <div style={{ display: "flex", gap: 8 }}><Btn warm disabled={loading} onClick={doLogin} style={{ flex: 1 }}>{loading ? "..." : "Přihlásit"}</Btn><Btn ghost onClick={async () => { try { const s = localStorage.getItem("sf_bio_email"), p = localStorage.getItem("sf_bio_token"); if (!s || !p) return setErr("Přihlaste se heslem a povolte biometrii"); await signInWithEmailAndPassword(auth, s, p); } catch (e) { setErr("Bio: " + e.message); } }} style={{ fontSize: 20 }}>🔐</Btn></div>
        <button onClick={async () => { if (!login || !login.includes("@")) return setErr("Zadejte email"); try { await sendPasswordResetEmail(auth, login); setErr(""); notify && notify("Email odeslán"); alert("Odkaz pro reset hesla odeslán na " + login); } catch (e) { setErr(e.message); } }} style={{ background: "none", border: "none", color: "var(--acc2)", cursor: "pointer", fontSize: 13, fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 1, marginTop: 12, width: "100%", textAlign: "center" }}>Zapomenuté heslo?</button>
      </> : <>
        <Input label="Jméno" value={rn} onChange={e => setRn(e.target.value)} />
        <Input label="Email" value={rEmail} onChange={e => setREmail(e.target.value)} />
        <Input label="Heslo (min. 6)" type="password" value={rp} onChange={e => setRp(e.target.value)} />
        <Input label="Heslo znovu" type="password" value={rp2} onChange={e => setRp2(e.target.value)} />
        <Btn warm disabled={loading} onClick={doReg} style={{ width: "100%" }}>{loading ? "..." : "Zaregistrovat"}</Btn>
      </>}
      {err && <p style={{ color: "var(--red)", fontSize: 14, marginTop: 12, padding: "10px 14px", border: "1px solid var(--red)" }}>{err}</p>}
    </div>
  </div>;
}

function DefEditor({ employees }) {
  const [editEmp, setEditEmp] = useState(null); const [es, setEs] = useState({}); const [saving, setSaving] = useState(false);
  const start = emp => { setEditEmp(emp); const s = {}; DAYS.forEach(d => { s[d] = emp.defaultSchedule?.[d] || "09:00"; s[`${d}_ho`] = emp.defaultSchedule?.[`${d}_ho`] || false; }); setEs(s); };
  return <div><div style={{ marginBottom: 28 }}>
    <div className="gl" style={{ overflow: "auto", padding: 0 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}><thead><tr>
        <th style={{ padding: "12px 14px", textAlign: "left", color: "var(--tx3)", borderBottom: "1px solid var(--brd)" }}>Zaměstnanec</th>
        {DAYS.map(d => <th key={d} style={{ padding: "12px 8px", textAlign: "center", color: "var(--tx3)", borderBottom: "1px solid var(--brd)" }}>{d}</th>)}
        <th style={{ padding: 12, borderBottom: "1px solid var(--brd)" }} />
      </tr></thead><tbody>{employees.filter(e => e.role !== "admin").map(emp => <tr key={emp.id} style={{ borderBottom: "1px solid var(--brd)" }}>
        <td style={{ padding: "12px 14px", fontWeight: 500, color: "var(--w)" }}>{emp.name}</td>
        {DAYS.map(d => <td key={d} style={{ padding: 8, textAlign: "center" }}>{emp.setupDone && emp.defaultSchedule?.[d] ? <span style={{ fontFamily: "'IBM Plex Mono',monospace", color: emp.defaultSchedule[`${d}_ho`] ? "var(--grn)" : "var(--acc2)", fontSize: 13 }}>{emp.defaultSchedule[`${d}_ho`] ? "HO" : emp.defaultSchedule[d]}</span> : "—"}</td>)}
        <td style={{ padding: "8px 12px", textAlign: "right" }}><Btn small onClick={() => start(emp)}>✏</Btn></td>
      </tr>)}</tbody></table>
    </div>
  </div>
    <Modal open={!!editEmp} onClose={() => setEditEmp(null)} title={editEmp?.name || ""}>{editEmp && <div>
      {DAYS.map(day => <div key={day} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--bg3)", marginBottom: 4 }}>
        <span style={{ fontWeight: 600, minWidth: 50, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif" }}>{day}</span>
        <div style={{ display: "flex", gap: 2, flex: 1 }}>{SHIFTS.map(sh => <button key={sh} onClick={() => setEs(s => ({ ...s, [day]: sh }))} style={{ flex: 1, padding: "10px 0", border: `1px solid ${es[day] === sh ? "var(--acc2)" : "var(--brd)"}`, fontFamily: "'IBM Plex Mono',monospace", cursor: "pointer", background: es[day] === sh ? "var(--adim)" : "transparent", color: es[day] === sh ? "var(--w)" : "var(--tx3)", minHeight: 44 }}>{sh}</button>)}<button onClick={() => setEs(s => ({ ...s, [`${day}_ho`]: !s[`${day}_ho`] }))} style={{ padding: "10px 12px", border: `1px solid ${es[`${day}_ho`] ? "var(--grn)" : "var(--brd)"}`, fontFamily: "'IBM Plex Mono',monospace", cursor: "pointer", background: "transparent", color: es[`${day}_ho`] ? "var(--grn)" : "var(--tx3)", minHeight: 44 }}>HO</button></div>
      </div>)}
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}><Btn warm disabled={saving} onClick={async () => { setSaving(true); await updateDoc(doc(db, "users", editEmp.id), { defaultSchedule: es, setupDone: true }); setSaving(false); setEditEmp(null); }} style={{ flex: 1 }}>Uložit</Btn><Btn ghost onClick={() => setEditEmp(null)}>Zrušit</Btn></div>
    </div>}</Modal></div>;
}

function AbsF({ emps, wd, onSubmit }) { const [eid, setEid] = useState(emps[0]?.id || ""); const [dayIdx, setDayIdx] = useState(0); const [t, setT] = useState(ABS[0].id); return <div><Sel label="Zaměstnanec" value={eid} onChange={e => setEid(e.target.value)} options={emps.map(e => ({ value: e.id, label: e.name }))} /><Sel label="Den" value={dayIdx} onChange={e => setDayIdx(+e.target.value)} options={DAYS.map((d, i) => ({ value: i, label: `${DAYS_F[i]} ${fmtDate(wd[i])}` }))} /><Sel label="Typ" value={t} onChange={e => setT(e.target.value)} options={ABS.map(a => ({ value: a.id, label: `${a.icon} ${a.label}` }))} /><Btn warm onClick={() => onSubmit(eid, DAYS[dayIdx], t)} style={{ width: "100%", marginTop: 8 }}>Přidat</Btn></div>; }
function EvF({ onSubmit }) { const [day, setDay] = useState(DAYS[0]); const [t, setT] = useState(EVTS[0].id); const [n, setN] = useState(""); return <div><Sel label="Den" value={day} onChange={e => setDay(e.target.value)} options={DAYS.map((d, i) => ({ value: d, label: DAYS_F[i] }))} /><Sel label="Typ" value={t} onChange={e => setT(e.target.value)} options={EVTS.map(e => ({ value: e.id, label: `${e.icon} ${e.label}` }))} /><Input label="Poznámka" value={n} onChange={e => setN(e.target.value)} /><Btn warm onClick={() => onSubmit(day, t, n)} style={{ width: "100%", marginTop: 8 }}>Přidat</Btn></div>; }
function SwF({ dDay, dShift, wd, onSubmit }) {
  const [dateISO, setDateISO] = useState(() => { const idx = dDay ? DAYS.indexOf(dDay) : 0; return wd?.[idx >= 0 ? idx : 0] || ""; });
  const [sh, setSh] = useState(dShift || SHIFTS[0]);
  const [comment, setComment] = useState("");
  const isWeekend = (() => { if (!dateISO) return false; const d = new Date(dateISO + "T00:00:00"); const dow = d.getDay(); return dow === 0 || dow === 6; })();
  const isPast = (() => { if (!dateISO) return false; const d = new Date(dateISO + "T00:00:00"); const today = new Date(); today.setHours(0, 0, 0, 0); return d < today; })();
  return <div>
    <Input label="Datum směny" type="date" value={dateISO} onChange={e => setDateISO(e.target.value)} />
    {dateISO && <p style={{ fontSize: 13, color: isWeekend || isPast ? "var(--red)" : "var(--tx2)", marginTop: -10, marginBottom: 14 }}>{(() => {
      const d = new Date(dateISO + "T00:00:00"); const dow = d.getDay();
      if (isPast) return "⚠️ Minulé datum";
      if (isWeekend) return "⚠️ Víkend - směna není";
      return DAYS_F[dow - 1];
    })()}</p>}
    <Sel label="Směna" value={sh} onChange={e => setSh(e.target.value)} options={SHIFTS.map(s => ({ value: s, label: s }))} />
    <Input label="Důvod (volitelné)" value={comment} onChange={e => setComment(e.target.value)} placeholder="Např. rodinná záležitost" />
    <Btn warm disabled={!dateISO || isWeekend || isPast} onClick={() => onSubmit(dateISO, sh, comment)} style={{ width: "100%", marginTop: 8 }}>Odeslat</Btn>
  </div>;
}
function MyAbsF({ profile, wd, onSubmit }) { const [dayIdx, setDayIdx] = useState(Math.max(0, todayIdx)); const [t, setT] = useState(ABS[0].id); const r = { sick: (profile.sickTotal || 5) - (profile.sickUsed || 0), vacation: (profile.vacationTotal || 20) - (profile.vacationUsed || 0), whatever: (profile.whateverTotal || 3) - (profile.whateverUsed || 0) }; return <div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>{[{ l: "Dovol.", v: r.vacation, c: "var(--sd)" }, { l: "Sick", v: r.sick, c: "var(--red)" }, { l: "What.", v: r.whatever, c: "var(--amb)" }].map(b => <div key={b.l} style={{ textAlign: "center", padding: 12, border: "1px solid var(--brd)", background: "var(--bg3)" }}><div style={{ fontSize: 28, fontWeight: 600, color: b.c, fontFamily: "'IBM Plex Mono',monospace" }}>{b.v}</div><div style={{ fontSize: 11, color: "var(--tx3)", textTransform: "uppercase" }}>{b.l}</div></div>)}</div><Sel label="Den" value={dayIdx} onChange={e => setDayIdx(+e.target.value)} options={DAYS.map((d, i) => ({ value: i, label: `${DAYS_F[i]} ${fmtDate(wd[i])}` }))} /><Sel label="Typ" value={t} onChange={e => setT(e.target.value)} options={ABS.map(a => ({ value: a.id, label: `${a.icon} ${a.label}` }))} /><Btn warm onClick={() => onSubmit(DAYS[dayIdx], t)} style={{ width: "100%", marginTop: 8 }}>Zadat</Btn></div>; }
function EditDF({ emp, onDone }) { const [vac, setVac] = useState(emp?.vacationTotal || 20); const [sick, setSick] = useState(emp?.sickTotal || 5); const [what, setWhat] = useState(emp?.whateverTotal || 3); const [l, setL] = useState(false); if (!emp) return null; return <div><Input label="Dovolená" type="number" value={vac} onChange={e => setVac(+e.target.value)} /><Input label="Sick Days" type="number" value={sick} onChange={e => setSick(+e.target.value)} /><Input label="Whatever Days" type="number" value={what} onChange={e => setWhat(+e.target.value)} /><Btn warm disabled={l} onClick={async () => { setL(true); await updateDoc(doc(db, "users", emp.id), { vacationTotal: vac, sickTotal: sick, whateverTotal: what }); setL(false); onDone(); }} style={{ width: "100%", marginTop: 8 }}>Uložit</Btn></div>; }
function AddF({ onDone }) { const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [pass, setPass] = useState(""); const [l, setL] = useState(false); const [err, setErr] = useState(""); return <div><Input label="Jméno" value={name} onChange={e => setName(e.target.value)} /><Input label="Email" value={email} onChange={e => setEmail(e.target.value)} /><Input label="Heslo (min. 6)" type="password" value={pass} onChange={e => setPass(e.target.value)} />{err && <p style={{ color: "var(--red)", fontSize: 14, marginBottom: 8, padding: 10, border: "1px solid var(--red)" }}>{err}</p>}<Btn warm disabled={l} onClick={async () => { setErr(""); if (!name.trim() || !email || !pass) return setErr("Vyplňte vše"); if (pass.length < 6) return setErr("Min. 6 znaků"); setL(true); try { const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${import.meta.env.VITE_FIREBASE_API_KEY}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pass, displayName: name.trim(), returnSecureToken: false }) }); const d = await r.json(); if (d.error) { setErr(d.error.message); setL(false); return; } await setDoc(doc(db, "users", d.localId), { name: name.trim(), email, role: "employee", notify: false, notifyEmail: "", fcmToken: null, defaultSchedule: null, setupDone: false, vacationTotal: 20, sickTotal: 5, whateverTotal: 3, vacationUsed: 0, sickUsed: 0, whateverUsed: 0, createdAt: new Date().toISOString() }); onDone(`Přidán: ${name.trim()}`); } catch (e) { setErr(e.message); } setL(false); }} style={{ width: "100%" }}>Přidat</Btn></div>; }
function NoteInput({ onSubmit }) { const [n, setN] = useState(""); return <div><Input value={n} onChange={e => setN(e.target.value)} placeholder="Přijdu o 20 min později" /><Btn warm onClick={() => onSubmit(n)} style={{ width: "100%", marginTop: 4 }}>Uložit poznámku</Btn></div>; }

function VacRangeF({ onSubmit }) {
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [type, setType] = useState("vacation");
  return <div>
    <Sel label="Typ" value={type} onChange={e => setType(e.target.value)} options={[{ value: "vacation", label: "🏖️ Dovolená" }, { value: "sick", label: "🤒 Sick Day" }, { value: "training", label: "📚 Školení" }]} />
    <Input label="Od" type="date" value={from} onChange={e => setFrom(e.target.value)} />
    <Input label="Do" type="date" value={to} onChange={e => setTo(e.target.value)} />
    <Btn warm onClick={() => { if (!from || !to) return; onSubmit(from, to, type); }} style={{ width: "100%", marginTop: 8 }}>Zadat rozsah</Btn>
  </div>;
}

function ChangePassF({ onDone }) {
  const [np, setNp] = useState(""); const [np2, setNp2] = useState(""); const [l, setL] = useState(false); const [err, setErr] = useState("");
  return <div>
    <Input label="Nové heslo (min. 6)" type="password" value={np} onChange={e => setNp(e.target.value)} />
    <Input label="Nové heslo znovu" type="password" value={np2} onChange={e => setNp2(e.target.value)} />
    {err && <p style={{ color: "var(--red)", fontSize: 14, marginBottom: 8, padding: 10, border: "1px solid var(--red)" }}>{err}</p>}
    <Btn warm disabled={l} onClick={async () => {
      setErr(""); if (np.length < 6) return setErr("Min. 6 znaků"); if (np !== np2) return setErr("Hesla se neshodují");
      setL(true); try { await updatePassword(auth.currentUser, np); onDone(); } catch (e) { setErr(e.code === "auth/requires-recent-login" ? "Odhlaste se a přihlaste znovu" : e.message); } setL(false);
    }} style={{ width: "100%", marginTop: 8 }}>Změnit heslo</Btn>
  </div>;
}

function ChangeNotifF({ profile, onDone }) {
  const [email, setEmail] = useState(profile?.notifyEmail || profile?.email || "");
  const [en, setEn] = useState(profile?.notify || false);
  const [l, setL] = useState(false);
  return <div>
    <Toggle checked={en} onChange={setEn} label="Dostávat email notifikace" />
    {en && <Input label="Email pro notifikace" type="email" value={email} onChange={e => setEmail(e.target.value)} />}
    <Btn warm disabled={l} onClick={async () => {
      setL(true); await updateDoc(doc(db, "users", profile.id), { notify: en, notifyEmail: email }); setL(false); onDone();
    }} style={{ width: "100%", marginTop: 8 }}>Uložit</Btn>
  </div>;
}

function ChangeNameF({ profile, onDone }) {
  const [name, setName] = useState(profile?.name || "");
  const [l, setL] = useState(false); const [err, setErr] = useState("");
  return <div>
    <Input label="Celé jméno" value={name} onChange={e => setName(e.target.value)} />
    {err && <p style={{ color: "var(--red)", fontSize: 14, marginBottom: 8, padding: 10, border: "1px solid var(--red)" }}>{err}</p>}
    <Btn warm disabled={l} onClick={async () => {
      setErr(""); if (!name.trim()) return setErr("Jméno nesmí být prázdné");
      setL(true); try { await updateDoc(doc(db, "users", profile.id), { name: name.trim() }); if (auth.currentUser) await updateProfile(auth.currentUser, { displayName: name.trim() }); onDone(); } catch (e) { setErr(e.message); } setL(false);
    }} style={{ width: "100%", marginTop: 8 }}>Uložit jméno</Btn>
  </div>;
}

function DirectSwapF({ targetEmp, dateLabel, dateISO, targetDay, targetShift, onSubmit }) {
  const [comment, setComment] = useState("");
  return <div>
    <div style={{ padding: 16, background: "var(--bg3)", border: "1px solid var(--brd)", marginBottom: 16 }}>
      <div style={{ fontSize: 13, color: "var(--tx3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, fontFamily: "'Barlow Condensed',sans-serif" }}>Požádat o výměnu</div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 40, height: 40, background: "var(--acc2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 600, color: "#fff" }}>{targetEmp.name.charAt(0)}</div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 17, color: "var(--w)" }}>{targetEmp.name}</div>
          <div style={{ fontSize: 14, color: "var(--acc2)", fontFamily: "'IBM Plex Mono',monospace" }}>{dateLabel} · {targetShift}</div>
        </div>
      </div>
    </div>
    <Input label="Komentář (volitelné)" value={comment} onChange={e => setComment(e.target.value)} placeholder="Např. potřebuji ten den volno" />
    <Btn warm onClick={() => onSubmit(comment)} style={{ width: "100%", marginTop: 8 }}>⇄ Odeslat žádost</Btn>
  </div>;
}

/* ═══ MAIN APP ═══ */
// ═══ RANKY za vyřešené problémy (fixCount) ═══
const RANK_TIERS = [1, 20, 30, 45, 60, 80, 100, 130, 160, 200];
const rankOf = n => { let r = 0; for (let i = 0; i < RANK_TIERS.length; i++) if ((n || 0) >= RANK_TIERS[i]) r = i + 1; return r; };
const RankBadge = ({ fixes, size = 20 }) => {
  const r = rankOf(fixes);
  if (!r) return null;
  const next = RANK_TIERS[r] ? ` · další rank od ${RANK_TIERS[r]}` : " · maximální rank";
  return <img src={`/badges/rank${r}.png`} alt={`Rank ${r}`} title={`Rank ${r} · ${fixes} vyřešených problémů${next}`} loading="lazy"
    style={{ width: size, height: size, flexShrink: 0, verticalAlign: "middle", objectFit: "contain" }} />;
};

export default function App() {
  const [authUser, setAuthUser] = useState(undefined); const [profile, setProfile] = useState(null);
  const [view, setView] = useState("schedule"); const [schedView, setSchedView] = useState("day");
  const [employees, setEmployees] = useState([]);
  const [intake, setIntake] = useState({}); const [intakeAllow, setIntakeAllow] = useState({}); const [schedMeta, setSchedMeta] = useState({});
  const [wo, setWo] = useState(0); const [schedule, setSchedule] = useState(null);
  const [absences, setAbsences] = useState({}); const [events, setEvents] = useState({});
  const [swaps, setSwaps] = useState([]); const [selCell, setSelCell] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [allSchedules, setAllSchedules] = useState({}); const [resolveTarget, setResolveTarget] = useState(null);
  const [showPerma, setShowPerma] = useState(false); const [showCompare, setShowCompare] = useState(false);
  const [modal, setModal] = useState(null); const [notifs, setNotifs] = useState([]);
  const [logs, setLogs] = useState([]); const [notes, setNotes] = useState({});
  const [rules, setRules] = useState({ ...RULE_DEFAULTS, allowAllDnD: false });
  const [theme, setTheme] = useState(() => localStorage.getItem("sf_theme") || "light");
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 900);
  const [selDay, setSelDay] = useState(Math.max(0, todayIdx));
  const [slideDir, setSlideDir] = useState('right');
  const viewKey = useRef(0);

  const goDay = i => { setSlideDir(i > selDay ? 'right' : 'left'); setSelDay(i); };
  const switchV = v => { viewKey.current++; setView(v); };

  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); localStorage.setItem("sf_theme", theme); }, [theme]);
  useEffect(() => { const fn = () => setIsMobile(window.innerWidth < 900); window.addEventListener('resize', fn); return () => window.removeEventListener('resize', fn); }, []);

  const cw = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + wo * 7); return d; }, [wo]);
  const wk = wKey(cw); const isA = profile?.role === "admin";
  const ge = id => employees.find(e => e.id === id);
  const ds = useMemo(() => buildDef(employees), [employees]);
  // Merge saved schedule with default schedule for any new employees not yet in saved data
  const cs = useMemo(() => {
    if (!schedule) return ds;
    const merged = dc(schedule);
    employees.forEach(emp => {
      if (!emp.defaultSchedule || !emp.setupDone) return;
      // Check if employee appears anywhere in saved schedule or absences
      const inSchedule = DAYS.some(day => SHIFTS.some(sh => merged[day]?.[sh]?.some(e => e.empId === emp.id)));
      const hasAbsence = Object.keys(absences).some(k => k.startsWith(`${emp.id}__`));
      if (!inSchedule && !hasAbsence) {
        // Add their default schedule
        DAYS.forEach(day => {
          const shift = emp.defaultSchedule[day];
          if (shift && SHIFTS.includes(shift)) {
            if (!merged[day]) merged[day] = {};
            if (!merged[day][shift]) merged[day][shift] = [];
            merged[day][shift].push({ empId: emp.id, ho: emp.defaultSchedule[`${day}_ho`] || false, isDefault: true });
          }
        });
      }
    });
    return merged;
  }, [schedule, ds, employees, absences]);
  const wd = useMemo(() => getWeekDates(wo), [wo]);
  const wh = wd.map(d => HMAP[d] || null);
  // Analýza pravidel nového modelu (jen pracovní dny bez svátku)
  const analysis = useMemo(() => {
    const res = analyzeWeek(cs, absences, employees, rules, intake, intakeAllow);
    const isHol = day => !!wh[DAYS.indexOf(day)];
    return {
      violations: res.violations.filter(v => !v.day || !isHol(v.day)),
      problems: res.problems.filter(p => !isHol(p.day)),
      weeklyHO: res.weeklyHO,
    };
  }, [cs, absences, employees, rules, wh.join("|"), intake, intakeAllow]);

  // ═══ CELOROČNÍ NÁVRHY: problémy napříč všemi týdny ode dneška dál ═══
  const yearProblems = useMemo(() => {
    const todayISO = localISO(new Date());
    const curMon = wKey(new Date());
    const out = [];
    Object.keys(allSchedules).filter(k => k >= curMon).sort().slice(0, 60).forEach(wkKey => {
      const data = allSchedules[wkKey] || {};
      const entries = data.entries || buildDef(employees);
      const abs = data.absences || {};
      const intk = data.intake || {}, intkA = data.intakeAllow || {};
      const monday = new Date(wkKey + "T00:00:00");
      const res = analyzeWeek(entries, abs, employees, rules, intk, intkA);
      res.problems.forEach(p => {
        const di = DAYS.indexOf(p.day); if (di < 0) return;
        const dd = new Date(monday); dd.setDate(monday.getDate() + di);
        const dISO = localISO(dd);
        if (dISO < todayISO || HMAP[dISO]) return; // jen ode dneška, bez svátků
        out.push({ ...p, weekKey: wkKey, dISO, dLabel: dd.toLocaleDateString("cs", { weekday: "short", day: "numeric", month: "numeric" }) });
      });
    });
    return out.sort((a, b) => a.dISO.localeCompare(b.dISO));
  }, [allSchedules, employees, rules]);

  // Přímá aplikace návrhu — transakce znovu ověří, že problém pořád trvá (žádné dvojí řešení)
  const applyProblemFix = async (weekKey, problemKey, alt) => {
    try {
      let status = "";
      await runTransaction(db, async t => {
        const ref = doc(db, "schedules", weekKey);
        const snap = await t.get(ref);
        const data = snap.exists() ? snap.data() : {};
        const entries = data.entries ? dc(data.entries) : dc(buildDef(employees));
        const abs = data.absences || {};
        const intk = data.intake || {}, intkA = data.intakeAllow || {};
        const before = analyzeWeek(entries, abs, employees, rules, intk, intkA);
        if (!before.problems.some(p => p.key === problemKey)) { status = "gone"; return; }
        const trial = dc(entries); applyAlt(trial, alt);
        const after = analyzeWeek(trial, abs, employees, rules, intk, intkA);
        const critB = before.violations.filter(v => v.sev === "crit").length, critA = after.violations.filter(v => v.sev === "crit").length;
        if (after.problems.some(p => p.key === problemKey) || critA > critB) { status = "invalid"; return; }
        t.set(ref, { entries: trial, weekStart: weekKey, modifiedAt: new Date().toISOString(), modifiedBy: profile?.id }, { mergeFields: ["entries", "weekStart", "modifiedAt", "modifiedBy"] });
        status = "ok";
      });
      if (status === "ok") {
        notify("Úprava provedena ✓"); log(`Vyřešeno: ${altLabel(alt, ge)} (${weekKey})`);
        if (alt.empId) updateDoc(doc(db, "users", alt.empId), { fixCount: increment(1) }).catch(() => { });
        const e = ge(alt.empId); if (e && e.id !== profile.id) eN(e, `Úprava tvé směny: ${altLabel(alt, ge)} (${weekKey})`);
      } else if (status === "gone") notify("Tento problém už někdo vyřešil");
      else if (status === "invalid") notify("Rozvrh se mezitím změnil — otevři Návrhy znovu");
    } catch (err) { console.error("applyProblemFix:", err); notify("Nepodařilo se uložit"); }
  };

  // ═══ FÉROVOST: počítadla 8:00 / 10:00 / HO od pevného data (nový model) + hlídač ═══
  const FAIRNESS_START = "2026-07-22"; // počítá se jen od tohoto dne (včetně)
  const FAIR_SPREAD = 3;
  const fairness = useMemo(() => {
    const tally = {};
    const active = employees.filter(e => e.role !== "admin");
    active.forEach(e => tally[e.id] = { eight: 0, ten: 0, ho: 0, deficit: 0, weeks: 0 });
    Object.entries(allSchedules).forEach(([wkKeyStr, data]) => {
      if (!data.entries) return;
      const monday = new Date(wkKeyStr + "T00:00:00");
      const seen = new Set();
      DAYS.forEach((day, i) => {
        const dd = new Date(monday); dd.setDate(monday.getDate() + i);
        if (localISO(dd) < FAIRNESS_START) return; // den před startem se nepočítá
        const present = {}; // empId → entry toho dne (pro výpočet HO deficitu)
        SHIFTS.forEach(sh => (data.entries[day]?.[sh] || []).forEach(en => {
          const t = tally[en.empId]; if (!t) return;
          seen.add(en.empId);
          present[en.empId] = en;
          if (en.ho) t.ho++;
          else if (sh === "08:00") t.eight++;
          else if (sh === "10:00") t.ten++;
        }));
        // Deficit: stálý rozvrh říká HO, ale člověk ten den pracuje z kanceláře (absence se nepočítá)
        active.forEach(e => { if (e.defaultSchedule?.[`${day}_ho`] && present[e.id] && !present[e.id].ho) tally[e.id].deficit++; });
      });
      seen.forEach(id => tally[id] && tally[id].weeks++);
    });
    const rows = active.map(e => ({ id: e.id, name: e.name, fixes: e.fixCount || 0, ...tally[e.id] })).sort((a, b) => b.eight - a.eight);
    const metrics = ["eight", "ten", "ho"];
    const warn = [];
    metrics.forEach(m => {
      const vals = rows.filter(r => r.weeks > 0).map(r => r[m]);
      if (vals.length < 2) return;
      const max = Math.max(...vals), min = Math.min(...vals);
      if (max - min > FAIR_SPREAD) {
        const hi = rows.filter(r => r[m] === max && r.weeks > 0).map(r => r.name);
        const lo = rows.filter(r => r[m] === min && r.weeks > 0).map(r => r.name);
        const label = m === "eight" ? "směn od 8:00" : m === "ten" ? "směn od 10:00" : "dnů HO";
        warn.push({ metric: m, spread: max - min, msg: `Nerovnoměrný počet ${label}: nejvíc ${hi.join(", ")} (${max}), nejmíň ${lo.join(", ")} (${min})` });
      }
    });
    return { rows, warn };
  }, [allSchedules, employees]);

  useEffect(() => { const u = onAuthStateChanged(auth, async u => { if (u) { setAuthUser(u); const s = await getDoc(doc(db, "users", u.uid)); if (s.exists()) setProfile({ id: u.uid, ...s.data() }); else setProfile({ id: u.uid, name: u.displayName || u.email, role: "employee", setupDone: false }); initPush(u.uid); } else { setAuthUser(null); setProfile(null); } }); return u; }, []);
  useEffect(() => { const u = onSnapshot(collection(db, "users"), s => { const e = s.docs.map(d => ({ id: d.id, ...d.data() })); setEmployees(e); if (profile) { const m = e.find(x => x.id === profile.id); if (m) setProfile(p => ({ ...p, ...m })); } }); return u; }, [profile?.id]);
  useEffect(() => { const u = onSnapshot(doc(db, "schedules", wk), s => { if (s.exists()) { const d = s.data(); setSchedule(d.entries || null); setAbsences(d.absences || {}); setEvents(d.events || {}); setNotes(d.notes || {}); setIntake(d.intake || {}); setIntakeAllow(d.intakeAllow || {}); setSchedMeta({ at: d.modifiedAt, by: d.modifiedBy }); } else { setSchedule(null); setAbsences({}); setEvents({}); setNotes({}); setIntake({}); setIntakeAllow({}); setSchedMeta({}); } }); return u; }, [wk]);

  // Auto-sync GCal when ANY week's schedule changes affecting current user
  // Listens to schedules collection and syncs the affected week if user has events there
  const lastSyncRef = useRef({});
  useEffect(() => {
    if (!profile?.gcalEnabled || !profile?.id) return;
    const u = onSnapshot(collection(db, "schedules"), s => {
      s.docChanges().forEach(change => {
        if (change.type !== "modified" && change.type !== "added") return;
        const data = change.doc.data();
        const weekId = change.doc.id;
        // Skip if our own change (avoid loop) or modified by us recently
        const userInvolved = (data.entries && Object.values(data.entries).some(day => Object.values(day).some(arr => arr.some(e => e.empId === profile.id)))) ||
          (data.absences && Object.keys(data.absences).some(k => k.startsWith(`${profile.id}__`)));
        if (!userInvolved) return;
        // Throttle: max once per 10s per week
        const now = Date.now();
        if (lastSyncRef.current[weekId] && now - lastSyncRef.current[weekId] < 10000) return;
        lastSyncRef.current[weekId] = now;
        // Only sync if token is available — silent
        if (!getGcalToken()) return;
        const weekDates = weekDatesFromMonday(weekId);
        setTimeout(() => {
          syncWeekToGCal(profile.id, weekDates, data.entries || {}, employees, data.absences || {}).catch(() => { });
        }, 2000);
      });
    });
    return u;
  }, [profile?.id, profile?.gcalEnabled, employees]);
  useEffect(() => { const u = onSnapshot(collection(db, "swapRequests"), s => setSwaps(s.docs.map(d => ({ id: d.id, ...d.data() })))); return u; }, []);
  useEffect(() => { const u = onSnapshot(collection(db, "changeProposals"), s => setProposals(s.docs.map(d => ({ id: d.id, ...d.data() })))); return u; }, []);
  // Všechny rozvrhy pro férovostní počítadla (malý tým → pár desítek dokumentů)
  useEffect(() => { const u = onSnapshot(collection(db, "schedules"), s => { const m = {}; s.docs.forEach(d => m[d.id] = d.data()); setAllSchedules(m); }); return u; }, []);
  useEffect(() => { const u = onSnapshot(doc(db, "rules", "global"), s => { if (s.exists()) setRules(s.data()); }); return u; }, []);
  useEffect(() => { const u = onSnapshot(collection(db, "auditLog"), s => { const a = s.docs.map(d => ({ id: d.id, ...d.data() })); a.sort((a, b) => (b.time || "").localeCompare(a.time || "")); setLogs(a.slice(0, 100)); }); return u; }, []);

  const notify = msg => { const n = { id: uid(), msg, time: new Date().toLocaleTimeString("cs") }; setNotifs(p => [n, ...p]); setTimeout(() => setNotifs(p => p.filter(x => x.id !== n.id)), 5000); };
  const hardSync = async () => {
    notify("Synchronizuji…");
    try {
      if ("caches" in window) { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); }
      if (navigator.serviceWorker) { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); }
    } catch { }
    // cache-busting reload
    const u = new URL(window.location.href); u.searchParams.set("_sync", Date.now()); window.location.replace(u.toString());
  };
  const log = async msg => { try { await addDoc(collection(db, "auditLog"), { msg, time: new Date().toISOString(), week: wk, userId: profile?.id }); } catch { } };

  /* ═══ TRANSAKČNÍ ZÁPIS — čte čerstvá data uvnitř transakce, aplikuje jen svou změnu.
     Tím se dva souběžné zásahy nepřepíšou (konec lost-update). ═══ */
  const txSchedule = (mutate, weekKey = wk) => {
    const ref = doc(db, "schedules", weekKey);
    return runTransaction(db, async t => {
      const snap = await t.get(ref);
      const data = snap.exists() ? snap.data() : {};
      const entries = data.entries ? dc(data.entries) : dc(buildDef(employees));
      const absences = data.absences ? { ...data.absences } : {};
      const res = mutate({ entries, absences }) || {};
      const payload = { entries: res.entries || entries, weekStart: weekKey, modifiedAt: new Date().toISOString(), modifiedBy: profile?.id };
      const fields = ["entries", "weekStart", "modifiedAt", "modifiedBy"];
      if (res.absences) { payload.absences = res.absences; fields.push("absences"); }
      // mergeFields: vyjmenovaná pole se NAHRADÍ celá (smazané klíče absencí opravdu zmizí),
      // nevyjmenovaná (intake, intakeAllow, events, notes) zůstávají nedotčená.
      t.set(ref, payload, { mergeFields: fields });
    });
  };
  // Optimistické zobrazení pro autora + autoritativní transakce; onSnapshot pak sladí všechny
  const editSchedule = (mutate, msg) => {
    const opt = mutate({ entries: dc(cs), absences: { ...absences } }) || {};
    if (opt.entries) setSchedule(opt.entries);
    if (opt.absences) setAbsences(opt.absences);
    txSchedule(mutate)
      .then(() => { if (msg) notify(msg); if (profile?.gcalEnabled && getGcalToken()) setTimeout(() => syncWeekToGCal(profile.id, wd, opt.entries || cs, employees, opt.absences || absences).catch(() => {}), 1500); })
      .catch(err => { console.error("editSchedule:", err); notify("Změna se neuložila — zkuste to znovu"); });
  };
  const eN = (emp, msg) => { if (emp?.notify) callGAS("sendEmail", { to: emp.notifyEmail || emp.email, employeeName: emp.name, changeDescription: msg, weekLabel: fmtW(cw) }); };

  // D&D: admin can move anyone, employee can move self within own team
  const canDrag = eid => isA || eid === profile?.id || rules?.allowAllDnD === true;
  const handleDrop = (targetDay, targetShift, e) => {
    e.preventDefault(); e.currentTarget.classList.remove("over");
    try {
      const d = JSON.parse(e.dataTransfer.getData("text/plain"));
      if (d.day === targetDay && d.shift === targetShift) return;
      // Permission: admin OR self OR global flag (jeden tým — bez týmového omezení)
      const allowedAll = rules?.allowAllDnD === true;
      if (!isA && !allowedAll && d.empId !== profile?.id) return;
      editSchedule(({ entries: s }) => {
        const f = s[d.day]?.[d.shift]; if (!f) return {};
        const i = f.findIndex(x => x.empId === d.empId); if (i === -1) return {};
        const [en] = f.splice(i, 1); en.isDefault = false;
        if (!s[targetDay]) s[targetDay] = {}; if (!s[targetDay][targetShift]) s[targetDay][targetShift] = [];
        s[targetDay][targetShift].push(en); return { entries: s };
      }, `Přesun: ${ge(d.empId)?.name}`);
    } catch { }
  };

  const moveE = (eid, fd, fs, td, ts) => editSchedule(({ entries: s }) => {
    const f = s[fd]?.[fs]; if (!f) return {};
    const i = f.findIndex(e => e.empId === eid); if (i === -1) return {};
    const [en] = f.splice(i, 1); en.isDefault = false;
    if (!s[td]) s[td] = {}; if (!s[td][ts]) s[td][ts] = []; s[td][ts].push(en); return { entries: s };
  }, `Přesun: ${ge(eid)?.name}`);
  const togHO = (day, sh, eid) => editSchedule(({ entries: s }) => {
    const en = s[day]?.[sh]?.find(e => e.empId === eid); if (en) { en.ho = !en.ho; en.isDefault = false; } return { entries: s };
  }, "HO přepnuto");

  // ABSENCE: transakční zápis (řeší souběh) + increment počítadla
  const addAbs = async (eid, day, type) => {
    if (!isA && eid !== profile.id) return;
    const absKey = fsKey(eid, day);
    const emp = ge(eid);
    try {
      await txSchedule(({ entries: s, absences: a }) => {
        SHIFTS.forEach(sh => { if (s[day]?.[sh]) s[day][sh] = s[day][sh].filter(e => e.empId !== eid); });
        return { entries: s, absences: { ...a, [absKey]: type } };
      });
      // optimistické lokální sladění
      setAbsences(prev => ({ ...prev, [absKey]: type }));
      if (emp && !["doctor", "training", "half_ho"].includes(type)) {
        const f = type === "sick" ? "sickUsed" : type === "vacation" || type === "half_vacation" ? "vacationUsed" : type === "whatever" ? "whateverUsed" : null;
        if (f) await updateDoc(doc(db, "users", eid), { [f]: increment(type.startsWith("half_") ? 0.5 : 1) });
      }
      const al = ABS.find(a => a.id === type)?.label;
      notify(`${emp?.name}: ${al}`); log(`${emp?.name}: ${al} ${day}`);
      if (profile?.gcalEnabled && getGcalToken() && eid === profile.id) {
        setTimeout(() => syncWeekToGCal(profile.id, wd, cs, employees, { ...absences, [absKey]: type }).catch(() => {}), 1500);
      }
    } catch (err) { console.error("addAbs:", err); notify("Chyba: " + err.message); }
  };

  // Absence for a date range (vacation etc)
  const addAbsRange = async (fromISO, toISO, type) => {
    const eid = profile.id;
    let current = new Date(fromISO + "T00:00:00");
    const end = new Date(toISO + "T00:00:00");
    let count = 0;
    while (current <= end) {
      const dow = current.getDay();
      if (dow >= 1 && dow <= 5) { // skip weekends
        const dayName = DAYS[dow - 1];
        const weekStart = wKey(current);
        const ak = fsKey(eid, dayName);
        await txSchedule(({ entries: s, absences: a }) => {
          SHIFTS.forEach(sh => { if (s[dayName]?.[sh]) s[dayName][sh] = s[dayName][sh].filter(e => e.empId !== eid); });
          return { entries: s, absences: { ...a, [ak]: type } };
        }, weekStart);
        if (weekStart === wk) setAbsences(prev => ({ ...prev, [ak]: type }));
        count++;
      }
      current.setDate(current.getDate() + 1);
    }
    // Update day counter
    const emp = ge(eid);
    if (emp && !["doctor", "training"].includes(type)) {
      const f = type === "sick" ? "sickUsed" : type === "vacation" ? "vacationUsed" : type === "whatever" ? "whateverUsed" : null;
      if (f) await updateDoc(doc(db, "users", eid), { [f]: increment(count) });
    }
    notify(`${ABS.find(a => a.id === type)?.label}: ${count} dní zadáno`);
    log(`Rozsah: ${type} ${fromISO} — ${toISO}`);
  };

  const removeAbs = async (eid, day) => {
    const k = fsKey(eid, day);
    const emp = ge(eid);
    const prevType = absences[k];
    try {
      await txSchedule(({ entries: s, absences: a }) => {
        SHIFTS.forEach(sh => { if (s[day]?.[sh]) s[day][sh] = s[day][sh].filter(e => e.empId !== eid); });
        if (emp?.defaultSchedule?.[day]) {
          const shift = emp.defaultSchedule[day];
          if (SHIFTS.includes(shift)) { if (!s[day]) s[day] = {}; if (!s[day][shift]) s[day][shift] = []; s[day][shift].push({ empId: eid, ho: emp.defaultSchedule[`${day}_ho`] || false, isDefault: true }); }
        }
        const na = { ...a }; delete na[k];
        return { entries: s, absences: na };
      });
      setAbsences(prev => { const n = { ...prev }; delete n[k]; return n; });
      // refundace počítadla (dřív se nevracelo)
      if (emp && prevType && !["doctor", "training", "half_ho"].includes(prevType)) {
        const f = prevType === "sick" ? "sickUsed" : prevType === "vacation" || prevType === "half_vacation" ? "vacationUsed" : prevType === "whatever" ? "whateverUsed" : null;
        if (f) await updateDoc(doc(db, "users", eid), { [f]: increment(prevType.startsWith("half_") ? -0.5 : -1) });
      }
      notify("Nepřítomnost odebrána, směna obnovena");
      if (profile?.gcalEnabled && getGcalToken() && eid === profile.id) {
        setTimeout(() => syncWeekToGCal(profile.id, wd, cs, employees, absences).catch(() => {}), 1500);
      }
    } catch (err) { console.error("removeAbs:", err); notify("Chyba"); }
  };

  const saveNote = async (eid, day, shift, note) => {
    const key = fsKey(eid, day, shift.replace(":", ""));
    const newNotes = { ...notes, [key]: note };
    setNotes(newNotes);
    try {
      await setDoc(doc(db, "schedules", wk), { notes: newNotes }, { merge: true });
      notify("Poznámka uložena");
    } catch (err) { console.error("saveNote:", err); notify("Chyba poznámky"); }
  };

  const addEv = async (day, et, note) => { await setDoc(doc(db, "schedules", wk), { [`events.${day}`]: { type: et, note, title: EVTS.find(e => e.id === et)?.label } }, { merge: true }); notify("Událost přidána"); };
  const mkSwap = async (rid, dateISO, sh, comment) => {
    // Compute correct week and day from picked date
    const date = new Date(dateISO + "T00:00:00");
    const dow = date.getDay();
    if (dow === 0 || dow === 6) { notify("Víkend nelze"); return; }
    const day = DAYS[dow - 1];
    const swWk = wKey(date);
    await addDoc(collection(db, "swapRequests"), { rid, day, sh, week: swWk, dateISO, status: "open", comment: comment || "", created: new Date().toISOString() });
    // Notify same-team members
    const requester = ge(rid);
    if (requester) {
      const teamMembers = employees.filter(e => e.id !== rid && e.role !== "admin" && e.notify);
      const msg = `${requester.name} žádá o výměnu: ${day} ${dateISO} ${sh}${comment ? ` — "${comment}"` : ""}`;
      teamMembers.forEach(m => callGAS("sendEmail", { to: m.notifyEmail || m.email, employeeName: m.name, changeDescription: msg, weekLabel: dateISO }));
    }
    notify("Žádost odeslána");
  };

  const doSwap = async (swId, aid) => {
    const sw = swaps.find(s => s.id === swId);
    if (!sw) { console.error("[SWAP] Žádost nenalezena", swId); notify("Žádost nenalezena"); return; }
    console.log("[SWAP] Start:", { swapId: swId, week: sw.week, day: sw.day, shift: sw.sh, requesterId: sw.rid, acceptorId: aid, currentViewWeek: wk });
    try {
      let weekSched, weekAbs;
      if (sw.week === wk) {
        weekSched = dc(cs); weekAbs = absences;
        console.log("[SWAP] Using current view schedule");
      } else {
        console.log("[SWAP] Loading schedule from Firestore for week:", sw.week);
        const snap = await getDoc(doc(db, "schedules", sw.week));
        if (snap.exists()) {
          const d = snap.data();
          weekSched = d.entries ? dc(d.entries) : dc(buildDef(employees));
          weekAbs = d.absences || {};
          console.log("[SWAP] Loaded existing doc, has entries:", !!d.entries);
        } else {
          weekSched = dc(buildDef(employees));
          weekAbs = {};
          console.log("[SWAP] Doc doesnt exist, using buildDef");
        }
      }
      // Print who's where on requested day
      const dayState = {};
      SHIFTS.forEach(sh => { dayState[sh] = (weekSched[sw.day]?.[sh] || []).map(e => e.empId); });
      console.log("[SWAP] Day state for", sw.day, ":", dayState);

      let aSh = null;
      SHIFTS.forEach(sh => { if (!aSh && weekSched[sw.day]?.[sh]?.some(e => e.empId === aid)) aSh = sh; });
      console.log("[SWAP] Acceptor shift on this day:", aSh || "(none)");

      const reqShiftEntries = weekSched[sw.day]?.[sw.sh] || [];
      const re = reqShiftEntries.find(e => e.empId === sw.rid);
      console.log("[SWAP] Requester in expected shift:", !!re);

      if (!re) {
        console.warn("[SWAP] Requester not in expected shift - cancelling");
        notify("Žadatel již není v této směně");
        await updateDoc(doc(db, 'swapRequests', swId), { status: 'cancelled', reason: 'requester not in shift', resolvedAt: new Date().toISOString() });
        return;
      }
      if (aSh && aSh !== sw.sh) {
        console.log("[SWAP] Performing swap between shifts:", aSh, "<->", sw.sh);
        const ae = weekSched[sw.day][aSh].find(e => e.empId === aid);
        weekSched[sw.day][sw.sh] = weekSched[sw.day][sw.sh].filter(e => e.empId !== sw.rid);
        weekSched[sw.day][aSh] = weekSched[sw.day][aSh].filter(e => e.empId !== aid);
        weekSched[sw.day][sw.sh].push({ ...ae, empId: aid, isDefault: false });
        weekSched[sw.day][aSh].push({ ...re, empId: sw.rid, isDefault: false });
      } else if (aSh === sw.sh) {
        console.warn("[SWAP] Both already on same shift");
        notify("Jste již na stejné směně");
        return;
      } else {
        console.log("[SWAP] Acceptor has no shift this day, taking requester's place");
        weekSched[sw.day][sw.sh] = weekSched[sw.day][sw.sh].filter(e => e.empId !== sw.rid);
        weekSched[sw.day][sw.sh].push({ empId: aid, ho: re.ho || false, isDefault: false });
      }
      console.log("[SWAP] Writing to Firestore week:", sw.week);
      await setDoc(doc(db, "schedules", sw.week), { entries: weekSched, weekStart: sw.week, modifiedAt: new Date().toISOString(), modifiedBy: profile?.id }, { merge: true });
      console.log("[SWAP] Schedule write OK");
      if (sw.week === wk) setSchedule(weekSched);
      await updateDoc(doc(db, 'swapRequests', swId), { status: 'done', aid, resolvedAt: new Date().toISOString() });
      console.log("[SWAP] Request marked done");
      const reqEmp = ge(sw.rid); const accEmp = ge(aid);
      const msg = `Výměna: ${reqEmp?.name} ↔ ${accEmp?.name} (${sw.day} ${sw.sh})`;
      notify('Výměna OK ✓'); log(msg);
      [reqEmp, accEmp].forEach(e => { if (e?.notify) callGAS("sendEmail", { to: e.notifyEmail || e.email, employeeName: e.name, changeDescription: msg, weekLabel: sw.dateISO || sw.week }); });
    } catch (err) {
      console.error("[SWAP] FAILED:", err);
      notify('Chyba výměny: ' + err.message);
    }
  };
  const delUser = async eid => { if (!confirm(`Smazat ${ge(eid)?.name}?`)) return; await deleteDoc(doc(db, "users", eid)); notify("Smazán"); };

  /* ═══ NÁVRHY ZMĚN (admin + dotčení) ═══ */
  const createProposal = async (alt, why, extraConsents = {}) => {
    const label = altLabel(alt, ge);
    await addDoc(collection(db, "changeProposals"), {
      week: wk, alt, label, why: why || "", affected: [alt.empId],
      consents: { ...(isA ? { admin: true } : {}), ...extraConsents },
      status: "open", created: new Date().toISOString(), createdBy: profile.id,
    });
    const emp = ge(alt.empId);
    if (emp && emp.id !== profile.id) eN(emp, `Nový návrh ke schválení: ${label}${why ? ` (${why})` : ""}`);
    notify("Návrh odeslán ke schválení"); log(`Návrh: ${label}`);
  };

  const applyProposal = async p => {
    let entries, weekAbs;
    if (p.week === wk) { entries = dc(cs); weekAbs = absences; }
    else {
      const snap = await getDoc(doc(db, "schedules", p.week));
      const d = snap.exists() ? snap.data() : {};
      entries = d.entries ? dc(d.entries) : dc(buildDef(employees));
      weekAbs = d.absences || {};
    }
    applyAlt(entries, p.alt);
    await setDoc(doc(db, "schedules", p.week), { entries, weekStart: p.week, modifiedAt: new Date().toISOString(), modifiedBy: profile?.id }, { merge: true });
    if (p.week === wk) setSchedule(entries);
    await updateDoc(doc(db, "changeProposals", p.id), { status: "done", resolvedAt: new Date().toISOString() });
    notify("Změna provedena ✓"); log(`Schváleno: ${p.label}`);
    p.affected.forEach(eid => { const e = ge(eid); if (e) eN(e, `Schválená změna rozvrhu: ${p.label}`); });
  };

  const consentProposal = async p => {
    const who = isA ? "admin" : profile.id;
    if (who !== "admin" && !p.affected.includes(profile.id)) return;
    const consents = { ...(p.consents || {}), [who]: true };
    const required = ["admin", ...p.affected];
    const complete = required.every(r => consents[r]);
    await updateDoc(doc(db, "changeProposals", p.id), { [`consents.${who}`]: true });
    if (complete) await applyProposal({ ...p, consents });
    else notify("Souhlas zaznamenán");
  };

  const rejectProposal = async p => {
    if (!isA && !p.affected.includes(profile.id)) return;
    await updateDoc(doc(db, "changeProposals", p.id), { status: "rejected", rejectedBy: profile.id, resolvedAt: new Date().toISOString() });
    notify("Návrh zamítnut"); log(`Zamítnuto: ${p.label}`);
  };

  // Žádost zaměstnance o (zrušení) HO — validace proti pravidlům, pak návrh adminovi
  const requestHO = async (day, grant) => {
    const alt = { kind: grant ? "grantHO" : "dropHO", empId: profile.id, day };
    if (grant) {
      if (intake[day] && !(intakeAllow[day] || []).includes(profile.id)) { notify(`${day} je den Nástupů — HO jen s výjimkou od admina`); return; }
      if ((analysis.weeklyHO[profile.id] || 0) >= (rules.hoPerWeek ?? 2)) { notify(`Strop ${rules.hoPerWeek ?? 2}× HO týdně je vyčerpán`); return; }
      const sim = applyAlt(dc(cs), alt);
      const res = analyzeWeek(sim, absences, employees, rules, intake, intakeAllow);
      const crit = res.violations.find(v => v.sev === "crit" && v.day === day);
      if (crit) { notify(`Nelze: ${crit.msg}`); return; }
      if (res.violations.some(v => v.sev === "warn" && v.day === day && v.msg.includes("na HO"))) { notify(`Nelze: ${day} je HO kapacita plná`); return; }
    }
    await createProposal(alt, grant ? "žádost o home office" : "žádost o zrušení home office", { [profile.id]: true });
  };

  // ═══ NÁSTUPY (admin) ═══
  const toggleIntake = async day => {
    const on = !intake[day];
    setIntake(p => ({ ...p, [day]: on })); // optimistické
    try {
      await runTransaction(db, async t => {
        const ref = doc(db, "schedules", wk); const snap = await t.get(ref);
        const cur = (snap.exists() && snap.data().intake) || {};
        t.set(ref, { intake: { ...cur, [day]: on }, weekStart: wk, modifiedAt: new Date().toISOString(), modifiedBy: profile?.id }, { merge: true });
      });
      notify(on ? `${day} označen jako Nástupy` : `${day} už není Nástupy`); log(`Nástupy ${day}: ${on ? "zapnuto" : "vypnuto"}`);
    } catch (e) { setIntake(p => ({ ...p, [day]: !on })); notify("Nepodařilo se uložit"); }
  };
  const allowIntakeException = async (day, eid) => {
    if ((intakeAllow[day] || []).includes(eid)) return;
    setIntakeAllow(p => ({ ...p, [day]: [...(p[day] || []), eid] }));
    try {
      await runTransaction(db, async t => {
        const ref = doc(db, "schedules", wk); const snap = await t.get(ref);
        const cur = (snap.exists() && snap.data().intakeAllow) || {};
        const list = cur[day] || [];
        if (!list.includes(eid)) t.set(ref, { intakeAllow: { ...cur, [day]: [...list, eid] }, weekStart: wk, modifiedAt: new Date().toISOString() }, { merge: true });
      });
      notify(`Výjimka pro ${ge(eid)?.name} v ${day}`); log(`Nástupy výjimka: ${ge(eid)?.name} ${day}`);
    } catch (e) { notify("Nepodařilo se uložit"); }
  };

  // Předvyplnění rozvrhu dle preferencí — napasuje PRESET na uživatele podle jména
  const applyPreset = async () => {
    if (!confirm("Předvyplnit výchozí rozvrh dle preferencí členů? Přepíše stávající výchozí rozvrhy (týdenní rozpisy zůstanou).")) return;
    let n = 0, miss = [], renamed = [];
    for (const emp of employees.filter(e => e.role !== "admin")) {
      let name = emp.name;
      if (RENAME[name]) { const nn = RENAME[name]; await updateDoc(doc(db, "users", emp.id), { name: nn }); renamed.push(`${name}→${nn}`); name = nn; }
      const ds = PRESET[name];
      if (!ds) { miss.push(name); continue; }
      await updateDoc(doc(db, "users", emp.id), { defaultSchedule: ds, setupDone: true });
      n++;
    }
    notify(`Předvyplněno pro ${n} lidí${renamed.length ? ` · přejmenováno: ${renamed.join(", ")}` : ""}${miss.length ? ` (bez předvolby: ${miss.join(", ")})` : ""}`);
    log(`Rozvrh předvyplněn dle preferencí (${n})${renamed.length ? `, přejmenováno ${renamed.join(", ")}` : ""}`);
    // Už rozepsané týdny by jinak zůstaly na staré verzi (a nesedělo by nic, co z nich čte — např. Google Kalendář)
    if (n > 0 && confirm("Přepsat novým stálým rozvrhem i už rozepsané týdny (52 týdnů dopředu)? Absence zůstanou zachované. Doporučeno — jinak budoucí týdny zůstanou podle staré verze.")) {
      await applyDefaultYear(true);
    }
  };

  // Aplikace stálého rozvrhu na týden — přepíše entries, ale zachová absence (vyřadí nepřítomné)
  const applyDefaultToWeek = (weekKey = wk) => txSchedule(({ absences }) => {
    const def = buildDef(employees);
    Object.keys(absences || {}).forEach(k => { const parts = k.split("__"); const day = parts[parts.length - 1]; const eid = parts.slice(0, -1).join("__"); SHIFTS.forEach(sh => { if (def[day]?.[sh]) def[day][sh] = def[day][sh].filter(e => e.empId !== eid); }); });
    return { entries: def };
  }, weekKey);
  const applyDefaultCurrentWeek = async () => {
    if (!confirm(`Aplikovat stálý rozvrh na týden ${fmtW(cw)}? Přepíše ruční úpravy tohoto týdne (absence zůstanou zohledněné).`)) return;
    await applyDefaultToWeek(wk); notify("Stálý rozvrh aplikován na týden"); log(`Stálý rozvrh → ${wk}`);
  };
  const applyDefaultYear = async (skipConfirm = false) => {
    if (!skipConfirm && !confirm("Aplikovat stálý rozvrh na příštích 52 týdnů od zobrazeného? Přepíše rozvrhy těchto týdnů. Může chvíli trvat.")) return;
    const start = new Date(wk + "T00:00:00"); let done = 0;
    for (let i = 0; i < 52; i++) { const d = new Date(start); d.setDate(d.getDate() + i * 7); await applyDefaultToWeek(wKey(d)); done++; if (i % 10 === 0) notify(`Aplikuji… ${done}/52`); }
    notify(`Stálý rozvrh aplikován na ${done} týdnů`); log(`Stálý rozvrh → 52 týdnů od ${wk}`);
  };
  const exportCSV = () => { let csv = "\ufeffDen,Směna,Jméno,HO\n"; DAYS.forEach(d => SHIFTS.forEach(sh => (cs[d]?.[sh] || []).forEach(en => { const e = ge(en.empId); if (e) csv += `${d},${sh},${e.name},${en.ho ? "Ano" : "Ne"}\n`; }))); const b = new Blob([csv], { type: "text/csv;charset=utf-8;" }); const u = URL.createObjectURL(b); Object.assign(document.createElement("a"), { href: u, download: `rozvrh_${wk}.csv` }).click(); };

  if (authUser === undefined) return <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}><style>{CSS}</style><div style={{ color: "var(--tx3)", fontSize: 14, letterSpacing: 4, fontFamily: "'Barlow Condensed',sans-serif", animation: "pulse 1.5s infinite" }}>SHIFTFLOW</div></div>;
  if (!authUser) return <AuthScreen />;
  if (!profile) return <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--tx3)" }}><style>{CSS}</style>Načítání…</div>;
  if (!isA && !profile.setupDone) return <Setup profile={profile} onDone={() => setProfile(p => ({ ...p, setupDone: true }))} />;

  const openSw = swaps.filter(s => s.status === "open").sort((a, b) => (a.dateISO || a.week || "").localeCompare(b.dateISO || b.week || ""));
  const openProps = proposals.filter(p => p.status === "open").sort((a, b) => (a.created || "").localeCompare(b.created || ""));
  const visibleProps = openProps.filter(p => isA || p.affected?.includes(profile.id));
  const myPendingProps = openProps.filter(p => isA ? !p.consents?.admin : (p.affected?.includes(profile.id) && !p.consents?.[profile.id]));
  const probBadge = isA ? yearProblems.length : yearProblems.filter(pr => pr.alts.some(a => a.empId === profile.id)).length;
  const NAV = [{ id: "schedule", l: "Rozvrh", ic: "▦", b: 0 }, { id: "proposals", l: "Návrhy", ic: "⚑", b: myPendingProps.length + probBadge }, { id: "swaps", l: "Výměny", ic: "⇄", b: openSw.length }, ...(isA ? [{ id: "people", l: "Tým", ic: "◉", b: 0 }] : []), { id: "stats", l: "Stats", ic: "◫", b: 0 }, { id: "log", l: "Log", ic: "≡", b: 0 }, ...(isA ? [{ id: "defaults", l: "Stálý rozvrh", ic: "✎", b: 0 }] : []), { id: "settings", l: "Nastavení", ic: "⚙", b: 0 }];
  const dayHol = wh[selDay];
  const getEntries = (day, shift) => (cs[day]?.[shift] || []).filter(e => ge(e.empId));
  const getDayAbs = day => Object.entries(absences).filter(([k]) => k.endsWith(`__${day}`)).map(([k, t]) => ({ empId: k.split("__")[0], type: t })).filter(a => ge(a.empId));

  // Shift card renderer (reused in day + week views)
  const ShiftCard = ({ day, shift }) => {
    const entries = getEntries(day, shift);
    return <div className="gl dz" style={{ padding: 0 }}
      onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("over"); }}
      onDragLeave={e => e.currentTarget.classList.remove("over")}
      onDrop={e => handleDrop(day, shift, e)}>
      {entries.map((en, idx) => { const emp = ge(en.empId); if (!emp) return null; const nk = fsKey(en.empId, day, shift.replace(":", "")); const note = notes[nk]; const isMe = en.empId === profile.id;
        return <div key={en.empId} className="ent" draggable={canDrag(en.empId)}
          onDragStart={e => e.dataTransfer.setData("text/plain", JSON.stringify({ empId: en.empId, day, shift }))}
          onClick={() => isA ? setSelCell({ day, shift, empId: en.empId }) : isMe && setModal({ type: "myshift", day, shift })}
          style={{ gap: 10, padding: "12px 14px", borderBottom: idx < entries.length - 1 ? "1px solid var(--brd)" : "none" }}>
          <div style={{ width: 3, height: 24, background: en.ho ? "var(--grn)" : "var(--acc2)" }} />
          <span style={{ fontWeight: 500, color: "var(--w)", flex: 1, display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{emp.name}</span><RankBadge fixes={emp.fixCount} /></span>
          {!isA && !isMe && <button title={`Požádat ${emp.name} o výměnu`} onClick={e => { e.stopPropagation(); setModal({ type: "directSwap", targetEmp: emp, targetDay: day, targetShift: shift }); }} style={{ background: "none", border: "1px solid var(--acc2)", color: "var(--acc2)", width: 26, height: 26, cursor: "pointer", fontSize: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontFamily: "'IBM Plex Mono',monospace" }}>⇄</button>}
          {note && <span title={note} style={{ color: "var(--acc2)", cursor: "help", fontSize: 15, fontWeight: 700, border: "1px solid var(--acc2)", width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>i</span>}
          {en.ho && <Badge small color="var(--grn)">HO</Badge>}
        </div>; })}
      {entries.length === 0 && <div style={{ padding: "14px", color: "var(--tx3)", fontSize: 14 }}>—</div>}
    </div>;
  };

  return <div style={{ minHeight: "100vh", fontFamily: "'Barlow',sans-serif", color: "var(--tx)", display: "flex" }} data-theme={theme}>
    <style>{CSS}</style>
    <ParallaxBg />

    {/* TOASTS */}
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999, padding: "8px 12px" }}>{notifs.map(n => <div key={n.id} className="gl" style={{ padding: "14px 16px", fontSize: 15, color: "var(--acc2)", display: "flex", gap: 10, alignItems: "center", marginBottom: 6, animation: "st .3s" }}><span style={{ flex: 1 }}>{n.msg}</span></div>)}</div>

    {/* SIDEBAR (desktop) */}
    {!isMobile && <SideNav view={view} setView={switchV} NAV={NAV} theme={theme} setTheme={setTheme} />}

    {/* MAIN */}
    <div style={{ flex: 1, marginLeft: isMobile ? 0 : 200, paddingBottom: isMobile ? 80 : 20, position: "relative", zIndex: 1 }}>
      <header className="pg" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--bt)" }}>
        <div style={{ fontSize: 14, color: "var(--tx2)", fontFamily: "'Barlow Condensed',sans-serif" }}>{profile.name} · <Badge small color={isA ? "var(--amb)" : "var(--acc)"}>{isA ? "ADM" : "CREW"}</Badge></div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={hardSync} title="Sync — načíst čerstvý stav" style={{ background: "none", border: "1px solid var(--brd2)", color: "var(--acc2)", width: 38, height: 38, cursor: "pointer", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center" }}>⟳</button>
          {isMobile && <button onClick={() => setTheme(t => t === "light" ? "dark" : "light")} style={{ background: "none", border: "1px solid var(--brd2)", width: 38, height: 38, cursor: "pointer", color: "var(--tx2)", fontSize: 14 }}>{theme === "light" ? "●" : "○"}</button>}
          <button onClick={() => signOut(auth)} style={{ background: "none", border: "1px solid var(--brd2)", color: "var(--tx3)", width: 38, height: 38, cursor: "pointer", fontSize: 13 }}>↪</button>
        </div>
      </header>

      <main style={{ padding: 16, maxWidth: 1000, margin: "0 auto" }}>
        <div key={viewKey.current} className="avi">

          {/* ═══ SCHEDULE ═══ */}
          {view === "schedule" && <div>
            {/* Week nav */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
              <button onClick={() => setWo(w => w - 1)} aria-label="Předchozí týden" style={{ width: 44, height: 44, border: "1px solid var(--brd2)", background: "transparent", color: "var(--tx)", cursor: "pointer", fontSize: 22, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>‹</button>
              <div style={{ textAlign: "center", minWidth: 190 }}>
                <div style={{ fontSize: 18, fontWeight: 500, color: "var(--w)", fontFamily: "'IBM Plex Mono',monospace" }}>{fmtW(cw)}</div>
                <div style={{ fontSize: 12, color: wo === 0 ? "var(--acc2)" : "var(--tx3)", textTransform: "uppercase", letterSpacing: 1 }}>{wo === 0 ? "Aktuální týden" : `${wo > 0 ? "+" : ""}${wo} týd.`}</div>
              </div>
              <button onClick={() => setWo(w => w + 1)} aria-label="Další týden" style={{ width: 44, height: 44, border: "1px solid var(--brd2)", background: "transparent", color: "var(--tx)", cursor: "pointer", fontSize: 22, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>›</button>
              <label style={{ position: "relative", width: 44, height: 44, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--brd2)", cursor: "pointer", color: "var(--tx)" }} title="Přejít na datum">
                <span style={{ fontSize: 18, pointerEvents: "none" }}>📅</span>
                <input type="date" aria-label="Přejít na datum" onChange={e => {
                  if (!e.target.value) return;
                  const picked = new Date(e.target.value + "T00:00:00");
                  const today = new Date(); today.setHours(0, 0, 0, 0);
                  const pickedMon = getMon(picked); const todayMon = getMon(today);
                  const diffDays = Math.round((pickedMon - todayMon) / (1000 * 60 * 60 * 24));
                  setWo(Math.round(diffDays / 7));
                  const dow = picked.getDay();
                  if (dow >= 1 && dow <= 5) goDay(dow - 1);
                }} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }} />
              </label>
              {wo !== 0 && <Btn small ghost onClick={() => setWo(0)}>Dnes</Btn>}
            </div>

            {/* Porušení pravidel nového modelu */}
            {analysis.violations.length > 0 && <div className="gl" style={{ padding: "10px 14px", marginBottom: 12, borderLeft: "3px solid var(--red)" }}>
              {analysis.violations.map((v, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: v.sev === "crit" ? "var(--red)" : "var(--amb)", padding: "2px 0", fontWeight: v.sev === "crit" ? 600 : 400 }}>
                <span style={{ flex: 1 }}>{v.sev === "crit" ? "⛔" : "⚠️"} {v.empId && !v.intake ? `${ge(v.empId)?.name}: ` : ""}{v.msg}</span>
                {isA && v.intake && v.empId && !(intakeAllow[v.day] || []).includes(v.empId) && <Btn small onClick={() => allowIntakeException(v.day, v.empId)}>Povolit výjimku</Btn>}
              </div>)}
              {isA && analysis.problems.length > 0 && <Btn small warm onClick={() => switchV("proposals")} style={{ marginTop: 8 }}>⚑ Zobrazit návrhy řešení ({analysis.problems.length})</Btn>}
            </div>}

            {/* Freshness — kdo a kdy naposledy upravil (real-time) */}
            {schedMeta.at && <div style={{ fontSize: 11, color: "var(--tx3)", fontFamily: "'IBM Plex Mono',monospace", marginBottom: 10 }}>
              aktualizováno {new Date(schedMeta.at).toLocaleTimeString("cs", { hour: "2-digit", minute: "2-digit" })}{schedMeta.by && ge(schedMeta.by) ? ` · ${ge(schedMeta.by).name}` : ""}
            </div>}

            {/* View toggle: Den / Týden */}
            <div style={{ display: "flex", gap: 2, marginBottom: 14, border: "1px solid var(--brd)", width: "fit-content" }}>
              {[{ k: "day", l: "Den" }, { k: "week", l: "Týden" }].map(v => <button key={v.k} onClick={() => setSchedView(v.k)} style={{ padding: "8px 18px", border: "none", background: schedView === v.k ? "var(--sel)" : "transparent", color: schedView === v.k ? "var(--stx)" : "var(--tx3)", cursor: "pointer", fontSize: 13, fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 1, minHeight: 38 }}>{v.l}</button>)}
            </div>

            {/* D&D global flag indicator */}
            {!isA && rules?.allowAllDnD === true && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", border: "1px solid var(--abrd)", background: "var(--adim)", marginBottom: 12, fontSize: 12, color: "var(--acc2)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 1 }}>
              ⤧ D&D povoleno pro všechny - můžeš přesouvat kohokoliv
            </div>}

            {/* Filters + actions */}
            <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
              <Btn small ghost onClick={() => setShowPerma(true)}>Zobrazit stálý</Btn>
              <Btn small ghost onClick={() => setShowCompare(true)}>Porovnat se stálým</Btn>
              {isA && <Btn small onClick={() => setModal("applydefault")}>Aplikovat stálý</Btn>}
              <div style={{ flex: 1 }} />
              {isA && <Btn small onClick={() => setModal("absence")}>+ Nepřít.</Btn>}
              {!isA && <Btn small warm onClick={() => setModal("myabsence")}>+ Nepřítomnost</Btn>}
              <Btn small ghost onClick={exportCSV}>CSV</Btn>
            </div>

            {/* ── DAY VIEW ── */}
            {schedView === "day" && <>
              {/* Day pills */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 3, marginBottom: 16 }}>
                {DAYS.map((d, i) => { const it = isTd(i, wo); const hol = !!wh[i]; return <button key={d} className={it && selDay === i ? 'atp' : ''} onClick={() => goDay(i)} style={{ padding: "8px 4px", border: `1px solid ${selDay === i ? "var(--abrd)" : "var(--brd)"}`, background: selDay === i ? "var(--adim)" : "transparent", color: selDay === i ? "var(--acc2)" : "var(--tx3)", cursor: "pointer", fontFamily: "'Barlow Condensed',sans-serif", fontSize: 14, fontWeight: 600, textTransform: "uppercase", textAlign: "center", minHeight: 52, opacity: hol ? .6 : 1 }}>
                  <div>{d}</div>
                  <div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", marginTop: 2 }}>{fmtDate(wd[i])}</div>
                  {it && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--acc2)", display: "block", margin: "2px auto 0" }} />}
                  {hol && <div style={{ fontSize: 7, color: "var(--acc2)" }}>svátek</div>}
                  {!hol && intake[d] && <div style={{ fontSize: 7, color: "var(--amb)" }}>🎓 nástupy</div>}
                </button>; })}
              </div>

              {/* Banners */}
              {isTd(selDay, wo) && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", border: "1px solid var(--abrd)", background: "var(--adim)", marginBottom: 12 }}><div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--acc2)" }} /><span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 12, color: "var(--acc2)", textTransform: "uppercase", letterSpacing: 1.5 }}>Dnes</span></div>}
              {dayHol && <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", border: "1px solid var(--abrd)", background: "var(--adim)", marginBottom: 12 }}><span>🎉</span><span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, color: "var(--acc2)", textTransform: "uppercase", letterSpacing: 1, fontSize: 14 }}>{dayHol} — volno</span></div>}

              {/* Nástupy: indikátor + admin přepínač */}
              {!dayHol && (intake[DAYS[selDay]] || isA) && <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", border: `1px solid ${intake[DAYS[selDay]] ? "var(--amb)" : "var(--brd)"}`, background: intake[DAYS[selDay]] ? "rgba(200,112,32,.08)" : "transparent", marginBottom: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 16 }}>🎓</span>
                <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 13, letterSpacing: 1, textTransform: "uppercase", color: intake[DAYS[selDay]] ? "var(--amb)" : "var(--tx3)", flex: 1 }}>
                  {intake[DAYS[selDay]] ? "Den nástupů — HO jen s výjimkou" : "Běžný den"}
                </span>
                {isA && <Btn small warm={!intake[DAYS[selDay]]} danger={intake[DAYS[selDay]]} onClick={() => toggleIntake(DAYS[selDay])}>{intake[DAYS[selDay]] ? "Zrušit Nástupy" : "Označit jako Nástupy"}</Btn>}
              </div>}

              {/* Shifts */}
              <div key={`${selDay}-${wo}`} className={slideDir === 'right' ? 'asr' : 'asl'}>
                {!dayHol && SHIFTS.map(shift => <div key={shift} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <span style={{ fontFamily: "'IBM Plex Mono',monospace", color: "var(--acc2)", fontSize: 16, fontWeight: 500 }}>{shift}</span>
                    <div style={{ flex: 1, height: 1, background: "var(--brd)" }} />
                    <span style={{ fontSize: 12, color: "var(--tx3)" }}>{getEntries(DAYS[selDay], shift).length} os.</span>
                  </div>
                  <ShiftCard day={DAYS[selDay]} shift={shift} />
                </div>)}
                {/* Day absences */}
                {(() => { const da = getDayAbs(DAYS[selDay]); if (!da.length) return null; return <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12, color: "var(--tx3)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8, fontFamily: "'Barlow Condensed',sans-serif" }}>Nepřítomnost</div>
                  {da.map(a => { const e = ge(a.empId); const at = ABS.find(t => t.id === a.type); return e && <div key={a.empId} className="gl" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", marginBottom: 6, minHeight: 48 }}><span>{at?.icon}</span><span style={{ fontWeight: 500, color: "var(--w)", flex: 1 }}>{e.name}</span><Badge small color={at?.color}>{at?.label}</Badge>{(isA || a.empId === profile.id) && <button onClick={() => removeAbs(a.empId, DAYS[selDay])} style={{ background: "none", border: "1px solid var(--red)", color: "var(--red)", width: 28, height: 28, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>✕</button>}</div>; })}
                </div>; })()}
              </div>
            </>}

            {/* ── WEEK VIEW (table) ── */}
            {schedView === "week" && <div className="gl" style={{ overflow: "hidden", padding: 0 }}>
              <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                <table style={{ width: "100%", minWidth: 700, borderCollapse: "collapse" }}>
                  <thead><tr>
                    <th style={{ position: "sticky", left: 0, zIndex: 10, background: "var(--panel)", backdropFilter: "var(--blur)", padding: "10px 8px", borderBottom: "2px solid var(--bt)", borderRight: "2px solid var(--bt)", width: 64, fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: "var(--tx3)" }}>⏱</th>
                    {DAYS.map((d, i) => { const hol = wh[i]; const td = isTd(i, wo); return <th key={d} style={{ padding: "8px 6px", borderBottom: td ? "3px solid var(--acc2)" : "2px solid var(--bt)", borderLeft: "2px solid var(--bt)", background: td ? "var(--adim)" : hol ? "rgba(48,128,96,.06)" : "var(--bg3)", textAlign: "center", minWidth: 115, opacity: hol ? .6 : 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: td ? "var(--acc2)" : "var(--w)", fontFamily: "'Barlow Condensed',sans-serif" }}>{DAYS_F[i]}</div>
                      <div style={{ fontSize: 11, color: "var(--tx3)", fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDate(wd[i])}</div>
                      {hol && <Badge small color="var(--grn)">{hol}</Badge>}
                      {!hol && intake[d] && <div style={{ fontSize: 9, color: "var(--amb)", fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: 1 }}>🎓 NÁSTUPY</div>}
                      {isA && !hol && <button onClick={() => toggleIntake(d)} title={intake[d] ? "Zrušit Nástupy" : "Označit jako Nástupy"} style={{ marginTop: 3, fontSize: 9, fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: .5, textTransform: "uppercase", cursor: "pointer", background: "transparent", border: `1px solid ${intake[d] ? "var(--amb)" : "var(--brd)"}`, color: intake[d] ? "var(--amb)" : "var(--tx3)", padding: "1px 6px" }}>{intake[d] ? "✕ nástupy" : "+ nástupy"}</button>}
                    </th>; })}
                  </tr></thead>
                  <tbody>{SHIFTS.map(shift => <tr key={shift}>
                    <td style={{ position: "sticky", left: 0, zIndex: 10, background: "var(--panel)", padding: "8px 6px", borderBottom: "2px solid var(--bt)", borderRight: "2px solid var(--bt)", textAlign: "center", fontFamily: "'IBM Plex Mono',monospace", fontSize: 17, fontWeight: 500, color: "var(--acc2)" }}>{shift}</td>
                    {DAYS.map((day, di) => { const entries = getEntries(day, shift); const td = isTd(di, wo); const hol = !!wh[di];
                      return <td key={`${day}-${shift}`} className="dz" style={{ padding: 4, borderBottom: "2px solid var(--bt)", borderLeft: "2px solid var(--bt)", verticalAlign: "top", background: td ? "var(--adim)" : hol ? "rgba(48,128,96,.04)" : "var(--bg3)", opacity: hol ? .5 : 1 }}
                        onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("over"); }}
                        onDragLeave={e => e.currentTarget.classList.remove("over")}
                        onDrop={e => handleDrop(day, shift, e)}>
                        {entries.map(en => { const emp = ge(en.empId); if (!emp) return null; const isMe = en.empId === profile.id;
                          return <div key={en.empId} className="ent" draggable={canDrag(en.empId)} onDragStart={e => e.dataTransfer.setData("text/plain", JSON.stringify({ empId: en.empId, day, shift }))} onClick={() => isA ? setSelCell({ day, shift, empId: en.empId }) : isMe && setModal({ type: "myshift", day, shift })} style={{ gap: 4, padding: "6px 8px", marginBottom: 2, background: "var(--bg3)", border: "1px solid var(--brd)", fontSize: 14 }}>
                            <span style={{ width: 8, height: 3, background: en.ho ? "var(--grn)" : "var(--acc2)" }} /><span style={{ fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--w)" }}>{emp.name?.split(" ").pop()}</span>
                            {!isA && !isMe && <button title={`Výměna s ${emp.name}`} onClick={e => { e.stopPropagation(); setModal({ type: "directSwap", targetEmp: emp, targetDay: day, targetShift: shift }); }} style={{ background: "none", border: "1px solid var(--acc2)", color: "var(--acc2)", width: 20, height: 20, cursor: "pointer", fontSize: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 0 }}>⇄</button>}
                            {en.ho && <Badge small color="var(--grn)">HO</Badge>}
                          </div>; })}
                      </td>; })}
                  </tr>)}
                  <tr><td style={{ position: "sticky", left: 0, zIndex: 10, background: "var(--panel)", padding: 8, borderRight: "2px solid var(--bt)", fontSize: 12, color: "var(--tx3)", textAlign: "center" }}>N/A</td>
                    {DAYS.map((day, di) => { const da = getDayAbs(day); const td = isTd(di, wo);
                      return <td key={`a-${day}`} style={{ padding: 4, borderLeft: "2px solid var(--bt)", borderTop: "2px solid var(--bt)", background: td ? "var(--adim)" : "transparent" }}>{da.map(a => { const e = ge(a.empId); const at = ABS.find(t => t.id === a.type); return e && <div key={a.empId} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 8px", marginBottom: 2, border: `1px solid ${at?.color}`, fontSize: 13, minHeight: 36, background: "var(--bg3)" }}><span>{at?.icon}</span><span style={{ fontWeight: 500 }}>{e.name?.split(" ").pop()}</span></div>; })}</td>; })}</tr>
                  </tbody>
                </table>
              </div>
            </div>}
          </div>}

          {/* ═══ OTHER VIEWS ═══ */}
          {view === "proposals" && <div>
            <div style={{ fontSize: 20, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2, marginBottom: 20, borderBottom: "1px solid var(--brd)", paddingBottom: 12 }}>Návrhy změn</div>

            {/* Plakát „Your colleagues need YOU" — ukáže se, když uživatel může něco udělat: čeká se na jeho souhlas, nebo má u problému tlačítko „Provést úpravu" */}
            {(myPendingProps.length > 0 || yearProblems.some(pr => pr.alts.some(a => isA || a.empId === profile.id))) && <div style={{ textAlign: "center", margin: "0 0 24px" }}>
              <img src="/kolegove-te-potrebuji.webp" alt="Your colleagues need YOU — můžeš pomoct s řešením" loading="lazy"
                style={{ maxWidth: 230, width: "100%", border: "1px solid var(--brd)", display: "inline-block" }} />
              <div style={{ fontSize: 12, color: "var(--tx3)", marginTop: 6, textTransform: "uppercase", letterSpacing: 1, fontFamily: "'Barlow Condensed',sans-serif" }}>Můžeš pomoct ↓</div>
            </div>}

            {/* Celoroční detekované problémy — ode dneška dál, přímá aplikace */}
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--tx2)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10, fontFamily: "'Barlow Condensed',sans-serif" }}>Problémy k vyřešení · ode dneška</div>
            {yearProblems.length === 0 && <Card style={{ marginBottom: 24, borderLeft: "3px solid var(--grn)" }}><span style={{ fontSize: 14 }}>✓ Žádné otevřené problémy — všechny dny splňují pravidla.</span></Card>}
            {yearProblems.length > 0 && <div style={{ marginBottom: 24 }}>
              {yearProblems.slice(0, 30).map((pr, pi) => {
                const myAlts = pr.alts.filter(a => isA || a.empId === profile.id);
                return <Card key={pr.weekKey + pr.key + pi} style={{ marginBottom: 10, borderLeft: `3px solid ${pr.alts.some(a => true) ? "var(--red)" : "var(--amb)"}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                    <Badge small color="var(--acc2)">{pr.dLabel}</Badge>
                    <span style={{ fontWeight: 600, fontSize: 15, color: "var(--w)" }}>{pr.title}</span>
                  </div>
                  {pr.alts.length === 0 && <p style={{ fontSize: 13, color: "var(--tx3)", margin: 0 }}>Žádné automatické řešení — vyřešte ručně v rozvrhu daného týdne.</p>}
                  {(isA ? pr.alts : myAlts).map((alt, i) => {
                    const canApply = isA || alt.empId === profile.id;
                    return <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "var(--bg3)", border: "1px solid var(--brd)", marginBottom: 4, flexWrap: "wrap" }}>
                      {i === 0 && <Badge small color="var(--grn)">TIP</Badge>}
                      <span style={{ flex: 1, fontSize: 14, minWidth: 160 }}>{altLabel(alt, ge)}</span>
                      {canApply
                        ? <Btn small warm onClick={() => applyProblemFix(pr.weekKey, pr.key, alt)}>Provést úpravu</Btn>
                        : <span style={{ fontSize: 11, color: "var(--tx3)" }}>vyřeší {ge(alt.empId)?.name} nebo admin</span>}
                    </div>;
                  })}
                  {!isA && myAlts.length === 0 && pr.alts.length > 0 && <p style={{ fontSize: 12, color: "var(--tx3)", margin: "4px 0 0" }}>Tenhle problém vyřeší někdo jiný z týmu nebo admin.</p>}
                </Card>;
              })}
              {yearProblems.length > 30 && <p style={{ fontSize: 12, color: "var(--tx3)" }}>…a dalších {yearProblems.length - 30} později v roce. Vyřešením prvních se seznam posune.</p>}
            </div>}

            {/* Čekající návrhy — admin vidí vše, člen jen svoje */}
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--tx2)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10, fontFamily: "'Barlow Condensed',sans-serif" }}>Čeká na schválení</div>
            {visibleProps.map(p => {
              const required = ["admin", ...(p.affected || [])];
              const canConsent = (isA && !p.consents?.admin) || (p.affected?.includes(profile.id) && !p.consents?.[profile.id]);
              return <Card key={p.id} style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 16, color: "var(--w)" }}>{p.label}</div>
                {p.why && <div style={{ fontSize: 13, color: "var(--tx2)", marginTop: 2 }}>Důvod: {p.why}</div>}
                <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <Badge small color="var(--acc2)">týden {p.week}</Badge>
                  {required.map(r => <Badge key={r} small color={p.consents?.[r] ? "var(--grn)" : "var(--tx3)"}>{p.consents?.[r] ? "✓ " : "· "}{r === "admin" ? "Admin" : ge(r)?.name || "?"}</Badge>)}
                  <div style={{ flex: 1 }} />
                  {canConsent && <Btn small warm onClick={() => consentProposal(p)}>Souhlasím</Btn>}
                  {(isA || p.affected?.includes(profile.id)) && <Btn small danger onClick={() => rejectProposal(p)}>Zamítnout</Btn>}
                </div>
              </Card>;
            })}
            {!visibleProps.length && <p style={{ color: "var(--tx3)" }}>Žádné čekající návrhy.</p>}
          </div>}

          {view === "swaps" && <div>
            <div style={{ fontSize: 20, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2, marginBottom: 20, borderBottom: "1px solid var(--brd)", paddingBottom: 12 }}>Výměny</div>
            {!isA && <Card style={{ marginBottom: 20 }}><Btn warm onClick={() => setModal({ type: "swap", day: DAYS[selDay], shift: SHIFTS[0] })}>+ Nová žádost</Btn></Card>}
            {openSw.map(sw => { const re = ge(sw.rid); const me = profile.id === sw.rid; const tgt = sw.targetId ? ge(sw.targetId) : null; const isTarget = sw.targetId === profile.id; const can = !isA && !me && (!sw.targetId ? true : isTarget); const dateLabel = sw.dateISO ? new Date(sw.dateISO + "T00:00:00").toLocaleDateString("cs", { weekday: "short", day: "numeric", month: "numeric" }) : `${sw.day} (týden ${sw.week})`; return <Card key={sw.id} style={{ padding: 16, marginBottom: 8 }}><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}><div><div style={{ fontWeight: 600, fontSize: 17, color: "var(--w)" }}>{re?.name}</div><div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center", flexWrap: "wrap" }}><Badge small color="var(--acc2)">{dateLabel} · {sw.sh}</Badge>{tgt && <Badge small color="var(--amb)">→ {tgt.name}</Badge>}</div></div><div style={{ display: "flex", gap: 6, alignItems: "center" }}>{can && <Btn warm small onClick={() => doSwap(sw.id, profile.id)}>Přijmout</Btn>}{me && <><Badge color="var(--amb)">Tvoje</Badge><Btn small danger onClick={async () => { if (!confirm("Zrušit žádost?")) return; try { await deleteDoc(doc(db, "swapRequests", sw.id)); notify("Zrušeno"); log(`Zrušena žádost: ${dateLabel}`); } catch (err) { notify("Chyba: " + err.message); } }}>✕ Zrušit</Btn></>}{isA && !me && <Btn small danger onClick={async () => { if (!confirm("Smazat žádost?")) return; try { await deleteDoc(doc(db, "swapRequests", sw.id)); notify("Smazáno"); } catch { notify("Chyba"); } }}>✕</Btn>}</div></div>{sw.comment && <div style={{ marginTop: 8, fontSize: 13, color: "var(--tx2)", padding: "6px 10px", border: "1px solid var(--brd)", background: "var(--bg3)" }}>💬 {sw.comment}</div>}</Card>; })}
            {!openSw.length && <p style={{ color: "var(--tx3)" }}>Žádné žádosti.</p>}
          </div>}

          {view === "people" && isA && <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20, borderBottom: "1px solid var(--brd)", paddingBottom: 12 }}><div style={{ fontSize: 20, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2 }}>Tým</div><Btn warm onClick={() => setModal("addMember")}>+ Přidat</Btn></div>
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>{employees.filter(e => e.role !== "admin").map(emp => <Card key={emp.id}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div style={{ fontWeight: 600, fontSize: 17, color: "var(--w)", display: "flex", alignItems: "center", gap: 8 }}>{emp.name}<RankBadge fixes={emp.fixCount} size={26} /></div>
                  <div style={{ display: "flex", gap: 4 }}><button onClick={() => setModal({ type: "editDays", emp })} style={{ background: "none", border: "1px solid var(--brd2)", color: "var(--tx3)", cursor: "pointer", width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center" }}>✏</button><button onClick={() => delUser(emp.id)} style={{ background: "none", border: "1px solid rgba(192,48,48,.3)", color: "var(--red)", cursor: "pointer", width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button></div>
                </div>
                <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>{[{ l: "Dovol.", v: (emp.vacationTotal || 20) - (emp.vacationUsed || 0), c: "var(--sd)" }, { l: "Sick", v: (emp.sickTotal || 5) - (emp.sickUsed || 0), c: "var(--red)" }, { l: "What.", v: (emp.whateverTotal || 3) - (emp.whateverUsed || 0), c: "var(--amb)" }].map(b => <div key={b.l} style={{ textAlign: "center", padding: 8, border: "1px solid var(--brd)" }}><div style={{ fontSize: 20, fontWeight: 600, color: b.c, fontFamily: "'IBM Plex Mono',monospace" }}>{b.v}</div><div style={{ fontSize: 10, color: "var(--tx3)", textTransform: "uppercase" }}>{b.l}</div></div>)}</div>
                <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", border: "1px solid var(--brd)" }}>
                  <span style={{ fontSize: 12, color: "var(--tx3)", textTransform: "uppercase", letterSpacing: 1, flex: 1 }}>🛠 Vyřešené problémy</span>
                  <button onClick={() => { if ((emp.fixCount || 0) > 0) updateDoc(doc(db, "users", emp.id), { fixCount: increment(-1) }).catch(() => notify("Chyba")); }} style={{ background: "none", border: "1px solid var(--brd2)", color: "var(--tx3)", cursor: "pointer", width: 28, height: 28 }}>−</button>
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 16, fontWeight: 600, color: "var(--amb)", minWidth: 24, textAlign: "center" }}>{emp.fixCount || 0}</span>
                  <button onClick={() => updateDoc(doc(db, "users", emp.id), { fixCount: increment(1) }).catch(() => notify("Chyba"))} style={{ background: "none", border: "1px solid var(--brd2)", color: "var(--tx3)", cursor: "pointer", width: 28, height: 28 }}>+</button>
                </div>
              </Card>)}</div>
            </div>
          </div>}

          {view === "stats" && <div>
            <div style={{ fontSize: 20, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2, marginBottom: 20, borderBottom: "1px solid var(--brd)", paddingBottom: 12 }}>Status</div>
            {!isA && <Card style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}><div style={{ fontSize: 16, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase" }}>Moje dny</div><button onClick={() => setModal({ type: "editDays", emp: profile })} style={{ background: "none", border: "1px solid var(--brd2)", color: "var(--tx3)", cursor: "pointer", width: 34, height: 34 }}>✏</button></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>{[{ l: "Dovolená", v: (profile.vacationTotal || 20) - (profile.vacationUsed || 0), t: profile.vacationTotal || 20, c: "var(--sd)" }, { l: "Sick", v: (profile.sickTotal || 5) - (profile.sickUsed || 0), t: profile.sickTotal || 5, c: "var(--red)" }, { l: "Whatever", v: (profile.whateverTotal || 3) - (profile.whateverUsed || 0), t: profile.whateverTotal || 3, c: "var(--amb)" }].map(b => <div key={b.l} style={{ textAlign: "center", padding: 12, border: "1px solid var(--brd)", background: "var(--bg3)" }}><div style={{ fontSize: 28, fontWeight: 600, color: b.c, fontFamily: "'IBM Plex Mono',monospace" }}>{b.v}</div><div style={{ fontSize: 11, color: "var(--tx3)", textTransform: "uppercase" }}>{b.l} (z {b.t})</div></div>)}</div>
            </Card>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 12 }}>{[{ l: "Crew", v: employees.filter(e => e.role !== "admin").length, c: "var(--acc2)" }, { l: "Active", v: employees.filter(e => e.setupDone).length, c: "var(--grn)" }, { l: "Swaps", v: openSw.length, c: "var(--amb)" }].map(s => <Card key={s.l}><div style={{ fontSize: 32, fontWeight: 600, color: s.c, fontFamily: "'IBM Plex Mono',monospace" }}>{s.v}</div><div style={{ fontSize: 12, color: "var(--tx3)", textTransform: "uppercase", marginTop: 4 }}>{s.l}</div></Card>)}</div>

            {/* ═══ FÉROVOST ═══ */}
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 1, margin: "28px 0 6px" }}>Férovost · od 22. 7. 2026</div>
            <p style={{ fontSize: 12, color: "var(--tx3)", marginBottom: 12 }}>Počty odpracovaných směn od 8:00, od 10:00 a dnů home office, počítané od 22. 7. 2026 (start nového modelu). Hlídač upozorní, když se rozdíl mezi lidmi zvětší nad {FAIR_SPREAD}.</p>
            {fairness.warn.length > 0 && <div className="gl" style={{ padding: "10px 14px", marginBottom: 12, borderLeft: "3px solid var(--amb)" }}>
              {fairness.warn.map((w, i) => <div key={i} style={{ fontSize: 13, color: "var(--amb)", padding: "2px 0" }}>⚠️ {w.msg}</div>)}
            </div>}
            {fairness.warn.length === 0 && fairness.rows.some(r => r.weeks > 0) && <div className="gl" style={{ padding: "10px 14px", marginBottom: 12, borderLeft: "3px solid var(--grn)", fontSize: 13, color: "var(--grn)" }}>✓ Rozložení směn i HO je vyrovnané.</div>}
            <div className="gl" style={{ overflow: "auto", padding: 0 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 420 }}>
                <thead><tr>
                  {["Člen", "8:00", "10:00", "HO", "HO −", "🛠 Fixy", "Týdnů"].map((h, i) => <th key={h} style={{ padding: "10px 12px", textAlign: i === 0 ? "left" : "center", color: "var(--tx3)", borderBottom: "1px solid var(--brd)", fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: 1 }} title={h === "HO −" ? "HO deficit: dny, kdy stálý rozvrh říká HO, ale člověk byl v kanceláři" : h === "🛠 Fixy" ? "Kolikrát jeho směna vyřešila problém (Provést úpravu)" : undefined}>{h}</th>)}
                </tr></thead>
                <tbody>{fairness.rows.map(r => {
                  const maxV = Math.max(1, ...fairness.rows.map(x => Math.max(x.eight, x.ten, x.ho)));
                  const bar = (v, c) => <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}><div style={{ width: 40, height: 6, background: "var(--brd)", position: "relative" }}><div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${100 * v / maxV}%`, background: c }} /></div><span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, minWidth: 18, textAlign: "right" }}>{v}</span></div>;
                  return <tr key={r.id} style={{ borderBottom: "1px solid var(--brd)" }}>
                    <td style={{ padding: "8px 12px", fontWeight: 600, color: "var(--w)" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{r.name}<RankBadge fixes={r.fixes} /></span></td>
                    <td style={{ padding: "8px 12px" }}>{bar(r.eight, "var(--acc2)")}</td>
                    <td style={{ padding: "8px 12px" }}>{bar(r.ten, "var(--amb)")}</td>
                    <td style={{ padding: "8px 12px" }}>{bar(r.ho, "var(--grn)")}</td>
                    <td style={{ padding: "8px 12px", textAlign: "center", fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: r.deficit > 0 ? "var(--red)" : "var(--tx3)" }}>{r.deficit > 0 ? `−${r.deficit}` : "0"}</td>
                    <td style={{ padding: "8px 12px", textAlign: "center" }}>{r.fixes > 0 ? <span style={{ display: "inline-block", padding: "1px 8px", border: "1px solid var(--amb)", color: "var(--amb)", fontFamily: "'IBM Plex Mono',monospace", fontSize: 13 }}>🛠 {r.fixes}</span> : <span style={{ color: "var(--tx3)", fontFamily: "'IBM Plex Mono',monospace", fontSize: 13 }}>0</span>}</td>
                    <td style={{ padding: "8px 12px", textAlign: "center", fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: "var(--tx3)" }}>{r.weeks}</td>
                  </tr>; })}</tbody>
              </table>
            </div>
          </div>}

          {view === "log" && <div><div style={{ fontSize: 20, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2, marginBottom: 20, borderBottom: "1px solid var(--brd)", paddingBottom: 12 }}>Log</div>{logs.map(h => <div key={h.id} style={{ display: "flex", gap: 10, padding: "10px 12px", borderBottom: "1px solid var(--brd)", fontSize: 14 }}><span style={{ fontSize: 12, color: "var(--tx3)", fontFamily: "'IBM Plex Mono',monospace", minWidth: 130 }}>{h.time ? new Date(h.time).toLocaleString("cs") : ""}</span><span style={{ flex: 1 }}>{h.msg}</span></div>)}</div>}
          {view === "defaults" && isA && <div><div style={{ fontSize: 20, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2, marginBottom: 16, borderBottom: "1px solid var(--brd)", paddingBottom: 12 }}>Stálý rozvrh</div>
            <Card style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--w)", marginBottom: 6 }}>Předvyplnit dle preferencí členů</div>
              <p style={{ fontSize: 13, color: "var(--tx2)", marginBottom: 12 }}>Nastaví každému výchozí rozvrh podle jeho preferencí (Jirka 8:00 celý týden, Andy nikdy neotevírá, Patrik HO od 8 + páteční 10, Denis ve středu bez 10:00…). Pak lze libovolně ručně upravit níže.</p>
              <Btn warm onClick={applyPreset}>Předvyplnit rozvrh</Btn>
            </Card>
            <DefEditor employees={employees} /></div>}
          {view === "settings" && <div style={{ maxWidth: 560 }}>
            <div style={{ fontSize: 20, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2, marginBottom: 20, borderBottom: "1px solid var(--brd)", paddingBottom: 12 }}>Nastavení</div>
            <Card style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--tx2)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12, fontFamily: "'Barlow Condensed',sans-serif" }}>Účet</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Btn ghost onClick={() => setModal("changeName")}>Změnit jméno</Btn>
                <Btn ghost onClick={() => setModal("changePass")}>Změnit heslo</Btn>
                <Btn ghost onClick={() => setModal("changeNotif")}>Email notifikace</Btn>
              </div>
            </Card>
            <Card style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--tx2)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12, fontFamily: "'Barlow Condensed',sans-serif" }}>Google Calendar</div>
              {!GCAL_CLIENT_ID ? <p style={{ fontSize: 13, color: "var(--tx3)" }}>Google Calendar integrace není nakonfigurována (chybí VITE_GOOGLE_CLIENT_ID).</p> : <>
                <Toggle checked={profile.gcalEnabled || false} onChange={async v => {
                  if (v && !getGcalToken()) {
                    const t = await gcalAuth();
                    if (!t) { notify("Autorizace selhala"); return; }
                  }
                  await updateDoc(doc(db, "users", profile.id), { gcalEnabled: v });
                  setProfile(p => ({ ...p, gcalEnabled: v }));
                  notify(v ? "Google Calendar zapnut" : "Google Calendar vypnut");
                }} label="Synchronizovat rozvrh do Google Calendar" />
                {profile.gcalEnabled && <>
                  <p style={{ fontSize: 12, color: "var(--tx3)", marginBottom: 10 }}>Směny se zapíšou do vašeho primárního Google kalendáře jako události s tagem [ShiftFlow].</p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Btn warm onClick={async () => {
                      notify("Synchronizuji aktuální týden...");
                      const res = await syncWeekToGCal(profile.id, wd, cs, employees, absences);
                      notify(res.msg);
                    }}>Sync týden</Btn>
                    <Btn warm onClick={async () => {
                      if (!confirm("Synchronizovat příštích 52 týdnů? Může trvat 1-3 minuty.")) return;
                      notify("Spouštím sync celého roku...");
                      const res = await syncRangeToGCal(profile.id, employees, db, 52, msg => notify(msg));
                      notify(res.msg);
                    }}>Sync celý rok</Btn>
                    <Btn ghost onClick={() => { localStorage.removeItem("sf_gcal_token"); notify("Token odstraněn — při dalším sync budete znovu autorizovat"); }}>Odpojit</Btn>
                  </div>
                </>}
              </>}
            </Card>
            {isA && <Card style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--tx2)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12, fontFamily: "'Barlow Condensed',sans-serif" }}>Pravidla směn</div>
              <Input label="Minimum lidí v kanceláři" type="number" value={rules.officeMin ?? 4} onChange={e => setRules(r => ({ ...r, officeMin: +e.target.value }))} /><Input label="Minimum v kanceláři od 8:00" type="number" value={rules.min8 ?? 2} onChange={e => setRules(r => ({ ...r, min8: +e.target.value }))} /><Input label="Minimum na 10:00 (vč. HO)" type="number" value={rules.min10 ?? 2} onChange={e => setRules(r => ({ ...r, min10: +e.target.value }))} /><Input label="Max HO / den" type="number" value={rules.hoCapDay ?? 3} onChange={e => setRules(r => ({ ...r, hoCapDay: +e.target.value }))} /><Input label="Max HO / osoba / týden" type="number" value={rules.hoPerWeek ?? 2} onChange={e => setRules(r => ({ ...r, hoPerWeek: +e.target.value }))} /><Toggle checked={rules.cover8 !== false} onChange={v => setRules(r => ({ ...r, cover8: v }))} label="Vyžadovat minimum na 8:00" /><Toggle checked={rules.cover10 !== false} onChange={v => setRules(r => ({ ...r, cover10: v }))} label="Vyžadovat minimum na 10:00" /><div style={{ borderTop: "1px solid var(--brd)", marginTop: 12, paddingTop: 12 }}><Toggle checked={rules.allowAllDnD || false} onChange={v => setRules(r => ({ ...r, allowAllDnD: v }))} label="Povolit Drag & Drop pro všechny" /><p style={{ fontSize: 12, color: "var(--tx3)", marginTop: -8, marginBottom: 12 }}>Zaměstnanci budou moci přesouvat kohokoliv v rozvrhu.</p></div><Btn warm onClick={async () => { await setDoc(doc(db, "rules", "global"), rules); notify("Uloženo"); }}>Uložit pravidla</Btn>
            </Card>}
            {isA && <Card><div style={{ display: "flex", gap: 8 }}><Btn danger onClick={async () => { await deleteDoc(doc(db, "schedules", wk)); notify("Reset"); }}>Reset týden</Btn><Btn ghost onClick={exportCSV}>CSV</Btn></div></Card>}
          </div>}
        </div>
      </main>
    </div>

    {isMobile && <PillNav view={view} setView={switchV} NAV={NAV} />}

    {/* MODALS */}
    <Modal open={!!selCell} onClose={() => setSelCell(null)} title="Akce">{selCell && (() => { const emp = ge(selCell.empId); if (!emp) return null; return <div>
      <div style={{ padding: 14, background: "var(--bg3)", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}><div style={{ width: 40, height: 40, background: "var(--acc2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 600, color: "#fff" }}>{emp.name.charAt(0)}</div><div><div style={{ fontWeight: 600, fontSize: 17, color: "var(--w)" }}>{emp.name}</div><div style={{ fontSize: 14, color: "var(--tx2)" }}>{selCell.day} · {selCell.shift}</div></div></div>
      <Btn onClick={() => { togHO(selCell.day, selCell.shift, selCell.empId); setSelCell(null); }} style={{ width: "100%", marginBottom: 8 }}>Toggle HO</Btn>
      <div style={{ fontSize: 12, color: "var(--tx3)", margin: "14px 0 6px", textTransform: "uppercase", letterSpacing: 1 }}>Přesunout</div>
      <div style={{ display: "flex", gap: 8 }}>{SHIFTS.filter(s => s !== selCell.shift).map(s => <Btn key={s} small style={{ flex: 1 }} onClick={() => { moveE(selCell.empId, selCell.day, selCell.shift, selCell.day, s); setSelCell(null); }}>→ {s}</Btn>)}</div>
      <div style={{ fontSize: 12, color: "var(--tx3)", margin: "14px 0 6px", textTransform: "uppercase", letterSpacing: 1 }}>Nepřítomnost</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>{ABS.map(a => <Btn key={a.id} small onClick={() => { addAbs(selCell.empId, selCell.day, a.id); setSelCell(null); }}>{a.icon} {a.label}</Btn>)}</div>
      <div style={{ fontSize: 12, color: "var(--tx3)", margin: "14px 0 6px", textTransform: "uppercase", letterSpacing: 1 }}>Poznámka</div>
      <NoteInput onSubmit={n => { saveNote(selCell.empId, selCell.day, selCell.shift, n); setSelCell(null); }} />
    </div>; })()}</Modal>

    <Modal open={modal === "absence"} onClose={() => setModal(null)} title="Nepřítomnost"><AbsF emps={employees.filter(e => e.role !== "admin")} wd={wd} onSubmit={(e, d, t) => { addAbs(e, d, t); setModal(null); }} /></Modal>
    <Modal open={modal === "event"} onClose={() => setModal(null)} title="Událost"><EvF onSubmit={(d, t, n) => { addEv(d, t, n); setModal(null); }} /></Modal>
    <Modal open={modal?.type === "swap"} onClose={() => setModal(null)} title="Výměna"><SwF dDay={modal?.day} dShift={modal?.shift} wd={wd} onSubmit={(d, s, c) => { mkSwap(profile.id, d, s, c); setModal(null); }} /></Modal>
    <Modal open={modal?.type === "myshift"} onClose={() => setModal(null)} title="Moje směna"><div>
      <p style={{ fontSize: 15, color: "var(--tx2)", marginBottom: 16 }}>{modal?.day} · {modal?.shift}</p>
      {(() => { const myEntry = cs[modal?.day]?.[modal?.shift]?.find(e => e.empId === profile.id); const isHO = myEntry?.ho || false;
        const pendingHO = openProps.some(p => p.affected?.includes(profile.id) && p.week === wk && p.alt?.day === modal?.day && (p.alt?.kind === "grantHO" || p.alt?.kind === "dropHO"));
        if (pendingHO) return <div style={{ padding: "12px 14px", border: "1px solid var(--amb)", color: "var(--amb)", fontSize: 14, marginBottom: 12 }}>⚑ Žádost o HO na tento den čeká na schválení.</div>;
        return <Btn warm={!isHO} primary={isHO} onClick={() => { requestHO(modal.day, !isHO); setModal(null); }} style={{ width: "100%", marginBottom: 12 }}>{isHO ? "🏠 Požádat o zrušení Home Office" : "🏠 Požádat o Home Office"}</Btn>; })()}
      <div style={{ fontSize: 12, color: "var(--tx3)", margin: "8px 0 6px", textTransform: "uppercase", letterSpacing: 1 }}>Nepřítomnost</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>{ABS.map(a => <Btn key={a.id} onClick={() => { const d = modal.day; addAbs(profile.id, d, a.id); setModal(null); setResolveTarget({ day: d, kind: "absence", empId: profile.id }); }}>{a.icon} {a.label}</Btn>)}</div>
      {(() => { const me = cs[modal?.day]?.[modal?.shift]?.find(e => e.empId === profile.id); if (!me || me.ho) return null;
        return <><div style={{ fontSize: 12, color: "var(--tx3)", margin: "8px 0 6px", textTransform: "uppercase", letterSpacing: 1 }}>Změnit hodinu</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>{SHIFTS.filter(s => s !== modal.shift).map(s => <Btn key={s} onClick={() => { setResolveTarget({ day: modal.day, kind: "shift", empId: profile.id, fromShift: modal.shift, toShift: s }); setModal(null); }} style={{ flex: 1 }}>{s}</Btn>)}</div></>; })()}
      <Btn warm onClick={() => setModal({ type: "swap", day: modal?.day, shift: modal?.shift })} style={{ width: "100%", marginBottom: 10 }}>Požádat o výměnu</Btn>
      <div style={{ fontSize: 12, color: "var(--tx3)", margin: "8px 0 6px", textTransform: "uppercase" }}>Poznámka</div>
      <NoteInput onSubmit={n => { saveNote(profile.id, modal.day, modal.shift, n); setModal(null); }} />
    </div></Modal>
    <Modal open={modal === "myabsence"} onClose={() => setModal(null)} title="Nepřítomnost">
      <MyAbsF profile={profile} wd={wd} onSubmit={(d, t) => { addAbs(profile.id, d, t); setModal(null); setResolveTarget({ day: d, kind: "absence", empId: profile.id }); }} />
      <div style={{ borderTop: "1px solid var(--brd)", marginTop: 16, paddingTop: 16 }}>
        <Btn ghost onClick={() => setModal("vacrange")} style={{ width: "100%", fontSize: 14 }}>🗓 Dovolená od — do (rozsah)</Btn>
      </div>
    </Modal>
    <Modal open={modal === "vacrange"} onClose={() => setModal(null)} title="Nepřítomnost — rozsah"><VacRangeF onSubmit={(f, t, type) => { addAbsRange(f, t, type); setModal(null); }} /></Modal>

    {/* ═══ STÁLÝ ROZVRH (read-only, pro všechny) ═══ */}
    <Modal open={showPerma} onClose={() => setShowPerma(false)} title="Stálý rozvrh" wide>
      <div style={{ fontSize: 12, color: "var(--tx3)", marginBottom: 10 }}>Trvalý týdenní rozpis dle výchozích rozvrhů členů. Bez zohlednění dovolených a úprav konkrétního týdne.</div>
      <div style={{ overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 460 }}>
          <thead><tr><th style={{ padding: "8px 10px", textAlign: "left", color: "var(--tx3)", borderBottom: "1px solid var(--brd)", fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: 1 }}>Člen</th>{DAYS.map(d => <th key={d} style={{ padding: "8px 6px", textAlign: "center", color: "var(--tx3)", borderBottom: "1px solid var(--brd)", fontFamily: "'IBM Plex Mono',monospace" }}>{d}</th>)}</tr></thead>
          <tbody>{employees.filter(e => e.role !== "admin").map(emp => <tr key={emp.id} style={{ borderBottom: "1px solid var(--brd)" }}>
            <td style={{ padding: "8px 10px", fontWeight: 600, color: "var(--w)" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{emp.name}<RankBadge fixes={emp.fixCount} size={18} /></span></td>
            {DAYS.map(d => { const t = emp.setupDone ? emp.defaultSchedule?.[d] : null; const ho = emp.defaultSchedule?.[`${d}_ho`]; return <td key={d} style={{ padding: "6px", textAlign: "center" }}>{t ? <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: ho ? "var(--grn)" : "var(--acc2)", border: `1px solid ${ho ? "var(--grn)" : "var(--brd)"}`, padding: "2px 6px" }}>{ho ? "HO" + t.slice(0, 2) : t.slice(0, 2)}</span> : <span style={{ color: "var(--tx3)" }}>—</span>}</td>; })}
          </tr>)}</tbody>
        </table>
      </div>
      <Btn ghost onClick={() => setShowPerma(false)} style={{ width: "100%", marginTop: 12 }}>Zavřít</Btn>
    </Modal>

    {/* ═══ APLIKOVAT STÁLÝ ROZVRH (admin) ═══ */}
    <Modal open={modal === "applydefault"} onClose={() => setModal(null)} title="Aplikovat stálý rozvrh">
      <p style={{ fontSize: 13, color: "var(--tx2)", marginBottom: 14 }}>Přepíše ručně upravený rozvrh trvalým rozpisem. Nepřítomnosti (dovolené, nemoci) zůstanou zohledněné — nepřítomní se do rozvrhu nevrátí.</p>
      <Btn warm onClick={() => { setModal(null); applyDefaultCurrentWeek(); }} style={{ width: "100%", marginBottom: 8 }}>Na tento týden ({fmtW(cw)})</Btn>
      <Btn onClick={() => { setModal(null); applyDefaultYear(); }} style={{ width: "100%", marginBottom: 8 }}>Na příštích 52 týdnů (rok)</Btn>
      <Btn ghost onClick={() => setModal(null)} style={{ width: "100%" }}>Zrušit</Btn>
    </Modal>

    {/* ═══ POROVNÁNÍ SE STÁLÝM — dva rozvrhy vedle sebe, změny pulzují ═══ */}
    {showCompare && (() => {
      const defAll = buildDef(employees);
      const daysToShow = schedView === "day" ? [DAYS[selDay]] : DAYS;
      const buildDay = day => {
        const side = src => { const m = {}; SHIFTS.forEach(sh => m[sh] = (src[day]?.[sh] || []).filter(en => ge(en.empId)).map(en => ({ empId: en.empId, ho: !!en.ho }))); return m; };
        const def = side(defAll), cur = side(cs);
        const stateOf = m => { const o = {}; SHIFTS.forEach(sh => m[sh].forEach(en => o[en.empId] = sh + (en.ho ? "H" : ""))); return o; };
        const sd = stateOf(def), sc = stateOf(cur);
        const absent = employees.filter(e => e.role !== "admin" && absences[fsKey(e.id, day)]).map(e => ({ empId: e.id, reason: absences[fsKey(e.id, day)] }));
        const changed = new Set();
        employees.filter(e => e.role !== "admin").forEach(e => { const a = sd[e.id] || "—"; const b = absences[fsKey(e.id, day)] ? "ABS" : (sc[e.id] || "—"); if (a !== b) changed.add(e.id); });
        const origin = eid => { const st = sd[eid]; if (!st) return "nově"; return st.endsWith("H") ? "z HO " + st.slice(0, 2) : "z " + st.slice(0, 2) + ":00"; };
        return { def, cur, absent, changed, origin };
      };
      const CmpChip = ({ en, changed, tag }) => <div className={changed ? "cmp-blink" : ""} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", border: "1px solid var(--brd)", marginBottom: 3, fontSize: 12.5 }}>
        <span style={{ width: 3, height: 14, background: en.ho ? "var(--grn)" : "var(--acc2)", flexShrink: 0 }} />
        <span style={{ fontWeight: 600, color: "var(--w)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ge(en.empId)?.name}</span>
        {en.ho && <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9.5, color: "var(--grn)", border: "1px solid var(--grn)", padding: "0 4px" }}>HO</span>}
        {tag && <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9.5, color: "var(--amb)" }}>{tag}</span>}
      </div>;
      return <Modal open={true} onClose={() => setShowCompare(false)} title={`Stálý rozvrh vs. tento týden${schedView === "day" ? ` — ${DAYS[selDay]}` : ""}`} wide>
        <style>{`@keyframes cmpPulse { 0%,100% { background: transparent; border-color: var(--brd); } 50% { background: rgba(200,140,40,.22); border-color: var(--amb); } } .cmp-blink { animation: cmpPulse 1.2s ease-in-out infinite; }`}</style>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, fontSize: 11.5, color: "var(--tx3)", flexWrap: "wrap" }}>
          <span><span style={{ color: "var(--tx2)", fontWeight: 600 }}>vlevo</span> stálý rozvrh</span>
          <span><span style={{ color: "var(--tx2)", fontWeight: 600 }}>vpravo</span> tento týden</span>
          <span className="cmp-blink" style={{ padding: "2px 8px", border: "1px solid var(--brd)" }}>blikající = změna</span>
        </div>
        {daysToShow.map(day => {
          const d = buildDay(day);
          const anyChange = d.changed.size > 0;
          return <div key={day} style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 15, letterSpacing: 1.5, color: "var(--acc2)", textTransform: "uppercase" }}>{day}</span>
              {!anyChange && <span style={{ fontSize: 11, color: "var(--grn)" }}>✓ beze změn</span>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {["def", "cur"].map(sideKey => <div key={sideKey} style={{ border: "1px solid var(--brd)", padding: 8, background: sideKey === "cur" ? "var(--bg3)" : "transparent" }}>
                <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 11, letterSpacing: 1, color: "var(--tx3)", textTransform: "uppercase", marginBottom: 6 }}>{sideKey === "def" ? "Stálý" : "Tento týden"}</div>
                {SHIFTS.map(sh => { const list = d[sideKey][sh]; return <div key={sh} style={{ marginBottom: 6 }}>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, color: "var(--tx3)", marginBottom: 3 }}>{sh}</div>
                  {list.length ? list.map((en, ci) => <CmpChip key={en.empId + ci} en={en} changed={d.changed.has(en.empId)} tag={sideKey === "cur" && d.changed.has(en.empId) ? d.origin(en.empId) : null} />) : <div style={{ fontSize: 11, color: "var(--tx3)", padding: "3px 0 6px" }}>—</div>}
                </div>; })}
                {sideKey === "cur" && d.absent.length > 0 && <div>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, color: "var(--tx3)", marginBottom: 3 }}>nepřítomni</div>
                  {d.absent.map(a => <div key={a.empId} className="cmp-blink" style={{ display: "flex", justifyContent: "space-between", gap: 6, padding: "5px 8px", border: "1px solid var(--brd)", marginBottom: 3, fontSize: 12.5 }}>
                    <span style={{ textDecoration: "line-through", color: "var(--tx3)" }}>{ge(a.empId)?.name}</span>
                    <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: "var(--amb)" }}>{ABS.find(x => x.id === a.reason)?.label || a.reason}</span>
                  </div>)}
                </div>}
              </div>)}
            </div>
          </div>;
        })}
        <Btn ghost onClick={() => setShowCompare(false)} style={{ width: "100%", marginTop: 6 }}>Zavřít</Btn>
      </Modal>;
    })()}

    {/* ═══ RESOLVE: možnosti krytí + koho oslovit ═══ */}
    {(() => {
      if (!resolveTarget) return null;
      const { day, kind, empId, fromShift, toShift } = resolveTarget;
      const sim = dc(cs);
      if (kind === "absence") SHIFTS.forEach(sh => { if (sim[day]?.[sh]) sim[day][sh] = sim[day][sh].filter(e => e.empId !== empId); });
      if (kind === "shift") { const arr = sim[day]?.[fromShift] || []; const i = arr.findIndex(e => e.empId === empId); if (i >= 0) { const [en] = arr.splice(i, 1); if (!sim[day][toShift]) sim[day][toShift] = []; sim[day][toShift].push(en); } }
      const simAbs = kind === "absence" ? { ...absences, [fsKey(empId, day)]: "vacation" } : absences;
      const probs = analyzeWeek(sim, simAbs, employees, rules, intake, intakeAllow).problems.filter(p => p.day === day);
      const title = kind === "absence" ? `Krytí nepřítomnosti — ${day}` : `Změna hodiny — ${day}`;
      return <Modal open={true} onClose={() => setResolveTarget(null)} title={title}>
        <div>
          {kind === "shift" && <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 14, color: "var(--tx2)", marginBottom: 10 }}>Chceš přejít z {fromShift} na {toShift}. Odešli změnu ke schválení a níže domluv případné krytí.</p>
            <Btn warm onClick={() => { createProposal({ kind: "shift", empId, day, fromShift, toShift }, "změna hodiny", { [empId]: true }); notify("Změna hodiny odeslána ke schválení"); }} style={{ width: "100%" }}>Odeslat změnu {fromShift} → {toShift} ke schválení</Btn>
          </div>}
          {probs.length === 0
            ? <div style={{ padding: "12px 14px", border: "1px solid var(--grn)", color: "var(--grn)", fontSize: 14 }}>✓ {kind === "absence" ? "Tvoje nepřítomnost" : "Tato změna"} nezpůsobí podstav — není třeba nikoho shánět.</div>
            : <>
              <p style={{ fontSize: 13, color: "var(--tx2)", marginBottom: 12 }}>Tahle změna něco rozbije. Vyber jednu z možností a oslov kolegu — po jeho i adminově souhlasu se to provede.</p>
              {probs.map(pr => <div key={pr.key} style={{ border: "1px solid var(--brd)", borderLeft: "3px solid var(--red)", padding: "10px 12px", marginBottom: 10 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: "var(--w)", marginBottom: 8 }}>{pr.title}</div>
                {pr.alts.length === 0 && <p style={{ fontSize: 13, color: "var(--tx3)", margin: 0 }}>Žádné automatické řešení — domluv se s adminem.</p>}
                {pr.alts.slice(0, 5).map((alt, i) => { const colleague = ge(alt.empId); const mail = colleague?.notifyEmail || colleague?.email;
                  return <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "var(--bg3)", border: "1px solid var(--brd)", marginBottom: 4, flexWrap: "wrap" }}>
                    {i === 0 && <Badge small color="var(--grn)">TIP</Badge>}
                    <span style={{ flex: 1, fontSize: 13, minWidth: 140 }}>{altLabel(alt, ge)}</span>
                    {mail && <a href={`mailto:${mail}?subject=${encodeURIComponent("Krytí směny " + day)}&body=${encodeURIComponent(`Ahoj ${colleague.name}, potřeboval bych domluvit: ${altLabel(alt, ge)}. Šlo by?`)}`} style={{ fontSize: 12, color: "var(--tx3)", textDecoration: "none", border: "1px solid var(--brd2)", padding: "5px 8px" }}>✉ napsat</a>}
                    <Btn small warm onClick={() => { createProposal(alt, kind === "absence" ? `krytí nepřítomnosti ${day}` : `krytí změny hodiny ${day}`); notify(`Požádán/a: ${colleague?.name}`); }}>Požádat {colleague?.name?.split(" ")[0]}</Btn>
                  </div>; })}
              </div>)}
            </>}
          <Btn ghost onClick={() => setResolveTarget(null)} style={{ width: "100%", marginTop: 6 }}>Zavřít</Btn>
        </div>
      </Modal>;
    })()}
    <Modal open={modal === "addMember"} onClose={() => setModal(null)} title="Nový člen"><AddF onDone={m => { notify(m); log(m); setModal(null); }} /></Modal>
    <Modal open={modal?.type === "editDays"} onClose={() => setModal(null)} title="Upravit dny"><EditDF emp={modal?.emp} onDone={() => { notify("Uloženo"); setModal(null); }} /></Modal>
    <Modal open={modal === "changePass"} onClose={() => setModal(null)} title="Změna hesla"><ChangePassF onDone={() => { notify("Heslo změněno"); setModal(null); }} /></Modal>
    <Modal open={modal === "changeName"} onClose={() => setModal(null)} title="Změna jména"><ChangeNameF profile={profile} onDone={() => { notify("Jméno změněno"); setModal(null); }} /></Modal>
    <Modal open={modal === "changeNotif"} onClose={() => setModal(null)} title="Notifikace"><ChangeNotifF profile={profile} onDone={() => { notify("Nastavení uloženo"); setModal(null); }} /></Modal>

    <Modal open={modal?.type === "directSwap"} onClose={() => setModal(null)} title="Žádost o výměnu">{modal?.type === "directSwap" && (() => {
      const { targetEmp, targetDay, targetShift } = modal;
      const dayIdx = DAYS.indexOf(targetDay);
      const dateISO = dayIdx >= 0 ? wd[dayIdx] : "";
      const dateLabel = dateISO ? new Date(dateISO + "T00:00:00").toLocaleDateString("cs", { weekday: "long", day: "numeric", month: "long" }) : targetDay;
      return <DirectSwapF targetEmp={targetEmp} dateLabel={dateLabel} dateISO={dateISO} targetDay={targetDay} targetShift={targetShift} onSubmit={async (comment) => {
        const date = new Date(dateISO + "T00:00:00");
        const swWk = wKey(date);
        await addDoc(collection(db, "swapRequests"), {
          rid: profile.id, day: targetDay, sh: targetShift, week: swWk, dateISO,
          targetId: targetEmp.id, status: "open", comment: comment || "",
          created: new Date().toISOString()
        });
        // Email target
        if (targetEmp.notify) {
          callGAS("sendEmail", {
            to: targetEmp.notifyEmail || targetEmp.email,
            employeeName: targetEmp.name,
            changeDescription: `${profile.name} vás žádá o výměnu směny: ${dateLabel} ${targetShift}${comment ? ` — "${comment}"` : ""}`,
            weekLabel: dateISO
          });
        }
        notify(`Žádost odeslána: ${targetEmp.name}`); log(`Žádost o výměnu: ${targetEmp.name} ${dateLabel} ${targetShift}`);
        setModal(null);
      }} />;
    })()}</Modal>
  </div>;
}
