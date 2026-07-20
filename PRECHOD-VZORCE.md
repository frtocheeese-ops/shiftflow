# ShiftFlow — přechod na model jednoho týmu (vzorce A–G)

**Stav: připraveno k nasazení PO schválení nadřízeným. Zatím nenasazovat.**

## Co se změnilo (src/App.jsx, +310 řádků)

**Vzorce A–G** — nová konstanta `PATTERNS` + admin view „Vzorce": tabulka vzorců, přiřazení
členům (výběr obsazeného vzorce = automatická výměna obou). Přiřazení zapíše
`users/{id}.pattern` + vygeneruje `defaultSchedule` přes `patternToDefault()` — dál jede
stávající mechanismus `buildDef`. HO den drží slot 09:00 s `ho:true` (HO nemá fixní čas,
9:00 smí zůstat nepokrytá).

**Validační engine** — `analyzeWeek()` hlídá: kancelář ≥ officeMin (4), 8:00 pokryta
z kanceláře (crit), 10:00 pokryta (warn), HO ≤ 3/den, HO ≤ 2/os./týden. Svátky se
přeskakují. Porušení se zobrazují banner­em přímo v rozvrhu.

**Návrhy změn** — nový view „Návrhy" + kolekce `changeProposals`:
- Admin vidí detekované problémy se VŠEMI proveditelnými alternativami (doporučená
  označena TIP), tlačítkem „Ke schválení →" vytvoří návrh.
- Návrh vidí jen admin + dotčený člen (client-side filtr + Firestore rules).
- Schválení = souhlas admina I dotčeného; poslední souhlas změnu provede
  (`applyProposal` → zápis do `schedules/{week}`), e-mail přes GAS, audit log.

**Ad-hoc HO žádosti** — „Moje směna" už nemění HO přímo: tlačítko „Požádat o Home
Office" nejdřív validuje (týdenní strop, kapacita dne, min. kancelář, pokrytí 8/10)
a pak vytvoří návrh adminovi. Tím je pokrytá i Jirkova občasná HO — vzorec G nemá HO
v základu, ale požádat může kdokoli. Admin může HO dál měnit přímo (togHO zachováno).

**Sloučení týmů** — odstraněn filtr Vše/L1/SD, týmové omezení D&D, grouping v Tým
a Default view; notifikace výměn jdou všem. Pole `team` v datech zůstává (kompatibilita),
barevné badge dočasně také.

**Pravidla** — Nastavení → Pravidla směn nově: min. kancelář, max HO/den, max
HO/os./týden, toggly pokrytí 8:00 a 10:00. Ukládá se do `rules/global` (staré L1/SD
klíče zůstanou v dokumentu, kód je ignoruje).

## Postup nasazení (po schválení)

1. `firestore.rules` — přidán match blok `changeProposals`. **Nutno publikovat**
   (Firebase Console nebo `firebase deploy --only firestore:rules`) — pozor na známý
   drift rules mezi repem a konzolí.
2. Nasadit `src/App.jsx` standardním flow.
3. V aplikaci: Vzorce → přiřadit A–G (Jirka = G). Tím se přepíšou `defaultSchedule`
   všech členů; běžící týden s uloženými `entries` se nezmění, nové týdny už jedou
   ze vzorců.
4. Nastavení → Pravidla směn → Uložit (zapíše nové defaulty do `rules/global`).

## Ověřeno testem (Node, produkční datový model)

- Čistý týden ze vzorců: 0 porušení, kancelář 4-5-5-5-4, HO 3-2-2-2-3
- Patrik dovolená + Andy út: 2 problémy, 3+5 alternativ, po schválení 0 porušení
- Jirka ad-hoc HO St: projde (kancelář 4, HO 3); HO Po: validace správně odmítne
- Krize (2 dovolené + nemoc): iterativní schvalování drží kancelář na 4 každý den

## Nezměněno / známé dluhy (mimo rozsah této změny)

Swapy, absence, GCal sync, GAS e-maily beze změny. P0 security (heslo v bundlu,
self-escalation rule, otevřený GAS relay) a P1 (addAbsRange lost-update, chybějící
transakce, removeAbs nerefunduje countery) trvají — doporučuji řešit samostatně
před ostrým provozem nového modelu.
