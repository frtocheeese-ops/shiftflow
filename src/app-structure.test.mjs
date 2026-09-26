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
