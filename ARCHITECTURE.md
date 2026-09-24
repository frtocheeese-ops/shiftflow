# ShiftFlow — architektura a pravidla pro změny

## Struktura

| Soubor | Co obsahuje | Závislosti |
|---|---|---|
| `src/schedule.js` | **Čistá logika rozvrhu**: konstanty (dny, směny, typy absencí, svátky), datumové pomocníky, stálý rozvrh (`PRESET`), osobní pravidla, rotace, skládání týdne (`withDefaults`), kontrola pravidel (`analyzeWeek`), návrhy řešení (`applyAlt`) | žádné (ani React, ani Firebase) |
| `src/schedule.test.mjs` | Testy logiky — každý odpovídá reálné chybě z historie projektu | jen `node:test` |
| `src/App.jsx` | UI, stav, zápisy do Firestore, Google Kalendář | importuje `schedule.js` |
| `scripts/nahled.mjs` + `.github/workflows/nahled.yml` | Páteční snímek rozvrhu na `/nahled/` | Puppeteer |

**Kam patří nová logika:** cokoli, co počítá nebo odvozuje rozvrh a nepotřebuje React ani databázi, patří do `schedule.js` — a k tomu test do `schedule.test.mjs`. `App.jsx` má logiku jen *volat*, ne ji mít vlastní kopii.

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

`npm run check` musí skončit bez chyby. Lint hlídá zejména:
- **použití proměnné před její deklarací** — shodilo celou appku na modrou obrazovku (v27),
  přitom build prošel;
- **nedefinované proměnné** — rozbíjelo potvrzení „Zapomenuté heslo" (v29).

Build tyhle chyby nechytá — kód je syntakticky v pořádku, padá až za běhu.
