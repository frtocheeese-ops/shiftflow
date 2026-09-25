// Test vykreslení obrazovek: každou obrazovku ze src/views/ skutečně vykreslí
// (react-dom/server) s realistickými daty. Chytá pády za běhu, které build ani lint
// nevidí — přesně ten typ chyby, co jednou shodil appku na prázdnou obrazovku.
// Spuštění: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { TEAM_WEEK } from "./test-fixtures.mjs";

const OUT = "node_modules/.cache/view-tests";

// Obrazovku zabalíme esbuildem (JSX → JS). React zůstává externí a načte se z node_modules.
async function loadView(name) {
  mkdirSync(OUT, { recursive: true });
  const file = `${OUT}/${name}.mjs`;
  await build({
    entryPoints: [`src/views/${name}.jsx`], outfile: file, bundle: true, format: "esm",
    platform: "node", jsx: "automatic", logLevel: "silent",
    external: ["react", "react-dom", "react/jsx-runtime"],
  });
  return (await import(pathToFileURL(file).href + `?t=${Date.now()}`)).default;
}

async function render(Component, props) {
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(React.createElement(Component, props));
}

const employees = [
  { id: "a", name: "Jiří Slavíček", role: "employee", setupDone: true, fixCount: 3 },
  { id: "b", name: "Andy", role: "employee", setupDone: true },
  { id: "adm", name: "Admin", role: "admin", setupDone: true },
];
const fairness = {
  rows: [
    { id: "a", name: "Jiří Slavíček", eight: 12, ten: 1, ho: 0, deficit: 0, weeks: 6, fixes: 3 },
    { id: "b", name: "Andy", eight: 0, ten: 5, ho: 9, deficit: 2, weeks: 6, fixes: 0 },
  ],
  warn: [{ metric: "eight", spread: 12, msg: "Nerovnoměrný počet směn od 8:00: nejvíc Jiří Slavíček (12), nejmíň Andy (0)" }],
};
const profile = { id: "b", name: "Andy", vacationTotal: 20, vacationUsed: 4, sickTotal: 5, sickUsed: 1, whateverTotal: 3, whateverUsed: 0 };

test("StatsView: vykreslí se pro admina", async () => {
  const StatsView = await loadView("StatsView");
  const html = await render(StatsView, { isA: true, profile, employees, openSwapsCount: 2, fairness, onEditDays: () => {} });
  assert.match(html, /Férovost/);
  assert.match(html, /Jiří Slavíček/);
  assert.match(html, /Nerovnoměrný počet/);
  assert.doesNotMatch(html, /Moje dny/);            // admin nemá kartu „Moje dny"
});

test("StatsView: vykreslí se pro člena včetně jeho zbývajících dnů", async () => {
  const StatsView = await loadView("StatsView");
  const html = await render(StatsView, { isA: false, profile, employees, openSwapsCount: 0, fairness, onEditDays: () => {} });
  assert.match(html, /Moje dny/);
  assert.match(html, />16</);                       // dovolená 20 − 4
});

test("StatsView: vykreslí se i bez dat (nový tým, prázdná férovost)", async () => {
  const StatsView = await loadView("StatsView");
  const html = await render(StatsView, { isA: true, profile, employees: [], openSwapsCount: 0, fairness: { rows: [], warn: [] }, onEditDays: () => {} });
  assert.match(html, /Férovost/);
});


test("LogView: vykreslí záznamy i prázdný log", async () => {
  const LogView = await loadView("LogView");
  const html = await render(LogView, { logs: [{ id: "1", time: "2026-09-18T10:00:00Z", msg: "Vyřešeno: Andy 09:00 → 08:00" }] });
  assert.match(html, /Vyřešeno: Andy/);
  assert.match(await render(LogView, { logs: [] }), /Log/);
});

