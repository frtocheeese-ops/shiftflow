// Test vykreslení obrazovek: každou obrazovku ze src/views/ skutečně vykreslí
// (react-dom/server) s realistickými daty. Chytá pády za běhu, které build ani lint
// nevidí — přesně ten typ chyby, co jednou shodil appku na prázdnou obrazovku.
// Spuštění: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";

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
  const html = await render(DefaultsView, { employees: emps, onSaveDefault: async () => {}, onApplyPreset() {} });
  assert.match(html, /Stálý rozvrh/); assert.match(html, /Předvyplnit rozvrh/);
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

test.after(() => rmSync(OUT, { recursive: true, force: true }));
