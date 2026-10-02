// Rozhodnutí, jestli má páteční náhled pracovat. BEZ ZÁVISLOSTÍ — workflow ho spouští jako
// první krok ještě před instalací Puppeteeru, takže pokusy mimo okno skončí za pár vteřin.
// Používá ho i scripts/nahled.mjs → logika okna je na jediném místě.
//   • 9:00–11:50 pražského času … obnovovací okno (každý běh přepíše snímek čerstvějším)
//   • 11:50–19:00 ………………………… záchrana, pokud dnes ještě nic nevzniklo
import { readFileSync, existsSync, appendFileSync } from "fs";

export const STAMP = "public/nahled/last.txt";
export const OKNO_OD = 9 * 60, OKNO_DO = 11 * 60 + 50, POZDE_DO = 19 * 60;

export const prahaNow = (d = new Date()) => new Date(d.toLocaleString("en-US", { timeZone: "Europe/Prague" }));

export function rozhodni({ now = new Date(), stamp, force = false } = {}) {
  if (stamp === undefined) stamp = existsSync(STAMP) ? readFileSync(STAMP, "utf8") : "";
  const praha = prahaNow(now);
  const dnes = `${praha.getFullYear()}-${String(praha.getMonth() + 1).padStart(2, "0")}-${String(praha.getDate()).padStart(2, "0")}`;
  const minuty = praha.getHours() * 60 + praha.getMinutes();
  const buhloDnes = stamp.trim().startsWith(dnes);
  const cas = praha.toTimeString().slice(0, 5);
  let run = true, duvod;
  if (force) duvod = "Ruční spuštění — okno se nehlídá.";
  else if (minuty < OKNO_OD) { run = false; duvod = `Pražský čas ${cas} — před oknem, končím.`; }
  else if (minuty > POZDE_DO) { run = false; duvod = `Pražský čas ${cas} — po okně, končím.`; }
  else if (minuty > OKNO_DO && buhloDnes) { run = false; duvod = "Po 11:50 a dnes už snímek vznikl — končím."; }
  else duvod = `Pražský čas ${cas} → ${minuty <= OKNO_DO ? "obnovuji snímek" : "záchranný běh"}.`;
  return { run, duvod, praha, dnes, minuty, buhloDnes };
}

// Spuštěno přímo (krok workflow): vypíše rozhodnutí a zapíše run=1/0 do výstupu kroku
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const r = rozhodni({ force: process.env.FORCE === "1" });
  console.log(r.duvod);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${r.run ? 1 : 0}\n`);
}