const swapEmps = { a: { id: "a", name: "Jiří Slavíček" }, b: { id: "b", name: "Andy" } };
const swaps = [{ id: "s1", rid: "a", dateISO: "2026-09-22", sh: "08:00", comment: "Mám doktora" }];
const swapProps = over => ({ isA: false, profile: { id: "b" }, swaps, ge: id => swapEmps[id], onAccept() {}, onCancel() {}, onDelete() {}, onNewRequest() {}, ...over });

test("SwapsView: jiný člen vidí Přijmout, žadatel Tvoje + Zrušit, admin smazání", async () => {
  const SwapsView = await loadView("SwapsView");
  const jiny = await render(SwapsView, swapProps({}));
  assert.match(jiny, /Přijmout/); assert.match(jiny, /Mám doktora/); assert.match(jiny, /Nová žádost/);
  const zadatel = await render(SwapsView, swapProps({ profile: { id: "a" } }));
  assert.match(zadatel, /Tvoje/); assert.match(zadatel, /Zrušit/); assert.doesNotMatch(zadatel, /Přijmout/);
  const admin = await render(SwapsView, swapProps({ isA: true, profile: { id: "adm" } }));
  assert.doesNotMatch(admin, /Přijmout/); assert.doesNotMatch(admin, /Nová žádost/); assert.match(admin, /✕/);
});

test("SwapsView: prázdný seznam", async () => {
  const SwapsView = await loadView("SwapsView");
  assert.match(await render(SwapsView, swapProps({ swaps: [] })), /Žádné žádosti/);
});

test("DefaultsView: tabulka stálého rozvrhu, HO a prázdný den", async () => {
  const DefaultsView = await loadView("DefaultsView");
  const emps = [
    { id: "a", name: "Jiří Slavíček", role: "employee", setupDone: true, defaultSchedule: { Po: "08:00", "Út": "08:00" } },
    { id: "b", name: "Andy", role: "employee", setupDone: true, defaultSchedule: { Po: "10:00", Po_ho: true } },
    { id: "adm", name: "Admin", role: "admin" },
  ];
  const html = await render(DefaultsView, { employees: emps, onSaveDefault: async () => {} });
  assert.match(html, /Stálý rozvrh/); assert.doesNotMatch(html, /Předvyplnit/);
  assert.match(html, /Jiří Slavíček/); assert.match(html, />HO</); assert.match(html, />08:00</);
  assert.doesNotMatch(html, />Admin</);            // admin v tabulce není
});

test("PeopleView: členové se zbývajícími dny a fixy, bez admina", async () => {
  const PeopleView = await loadView("PeopleView");
  const emps = [
    { id: "a", name: "Jiří Slavíček", role: "employee", vacationTotal: 20, vacationUsed: 5, fixCount: 4 },
    { id: "b", name: "Andy", role: "employee" },
    { id: "adm", name: "Admin", role: "admin" },
  ];
  const html = await render(PeopleView, { employees: emps, onAdd() {}, onEditDays() {}, onDelete() {}, onAdjustFixes() {} });
  assert.match(html, /Jiří Slavíček/); assert.match(html, /Andy/); assert.doesNotMatch(html, />Admin</);
  assert.match(html, />15</);                        // dovolená 20 − 5
  assert.match(html, /Vyřešené problémy/);
});

const setEmps = [{ id: "loch", name: "Denis Lochman", role: "employee" }, { id: "andy", name: "Andy", role: "employee" }];
const setProps = over => ({
  isA: true, profile: { id: "adm", gcalEnabled: false }, employees: setEmps, wk: "2026-09-14",
  rules: { officeMin: 4, min8: 2, min10: 2, hoCapDay: 3, rotations: [{ day: "Út", aId: "loch", bId: "andy", shiftA: "08:00", shiftB: "10:00", ho: true, anchor: "2026-09-07" }] },
  nahledInfo: { week: "21.9.", date: "19.9. 11:45" }, installState: "other", showGyro: false, gyroOn: false, gcalConfigured: true,
  onOpenModal() {}, onInstall() {}, onGyroChange() {}, onGcalToggle() {}, onGcalSyncWeek() {}, onGcalSyncYear() {},
  onGcalClear() {}, onGcalDisconnect() {}, onSaveRules: async () => {}, onResetWeek() {}, onExportCSV() {}, ...over,
});

