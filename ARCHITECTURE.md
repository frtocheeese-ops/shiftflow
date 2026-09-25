# ShiftFlow — architektura a pravidla pro změny

## Struktura

| Soubor | Co obsahuje | Závislosti |
|---|---|---|
| `src/schedule.js` | **Čistá logika rozvrhu**: konstanty (dny, směny, typy absencí, svátky), datumové pomocníky, stálý rozvrh (`PRESET`), osobní pravidla, rotace, skládání týdne (`withDefaults`), kontrola pravidel (`analyzeWeek`), návrhy řešení (`applyAlt`) | žádné (ani React, ani Firebase) |
| `src/schedule.test.mjs` | Testy logiky — každý odpovídá reálné chybě z historie projektu | jen `node:test` |
| `src/ui.jsx` | Sdílené UI prvky: `Btn`, `Card`, `Modal`, `Input`, `Sel`, `Toggle`, `Badge`, `RankBadge`, `HalfTag` | `schedule.js` |
| `src/views/*.jsx` | Všechny obrazovky: `ScheduleView` (+ `ShiftCard`), `ProposalsView`, `SwapsView`, `PeopleView`, `StatsView`, `LogView`, `DefaultsView`, `SettingsView` | `ui.jsx`, `schedule.js` |
| `src/views.test.mjs` | Test vykreslení obrazovek — chytá pády za běhu | `esbuild`, `react-dom/server` |
| `src/App.jsx` | Stav, přihlášení, listenery, **všechny zápisy do Firestore**, Google Kalendář, modální okna, navigace | vše výše |
| `scripts/nahled.mjs` + `.github/workflows/nahled.yml` | Páteční snímek rozvrhu na `/nahled/` | Puppeteer |

**Kam patří nová logika:** cokoli, co počítá nebo odvozuje rozvrh a nepotřebuje React ani databázi, patří do `schedule.js` — a k tomu test do `schedule.test.mjs`. `App.jsx` má logiku jen *volat*, ne ji mít vlastní kopii.

## Jak oddělit další obrazovku (vzor podle StatsView)

1. **Logika pryč z JSX.** Pokud obrazovka něco počítá (jako férovost), výpočet jde do
   `schedule.js` jako čistá funkce + test do `schedule.test.mjs`.
2. **JSX do `src/views/XxxView.jsx`.** Obrazovka dostává data jako vstupy (props) a akce
   jako funkce (`onEditDays`, …). **Sama nezapisuje do Firestore** — zápis zůstává
   v `App.jsx`, obrazovka jen zavolá předanou funkci.
3. **Test vykreslení do `views.test.mjs`** — pro každou roli (admin / člen) a pro prázdná data.
4. **Po každém kroku commit** a `npm run check`.

**Všechny obrazovky jsou oddělené.** Pravidlo platí dál: nová obrazovka = nový soubor ve
`src/views/`, data a akce jako props, žádné zápisy do databáze uvnitř.

**Komponenty nedefinovat uvnitř jiných komponent.** `ShiftCard` byla dřív definovaná
uvnitř `App` — React ji pak při každém překreslení bral jako novou a všechny karty
zahazoval a vytvářel znovu. Každá komponenta patří na nejvyšší úroveň souboru.

**Pozor na proměnné modulu:** handler, který přiřazuje do proměnné `let` z `App.jsx`
(např. `deferredInstall = null`), nejde přesunout do jiného souboru — import je jen
ke čtení. Takový handler zůstává v `App.jsx` a obrazovka ho dostane jako funkci.

**Formuláře nastavení upravují koncept**, ne živý stav — viz pravidla v `SettingsView`.

## Jediný zdroj pravdy

Uložený týden v databázi **není** to, co uživatel vidí. Skutečný rozvrh vzniká až funkcí
`withDefaults(entries, absences, employees, weekKey, rotations, intake, intakeAllow)`,
která na uložená data aplikuje aktuální stálý rozvrh, nové kolegy, rotace a Nástupy.

Všechno, co s rozvrhem pracuje — mřížka, kontrola pravidel, Návrhy, statistiky,
výměny, schvalování, Google Kalendář, hromadné aplikování — **musí jít přes `withDefaults`**.
Vlastní kopie slučovací logiky kdekoli jinde byla v historii projektu zdrojem pěti
samostatných chyb (viz PRECHOD-VZORCE.md v16, v18, v20, v21, v28).

## Invarianty (to, co musí vždy platit)

1. **Ruční úprava má přednost.** Záznam s `isDefault: false` se nikdy nepřepíše stálým
   rozvrhem ani rotací.
2. **Celodenní vs. půldenní absence.** Celodenní absence člověka ze dne vyřadí. Půlden
   (`half_*`) ho ve směně **nechá** a označí (`halfAbs`, `halfPart`). Rozlišuje `isFullAbs()`.
3. **Minulost je historie.** Minulé týdny se nepřepisují změnou stálého rozvrhu, rotací
   založenou později, ani doplněním kolegy, který tehdy ještě nenastoupil
   (jinak by se měnily statistiky férovosti).
4. **Nástupy a rotace.** V den Nástupů rotace prohodí časy, ale bez home office
   (pokud dotyčný nemá výjimku).
5. **Zápisy přes transakce.** Změny týdne jdou přes `txSchedule` / `runTransaction`
   s `mergeFields` — nikdy `setDoc(..., { merge: true })` na mapy (`absences`),
   jinak nejdou mazat klíče a hrozí přepsání souběžné změny.

## Datový model týdne (`schedules/{pondělí}`)

```
entries:     { [den]: { [směna]: [ { empId, ho, isDefault, rot?, halfAbs?, halfPart? } ] } }
absences:    { "<empId>__<den>": "<typ>" }     // typ z ABS, half_* = půlden
intake:      { [den]: true }                    // Nástupy
intakeAllow: { [den]: [empId, …] }              // výjimky z Nástupů
notes, events, modifiedAt, modifiedBy
```

## Před každým nasazením

```
npm run check      # testy logiky + lint
npm run build      # (s VITE_FIREBASE_* proměnnými)
```

`npm run check` musí skončit bez chyby. Test vykreslení ověřen sabotáží: chyba „použití
před deklarací" vložená do obrazovky prošla buildem, ale test ji chytil. Lint hlídá zejména:
- **použití proměnné před její deklarací** — shodilo celou appku na modrou obrazovku (v27),
  přitom build prošel;
- **nedefinované proměnné** — rozbíjelo potvrzení „Zapomenuté heslo" (v29);
- **nedefinované komponenty v JSX** (`react/jsx-no-undef`) — `no-undef` je nevidí; bez
  tohoto pravidla by týdenní pohled rozvrhu spadl na chybějící `RankBadge` a `HalfTag` (v34).

Build tyhle chyby nechytá — kód je syntakticky v pořádku, padá až za běhu.
