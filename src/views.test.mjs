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

test.after(() => rmSync(OUT, { recursive: true, force: true }));