test("SettingsView: admin vidí pravidla, rotace s rozpisem na 4 týdny a páteční snímek", async () => {
  const SettingsView = await loadView("SettingsView");
  const html = await render(SettingsView, setProps({}));
  assert.match(html, /Pravidla směn/); assert.match(html, /Rotace dvojic/); assert.match(html, /Páteční snímek/);
  assert.match(html, /Denis Lochman ⇄ Andy/);
  assert.match(html, /tento týden/); assert.match(html, /21\.9\./);          // další týdny rozpisu
  assert.match(html, />Uloženo</);                                           // bez úprav = nic k uložení
  assert.doesNotMatch(html, /Neuložené změny/);
});

test("SettingsView: člen nevidí pravidla ani reset týdne", async () => {
  const SettingsView = await loadView("SettingsView");
  const html = await render(SettingsView, setProps({ isA: false, profile: { id: "loch" } }));
  assert.match(html, /Účet/); assert.match(html, /Google Calendar/);
  assert.doesNotMatch(html, /Pravidla směn/); assert.doesNotMatch(html, /Reset týden/); assert.doesNotMatch(html, /Páteční snímek/);
});

test("SettingsView: stav instalace a nenakonfigurovaný kalendář", async () => {
  const SettingsView = await loadView("SettingsView");
  assert.match(await render(SettingsView, setProps({ installState: "standalone" })), /Běžíš v nainstalované aplikaci/);
  assert.match(await render(SettingsView, setProps({ installState: "installable" })), /Nainstalovat aplikaci/);
  assert.match(await render(SettingsView, setProps({ installState: "ios" })), /Na iPhonu/);
  assert.match(await render(SettingsView, setProps({ gcalConfigured: false })), /není nakonfigurována/);
});

const pEmps = { loch: { id: "loch", name: "Denis Lochman" }, andy: { id: "andy", name: "Andy" }, vita: { id: "vita", name: "Víťa" } };
const prob = { weekKey: "2026-09-21", key: "08:00:Út", dLabel: "út 22. 9.", title: "Út: potřeba 2 v kanceláři od 8:00",
  alts: [{ kind: "shift", empId: "andy", day: "Út", fromShift: "09:00", toShift: "08:00" }, { kind: "shift", empId: "loch", day: "Út", fromShift: "10:00", toShift: "08:00" }] };
const pProps = over => ({ isA: false, profile: { id: "vita" }, yearProblems: [prob], visibleProps: [], myPendingProps: [], ge: id => pEmps[id], onApplyFix() {}, onConsent() {}, onReject() {}, ...over });
const n = (html, re) => (html.match(re) || []).length;

test("ProposalsView: admin vidí všechny možnosti s Provést úpravu a plakát", async () => {
  const V = await loadView("ProposalsView");
  const html = await render(V, pProps({ isA: true, profile: { id: "adm" } }));
  assert.equal(n(html, /Provést úpravu/g), 2); assert.match(html, /TIP/); assert.match(html, /Můžeš pomoct/);
});

test("ProposalsView: dotčený člen vidí jen svoji možnost", async () => {
  const V = await loadView("ProposalsView");
  const html = await render(V, pProps({ profile: { id: "andy" } }));
  assert.equal(n(html, /Provést úpravu/g), 1); assert.match(html, /Andy/); assert.doesNotMatch(html, /Denis Lochman/);
  assert.match(html, /Můžeš pomoct/);
});

