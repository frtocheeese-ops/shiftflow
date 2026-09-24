// Testy čisté logiky rozvrhu. Spuštění: npm test  (bez závislostí, vestavěný node:test)
// Každý test odpovídá chybě, která se v projektu reálně stala — viz PRECHOD-VZORCE.md.
// Testy běží nad SKUTEČNÝM src/schedule.js, ne nad kopií kódu.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SHIFTS, DAYS, PRESET, buildDef, withDefaults, applyRotations, rotIsSwapped,
  dayStats, analyzeWeek, applyAlt, getMon, localISO, computeFairness,
} from "./schedule.js";

// ── pomocníci ──
const dc = o => JSON.parse(JSON.stringify(o));
const empty = () => Object.fromEntries(DAYS.map(d => [d, { "08:00": [], "09:00": [], "10:00": [] }]));
const find = (w, day, id) => { for (const sh of SHIFTS) { const e = (w[day]?.[sh] || []).find(x => x.empId === id); if (e) return { sh, e }; } return null; };
const count = (w, day, id) => SHIFTS.reduce((n, sh) => n + (w[day]?.[sh] || []).filter(x => x.empId === id).length, 0);
const mondayOffset = weeks => localISO(getMon(new Date(Date.now() + weeks * 7 * 864e5)));
const FUTURE = mondayOffset(3), PAST = "2025-01-06";

const pair = () => [
  { id: "loch", name: "Lochman", role: "employee", setupDone: true, defaultSchedule: { Po: "08:00", "Út": "10:00", "Út_ho": true, St: "08:00" } },
  { id: "andy", name: "Andy", role: "employee", setupDone: true, defaultSchedule: { Po: "10:00", "Út": "09:00", "Út_ho": true, St: "09:00" } },
];
const ROT = [{ day: "Út", aId: "loch", bId: "andy", shiftA: "08:00", shiftB: "10:00", ho: true, anchor: "2026-09-07" }];
const team = () => Object.keys(PRESET).map((n, i) => ({ id: "u" + i, name: n, role: "employee", setupDone: true, defaultSchedule: PRESET[n] }));

// ════════════════ Stálý rozvrh ════════════════
test("PRESET: kancelář a osmička vždy splněny (desítka v pondělí je známá mezera)", () => {
  const r = analyzeWeek(buildDef(team()), {}, team(), {});
  const crit = r.violations.filter(v => v.sev === "crit");
  assert.deepEqual(crit, [], crit.map(v => v.msg).join(" | "));
});

test("změna stálého rozvrhu se okamžitě propíše do budoucího týdne", () => {
  const stored = empty(); stored.Po["09:00"].push({ empId: "loch", isDefault: true }); // stará verze: 9:00
  const w = withDefaults(stored, {}, pair(), FUTURE, []);
  assert.equal(find(w, "Po", "loch").sh, "08:00");
});

test("ruční úprava se změnou stálého rozvrhu NEpřepíše", () => {
  const stored = empty(); stored.Po["09:00"].push({ empId: "loch", isDefault: false });
  assert.equal(find(withDefaults(stored, {}, pair(), FUTURE, []), "Po", "loch").sh, "09:00");
});

test("ručně odebraný člověk se do dne nevrací", () => {
  const stored = empty(); stored.St["08:00"].push({ empId: "loch", isDefault: true }); // v týdnu je, v pondělí ne
  assert.equal(find(withDefaults(stored, {}, pair(), FUTURE, []), "Po", "loch"), null);
});

// ════════════════ Historie (statistiky férovosti) ════════════════
test("minulý týden: změna stálého rozvrhu historii nepřepíše", () => {
  const stored = empty(); stored.Po["09:00"].push({ empId: "loch", isDefault: true });
  assert.equal(find(withDefaults(stored, {}, pair(), PAST, []), "Po", "loch").sh, "09:00");
});

test("minulý týden: rotace založená později historii nepřepíše", () => {
  const stored = empty(); stored["Út"]["09:00"].push({ empId: "andy", ho: true, isDefault: true }); stored["Út"]["10:00"].push({ empId: "loch", ho: true, isDefault: true });
  assert.equal(find(withDefaults(stored, {}, pair(), PAST, ROT), "Út", "andy").sh, "09:00");
});

test("minulý týden: kolega se nedoplní do týdne před svým nástupem", () => {
  const emps = [...pair(), { id: "novy", name: "Viktor", setupDone: true, createdAt: "2026-09-01T08:00:00Z", defaultSchedule: { Po: "08:00" } }];
  const stored = empty(); stored.Po["08:00"].push({ empId: "loch", isDefault: true });
  assert.equal(find(withDefaults(stored, {}, emps, PAST, []), "Po", "novy"), null);
});

