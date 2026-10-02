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
  assert.match(readFileSync(new URL("./skins.js", import.meta.url), "utf8"), /id: "sever"/);
});

test("skin Sever: dny jako praporce a čitelné spodní menu", () => {
  const sched = readFileSync(new URL("./views/ScheduleView.jsx", import.meta.url), "utf8");
  assert.match(sched, /className="day-pills"/); assert.match(sched, /day-pill\$\{/); assert.match(sched, /data-sel=/);
  assert.match(src, /\[data-theme="sever"\] \.day-pill\{clip-path:polygon/);
  assert.match(src, /\[data-theme="sever"\] \.day-pill\[data-sel="1"\]\{[^}]*pergamen/);
  assert.match(src, /className="pill-lbl"/); assert.match(src, /\[data-theme="sever"\] \.pill-lbl\{font-family:var\(--font-body\)/);
});

test("skin Sever: vlk v medailonu, štíty s číslicemi, pergamenová deska (jinde skrytá)", () => {
  assert.match(src, /\[data-theme="sever"\] header\.pg::before\{[^}]*vlk\.webp/);
  assert.match(src, /\[data-theme="sever"\] \.shift-sec::after\{content:attr\(data-roman\)/);
  assert.match(src, /\n\.day-plaque\{display:none\}/);
  assert.match(src, /\[data-theme="sever"\] \.day-plaque\{display:block[^}]*pergamen/);
});

test("vzhledy: tlačítko přepíná dokola přes všechny skiny, neznámý vzhled začne od prvního", async () => {
  const { SKINS, nextSkin, skinOf } = await import("./skins.js");
  let id = SKINS[0].id; const seen = [];
  for (let i = 0; i < SKINS.length; i++) { seen.push(id); id = nextSkin(id); }
  assert.deepEqual(seen, SKINS.map(s => s.id)); assert.equal(id, SKINS[0].id);
  assert.equal(nextSkin("neexistuje"), SKINS[0].id); assert.equal(skinOf("neexistuje").id, SKINS[0].id);
  assert.match(src, /setTheme\(nextSkin\)/); assert.doesNotMatch(src, /t === "light" \? "dark" : "light"/);
});

test("Ringbearer CE nepoužívá blok interpunkce (pomlčky a uvozovky má nakreslené jako písmena)", () => {
  assert.match(src, /font-family:'Ringbearer CE';[^}]*unicode-range:U\+0000-1FFF,U\+2070-FFFF/);
});

test("skin Nebula: písma, barvy, planety u směn, holografický nadpis dne, je ve výběru", async () => {
  const { SKINS } = await import("./skins.js");
  const neb = SKINS.find(s => s.id === "nebula"); assert.ok(neb, "Nebula chybí v seznamu vzhledů"); assert.match(neb.fonts, /Exo\+2/);
  assert.match(src, /\[data-theme="nebula"\]\{[^}]*--font-head:'Exo 2'/);
  for (const r of ["VIII", "IX", "X"]) assert.match(src, new RegExp(`\\[data-theme="nebula"\\] \\.shift-sec\\[data-roman="${r}"\\]::before\\{background-image:url`));
  assert.match(src, /\[data-theme="nebula"\] \.day-plaque\{display:block/);
  assert.match(src, /skinOf\(theme\)\.fonts/);                 // písma se načítají obecně podle skinu
});

test("skin Temný věk: písmo, papírové karty s tmavým textem, bubliny u lidí, čísla směn, nadpis ve výbuchu", async () => {
  const { SKINS } = await import("./skins.js");
  const tv = SKINS.find(s => s.id === "temny"); assert.ok(tv, "Temný věk chybí v seznamu vzhledů"); assert.match(tv.fonts, /MedievalSharp/);
  assert.match(src, /\[data-theme="temny"\]\{[^}]*--font-head:'MedievalSharp'/);
  assert.match(src, /\[data-theme="temny"\] \.gl\{--tx:#141210/);            // uvnitř papíru tmavý text
  assert.match(src, /\[data-theme="temny"\] \.ent\{background:url\(\/skins\/temny\/bublina\.webp\)/);
  assert.match(src, /\[data-theme="temny"\] \.ent\[data-me="1"\]/);
  for (const r of ["VIII", "IX", "X"]) assert.match(src, new RegExp(`\\[data-theme="temny"\\] \\.shift-sec\\[data-roman="${r}"\\]::before`));
  assert.match(src, /\[data-theme="temny"\] \.day-plaque\{display:flex/);
  assert.match(readFileSync(new URL("./views/ShiftCard.jsx", import.meta.url), "utf8"), /data-me=\{isMe \? "1" : undefined\}/);
});

test("Temný věk: bublina při najetí myší nezmizí, má omezenou šířku, vybraný den má výbuch větší než tlačítko", () => {
  assert.match(src, /\[data-theme="temny"\] \.ent:hover[^{]*\{background:url\(\/skins\/temny\/bublina\.webp\)[^}]*!important/);
  assert.match(src, /\[data-theme="temny"\] \.ent\{max-width:\d+px/);
  assert.match(src, /\[data-theme="temny"\] \.day-pill\[data-sel="1"\]::before\{[^}]*vybuch-maly/);
});

test("pulz dnešního dne: barva z proměnné; Temný věk pulzuje tvarem výbuchu", () => {
  assert.match(src, /@keyframes tp\{[^}]*var\(--pulse/); assert.doesNotMatch(src, /@keyframes tp\{0%,100%\{box-shadow:0 0 0 0 rgba\(212/);
  assert.match(src, /\[data-theme="temny"\] \.day-pill\.atp\{animation:none!important\}/);
  assert.match(src, /\[data-theme="temny"\] \.day-pill\.atp\[data-sel="1"\]::before\{animation:tvPulse/);
});

test("páteční snímek: ruční test nemailuje, plánované spuštění (cron nebo Apps Script) ano", () => {
  const wf = readFileSync(new URL("../.github/workflows/nahled.yml", import.meta.url), "utf8");
  assert.match(wf, /planovany:\s*\n\s*description:[^\n]*\n\s*type: boolean/);
  assert.match(wf, /FORCE: \$\{\{ github\.event_name == 'workflow_dispatch' && github\.event\.inputs\.planovany != 'true' && '1' \|\| '' \}\}/);
  assert.match(wf, /if: [^\n]*\(github\.event_name == 'schedule' \|\| github\.event\.inputs\.planovany == 'true'\)/);
});
