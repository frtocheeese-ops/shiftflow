// Testy rozhodování pátečního náhledu (scripts/nahled-okno.mjs) — letní i zimní čas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rozhodni } from "./nahled-okno.mjs";

const at = iso => ({ now: new Date(iso), stamp: "" });

test("léto (UTC+2): před 9:00 nic, v 9:07 obnova, ve 12:30 záchrana, po 19:00 nic", () => {
  assert.equal(rozhodni(at("2026-10-02T06:47:00Z")).run, false);                 // 8:47
  assert.match(rozhodni(at("2026-10-02T07:07:00Z")).duvod, /obnovuji snímek/);     // 9:07
  assert.match(rozhodni(at("2026-10-02T10:30:00Z")).duvod, /záchranný běh/);      // 12:30
  assert.equal(rozhodni(at("2026-10-02T17:07:00Z")).run, false);                 // 19:07
});

test("zima (UTC+1): okno se posune o hodinu", () => {
  assert.equal(rozhodni(at("2026-12-04T07:47:00Z")).run, false);                 // 8:47
  assert.equal(rozhodni(at("2026-12-04T08:07:00Z")).run, true);                  // 9:07
  assert.equal(rozhodni(at("2026-12-04T17:47:00Z")).run, true);                  // 18:47 záchrana
});

test("po 11:50 už dnešní snímek → konec; ruční spuštění okno nehlídá", () => {
  assert.equal(rozhodni({ now: new Date("2026-10-02T10:30:00Z"), stamp: "2026-10-02 09:12\n" }).run, false);
  assert.equal(rozhodni({ now: new Date("2026-10-02T08:30:00Z"), stamp: "2026-10-02 09:12\n" }).run, true);   // v okně obnovuje dál
  assert.equal(rozhodni({ now: new Date("2026-10-02T03:00:00Z"), stamp: "", force: true }).run, true);
});

test("cron workflow pokrývá celé okno v létě i v zimě a vyhýbá se celým hodinám a čtvrthodinám", () => {
  const wf = readFileSync(new URL("../.github/workflows/nahled.yml", import.meta.url), "utf8");
  const m = wf.match(/cron: "([\d,]+) (\d+)-(\d+) \* \* 5"/); assert.ok(m, "cron nenalezen");
  const mins = m[1].split(",").map(Number), [h0, h1] = [Number(m[2]), Number(m[3])];
  assert.ok(mins.every(x => x % 15 !== 0), `minuty ${mins} trefují vytížené :00/:15/:30/:45`);
  for (const [den, label] of [["2026-10-02", "léto"], ["2026-12-04", "zima"]]) {
    const runs = [];
    for (let h = h0; h <= h1; h++) for (const mi of mins) {
      const t = new Date(`${den}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00Z`);
      if (rozhodni({ now: t, stamp: "" }).run) runs.push(t);
    }
    const prvni = Math.min(...runs.map(r => r.getUTCHours() * 60 + r.getUTCMinutes())), posledni = Math.max(...runs.map(r => r.getUTCHours() * 60 + r.getUTCMinutes()));
    assert.ok(runs.length >= 25, `${label}: jen ${runs.length} pokusů v okně`);
    assert.ok(prvni - (label === "léto" ? 7 * 60 : 8 * 60) <= 10, `${label}: první pokus až ${prvni} min UTC`);         // do 10 min po 9:00
    assert.ok((label === "léto" ? 17 * 60 : 18 * 60) - posledni <= 20, `${label}: poslední pokus už ${posledni} min UTC`); // do 20 min před 19:00
  }
});