test("nový kolega se doplní do budoucího týdne materializovaného před jeho příchodem", () => {
  const emps = [...pair(), { id: "novy", name: "Viktor", setupDone: true, createdAt: "2026-09-01T08:00:00Z", defaultSchedule: { Po: "09:00" } }];
  const stored = empty(); stored.Po["08:00"].push({ empId: "loch", isDefault: true });
  assert.equal(find(withDefaults(stored, {}, emps, FUTURE, []), "Po", "novy").sh, "09:00");
});

// ════════════════ Rotace dvojic ════════════════
test("rotace se střídá po týdnech", () => {
  const a = withDefaults(null, {}, pair(), "2026-09-07", ROT), b = withDefaults(null, {}, pair(), "2026-09-14", ROT);
  assert.equal(find(a, "Út", "loch").sh, "08:00"); assert.equal(find(b, "Út", "andy").sh, "08:00");
});

test("rotace: parita stabilní přes přechod na zimní čas", () => {
  assert.equal(rotIsSwapped("2026-10-26", "2026-10-19"), true);   // přes 25. 10. (změna času)
  assert.equal(rotIsSwapped("2026-11-02", "2026-10-19"), false);
});

test("rotace v den Nástupů prohodí časy, ale bez HO a bez porušení", () => {
  const w = withDefaults(null, {}, pair(), "2026-09-14", ROT, { "Út": true }, {});
  assert.equal(find(w, "Út", "andy").e.ho, false); assert.equal(find(w, "Út", "loch").e.ho, false);
  assert.equal(analyzeWeek(w, {}, pair(), {}, { "Út": true }, {}).violations.filter(v => v.intake).length, 0);
});

test("rotace v den Nástupů respektuje výjimku", () => {
  const w = withDefaults(null, {}, pair(), "2026-09-14", ROT, { "Út": true }, { "Út": ["andy"] });
  assert.equal(find(w, "Út", "andy").e.ho, true); assert.equal(find(w, "Út", "loch").e.ho, false);
});

test("rotace: ruční úprava jednoho z dvojice rotaci v tom týdnu vypne", () => {
  const stored = empty(); stored["Út"]["09:00"].push({ empId: "andy", ho: true, isDefault: false }); stored["Út"]["10:00"].push({ empId: "loch", ho: true, isDefault: true });
  assert.equal(find(withDefaults(stored, {}, pair(), FUTURE, ROT), "Út", "andy").sh, "09:00");
});

// ════════════════ Půlden ════════════════
test("půlden: člověk zůstává ve směně a nese označení i zvolenou polovinu", () => {
  const stored = withDefaults(null, {}, pair(), FUTURE, []);
  Object.assign(find(stored, "St", "loch").e, { halfAbs: "half_vacation", halfPart: "second" });
  const f = find(withDefaults(stored, { loch__St: "half_vacation" }, pair(), FUTURE, []), "St", "loch");
  assert.ok(f); assert.equal(f.e.halfAbs, "half_vacation"); assert.equal(f.e.halfPart, "second");
});

test("půlden: rotace se nevypne a druhý z dvojice neskočí na staré místo", () => {
  const stored = withDefaults(null, {}, pair(), "2026-09-14", ROT);
  Object.assign(find(stored, "Út", "loch").e, { halfAbs: "half_vacation", halfPart: "first" });
  const w = withDefaults(stored, { "loch__Út": "half_vacation" }, pair(), "2026-09-14", ROT);
  assert.equal(find(w, "Út", "andy").sh, "08:00"); assert.equal(find(w, "Út", "loch").e.halfAbs, "half_vacation");
});

test("půlden: člověk vypadlý z uloženého týdne (stará chyba) se do směny vrátí", () => {
  const stored = empty(); stored.Po["08:00"].push({ empId: "loch", isDefault: true }); // v týdnu je, v úterý v DB chybí
  const w = withDefaults(stored, { "loch__Út": "half_vacation" }, pair(), FUTURE, []);
  const f = find(w, "Út", "loch"); assert.ok(f, "Lochman chybí ve směně"); assert.equal(f.e.halfAbs, "half_vacation");
});

test("celodenní absence člověka ze dne vyřadí", () => {
  assert.equal(find(withDefaults(null, { loch__St: "vacation" }, pair(), FUTURE, []), "St", "loch"), null);
});