test("ProposalsView: nezúčastněný člen nic neprovádí a plakát nevidí", async () => {
  const V = await loadView("ProposalsView");
  const html = await render(V, pProps({}));
  assert.equal(n(html, /Provést úpravu/g), 0); assert.match(html, /vyřeší někdo jiný/); assert.doesNotMatch(html, /Můžeš pomoct/);
});

test("ProposalsView: bez problémů a návrhů", async () => {
  const V = await loadView("ProposalsView");
  const html = await render(V, pProps({ yearProblems: [] }));
  assert.match(html, /Žádné otevřené problémy/); assert.match(html, /Žádné čekající návrhy/); assert.doesNotMatch(html, /Můžeš pomoct/);
});

test("ProposalsView: čekající návrh — dotčený souhlasí, stav souhlasů", async () => {
  const V = await loadView("ProposalsView");
  const p = { id: "p1", label: "Út: Andy 09:00 → 08:00", why: "krytí", week: "2026-09-21", affected: ["andy"], consents: { admin: true } };
  const html = await render(V, pProps({ yearProblems: [], profile: { id: "andy" }, visibleProps: [p], myPendingProps: [p] }));
  assert.match(html, /Souhlasím/); assert.match(html, /Zamítnout/); assert.match(html, /✓ Admin/); assert.match(html, /Důvod: krytí/);
});

test("ProposalsView: víc než 30 problémů — zobrazí 30 a počet zbývajících", async () => {
  const V = await loadView("ProposalsView");
  const many = Array.from({ length: 33 }, (_, i) => ({ ...prob, key: "k" + i }));
  const html = await render(V, pProps({ isA: true, profile: { id: "adm" }, yearProblems: many }));
  assert.match(html, /a dalších 3 později/);
});

const scEmps = { loch: { id: "loch", name: "Denis Lochman", fixCount: 2 }, andy: { id: "andy", name: "Andy" } };
const scProps = over => ({ day: "Út", shift: "08:00", ge: id => scEmps[id], notes: {}, meId: "andy", isA: false, canDrag: () => false,
  onDrop() {}, onAdminClick() {}, onMyShift() {}, onDirectSwap() {}, onNote() {},
  entries: [{ empId: "loch", ho: true }, { empId: "andy", halfAbs: "half_vacation", halfPart: "second" }], ...over });

test("ShiftCard: lidé ve směně, HO, půlden a poznámka", async () => {
  const V = await loadView("ShiftCard");
  const html = await render(V, scProps({ notes: { "loch__Út__0800": "přijdu o 10 min později" } }));
  assert.match(html, /Denis Lochman/); assert.match(html, /Andy/);
  assert.match(html, />HO</);                                 // Lochman je na HO
  assert.match(html, /odpoledne|odp\./);                      // Andy má půlden odpoledne
  assert.match(html, /Zobrazit poznámku/);
  assert.match(html, /Požádat Denis Lochman o výměnu/);         // člen vidí výměnu u kolegy, ne u sebe
  assert.doesNotMatch(html, /Požádat Andy o výměnu/);
});

test("ShiftCard: prázdná směna", async () => {
  const V = await loadView("ShiftCard");
  assert.match(await render(V, scProps({ entries: [] })), />—</);
});

