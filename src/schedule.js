/* ═══════════════════════════════════════════════════════════════════════════
   schedule.js — ČISTÁ LOGIKA ROZVRHU (bez Reactu, bez Firebase)
   ---------------------------------------------------------------------------
   Jediný zdroj pravdy pro skládání rozvrhu. Všechno, co z uloženého týdne
   odvozuje „jak rozvrh opravdu vypadá", MUSÍ jít přes withDefaults().
   Pravidla (invarianty), která kód drží — viz také ARCHITECTURE.md:
     1. Ruční úprava (isDefault:false) má vždy přednost před stálým rozvrhem i rotací.
     2. Celodenní absence člověka ze dne vyřadí; půlden (half_*) ho NECHÁ a označí.
     3. Minulé týdny jsou historie: nepřepisují se změnou stálého rozvrhu,
        rotací založenou později ani doplněním kolegy, který tehdy ještě nebyl.
     4. V den Nástupů rotace prohodí časy, ale bez home office.
   Testy: npm test  (src/schedule.test.mjs — běží nad TÍMTO souborem, ne nad kopií)
   ═══════════════════════════════════════════════════════════════════════════ */
/* ═══ CONSTANTS ═══ */
export const SHIFTS = ["08:00", "09:00", "10:00"];
export const DAYS = ["Po", "Út", "St", "Čt", "Pá"];
export const DAYS_F = ["Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek"];
export const ABS = [
  { id: "sick", label: "Sick Day", icon: "🤒", color: "#c04040" },
  { id: "doctor", label: "Lékař", icon: "🏥", color: "#d48020" },
  { id: "vacation", label: "Dovolená", icon: "🏖️", color: "#4080b0" },
  { id: "whatever", label: "Whatever", icon: "☕", color: "#8070b0" },
  { id: "training", label: "Školení", icon: "📚", color: "#308060" },
  { id: "business_trip", label: "Služební cesta", icon: "🚗", color: "#3c90a8" },
  { id: "half_vacation", label: "½ Dovolená", icon: "½🏖", color: "#4080b0" },
  { id: "half_ho", label: "½ HO", icon: "½🏠", color: "#50a060" },
];
export const EVTS = [{ id: "training", label: "Školení", icon: "📚" }, { id: "dinner", label: "Večeře", icon: "🍽️" }, { id: "teambuilding", label: "Teambuilding", icon: "🎯" }, { id: "meeting", label: "Porada", icon: "💬" }, { id: "other", label: "Jiné", icon: "📌" }];
export const HMAP = {
  '2025-01-01':'Nový rok','2025-04-18':'Velký pátek','2025-04-21':'Vel. pondělí','2025-05-01':'Svátek práce','2025-05-08':'Den vítězství','2025-07-05':'Cyril a Metoděj','2025-07-06':'Jan Hus','2025-09-28':'Den české státnosti','2025-10-28':'Den vzniku ČSR','2025-11-17':'Den svobody','2025-12-24':'Štědrý den','2025-12-25':'1. svátek vánoční','2025-12-26':'2. svátek vánoční',
  '2026-01-01':'Nový rok','2026-04-03':'Velký pátek','2026-04-06':'Vel. pondělí','2026-05-01':'Svátek práce','2026-05-08':'Den vítězství','2026-07-05':'Cyril a Metoděj','2026-07-06':'Jan Hus','2026-09-28':'Den české státnosti','2026-10-28':'Den vzniku ČSR','2026-11-17':'Den svobody','2026-12-24':'Štědrý den','2026-12-25':'1. svátek vánoční','2026-12-26':'2. svátek vánoční',
  '2027-01-01':'Nový rok','2027-03-26':'Velký pátek','2027-03-29':'Vel. pondělí','2027-05-01':'Svátek práce','2027-05-08':'Den vítězství','2027-07-05':'Cyril a Metoděj','2027-07-06':'Jan Hus','2027-09-28':'Den české státnosti','2027-10-28':'Den vzniku ČSR','2027-11-17':'Den svobody','2027-12-24':'Štědrý den','2027-12-25':'1. svátek vánoční','2027-12-26':'2. svátek vánoční',
};

