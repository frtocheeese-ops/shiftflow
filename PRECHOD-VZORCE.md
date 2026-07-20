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

---

## Aktualizace v3 — real-time, sloučení týmů, Nástupy

**Real-time / konec lost-update.** Zápisy rozvrhu (drag&drop, přesun, HO toggle,
absence, rozsah absencí) teď jdou přes `runTransaction` (`txSchedule` + `editSchedule`):
transakce uvnitř přečte čerstvá data a aplikuje jen svou změnu, takže dva souběžné
zásahy se nepřepíšou. Autor vidí okamžitou optimistickou změnu, ostatní ji dostanou
přes `onSnapshot` po commitu. Počítadla (dovolená/sick/whatever) jdou přes `increment()`
— a `removeAbs` je teď vrací zpět (oprava P1). V záhlaví rozvrhu přibylo „aktualizováno
HH:MM · jméno" pro přehled o čerstvosti.

**Sloučení týmů.** Odstraněny všechny zbytky L1/SD: `TEAMS`, výběr týmu v registraci
i přidání člena, týmové badge a barvy, filtr `tf`, sloupec Tým v CSV a v GCal popisu.
Pole `team` u existujících uživatelů zůstává (kompatibilita), kód ho ignoruje.

**Nástupy.** Admin může označit den jako „Nástupy" (týdenní i denní pohled). V takový
den systém doporučuje nulové HO — kdo HO má, dostane upozornění a admin může udělit
výjimku („Povolit výjimku"). Ad-hoc HO žádost na Nástupový den se zablokuje (bez výjimky)
a samoopravný engine do Nástupového dne nepřesouvá HO. Ukládá se na týdenní dokument
(`intake`, `intakeAllow`) — žádná změna Firestore rules není potřeba (spadá pod stávající
pravidla kolekce `schedules`).

Ověřeno plným `vite build` a logickými testy enginu (detekce Nástupů, výjimky, zákaz
přesunu HO do Nástupového dne).

---

## Aktualizace v4 — férovost, resolution modal, sync, oprava UI

**Férovostní hlídač.** Nová sekce ve Stats agreguje z posledních 16 týdnů počty
odpracovaných směn od 8:00, od 10:00 a dnů HO pro každého (živě z kolekce `schedules`).
Tabulka s proužky + hlídač, který upozorní, když rozdíl mezi lidmi překročí 3
(nejvíc vs. nejmíň, jmenovitě). Konstanty `FAIR_WEEKS`, `FAIR_SPREAD`. Jen čtení.

**Resolution modal.** Když si člen zadá nepřítomnost nebo změní hodinu směny, vyskočí
tabulka: nasimuluje dopad, a pokud vznikne podstav, vypíše všechny možnosti krytí —
každou s kolegou, kterého se týká, tlačítkem „Požádat {jméno}" (vytvoří návrh + notifikaci)
a „✉ napsat" (mailto). U změny hodiny navíc tlačítko „Odeslat změnu ke schválení"
(návrh s předvyplněným souhlasem žadatele, zbývá admin). Když změna nic nerozbije,
modal to potvrdí a nikoho neshání.

**Sync tlačítko (⟳).** V hlavičce. Vyčistí Cache Storage i service worker registrace
a natvrdo přenačte s cache-busting parametrem — jistota čerstvého stavu.

**Opravy UI.** Šipky týdnů ‹ › nově flex-centrované (glyfy byly mimo osu). Nespolehlivý
`<input type=date>` nahrazen čistým tlačítkem 📅 s neviditelným, přes celou plochu
roztaženým date-pickerem (spolehlivě otevře nativní výběr na mobilu i desktopu).

Ověřeno `vite build` + logickými testy (resolve simulace absence i změny hodiny,
férovostní agregace).
