// Strukturální testy App.jsx — hlídají chyby, které testy vykreslení odhalit nemohou
// (efekty se při vykreslení na serveru nespouštějí).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("každé naslouchání na databázi čeká na přihlášení a po něm se připojí znovu", () => {
  // Chyba v37: listenery se připojily před přihlášením → databáze je odmítla → s prázdnými
  // závislostmi [] se už nikdy nepřipojily. Po ručním přihlášení pak chyběly rotace, výměny,
  // návrhy, statistiky i log (a páteční bot fotil rozvrh bez rotací).
  const effects = [...src.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n?\s*\}, (\[[^\]]*\])\);/g)];
  const withListener = effects.filter(([, body]) => body.includes("onSnapshot("));
  assert.ok(withListener.length >= 7, `nalezeno jen ${withListener.length} efektů s onSnapshot`);
  for (const [, body, deps] of withListener) {
    const guarded = /if \(!authUser|if \(!profile/.test(body);
    const reattaches = /authUser|profile/.test(deps);
    assert.ok(guarded && reattaches, `listener bez čekání na přihlášení (deps ${deps}): ${body.trim().slice(0, 90)}…`);
  }
});

test("návrhy: člen čte jen ty, které se ho týkají (celou kolekci mu pravidla odmítnou)", () => {
  assert.match(src, /where\("affected", "array-contains", authUser\.uid\)/);
});

test("datová připojení čekají na schválené členství (čekající účet nic nenačítá)", () => {
  const effects = [...src.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n?\s*\}, (\[[^\]]*\])\);/g)];
  const data = effects.filter(([, body]) => /onSnapshot\((?:ref|collection|doc\(db, "(?:schedules|rules)")/.test(body));
  assert.ok(data.length >= 7, `nalezeno ${data.length}`);
  for (const [, body, deps] of data) {
    assert.match(body, /!isMember/, `bez podmínky členství: ${body.trim().slice(0, 80)}`);
    assert.match(deps, /isMember/, `isMember chybí v závislostech: ${deps}`);
  }
});

test("registrace a přihlášení bez profilu nevytvoří člena", () => {
  assert.match(src, /setDoc\(doc\(db, "users", c\.user\.uid\), \{[^}]*role: "pending"/);
  assert.match(src, /else setProfile\(\{[^}]*role: "pending"/);
  assert.doesNotMatch(src, /setDoc\(doc\(db, "users", c\.user\.uid\), \{[^}]*role: "employee"/);
});

test("bot (páteční snímek) se nepočítá mezi členy týmu", () => {
  assert.match(src, /setEmployees\(e\.filter\(x => [^)]*!x\.bot\)\)/);
});

test("skin Sever: každý soubor, na který CSS odkazuje, existuje v public/", async () => {
  const { existsSync } = await import("node:fs");
  const urls = [...src.matchAll(/url\((\/skins\/[^)'"]+)\)/g)].map(m => m[1]);
  assert.ok(urls.length >= 7, `odkazů na soubory skinu: ${urls.length}`);
  for (const u of new Set(urls)) assert.ok(existsSync(new URL(`../public${u}`, import.meta.url)), `chybí soubor ${u}`);
});

test("skin Sever: přepíná písma i barvy a je ve výběru vzhledu", () => {
  assert.match(src, /\[data-theme="sever"\]\{[^}]*--font-head:'Ringbearer CE'/);
  assert.match(src, /\[data-theme="sever"\]\{[^}]*--acc2:/);
  assert.match(readFileSync(new URL("./views/SettingsView.jsx", import.meta.url), "utf8"), /id: "sever"/);
});

test("skin Sever: dny jako praporce a čitelné spodní menu", () => {
  const sched = readFileSync(new URL("./views/ScheduleView.jsx", import.meta.url), "utf8");
  assert.match(sched, /className="day-pills"/); assert.match(sched, /day-pill\$\{/); assert.match(sched, /data-sel=/);
  assert.match(src, /\[data-theme="sever"\] \.day-pill\{clip-path:polygon/);
  assert.match(src, /\[data-theme="sever"\] \.day-pill\[data-sel="1"\]\{[^}]*pergamen/);
  assert.match(src, /className="pill-lbl"/); assert.match(src, /\[data-theme="sever"\] \.pill-lbl\{font-family:var\(--font-body\)/);
});