test("půlden: do plného pokrytí dne se nepočítá", () => {
  const stored = withDefaults(null, {}, pair(), FUTURE, []);
  Object.assign(find(stored, "St", "loch").e, { halfAbs: "half_vacation", halfPart: "first" });
  assert.equal(dayStats(stored, { loch__St: "half_vacation" }, "St", pair()).office.some(o => o.empId === "loch"), false);
});

test("žádné duplicity: člověk je v jednom dni nejvýš jednou", () => {
  const stored = withDefaults(null, {}, pair(), "2026-09-14", ROT);
  Object.assign(find(stored, "Út", "loch").e, { halfAbs: "half_vacation", halfPart: "first" });
  const w = withDefaults(withDefaults(stored, { "loch__Út": "half_vacation" }, pair(), "2026-09-14", ROT), { "loch__Út": "half_vacation" }, pair(), "2026-09-14", ROT);
  for (const d of DAYS) for (const id of ["loch", "andy"]) assert.ok(count(w, d, id) <= 1, `${id} ${d} ×${count(w, d, id)}`);
});

test("withDefaults je idempotentní (opakované načtení nic nemění)", () => {
  const once = withDefaults(null, { "loch__Út": "half_vacation" }, pair(), "2026-09-14", ROT, { "Út": true }, {});
  const twice = withDefaults(dc(once), { "loch__Út": "half_vacation" }, pair(), "2026-09-14", ROT, { "Út": true }, {});
  assert.deepEqual(twice, once);
});

// ════════════════ Návrhy řešení ════════════════
test("problém, kde chybí víc lidí, jde vyřešit po krocích (deficit klesá)", () => {
  const emps = [0, 1, 2, 3, 4].map(i => ({ id: "e" + i, name: "E" + i, role: "employee" }));
  let w = empty(); w.Po["09:00"] = [{ empId: "e0" }, { empId: "e1" }, { empId: "e2" }]; w.Po["10:00"] = [{ empId: "e3" }, { empId: "e4", ho: true }];
  const p1 = analyzeWeek(w, {}, emps, {}).problems.find(p => p.key === "08:00:Po");
  assert.equal(p1.deficit, 2); applyAlt(w, p1.alts[0]);
  const p2 = analyzeWeek(w, {}, emps, {}).problems.find(p => p.key === "08:00:Po");
  assert.equal(p2.deficit, 1);
});

// ════════════════ Férovost ════════════════
const wkDoc = (entries, absences = {}) => ({ entries, absences });
const pw = () => { const w = empty(); w.Po["08:00"] = [{ empId: "a", isDefault: false }]; w.Po["10:00"] = [{ empId: "b", isDefault: false }]; w["Út"]["09:00"] = [{ empId: "a", ho: true, isDefault: false }]; return w; };
const fe = () => [{ id: "a", name: "A", role: "employee", setupDone: true, defaultSchedule: {} }, { id: "b", name: "B", role: "employee", setupDone: true, defaultSchedule: {} }, { id: "adm", name: "Admin", role: "admin" }];

test("férovost: počítá 8:00, 10:00 a HO a vynechá admina", () => {
  const r = computeFairness({ "2026-09-14": wkDoc(pw()) }, fe(), []);
  const a = r.rows.find(x => x.id === "a"), b = r.rows.find(x => x.id === "b");
  assert.equal(a.eight, 1); assert.equal(a.ho, 1); assert.equal(b.ten, 1);
  assert.equal(r.rows.some(x => x.id === "adm"), false);
});

test("férovost: dny před startovním datem se nepočítají", () => {
  assert.equal(computeFairness({ "2026-07-13": wkDoc(pw()) }, fe(), []).rows.find(x => x.id === "a").eight, 0);
});

test("férovost: HO deficit — stálý rozvrh říká HO, ale byl v kanceláři", () => {
  const emps = fe(); emps[0].defaultSchedule = { Po: "08:00", Po_ho: true };
  assert.equal(computeFairness({ "2026-09-14": wkDoc(pw()) }, emps, []).rows.find(x => x.id === "a").deficit, 1);
});

test("férovost: hlídač nahlásí rozdíl větší než 3", () => {
  const docs = {}; ["2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"].forEach(k => { docs[k] = wkDoc(pw()); });
  assert.ok(computeFairness(docs, fe(), []).warn.some(w => w.metric === "eight"));
});

test("férovost: nový kolega nedostane směny z týdnů před nástupem", () => {
  const emps = [...fe(), { id: "n", name: "N", role: "employee", setupDone: true, createdAt: "2026-10-01T00:00:00Z", defaultSchedule: { Po: "08:00" } }];
  assert.equal(computeFairness({ "2026-09-14": wkDoc(pw()) }, emps, []).rows.find(x => x.id === "n").eight, 0);
});