// Rozvrh s realistickými daty: celý tým ze stálého rozvrhu přes skutečné withDefaults + analyzeWeek
async function scheduleFixture(over = {}) {
  const S = await import("./schedule.js");
  const team = Object.keys(TEAM_WEEK).map((n, i) => ({ id: "u" + i, name: n, role: "employee", setupDone: true, defaultSchedule: TEAM_WEEK[n] }));
  const byId = Object.fromEntries(team.map(e => [e.id, e]));
  const absences = over.absences || {};
  const wk = "2026-09-21";
  const cs = S.withDefaults(null, absences, team, wk, [], {}, {});
  const res = S.analyzeWeek(cs, absences, team, {}, {}, {});
  const wd = [0, 1, 2, 3, 4].map(i => { const d = new Date(wk + "T00:00:00"); d.setDate(d.getDate() + i); return S.localISO(d); });
  const getDayAbs = day => Object.entries(absences).filter(([k]) => k.endsWith("__" + day)).map(([k, type]) => ({ empId: k.split("__")[0], type }));
  const noop = () => {};
  return {
    analysis: { violations: res.violations, problems: res.problems, weeklyHO: res.weeklyHO }, cs, cw: new Date(wk + "T00:00:00"),
    dayHol: null, intake: {}, intakeAllow: {}, isA: false, isMobile: false, notes: {}, profile: { id: "u1" }, rules: {},
    schedMeta: { at: "2026-09-19T09:12:00Z", by: "u0" }, schedView: "day", selDay: 1, slideDir: "right", wd, wh: [null, null, null, null, null], wo: 0,
    allowIntakeException: noop, canDrag: () => false, exportCSV: noop, ge: id => byId[id], getDayAbs,
    getEntries: (day, sh) => cs[day]?.[sh] || [], goDay: noop, handleDrop: noop, removeAbs: noop, setModal: noop, setNoteView: noop,
    setSchedView: noop, setSelCell: noop, setShowCompare: noop, setShowPerma: noop, setWo: noop, switchV: noop, toggleIntake: noop,
    ...over, team,
  };
}

test("ScheduleView: denní pohled — tři směny, lidé ze stálého rozvrhu, aktualizace", async () => {
  const V = await loadView("ScheduleView");
  const p = await scheduleFixture();
  const html = await render(V, p);
  for (const sh of ["08:00", "09:00", "10:00"]) assert.match(html, new RegExp(sh));
  const inUt = Object.values(p.cs["Út"]).flat().map(e => p.ge(e.empId).name);
  assert.ok(inUt.length >= 4);
  for (const n of inUt) assert.match(html, new RegExp(n));   // všichni z úterý jsou vidět
});

test("ScheduleView: týdenní pohled — všech pět dní", async () => {
  const V = await loadView("ScheduleView");
  const html = await render(V, await scheduleFixture({ schedView: "week" }));
  for (const d of ["Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek"]) assert.match(html, new RegExp(d));
});

test("ScheduleView: půlden se vykreslí v denním i týdenním pohledu", async () => {
  const V = await loadView("ScheduleView");
  const S = await import("./schedule.js");
  const andy = "u" + Object.keys(TEAM_WEEK).indexOf("Andy");
  const p = await scheduleFixture({ absences: { [`${andy}__Út`]: "half_vacation" } });
  const e = Object.values(p.cs["Út"]).flat().find(x => x.empId === andy);
  assert.ok(e?.halfAbs, "Andy má mít v úterý půlden a zůstat ve směně");
  for (const schedView of ["day", "week"]) {
    const html = await render(V, { ...p, schedView });
    assert.match(html, /Andy/); assert.match(html, /dopoledne|dop\./, `půlden chybí v pohledu ${schedView}`);
  }
});

test("ScheduleView: dovolená vyrobí porušení a člověk je mezi nepřítomnými", async () => {
  const V = await loadView("ScheduleView");
  const S = await import("./schedule.js");
  const slav = Object.keys(TEAM_WEEK).indexOf("Slavíček");
  const p = await scheduleFixture({ absences: { [`u${slav}__Út`]: "vacation" } });
  assert.ok(p.analysis.violations.length > 0, "fixture má mít porušení");
  const html = await render(V, p);
  assert.match(html, /Slavíček/); assert.match(html, /Dovolená/);
});

test("ScheduleView: admin vidí přepínač Nástupů, člen ne", async () => {
  const V = await loadView("ScheduleView");
  assert.match(await render(V, await scheduleFixture({ isA: true })), /Označit jako Nástupy/);
  assert.doesNotMatch(await render(V, await scheduleFixture({ isA: false })), /Označit jako Nástupy/);
});

test.after(() => rmSync(OUT, { recursive: true, force: true }));
