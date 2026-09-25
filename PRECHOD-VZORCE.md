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

---

## Aktualizace v5 — konec vzorců, předvyplnění dle preferencí

**Vzorce A–G odstraněny.** Pryč `PATTERNS`, `patternToDefault`, `assignPattern`, admin
view „Vzorce" i položka v menu. Model je teď čistě per-osoba přes `defaultSchedule`
(stávající editor „Rozvrh (default)" zůstává pro ruční úpravy — s přepínačem HO).

**Předvyplnění dle preferencí.** Nová konstanta `PRESET` (jméno → týdenní rozvrh)
sestavená z „ideálních" požadavků členů; tlačítko „Předvyplnit rozvrh" v sekci Rozvrh
(default) ji napasuje na uživatele podle jména (`setupDone:true`). Ověřeno: rozložení
je validní (0 porušení, kancelář 4-4-5-5-5, HO 3-3-2-2-2, každý 2 HO). Přepíše jen
výchozí rozvrhy; už rozepsané týdny zůstávají.

**Osobní pravidla** (`PERSONAL`, upravitelná úpravou rozvrhu, hlásí se jen jako
upozornění): Jirka otevírá celý týden (8:00), Andy/Andrea nikdy neotevírá, Denis ve
středu nemá 10:00. Samoopravný engine navíc na 8:00 nikdy nenavrhne někoho, kdo
otevírat nemá (ověřeno scénářem „Jirka nemocný").

Ověřeno `vite build` + logickými testy (PRESET coverage, osobní warny, opener exclusion).

---

## Aktualizace v6 — 2× ráno, 2× na 10:00, Víťa bez HO

**Nová minima pokrytí.** 8:00 nově vyžaduje ≥2 v kanceláři (dřív 1), 10:00 vyžaduje
≥2 celkem, z toho aspoň 1 v kanceláři (druhý smí být HO). Řízeno `min8`/`min10`
v `RULE_DEFAULTS` a editovatelné v Nastavení → Pravidla. Samoopravný engine zná nová
minima (nabízí posun i stažení z HO tak, aby se dodržela, a nikdy nerozbije zdrojovou
směnu pod její minimum).

**Franta → Víťa, bez HO.** PRESET přejmenován; při „Předvyplnit rozvrh" se člen jménem
Franta automaticky přejmenuje na Víťu (mapa `RENAME`). Víťa má `noHO` (jako Jirka)
— HO se mu hlásí jako upozornění.

**Přepočítaný PRESET.** Ověřeno: 0 porušení, každý den kancelář 5, 8:00 = 2 v kanceláři,
10:00 = 2 (1 kancelář + 1 HO), HO 2/os. (Jirka a Víťa 0). Všechny osobní preference
dál platí.

Ověřeno `vite build` + logickými testy (minima 8/10, Víťa bez HO, opener exclusion).

---

## Aktualizace v7 — stálý rozvrh: zobrazení, aplikace, porovnání + fix Nástupů

**Fix Nástupů.** `toggleIntake`/`allowIntakeException` používaly `setDoc` s tečkovým
klíčem (`intake.Po`), který `merge` NEbere jako vnořené pole → zapisovalo se pole
s tečkou v názvu a snapshot to přepsal zpět (odtud „probliklo a neuložilo"). Nově se
zapisuje celý objekt `intake`/`intakeAllow`.

**Zobrazit stálý rozvrh (všichni).** Tlačítko „Stálý rozvrh" v liště rozvrhu → read-only
modal s trvalým týdenním rozpisem (z výchozích rozvrhů členů), bez možnosti úpravy.

**Aplikovat stálý rozvrh (admin).** Tlačítko „Aplikovat stálý" → volba „tento týden"
nebo „příštích 52 týdnů (rok)". Přepíše entries trvalým rozpisem, ale zachová absence
(nepřítomní se do rozvrhu nevrátí). Transakční zápis po týdnech.

**Porovnat se stálým (všichni).** Tlačítko „Porovnat se stálým" → modal s odchylkami
aktuálního týdne (nebo dne, je-li denní pohled) oproti trvalému rozpisu, po dnech,
ve formátu „stálý → nynější" (absence zvýrazněné).

Ověřeno `vite build` + logickým testem porovnání.

---

## Aktualizace v8 — PRESET na skutečná jména

Klíče PRESET/PERSONAL byly na křestní jména (Patrik, Denis…), ale v appce jsou členové
vedení pod příjmeními, takže se předvyplnění napasovalo jen na Andyho a Víťu. Přepsáno
na skutečná jména dle dodaného rozvrhu: Slavíček (8:00 celý týden), Víťa (bez HO),
Stibor, Lochman (středa bez 10:00), Frťala (HO od 8, páteční 10), Švarc, Andy (neotevírá).
Ověřeno, že „Předvyplnit rozvrh" nyní vytvoří přesně cílový rozpis (0 porušení, 8:00 ≥2,
10:00 ≥2 vč. HO, HO 2/os. kromě Slavíčka a Víti).

---

## Aktualizace v9 — férovost od pevného data

Počítadla férovosti (8:00 / 10:00 / HO) už nejedou jako plovoucí okno posledních
16 týdnů, ale počítají se **jen od 22. 7. 2026 včetně** — nový model má tímto dnem
oficiální start. Počítá se na úrovni jednotlivých dnů (ne celých týdnů), takže první
týden po nasazení se do statistiky započítá jen od svého dne 22. 7. dál, ne od
pondělí. `FAIRNESS_START` je konstanta, snadno se v budoucnu posune. Ověřeno testem
přes hranici týdne.

---

## Aktualizace v11 — finální stálý rozvrh + Švarc (Vláďa) pondělí volno

PRESET upraven na finálně potvrzený rozvrh (týden 20.–24. 7.). Švarc = Vláďa má
v pondělí volno — v jeho výchozím rozvrhu chybí klíč Po, takže se v pondělí do rozvrhu
nezařadí. Důsledek: v pondělí je na 10:00 jen Andy (Švarc byl pondělní HO-10), takže
appka na pondělní 10:00 hlásí soft-upozornění „na 10:00 jen 1". Ostatní dny čisté,
kancelář 5, 8:00 ≥2, HO 2/os. (Švarc 1 kvůli volnu, Slavíček a Víťa 0).

---

## Aktualizace v12 — celoroční Návrhy s přímou aplikací + spolehlivý GCal sync

**Celoroční Návrhy.** Sekce Návrhy teď zobrazuje problémy napříč všemi materializovanými
týdny ode dneška dál (memo `yearProblems` nad živým `allSchedules`), ne jen za zobrazený
týden. Každý problém má u dne datum. Kdo ho může vyřešit (admin, nebo člen, jehož se
navrhovaná úprava týká), vidí tlačítko „Provést úpravu" — aplikace se provede rovnou.
`applyProblemFix` běží přes `runTransaction`: uvnitř znovu ověří, že problém pořád trvá;
když ho mezitím vyřešil někdo jiný, druhý dostane „už vyřešeno" a nezapíše se nic
(žádný dvojí zásah, okamžité propsání všem přes onSnapshot). Odznak u Návrhů počítá
celoroční problémy (u člena jen ty, které může řešit sám).

**GCal — spolehlivé mazání.** Dřív se staré události mazaly přes `q=ShiftFlow` full-text
hledání (u Googlu eventually-consistent → občas nevrátí vše → pozůstatky a duplicity).
Nově `clearShiftFlowEvents` načte VŠECHNY události v okně (stránkovaně, bez závislosti
na indexu) a smaže ty naše podle značky `extendedProperties.private.shiftflow`, textu
i názvu — tím padnou i staré události bez značky a duplicity. Nové události značku nesou.
Používá to jak týdenní, tak roční sync.

---

## Aktualizace v13 — deep debugging / audit

Opraveno:
- **(vysoká) GCal mazání zúženo** — dřív matchovalo i holé slovo „Směna" v názvu,
  což mohlo smazat soukromé události uživatele. Nově jen značka
  `extendedProperties.private.shiftflow`, `[ShiftFlow]` v popisu nebo „ShiftFlow" v názvu.
- **(vysoká) Nástupy alternativa `cancelHO`** nebyla implementovaná v `applyAlt` ani
  `altLabel` (prázdný popisek, aplikace by nic neudělala). Engine nyní emituje ověřený
  `dropHO` — end-to-end otestováno (detekce → popisek → aplikace → problém zmizí).
- **(střední) Souběh intake zápisů** — `toggleIntake`/`allowIntakeException` přepsány
  na `runTransaction` (čtou čerstvý objekt uvnitř), dva admini už si nepřepíšou změny.
- **(střední) `applyProblemFix` guard** — oprava se odmítne i tehdy, když by zvýšila
  počet kritických porušení v týdnu (nejen když nevyřeší cílový problém).
- **(nízká) Úklid**: mrtvá `permaDef`; kolize React klíčů v porovnání při duplicitě
  člověka ve směně; strop 30 zobrazených celoročních problémů s poznámkou.
- **(UI) Konzistence názvů**: menu „Rozvrh (default)" → „Stálý rozvrh"; prohlížecí
  tlačítko přejmenováno na „Zobrazit stálý" (admin měl dvě různé věci se stejným
  názvem); labely přepínačů pravidel („Vyžadovat minimum na 8:00/10:00") odpovídají
  nové sémantice minim.

Poznámky bez zásahu: prop `ghost` u Btn je vizuální no-op (výchozí styl je už
„ghost"); tlačítka „+ nástupy" v týdenním záhlaví jsou přiznaně husté — případné
zjemnění až podle zpětné vazby; celoroční Návrhy čtou jen materializované týdny
(po „Aplikovat stálý na rok" je pokryto vše).

---

## Aktualizace v14 — oprava mazání absencí + stálý rozvrh vs. rozepsané týdny

**Zrušení dovolené nechávalo absenci v DB (kritické).** `txSchedule` zapisoval přes
`set(..., {merge:true})` — merge u mapy `absences` slučuje po klíčích, takže klíč
smazaný v `removeAbs` v dokumentu přežil a snapshot ho vrátil do UI (člověk v rozvrhu
i s dovolenou zároveň). Oprava: `mergeFields` — vyjmenovaná pole (entries, absences…)
se nahrazují CELÁ, ostatní (intake, notes, events) zůstávají. Stejná sémantika i
v `applyProblemFix`. Pozor: každé opakované kliknutí na zrušení dřív vracelo den
do počítadla → počty dovolených u dotčených lidí můžou být nižší, srovnat ručně.

**GCal ukazoval staré směny.** Příčina není v syncu — ten věrně kopíruje týdenní
dokumenty ve Firestore. Ale „Předvyplnit rozvrh" mění jen výchozí rozvrhy lidí;
UŽ ROZEPSANÉ (materializované) týdny zůstávají na staré verzi, a právě z nich sync
čte. Jednorázová náprava: „Aplikovat stálý → na příštích 52 týdnů", pak roční GCal
sync. Produktová pojistka: `applyPreset` nově po úspěchu sám nabídne přepsání
52 týdnů (`applyDefaultYear(true)` bez druhého confirmu).

---

## Aktualizace v15 — admin login bez hardcoded hesla + serializace GCal

**Admin login (kritické, částečná náprava P0).** `doLogin` měl zkratku
`Admin + "0000" → přihlášení hardcoded heslem AP` uloženým přímo v klientském bundlu
(a ve veřejném repu). Po změně hesla ve Firebase proto: staré „0000" → pokus o už
neplatné AP → „Neplatné údaje"; nové heslo → zkratka se nechytla → poslal se e-mail
doslova „Admin" → `auth/invalid-email`. Oprava: konstanta AP ODSTRANĚNA; jméno
„Admin"/„admin" se mapuje na `admin@shiftflow.app` a heslo se VŽDY bere z formuláře.
Uniklé heslo v historii repa je změnou ve Firebase mrtvé. (Pozn.: biometrické
přihlášení stále drží heslo v localStorage — zbývající dluh.)

**GCal duplicity ze souběhu.** Po každé editaci se za 1,5 s spouští týdenní auto-sync;
dvě rychlé editace = dva souběžné syncy, které si proloží list→delete→create → duplicitní
události (na screenshotu 2×–3× táž směna). Oprava: všechny GCal synchronizace
(týdenní i roční) jedou přes jednu serializační frontu `gcalSerial`; navíc 60ms pauza
mezi mazáními jako rate-limit pojistka. Světle modré pozůstatky (staré colorId 7 z éry
týmů) přežily, protože dřívější velký úklid běžel ještě na staré verzi kódu (PWA cache,
q-based hledání) — po nasazení je příští roční sync spolehlivě smaže (mají „ShiftFlow"
v názvu).

---

## Aktualizace v16 — nový člen neviditelný pro pravidla i statistiky

**Příznak.** Po odchodu člena hlásil engine podstav (např. Pá 11. 9. „jen 3 lidi").
Nový kolega se v mřížce zobrazoval a počet doplnil na 4, ale Návrhy problém dál
hlásily a ve Stats měl samé nuly / 0 týdnů.

**Příčina.** Mřížka (`cs`) si členy chybějící v uloženém týdnu doplňovala z jejich
stálého rozvrhu, ale `yearProblems`, `fairness` a `applyProblemFix` četly SYROVÉ
`allSchedules[wk].entries`. Týdny materializované PŘED příchodem nového kolegy ho
tedy neobsahovaly → mřížka ho viděla, engine a statistiky ne. Dvojí zdroj pravdy.

**Oprava.** Doplňovací logika vytažena do sdílené funkce `withDefaults(entries,
absences, emps)` a použita ve VŠECH konzumentech: `cs`, `yearProblems`, `fairness`,
`applyProblemFix` i `txSchedule` (mutace tak vychází z doplněného stavu a zápis
nového kolegu materializuje). Ověřeno testem: syrová data hlásí „jen 3 lidi",
po doplnění je porušení pryč a směny se započítají.

---

## Aktualizace v17 — rotace dvojic

Nová funkce: dvojici lidí se v daný den každý týden prohodí směna (případ z praxe:
úterý, Denis HO 8:00 ⇄ Andy HO 10:00).

- **Konfigurace** v Nastavení → Pravidla → „Rotace dvojic": den, režim (HO/kancelář),
  člen A + jeho směna, člen B + jeho směna. Uloženo v `rules.rotations`, takže platí
  pro celý tým a je kdykoli upravitelné/odebratelné. U každé rotace je vidět, jak
  vychází aktuální týden.
- **Parita** se počítá od kotvícího pondělí (`anchor`, uloží se při vytvoření), takže
  je stabilní dopředu i zpět — ne od „kolikátý týden v roce", který by přeskočil přes
  Nový rok.
- **Ruční úprava má přednost**: rotace se uplatní jen na místa, která nikdo nezměnil
  (`isDefault`). Pokud někdo dvojici v daném týdnu přehodí ručně, rotace do toho
  nesahá. Nerotuje se ani při absenci jednoho z dvojice.
- Aplikuje se přes sdílený `withDefaults`, takže mřížka, engine, Návrhy i statistiky
  vidí totéž; `applyDefaultToWeek` rotaci respektuje i při materializaci týdnů.

Ověřeno testem: čtyři týdny po sobě se pravidelně střídají, ruční úprava i absence
rotaci korektně vypnou.

---

## Aktualizace v18 — okamžité propsání změn stálého rozvrhu

**Příznak.** Změna stálého rozvrhu se v už rozepsaných budoucích týdnech neprojevila;
bylo nutné ručně spustit „Aplikovat stálý → 52 týdnů".

**Příčina.** `withDefaults` doplňoval z výchozích rozvrhů POUZE lidi, kteří v uloženém
týdnu chyběli úplně. Kdo už v týdnu byl (se starou směnou), zůstal beze změny —
uložené `entries` měly přednost před aktuálním stálým rozvrhem.

**Oprava.** `withDefaults` nově u každého dne porovná nedotčené (`isDefault`) umístění
s AKTUÁLNÍM stálým rozvrhem a srovná ho — bez jediného zápisu do databáze, takže se
změna projeví okamžitě všem (mřížka, engine, Návrhy, statistiky). Zachováno:
- **ruční úprava má přednost** (`isDefault:false` se nikdy nepřepíše),
- **ručně odebraný člověk se do dne nevrací**,
- **minulé týdny se nepřepisují** (jinak by se měnily odpracované směny ve statistikách),
- absence dál vyřazují člověka ze dne.

Ověřeno testem: změna stálého rozvrhu se v budoucím týdnu projeví ihned, ruční úprava
zůstane a historie se nezmění.

---

## Aktualizace v19 — mobil: poznámky a přesun směn

**Poznámka „i" nereagovala.** Byl to `<span title={note}>` — nativní tooltip se na
dotyku nikdy nezobrazí a prvek neměl žádný `onClick`. Nově je to skutečné tlačítko
(28×28, `stopPropagation`), které otevře modal s celou poznámkou. Přidán i do
týdenního pohledu, kde se poznámky dosud nezobrazovaly vůbec.

**Drag & drop na mobilu.** Používá HTML5 `draggable` + `onDragStart/onDrop`, které
dotykové prohlížeče neemitují — na mobilu tedy principiálně nefunguje (na desktopu
funguje dál beze změny). Náhrada bez přepisování na touch-eventy: admin klepne na
jméno → v modalu „Akce" je nově `MoveForm` (výběr dne + směny → „Přesunout sem"),
takže jde přesouvat i **mezi dny**, což dřív šlo jen tažením. Rychlá tlačítka
„→ 09:00" pro přesun v rámci dne zůstala. Členové mění svou směnu přes „Změnit
hodinu" v myshift modalu (návrh ke schválení) jako dosud.

Doplněna mobilní nápověda nad rozvrhem, že se klepe místo tažení.

---

## Aktualizace v20 — GCal sync respektuje stálý rozvrh a rotace

**Příznak.** Po ročním syncu chyběly v Google Kalendáři změny, které se do rozvrhu
propisují ze stálého rozvrhu (v18) — kalendář ukazoval staré směny.

**Příčina.** `_syncRangeCore` (i `_syncWeekCore`) měly VLASTNÍ kopii slučovací logiky,
napsanou ještě v původní podobě: doplnily člověka jen tehdy, když v uloženém týdnu
chyběl úplně. Kdo už v týdnu byl se starou směnou, šel do kalendáře postaru — sync tedy
neviděl ani propsání stálého rozvrhu, ani rotace dvojic. Duplicitní logika = druhý
zdroj pravdy.

**Oprava.** Obě sync cesty používají sdílený `withDefaults(entries, absences, employees,
weekKey, rotations)` — stejný, ze kterého se skládá mřížka, engine i statistiky. Do
sync funkcí se proto nově předává i klíč týdne a `rules.rotations`; auto-sync z listeneru
čte rotace přes `rulesRef` (aby nezachytil zastaralou closure).

Ověřeno testem: uložený týden se starou 09:00 vygeneruje po změně stálého rozvrhu
události 08:00 HO, se správnou značkou pro spolehlivé mazání.

---

## Aktualizace v21 — audit duplicit (hledání dalších kopií slučovací logiky)

Cílený audit celého repa (src, scripts, gas) po opakovaném výskytu chyby „opravím
logiku na jednom místě, ale existuje její kopie". Nalezeno a opraveno:

- **Přijetí výměny (`acceptSwap`)** četlo syrové `entries` + `buildDef` místo
  `withDefaults` → v týdnu, kde ještě nefiguroval nový kolega nebo změna stálého
  rozvrhu / rotace, pracovalo se starým obrazem týdne a zápis ho materializoval.
- **`applyProposal`** (schválení návrhu) — tentýž problém, tentýž fix.
- **Zápisy obou** používaly `setDoc(..., {merge:true})` → riziko lost-update
  a u map i neodstranění klíčů. Sjednoceno na `mergeFields`.
- **Porovnání se stálým** stavělo základ přes `buildDef` BEZ rotací → rotující dvojice
  blikala jako „změna" v každém týdnu, i když šlo o řádný stav. Nyní se na základ
  aplikují rotace daného týdne.
- **Obcházení konstant**: dvě místa měla inline `["Po","Út",…]` a `["08:00",…]` místo
  `DAYS`/`SHIFTS`. Sjednoceno.

Ověřeno regresním testem (8 scénářů: validita PRESET, rotace, propsání stálého rozvrhu
do budoucna, ochrana historie, přednost ruční úpravy, doplnění nového kolegy, absence).

**Otevřený bod (bez zásahu, vyžaduje rozhodnutí):** konstanta `PRESET` stále obsahuje
pondělní mezeru na 10:00 (Švarc má pondělí volno, na desítce zbývá jen Andy). Pondělí
bylo vyřešeno ručně v appce, ale kdokoli později klikne „Předvyplnit rozvrh", mezera
se vrátí. Doporučeno srovnat PRESET s realitou.

---

## Aktualizace v22 — „Provést úpravu" hlásila chybu donekonečna

**Příznak.** Klik na „Provést úpravu" vrátil „Rozvrh se mezitím změnil — otevři Návrhy
znovu"; ani po znovuotevření se úprava neprovedla, hláška se opakovala.

**Příčina.** Kontrola v `applyProblemFix` vyžadovala, aby úprava problém vyřešila ÚPLNĚ.
Když ale na směně chybí víc než jeden člověk (např. na 8:00 nikdo, minimum 2), žádná
jednotlivá alternativa problém nevyřeší — každá ho jen zmenší. Transakce proto zápis
pokaždé odmítla a stav se nikdy nepohnul. Hláška navíc mylně tvrdila, že se rozvrh
změnil, což znemožňovalo diagnózu.

**Oprava.**
- `analyzeWeek` u každého problému vrací `deficit` (kolik lidí ještě chybí).
- `applyProblemFix` přijme i **částečné zlepšení** (deficit klesl) a oznámí
  „Úprava provedena ✓ — ještě chybí X, vyber další možnost". Druhý klik problém dořeší.
- Odmítne se jen tehdy, když úprava nic nezlepší („Tahle možnost problém nezlepší —
  zkus jinou“) nebo by vytvořila NOVÉ kritické porušení („Nelze — vzniklo by: …“).
- Detekce nového kritického porušení porovnává DRUH hlášky, ne přesné znění —
  po částečné opravě se čísla v textu mění („jen 0" → „jen 1") a dřívější verze
  by to chybně vyhodnotila jako nový problém (odhaleno testem).

Ověřeno krokovým testem: den bez kohokoli na 8:00 se vyřeší dvěma úpravami po sobě.

---

## Aktualizace v23 — nový typ absence: Služební cesta

Přidán typ `business_trip` — „✈️ Služební cesta" (barva #3c90a8). Chování:
- Dostupný všude, kde se zadává nepřítomnost (admin i člen, denní i týdenní pohled).
- **Neodečítá se** z konta dovolené/sick/whatever — jako Lékař a Školení. Přidán
  explicitně do vylučovacích seznamů v `addAbs`, `addAbsRange` i `removeAbs`.
- Ikona 🚗 (auto). Přidán i do **rozsahového** formuláře (od–do), protože služební cesta bývá vícedenní.
- Do Google Kalendáře se propíše automaticky (`buildWeekEvents` čte z `ABS`).
- V přehledu Dovolená se nezobrazuje (ten záměrně sleduje jen dovolenou).
- Nemá půldenní variantu — je celodenní.

---

## Aktualizace v24 — páteční náhled nebyl ve 12:00 aktuální

**Diagnóza z reálných dat** (commity nahled-bota):
- 11. 9. → commit 10:02 UTC = **12:02 pražského času**
- 18. 9. → commit 10:29 UTC = **12:29 pražského času**

Workflow přitom počítalo s tím, že projde první pokus v 9:07. Skutečnost: **GitHub
cron se zpožďoval o 50–80 minut** a proběhl až jeden z pozdních pokusů — tedy až PO
dvanácté. Na stránce /nahled/ tak ve 12:00 visel ještě snímek z minulého týdne.
Nebyla to chyba appky ani skriptu, ale křehké spoléhání na přesnost plánovače.

**Oprava — model odolný vůči zpoždění:**
- cron nově `*/15 6-10 * * 5` (pokus každých 15 min, pokrývá letní i zimní čas);
  o tom, kdy se pracuje, rozhoduje skript podle pražského času.
- **9:00–11:50 = průběžná obnova**: každý běh přepíše snímek čerstvějším, takže ve
  12:00 je k dispozici nejaktuálnější verze bez ohledu na to, které pokusy vypadly.
- **po 11:50 = záchranný běh** jen tehdy, když dnes ještě nic nevzniklo.
- **Commit jen při skutečné změně** snímku (`git diff --quiet` na rozvrh.png) →
  žádné zbytečné commity ani Netlify buildy při nezměněném rozvrhu.
- **E-mail jen jednou denně** (příznak `send_mail.txt`) — obnovy už mail neposílají.
- `concurrency: nahled` + `git pull --rebase` před pushem → dva souběžné běhy si
  navzájem neshodí push (dřív by push selhal a snímek by se nezveřejnil).

Vedlejší efekt: snímek je i čerstvější než dřív — poslední obnova je z ~11:50, takže
zachytí i ranní změny rozvrhu, které se do 9:07 verze nedostaly.

---

## Aktualizace v25 — audit rotací: kolize s Nástupy

**Co audit ukázal.** Samotná rotace je v pořádku — střídání po týdnech, parita od
kotvícího data, materializace i znovunačtení týdne dávají konzistentní výsledek
(ověřeno testy A–F). Problém vzniká teprve v kombinaci s Nástupy.

**Příčina.** Rotace je HO rotace: v Nástupový den postavila oba členy dvojice na home
office. Engine to (správně) označil za porušení pravidla Nástupů, admin klikl „Provést
úpravu" → `dropHO` u obou → z rotovaných míst se staly ruční úpravy (`isDefault:false`)
→ **rotace se pro ten týden natrvalo vypnula** a den pak nevypadal ani jako rotace,
ani jako stálý rozvrh. Přesně to se projevilo v /nahled/ (snímek příštího týdne, kde
byly Nástupy) i jako „špatný sled" v živém rozvrhu.

**Oprava.** `applyRotations` je nově vědomá Nástupů: v takový den **prohodí časy jako
obvykle, ale bez HO** (oba do kanceláře) — pokud nemá dotyčný udělenou výjimku, ta se
respektuje. Důsledky: rotace nevyrábí porušení, admin nemusí nic „opravovat",
umístění zůstávají `isDefault`, takže rotace zůstává aktivní a sled pokračuje.
`intake`/`intakeAllow` se proto předávají do `withDefaults` a dál do všech konzumentů
(mřížka, engine, návrhy, statistiky, porovnání, GCal sync, materializace týdne).

**UI.** Karta rotace v Nastavení nově ukazuje **rozpis na 4 týdny dopředu**, takže je
pořadí vidět na první pohled a dá se ověřit, jestli parita sedí (kdyby byla obráceně,
stačí rotaci odebrat a přidat s prohozenými směnami). Doplněna poznámka o chování
v den Nástupů.

Ověřeno: v Nástupovém týdnu 0 porušení, `isDefault` zachováno, sled 6 týdnů vychází
rovnoměrně (3× / 3× na obou časech).

---

## Aktualizace v26 — instalovaná PWA se po nasazení nenačetla

**Příznak.** Po mergi se web v prohlížeči načte normálně, ale aplikace spuštěná z ikony
na ploše ne.

**Zjištění.** V repu nikdy nebyl žádný cachovací service worker (jen
`firebase-messaging-sw.js` pro notifikace), takže nešlo o zaseknutý SW. Zbývající
mechanismus: instalovaná PWA si drží **starou `index.html`**, která odkazuje na
`/assets/index-<hash>.js`. Po nasazení má bundle nový hash, starý soubor už
neexistuje → skript 404 → prázdná obrazovka. Prohlížeč si HTML vyžádá znovu, a proto
tam problém není. `index.html` přitom neměla v `netlify.toml` žádné explicitní
cache hlavičky (řídila se výchozím chováním).

**Pojistky.**
1. `netlify.toml`: `/` i `/index.html` nově `Cache-Control: public, max-age=0,
   must-revalidate` — HTML se tak vždy ověří proti serveru (hashované assety zůstávají
   `immutable`, ty se cachovat mají).
2. `index.html`: drobný inline skript hlídá selhání načtení hlavního bundlu a jednou
   provede přenačtení s cache-bustem (`?v=…`, pojistka proti smyčce přes
   `sessionStorage`). `main.jsx` po úspěšném startu příznak maže.

Tím se stejná situace v budoucnu opraví sama, bez nutnosti přeinstalovat appku.

---

## Aktualizace v27 — HOTFIX: modrá prázdná obrazovka (TDZ)

**Příznak.** Po nasazení v26 zůstávala stránka na modré prázdné obrazovce. Konzole:
`ReferenceError: Cannot access 'N' before initialization` uvnitř `useMemo`.

**Příčina (moje chyba z v25).** Při předávání `intake` do `withDefaults` jsem na dvou
místech použil `intk`/`intkA` o řádek DŘÍV, než byly deklarované (`const` je do
deklarace v „temporal dead zone"):
- `yearProblems` (useMemo) → běží při každém vykreslení → **pád celé aplikace**,
- `applyProblemFix` (transakce) → pád až po kliknutí na „Provést úpravu".
Build to neodhalí — syntakticky je kód v pořádku, chyba vzniká až za běhu.
Testy engine logiky běžely nad vyříznutými funkcemi, ne nad komponentou, proto
to také nezachytily.

**Oprava.** Prohozeno pořadí deklarací na obou místech.

**Prevence.** Celý `App.jsx` prověřen ESLintem pravidlem `no-use-before-define`.
Zbylých 9 nálezů je uvnitř handlerů/async funkcí volaných až po inicializaci
komponenty (bezpečné). Do ověřovací rutiny před každým pushem přidávám tento lint
jako povinný krok vedle `vite build`:
  npx eslint --no-eslintrc --parser-options=ecmaVersion:2022,sourceType:module,ecmaFeatures:{jsx:true}
    --rule 'no-use-before-define:[error,{functions:false,variables:true}]' src/App.jsx
a nálezy mimo handlery (useMemo, tělo komponenty, top-level) = blokující chyba.

---

## Aktualizace v28 — půlden: člověk mizel z rozvrhu a „rozvrh se vrátil o verzi"

**Příznaky.** (1) Po zadání půldne adminem se rozvrh „posunul o verzi zpět".
(2) Člověk s půldnem se přesunul jen do „Nepřítomen" místo aby zůstal ve směně.

**Společná příčina (moje regrese z v16/v18/v17).** Appka už měla půldenní logiku
(`halfAbs`/`halfPart`, `HalfTag`, výjimka v `dayStats`) — člověk měl ve směně zůstat
s označením. Ale `withDefaults` i `applyRotations`, které jsem později přidal, braly
**jakoukoli** absenci jako celodenní:
- `withDefaults` při obnově nedotčeného místa člověka se záznamem absence ze dne
  odstranil → skončil jen v „Nepřítomen" (chyba 2), a při přestavbě záznamu navíc
  zahodil `halfAbs`/`halfPart`.
- `applyRotations` se při jakékoli absenci jednoho z dvojice vypnula → druhý člen
  dvojice skočil ze svého rotovaného místa zpět na **starou** výchozí pozici. To je
  to „vrácení o verzi" (chyba 1). Ověřeno: Andy skočil z 10:00 na původní 9:00.
- Stejně se chovalo i hromadné „Aplikovat stálý" (`applyDefaultToWeek`).

**Oprava.**
- Nová funkce `isFullAbs(t)` — celodenní = cokoli kromě `half_*`.
- `withDefaults`: ze dne vyřadí jen celodenní absence; u půldne člověka ponechá
  a doplní/zachová `halfAbs` + zvolenou `halfPart`.
- `applyRotations`: vypne se jen při celodenní absenci; při půldni rotuje a označení
  přenese na nové místo.
- `applyDefaultToWeek`: půlden nevyřazuje, jen označí (se zachovanou polovinou).

**UI.** Popisky „1. půle / 2. půle" → „chybí dopoledne / chybí odpoledne" (štítek ve
směně, výběr při zadání, detail absence). Seznam „Nepřítomnost" u půldne nově ukazuje
i část dne. Člověk je tak vidět na obou místech, jak bylo požadováno.

Ověřeno 7 scénáři (zůstává ve směně, nese zvolenou polovinu, rotace přežije,
celodenní absence dál vyřazuje, obsazenost, zrušení půldne) + povinný TDZ lint
(beze změny: 9 známých bezpečných nálezů v handlerech).

---

## Aktualizace v29 — revize: regrese z dřívějších oprav + přestavba logiky

**Ověření ruční opravy uživatele.** Nová verze otestována proti 4 pravděpodobným stavům
databáze po ruční opravě půldne (oba ručně / člověk vypadlý z DB / zrušeno a znovu
zadáno / jen jeden ručně) — ve všech zůstanou oba lidé na místě, bez duplicit.

**Nalezené regrese (opraveno):**
1. **Týden poškozený dřívější chybou půldne** — člověk mohl v DB ze dne vypadnout a nová
   verze by ho nevrátila (pravidlo „ručně odebraný se nevrací"). Nově: půlden = člověk
   ten den pracuje → do směny se vrátí vždy.
2. **Rotace přepisovala historii** — uplatnila se i na týdny před svým založením
   (zkreslovalo statistiky férovosti). Nově se týdny před `anchor` nerotují.
3. **Nový kolega se dopisoval do minulosti** — do týdnů před nástupem, statistiky mu
   připsaly neodpracované směny. Nově se nedoplní do týdnů před `createdAt`.
4. **Zrušení půldne přemazalo ruční umístění** (smazalo a vrátilo na výchozí). Nově jen
   sundá označení.
5. **„Zapomenuté heslo"** hlásilo chybu, přestože e-mail odešel — volání neexistující
   `notify` v přihlašovací obrazovce (odhaleno nově zapnutým lintem `no-undef`).

**Přestavba (proč se regrese opakovaly).** Dvě příčiny: logika rozvrhu byla rozházená
uvnitř 2000řádkové komponenty (vznikaly její kopie) a testy běžely nad vyříznutými
kopiemi kódu, ne nad skutečným souborem. Řešení:
- Veškerá čistá logika přesunuta **beze změny chování** do `src/schedule.js`
  (27 exportů, bez Reactu i Firebase). `App.jsx` ji importuje.
- Trvalá testovací sada `src/schedule.test.mjs` — 21 testů, každý odpovídá reálné
  chybě z historie. Běží nad skutečným modulem. Nejdřív spuštěna BEZ oprav: selhaly
  přesně 3 nálezy auditu, 18 ostatních prošlo → testy chytají to, co mají.
- Lint (`.eslintrc.json`) v repu: `no-use-before-define` + `no-undef`. Pořadí definic
  v `App.jsx` srovnáno tak, aby prošel **čistě na nulu** (dřív 9 „bezpečných" nálezů,
  které se musely ručně filtrovat).
- `npm run check` = testy + lint. Povinné před každým nasazením.
- `ARCHITECTURE.md` — struktura, jediný zdroj pravdy, invarianty, datový model.

---

## Aktualizace v30 — rozdělení UI: první obrazovka (Statistiky)

Začátek postupného rozdělení `App.jsx` na obrazovky. Statistiky zvoleny jako první,
protože jsou jen ke čtení — nejbezpečnější pro zavedení vzoru.

1. **`src/ui.jsx`** — 12 sdílených UI prvků (Btn, Card, Modal, Input, Sel, Toggle, Badge,
   RankBadge, HalfTag…) přesunuto z `App.jsx`. Nutný základ pro jakoukoli oddělenou obrazovku.
2. **`computeFairness()` v `schedule.js`** — výpočet férovosti přesunut z `useMemo`
   v komponentě beze změny chování + 5 nových testů (vynechání admina, startovní datum,
   HO deficit, hlídač rozptylu, nový kolega bez směn z doby před nástupem).
3. **`src/views/StatsView.jsx`** — obrazovka dostává data jako props, akci „upravit dny"
   jako funkci; sama nic nezapisuje.
4. **`src/views.test.mjs`** — nový typ testu: obrazovku skutečně vykreslí
   (`react-dom/server`) pro admina, člena i prázdná data. **Ověřeno sabotáží:** chyba
   „použití před deklarací" vložená do obrazovky prošla buildem, test ji chytil.

`npm test` = 29 testů (26 logika + 3 vykreslení), `npm run lint` nově přes celý `src/`
(automaticky pokryje i budoucí obrazovky). Vzor pro další obrazovky popsán v ARCHITECTURE.md.

---

## Aktualizace v31 — rozdělení UI: Log, Výměny, Stálý rozvrh

Tři další obrazovky podle vzoru ze StatsView, každá jako samostatný ověřený commit:
- **`LogView`** — čistý přesun.
- **`SwapsView`** — inline zápisy do Firestore (zrušení vlastní žádosti, smazání adminem)
  vytaženy do `App.jsx` jako `cancelSwap` / `deleteSwap` s identickým obsahem;
  přijetí a nová žádost předány jako `onAccept` / `onNewRequest`.
- **`DefaultsView`** + `DefEditor` přesunut do obrazovky; přímý `updateDoc` na
  `users.defaultSchedule` vytažen do `App.jsx` jako `saveDefaultSchedule`.
  Vedlejší oprava: při chybě uložení dřív tlačítko zůstalo navždy v režimu „ukládám"
  (výjimka nebyla ošetřena). Nyní se chyba ohlásí a editační okno zůstane otevřené.
  Úspěšné uložení nově potvrdí hláška „Stálý rozvrh uložen".

Žádná z oddělených obrazovek neobsahuje zápis do databáze (ověřeno grepem).
Testy vykreslení pro všechny role (admin / žadatel / jiný člen) a prázdná data:
celkem 33 testů. `App.jsx`: 1909 → 1889 řádků.

---

## Aktualizace v32 — rozdělení UI: Tým a Nastavení

- **`PeopleView`** — inline zápisy `fixCount ± 1` vytaženy do `App.jsx` jako `adjustFixCount`.
- **`SettingsView`** (+ `RotationForm`) — po krocích: (A) `fmtDate` do `schedule.js`,
  (B) 9 handlerů s vedlejšími efekty (instalace, gyroskop, Google Kalendář ×5, uložení
  pravidel, reset) vytaženo do pojmenovaných funkcí v `App.jsx` beze změny obsahu,
  (C) přesun obrazovky. Handler instalace přiřazuje do modulové proměnné
  `deferredInstall` — z jiného souboru to nejde, proto zůstal v `App.jsx`.

Dvě opravy nalezené během přesunu:
1. **Pravidla se upravují jako koncept.** Dřív editace (min. počty, rotace) měnila přímo
   živý stav `rules` → projevila se v adminově rozvrhu ještě před uložením, ostatní je
   neviděli, a neuložené změny mohla přepsat aktualizace z databáze (listener na
   `rules/global`). Nyní obrazovka upravuje lokální `draft`, zobrazí „● Neuložené změny"
   a do aplikace se promítne až po „Uložit pravidla". Bez změn tlačítko ukazuje „Uloženo".
2. **„Reset týden" bez potvrzení.** Jedním kliknutím smazal celý dokument týdne včetně
   dovolených, nemocí, Nástupů a poznámek. Nyní vyžaduje potvrzení s výčtem, co se smaže.

Testy vykreslení Nastavení: admin / člen / 4 stavy instalace / nenakonfigurovaný kalendář.
Celkem 37 testů. `App.jsx`: 1787 ř. Interakce (psaní do polí, tlačítko Uložit) test vykreslení neověří — nutno ověřit ručně po nasazení.

---

## Aktualizace v33 — rozdělení UI: Návrhy

- **`ProposalsView`** — obrazovka nemá žádné přímé zápisy; volá `applyProblemFix`
  (transakce s ochranou proti dvojímu řešení), `consentProposal`, `rejectProposal`.
- Lint (`no-undef`) při přesunu zachytil proměnnou `visibleProps` definovanou mimo blok
  obrazovky — bez jejího předání by Návrhy za běhu spadly. Předává se jako prop.
- Kosmetika: `pr.alts.some(a => true)` → `pr.alts.length > 0` (totožné chování).
- 6 testů vykreslení podle rolí: admin vidí všechny možnosti, dotčený člen jen svoji,
  nezúčastněný žádnou (a nevidí plakát „Můžeš pomoct"), prázdný stav, čekající návrh se
  stavem souhlasů, strop 30 problémů. Celkem 43 testů.

---

## Aktualizace v34 — rozdělení UI dokončeno: Rozvrh

Poslední a největší obrazovka, ve dvou krocích:

**R1 — `ShiftCard` jako samostatná komponenta.** Byla definovaná *uvnitř* komponenty
`App`, takže při každém překreslení vznikala jako „nová" komponenta a React všechny
karty ve směnách zahodil a vytvořil znovu (zbytečná práce, ztráta stavu prvků). Nyní
je samostatná v `src/views/ShiftCard.jsx`.

**R2 — `ScheduleView`.** Závislosti (39 proměnných) nevypisovány ručně — vlastní
analýza minula proměnné deklarované víc na jednom řádku. Místo toho přesun a výčet
chybějících proměnných z lintu. Data i akce předány **pod stejnými jmény**, takže JSX
zůstalo beze změny. `todayIdx` a `isTd` (čisté datumové funkce) do `schedule.js`.

**Díra v kontrolách, nalezena a opravena.** Test vykreslení týdenního pohledu spadl na
`ReferenceError: RankBadge is not defined` — přestože lint prošel. Pravidlo `no-undef`
nekontroluje komponenty v JSX; na to slouží `react/jsx-no-undef`. Po jeho zapnutí lint
našel **dvě** chybějící komponenty (`RankBadge`, `HalfTag`). `HalfTag` by test sám
nenašel (vykresluje se jen u půldne, který testovací data neměla) — proto přidán test
s půldnem v obou pohledech. Obě pojistky se doplňují. Ostatní obrazovky nové pravidlo
prošly bez nálezu.

Testy Rozvrhu běží nad **realistickými daty**: celý tým ze stálého rozvrhu přes skutečné
`withDefaults` + `analyzeWeek`, včetně dovolené vyrábějící porušení a půldne.

**Stav rozdělení:** všech 8 obrazovek v `src/views/`, `App.jsx` 1909 → 1571 řádků
(zbytek = stav, listenery, zápisy, modální okna). 50 testů, lint čistý.

---

## Aktualizace v35 — odstraněno „Předvyplnit rozvrh", opravena osobní pravidla

**Nález.** Uživatel poslal aktuální pondělí k doplnění do konstanty `PRESET`. Pondělí
je v pořádku (kancelář 5, 8:00 ×3, 10:00 ×2 s jedním v kanceláři). Ale kontrola
ukázala, že **`PRESET` se rozešel s realitou**: jména ve Firestore jsou nyní celá
(„Denis Lochman"), `PRESET` zná jen příjmení → 6 ze 7 lidí se nespárovalo, obsahoval
bývalého člena (Víťa) a neznal nového (Viktor Koutný). Jediný spárovaný byl Andy —
klik na „Předvyplnit rozvrh" by tedy **přepsal jen Andyho aktuální stálý rozvrh
červencovou verzí**. Tichá past.

**Rozhodnutí uživatele: odstranit.** Stálý rozvrh žije v databázi a upravuje se
v appce — kopie v kódu se nutně rozchází. Odstraněno: `PRESET`, `RENAME`,
`applyPreset`, karta s tlačítkem v obrazovce Stálý rozvrh. Týden z `PRESET` přesunut
do `src/test-fixtures.mjs` jako testovací data (`TEAM_WEEK`) — testy Rozvrhu na něm stojí.

Pozn. k postupu: první pokus o odstranění `applyPreset` smazal místo něj
`applyDefaultToWeek` + `applyDefaultCurrentWeek` — komentář nad předvyplněním se při
dřívějším přeuspořádání (v29) oddělil od své funkce a zůstal nad jinou. Zachyceno
kontrolou diffu před commitem, `App.jsx` vrácen a funkce odstraněna podle přesných hranic.

**Druhý nález — osobní pravidla se přestala uplatňovat.** `PERSONAL` je klíčovaný
příjmením, `personalOf` hledal přesnou shodu → po přechodu na celá jména platilo jen
pravidlo Andyho. **Appka nehlídala, že Lochman nemá mít ve středu 10:00**, ani
Slavíčkova pravidla. Oprava: `personalOf` páruje podle celého jména **nebo** příjmení.
Odebrán stale záznam Víťa (noHO). Dva nové testy — ověřeno, že na staré logice selžou.

52 testů, lint čistý.

---

## Aktualizace v36 — osobní pravidla prozatím vypnuta

Rozhodnutí uživatele: kvůli dynamice týmu se osobní pravidla v praxi často porušují
a upozornění by jen dělala šum. `PERSONAL = {}`.

Důsledky vypnutí (vědomě přijaté):
- žádná upozornění „X nemá otevírat / nemá mít 10:00 / nemá mít HO",
- Návrhy mohou nabídnout **Andyho** na pokrytí 8:00 (dřív ho `canOpen` vyřazoval).

Mechanismus zůstává kvůli případnému návratu: `personalOf(employees, eid, rulesMap)`
s volitelnou mapou a `analyzeWeek` bere mapu z `rules.personal`, jinak z `PERSONAL`.
Zapnutí = doplnit záznam do `PERSONAL` (příklady v komentáři u konstanty).
Testy mechanismu používají vlastní mapu (nezávislé na tom, co je zapnuté) + nový test
aktuálního stavu: žádná osobní upozornění, Andy mezi návrhy na 8:00. 53 testů.

Tato větev obsahuje i v35 (odstranění „Předvyplnit rozvrh").

---

## Aktualizace v37 — diagnostika: náhled bez rotace

**Příznak.** Admin vidí v úterý 29. 9. rotaci (Lochman 8:00 HO, Andy 10:00 HO), páteční
snímek ukazuje úterý bez rotace (Andy 9:00 HO, Lochman 10:00 HO = výchozí pozice).
Opakovaný snímek dává totéž.

**Rozbor.** Kód je pro admina i bota shodný a pravidla se načítají bezpodmínečně;
`firestore.rules` v repu čtení `rules/global` všem přihlášeným dovoluje. Bot je běžný
člen → pravděpodobně **stejně špatně vidí rozvrh všichni členové**. Kandidáti:
(1) rotace není uložená v DB, žije jen v otevřené admin relaci (před v32 se změny
pravidel projevovaly bez uložení); (2) pravidla v konzoli Firebase se liší od repa
a členové `rules/global` číst nesmí (známý otevřený bod „rules drift").

**Co se změnilo (aby to šlo příště poznat hned):**
- Listener `rules/global` má obsluhu chyby — dřív chybějící oprávnění znamenalo tichý
  návrat k výchozím pravidlům bez rotací. Stav načtení se zapisuje do
  `<html data-rules="ok:N | missing | error:kód">`.
- Bot přeposílá chyby a výjimky stránky do logu Actions, **čeká na načtení pravidel**
  a vypíše „Pravidla v appce: …". Pokud se pravidla nenačetla, **skončí chybou bez
  uložení snímku** — raději ponechá předchozí snímek, než aby zveřejnil špatný.