/* ═══ HELPERS ═══ */
export const dc = o => JSON.parse(JSON.stringify(o));
export const uid = () => "u" + Math.random().toString(36).slice(2, 9);
export function getMon(d) { const dt = new Date(d); const dy = dt.getDay(); dt.setDate(dt.getDate() - dy + (dy === 0 ? -6 : 1)); dt.setHours(0, 0, 0, 0); return dt; }
export function localISO(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
export const wKey = d => localISO(getMon(d));
export const fmtW = d => { const m = getMon(d), f = new Date(m); f.setDate(f.getDate() + 4); return `${m.getDate()}.${m.getMonth() + 1}. — ${f.getDate()}.${f.getMonth() + 1}.${f.getFullYear()}`; };
export function buildDef(emps) { const s = {}; DAYS.forEach(day => { s[day] = {}; SHIFTS.forEach(sh => s[day][sh] = []); emps.forEach(emp => { if (!emp.defaultSchedule || !emp.setupDone) return; const shift = emp.defaultSchedule[day]; if (shift && SHIFTS.includes(shift)) s[day][shift].push({ empId: emp.id, ho: emp.defaultSchedule[`${day}_ho`] || false, isDefault: true }); }); }); return s; }

// Půlden (half_*) člověka NEVYŘAZUJE ze směny — jen ho označí. Celodenní absence ano.
export const isFullAbs = t => !!t && !String(t).startsWith("half_");

/* ═══ ROTACE DVOJIC ═══
   Dvěma lidem se v daný den každý týden prohodí směna (typicky HO 8:00 ↔ HO 10:00).
   Parita se počítá od kotvícího pondělí, takže je stabilní dopředu i zpětně.
   Rotace se uplatní JEN na místa, která nikdo ručně nepřepsal (isDefault) — ruční
   úprava má vždy přednost. */
export function rotIsSwapped(weekKey, anchor) {
  const a = new Date((anchor || "2026-01-05") + "T00:00:00"), w = new Date(weekKey + "T00:00:00");
  const weeks = Math.round((w - a) / (7 * 24 * 3600 * 1000));
  return ((weeks % 2) + 2) % 2 === 1;
}
export function applyRotations(entries, weekKey, rotations, absences, intake, intakeAllow) {
  if (!weekKey || !Array.isArray(rotations) || !rotations.length) return entries;
  rotations.forEach(rot => {
    const { day, aId, bId, shiftA, shiftB } = rot;
    if (!day || !aId || !bId || !shiftA || !shiftB) return;
    if (rot.anchor && weekKey < rot.anchor) return;          // týdny před založením rotace = historie
    if (!entries[day]) return;
    const find = id => { for (const sh of SHIFTS) { const i = (entries[day][sh] || []).findIndex(e => e.empId === id); if (i >= 0) return { sh, i, en: entries[day][sh][i] }; } return null; };
    const A = find(aId), B = find(bId);
    if (!A || !B) return;                                   // někdo chybí (absence/volno) → nerotujeme
    if (!A.en.isDefault || !B.en.isDefault) return;          // ruční úprava má přednost
    if (isFullAbs((absences || {})[`${aId}__${day}`]) || isFullAbs((absences || {})[`${bId}__${day}`])) return; // půlden rotaci nevypíná
    const swapped = rotIsSwapped(weekKey, rot.anchor);
    const targetA = swapped ? shiftB : shiftA, targetB = swapped ? shiftA : shiftB;
    // V den Nástupů se čas prohodí jako obvykle, ale BEZ home office (pokud nemá výjimku).
    // Jinak by rotace sama vyrobila porušení pravidla Nástupů, admin by ho „opravil",
    // tím by z rotovaných míst udělal ruční úpravu a rotace by se v tom týdnu vypnula.
    const jeNastup = !!(intake || {})[day];
    const vyjimka = id => ((intakeAllow || {})[day] || []).includes(id);
    const hoZaklad = rot.ho !== false;
    const hoA = hoZaklad && (!jeNastup || vyjimka(aId));
    const hoB = hoZaklad && (!jeNastup || vyjimka(bId));
    entries[day][A.sh] = entries[day][A.sh].filter(e => e.empId !== aId);
    entries[day][B.sh] = entries[day][B.sh].filter(e => e.empId !== bId);
    if (!entries[day][targetA]) entries[day][targetA] = [];
    if (!entries[day][targetB]) entries[day][targetB] = [];
    const half = en => en.halfAbs ? { halfAbs: en.halfAbs, halfPart: en.halfPart || "first" } : {};
    entries[day][targetA].push({ empId: aId, ho: hoA, isDefault: true, rot: true, ...half(A.en) });
    entries[day][targetB].push({ empId: bId, ho: hoB, isDefault: true, rot: true, ...half(B.en) });
  });
  return entries;
}

/* Doplní do uloženého týdne členy, kteří v něm ještě nefigurují (typicky nový kolega,
   který přišel až po materializaci týdne) — podle jejich stálého rozvrhu.
   JEDINÝ zdroj pravdy pro mřížku, engine, návrhy i statistiky, aby se nerozcházely. */
export function withDefaults(entries, absences, emps, weekKey, rotations, intake, intakeAllow) {
  const merged = entries ? dc(entries) : buildDef(emps);
  DAYS.forEach(day => { if (!merged[day]) merged[day] = {}; SHIFTS.forEach(sh => { if (!merged[day][sh]) merged[day][sh] = []; }); });
  // Minulé týdny jsou historie — ty se aktuálním stálým rozvrhem nepřepisují (jinak by se
  // měnily i odpracované směny ve statistikách). Obnovuje se jen tento a budoucí týdny.
  const isPast = weekKey && weekKey < localISO(getMon(new Date()));
  emps.forEach(emp => {
    if (!emp.defaultSchedule || !emp.setupDone) return;
    // Týden před nástupem kolegy = historie; nedoplňovat (jinak by mu statistiky připsaly neodpracované směny)
    const joinedWeek = emp.createdAt ? localISO(getMon(new Date(emp.createdAt))) : null;
    const beforeJoin = !!(joinedWeek && weekKey && weekKey < joinedWeek);
    const placed = {};
    let anywhere = false;
    DAYS.forEach(day => { for (const sh of SHIFTS) { const en = merged[day][sh].find(e => e.empId === emp.id); if (en) { placed[day] = { sh, en }; anywhere = true; break; } } });
    const hasAbsence = Object.entries(absences || {}).some(([k, t]) => k.startsWith(`${emp.id}__`) && isFullAbs(t));
    if (!anywhere && hasAbsence) return;  // v týdnu není a má celodenní absenci → řeší absenční logika

    DAYS.forEach(day => {
      const cur = placed[day];
      const absT = absences?.[`${emp.id}__${day}`];
      const halfDay = !!absT && !isFullAbs(absT);
      if (cur && !cur.en.isDefault) return;                    // ruční úprava má přednost
      if (cur && isPast) return;                               // historii nepřepisujeme
      // Ručně odebraný ze dne se nevrací — VÝJIMKA: půlden. Ten znamená, že člověk ten den
      // pracuje, takže ve směně být musí (opravuje i týdny poškozené dřívější chybou).
      if (!cur && anywhere && !halfDay) return;
      if (!cur && beforeJoin) return;
      if (cur) merged[day][cur.sh] = merged[day][cur.sh].filter(e => e.empId !== emp.id);
      if (isFullAbs(absT)) return;                             // celodenní nepřítomnost → ze dne pryč
      const shift = emp.defaultSchedule[day];
      if (!shift || !SHIFTS.includes(shift)) return;           // stálý rozvrh říká volno
      const en = { empId: emp.id, ho: emp.defaultSchedule[`${day}_ho`] || false, isDefault: true };
      if (absT) { en.halfAbs = absT; en.halfPart = cur?.en.halfPart || "first"; } // půlden: zůstává a nese označení
      merged[day][shift].push(en);
    });
  });
  return applyRotations(merged, weekKey, rotations, absences, intake, intakeAllow);
}

/* ═══ PŘEDVYPLNĚNÝ ROZVRH dle preferencí členů (upravitelný v editoru Default) ═══
   Entry na den: "08:00"/"09:00"/"10:00" = kancelář; s `${den}_ho:true` = home office.
   HO drží nominální čas ve svém slotu. Klíčováno jménem — seed napasuje na uživatele. */
export const PRESET = {
  "Slavíček": { Po: "08:00", "Út": "08:00", St: "08:00", "Čt": "08:00", "Pá": "08:00" },
  "Víťa":     { Po: "09:00", "Út": "08:00", St: "09:00", "Čt": "09:00", "Pá": "08:00" },
  "Stibor":   { Po: "08:00", Po_ho: true, "Út": "08:00", St: "10:00", "Čt": "10:00", "Čt_ho": true, "Pá": "08:00" },
  "Lochman":  { Po: "08:00", "Út": "10:00", "Út_ho": true, St: "08:00", "Čt": "08:00", "Pá": "09:00", "Pá_ho": true },
  "Frťala":   { Po: "09:00", "Út": "10:00", St: "08:00", St_ho: true, "Čt": "08:00", "Čt_ho": true, "Pá": "10:00" },
  "Švarc":    { "Út": "09:00", St: "10:00", St_ho: true, "Čt": "10:00", "Pá": "09:00" }, // Vláďa — pondělí volno (bez klíče Po)
  "Andy":     { Po: "10:00", "Út": "09:00", "Út_ho": true, St: "09:00", "Čt": "09:00", "Pá": "10:00", "Pá_ho": true },
};
// Přejmenování člena při seedu (staré jméno v DB → nové). Bezpečné i když se nikdo nejmenuje "Franta".
export const RENAME = { Franta: "Víťa" };
// Osobní preference/pravidla (silná, ale admin je může přebít úpravou). Klíč = jméno v appce.
export const PERSONAL = {
  "Slavíček": { mustOpen: true },          // Jirka S. — 8:00 celý týden v kanceláři
  "Víťa":     { noHO: true },              // nemá nárok na HO
  "Andy":     { noOpen: true },            // nikdy 8:00 v kanceláři
  "Lochman":  { noTenOn: "St" },           // ve středu ne od 10:00
};
export const personalOf = (employees, eid) => PERSONAL[(employees.find(e => e.id === eid) || {}).name] || {};

export const RULE_DEFAULTS = { officeMin: 4, hoCapDay: 3, hoPerWeek: 2, cover8: true, cover10: true, min8: 2, min10: 2 };

/* Analýza týdne: porušení pravidel + problémy se VŠEMI proveditelnými alternativami řešení */
export function dayStats(cs, absences, day, employees) {
  const absSet = new Set(Object.keys(absences).filter(k => k.endsWith(`__${day}`)).map(k => k.split("__")[0]));
  const office = [], ho = [];
  SHIFTS.forEach(sh => (cs[day]?.[sh] || []).forEach(en => {
    // Výjimka: půlden na 1. polovinu u směny od 10:00 pokrytí neohrozí → nevyžaduje návrh řešení.
    const halfCovers = !!en.halfAbs && en.halfPart === "first" && sh === "10:00";
    if (absSet.has(en.empId) && !halfCovers) return;
    if (!employees.some(e => e.id === en.empId)) return;
    (en.ho ? ho : office).push({ empId: en.empId, shift: sh, half: !!en.halfAbs });
  }));
  return { office, ho, absSet };
}

export function analyzeWeek(cs, absences, employees, rulesIn, intake = {}, intakeAllow = {}) {
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
      .filter(x => !x.half)
      .filter(x => x.shift !== toShift && cnt(x.shift) > shiftMin(x.shift))
      .filter(x => toShift !== "08:00" || canOpen(x.empId))
      .sort((a, b) => ((a.shift === "09:00") ? 0 : 1) - ((b.shift === "09:00") ? 0 : 1))
      .map(x => ({ kind: "shift", empId: x.empId, day, fromShift: x.shift, toShift }));
    // Alternativy: stažení člověka z HO do kanceláře na cílovou směnu
    const pullAlts = toShift => {
      const out = [];
      st.ho.forEach(h => {
        if (h.half) return; // půlden nikam nepřesouvat
        if (toShift === "08:00" && !canOpen(h.empId)) return;
        for (let dj = 0; dj < 5; dj++) {
          if (dj === di || intake[DAYS[dj]]) continue;
          const stj = stats[dj];
          if (stj.absSet.has(h.empId)) continue;
          const mine = stj.office.find(x => x.empId === h.empId);
          if (!mine || mine.half) continue;
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
      problems.push({ key: `head:${day}`, day, deficit: short, title: `${day}: v kanceláři jen ${st.office.length} lidí (minimum ${R.officeMin})`, alts: pullAlts(toShift) });
    } else {
      // 8:00 — minimálně min8 v kanceláři
      if (R.cover8 && off8 < min8) {
        violations.push({ sev: "crit", day, msg: `${day}: v kanceláři od 8:00 jen ${off8} (potřeba ${min8})` });
        const alts = [...shiftAlts("08:00"), ...pullAlts("08:00")];
        if (alts.length) problems.push({ key: `08:00:${day}`, day, deficit: min8 - off8, title: `${day}: potřeba ${min8} v kanceláři od 8:00`, alts });
      }
      // 10:00 — minimálně min10, aspoň 1 z kanceláře
      if (R.cover10 && (off10 < 1 || (off10 + ho10) < min10)) {
        const total = off10 + ho10;
        const noOffice = off10 < 1;
        const msg = noOffice ? `${day}: od 10:00 nikdo v kanceláři` : `${day}: na 10:00 jen ${total} (potřeba ${min10}, aspoň 1 v kanceláři)`;
        violations.push({ sev: noOffice ? "crit" : "warn", day, msg });
        const alts = [...shiftAlts("10:00"), ...pullAlts("10:00")];
        if (alts.length) problems.push({ key: `10:00:${day}`, day, deficit: Math.max(1 - off10, 0) + Math.max(min10 - total, 0), title: msg, alts });
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
      if (offenders.length) problems.push({ key: `intake:${day}`, day, intake: true, deficit: offenders.length, title: `Nástupy ${day}: ${offenders.length}× HO (doporučeno bez HO)`, alts: offenders.map(h => ({ kind: "dropHO", empId: h.empId, day })) });
    }
  });
  Object.entries(weeklyHO).forEach(([eid, n]) => { if (n > R.hoPerWeek) violations.push({ sev: "warn", day: null, empId: eid, msg: `HO ${n}× v týdnu (strop ${R.hoPerWeek})` }); });
  return { violations, problems, stats, weeklyHO };
}

/* Aplikace schválené alternativy na entries (mutuje kopii) */
export function applyAlt(s, alt) {
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

export function altLabel(alt, ge) {
  const n = ge(alt.empId)?.name || "?";
  if (alt.kind === "pullHO") return `${alt.day}: ${n} z HO do kanceláře na ${alt.toShift}${alt.moveToDay ? `, HO náhradou v ${alt.moveToDay}` : " (bez náhrady)"}`;
  if (alt.kind === "shift") return `${alt.day}: ${n} ${alt.fromShift} → ${alt.toShift}`;
  if (alt.kind === "grantHO") return `${alt.day}: ${n} — Home Office`;
  if (alt.kind === "dropHO") return `${alt.day}: ${n} — zrušení Home Office`;
  return "";
}
export const fsKey = (...parts) => parts.join("__");

/* ═══ FÉROVOST ═══
   Počty odpracovaných směn od 8:00, od 10:00, dnů HO a „HO deficitu" (stálý rozvrh říká
   HO, ale člověk byl v kanceláři) — od FAIRNESS_START. Hlídač hlásí rozdíl > FAIR_SPREAD. */
export const FAIRNESS_START = "2026-07-22"; // počítá se jen od tohoto dne (včetně)
export const FAIR_SPREAD = 3;
export function computeFairness(allSchedules, employees, rotations, start = FAIRNESS_START, spread = FAIR_SPREAD) {
  const tally = {};
  const active = employees.filter(e => e.role !== "admin");
  active.forEach(e => tally[e.id] = { eight: 0, ten: 0, ho: 0, deficit: 0, weeks: 0 });
  Object.entries(allSchedules || {}).forEach(([wkKeyStr, data]) => {
    const entries = withDefaults(data.entries, data.absences, employees, wkKeyStr, rotations, data.intake, data.intakeAllow);
    const monday = new Date(wkKeyStr + "T00:00:00");
    const seen = new Set();
    DAYS.forEach((day, i) => {
      const dd = new Date(monday); dd.setDate(monday.getDate() + i);
      if (localISO(dd) < start) return; // den před startem se nepočítá
      const present = {}; // empId → záznam toho dne (pro HO deficit)
      SHIFTS.forEach(sh => (entries[day]?.[sh] || []).forEach(en => {
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
  const warn = [];
  ["eight", "ten", "ho"].forEach(m => {
    const vals = rows.filter(r => r.weeks > 0).map(r => r[m]);
    if (vals.length < 2) return;
    const max = Math.max(...vals), min = Math.min(...vals);
    if (max - min > spread) {
      const hi = rows.filter(r => r[m] === max && r.weeks > 0).map(r => r.name);
      const lo = rows.filter(r => r[m] === min && r.weeks > 0).map(r => r.name);
      const label = m === "eight" ? "směn od 8:00" : m === "ten" ? "směn od 10:00" : "dnů HO";
      warn.push({ metric: m, spread: max - min, msg: `Nerovnoměrný počet ${label}: nejvíc ${hi.join(", ")} (${max}), nejmíň ${lo.join(", ")} (${min})` });
    }
  });
  return { rows, warn };
}

// „2026-09-22" → „22.9."
export function fmtDate(iso) { const p = iso.split('-'); return `${parseInt(p[2])}.${parseInt(p[1])}.`; }

// Index dnešního pracovního dne (Po=0 … Pá=4), o víkendu -1; isTd = je to dnešek v aktuálním týdnu?
export const todayIdx = (() => { const d = new Date().getDay(); return d >= 1 && d <= 5 ? d - 1 : -1; })();
export const isTd = (i, wo) => wo === 0 && todayIdx >= 0 && i === todayIdx;
