/* Obrazovka Nastavení — účet, páteční snímek, instalace, vzhled, Google Kalendář, pravidla.
   Nic nezapisuje do databáze: všechny akce volá z App.jsx.
   Pravidla se upravují jako KONCEPT — do aplikace (a ostatním) se promítnou až po „Uložit". */
import { useState, useEffect } from "react";
import { DAYS, SHIFTS, wKey, rotIsSwapped, localISO, getMon, fmtDate } from "../schedule";
import { Badge, Btn, Card, Input, Sel, Toggle } from "../ui";

function RotationForm({ employees, onAdd }) {
  const staff = employees.filter(e => e.role !== "admin");
  const [day, setDay] = useState("Út");
  const [aId, setA] = useState(""); const [bId, setB] = useState("");
  const [shiftA, setSA] = useState("08:00"); const [shiftB, setSB] = useState("10:00");
  const [ho, setHo] = useState(true);
  const opts = staff.map(e => ({ value: e.id, label: e.name }));
  const shOpts = SHIFTS.map(x => ({ value: x, label: x }));
  const add = () => {
    if (!aId || !bId || aId === bId) return alert("Vyber dva různé členy.");
    if (shiftA === shiftB) return alert("Vyber dvě různé směny.");
    onAdd({ day, aId, bId, shiftA, shiftB, ho, anchor: wKey(new Date()) });
    setA(""); setB("");
  };
  return <div style={{ border: "1px dashed var(--brd2)", padding: "10px 11px" }}>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      <Sel label="Den" value={day} onChange={e => setDay(e.target.value)} options={DAYS.map(d => ({ value: d, label: d }))} />
      <Sel label="Režim" value={ho ? "ho" : "office"} onChange={e => setHo(e.target.value === "ho")} options={[{ value: "ho", label: "Home office" }, { value: "office", label: "Kancelář" }]} />
      <Sel label="Člen A" value={aId} onChange={e => setA(e.target.value)} options={[{ value: "", label: "— vyber —" }, ...opts]} />
      <Sel label="Směna A" value={shiftA} onChange={e => setSA(e.target.value)} options={shOpts} />
      <Sel label="Člen B" value={bId} onChange={e => setB(e.target.value)} options={[{ value: "", label: "— vyber —" }, ...opts]} />
      <Sel label="Směna B" value={shiftB} onChange={e => setSB(e.target.value)} options={shOpts} />
    </div>
    <p style={{ fontSize: 11.5, color: "var(--tx3)", margin: "4px 0 8px" }}>Tento týden dostane A směnu {shiftA} a B směnu {shiftB}; příští týden se prohodí.</p>
    <Btn small warm onClick={add} style={{ width: "100%" }}>+ Přidat rotaci</Btn>
  </div>;
}

export default function SettingsView({
  isA, profile, employees, wk, rules, nahledInfo, installState, showGyro, gyroOn, gcalConfigured,
  onOpenModal, onInstall, onGyroChange, onGcalToggle, onGcalSyncWeek, onGcalSyncYear, onGcalClear,
  onGcalDisconnect, onSaveRules, onResetWeek, onExportCSV,
}) {
  // Koncept pravidel: dokud admin neuloží, změny přicházející z databáze koncept nepřepíšou
  const [draft, setDraft] = useState(rules);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setDraft(rules); }, [rules, dirty]);
  const edit = fn => { setDraft(fn); setDirty(true); };
  const save = async () => { await onSaveRules(draft); setDirty(false); };

  return (
    <div style={{ maxWidth: 560 }}>
          <div style={{ fontSize: 20, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2, marginBottom: 20, borderBottom: "1px solid var(--brd)", paddingBottom: 12 }}>Nastavení</div>
          <Card style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--tx2)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12, fontFamily: "'Barlow Condensed',sans-serif" }}>Účet</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Btn ghost onClick={() => onOpenModal("changeName")}>Změnit jméno</Btn>
              <Btn ghost onClick={() => onOpenModal("changePass")}>Změnit heslo</Btn>
              <Btn ghost onClick={() => onOpenModal("changeNotif")}>Email notifikace</Btn>
            </div>
          </Card>
          {isA && <Card style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--tx2)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12, fontFamily: "'Barlow Condensed',sans-serif" }}>Páteční snímek rozvrhu</div>
            <div style={{ fontSize: 13, color: "var(--tx2)", marginBottom: 12, lineHeight: 1.7 }}>
              {nahledInfo === null ? <span style={{ color: "var(--tx3)" }}>Načítám stav…</span> : <>
                Publikovaný týden: <b style={{ color: "var(--w)" }}>{nahledInfo.week || "neznámý"}</b><br />
                Naposledy aktualizováno: <b style={{ color: "var(--w)" }}>{nahledInfo.date || "—"}</b>
              </>}
            </div>
            <Btn warm onClick={() => window.open("https://github.com/frtocheeese-ops/shiftflow/actions/workflows/nahled.yml", "_blank")} style={{ width: "100%", marginBottom: 8 }}>🔄 Aktualizovat snímek teď</Btn>
            <Btn ghost onClick={() => window.open("https://smenyjt.netlify.app/nahled/?c=" + Date.now(), "_blank")} style={{ width: "100%", marginBottom: 10 }}>👁 Zobrazit aktuální snímek</Btn>
            <p style={{ fontSize: 12, color: "var(--tx3)", margin: 0, lineHeight: 1.6 }}>
              Snímek se tvoří automaticky v pátek ráno. Po změnách na poslední chvíli klepni na Aktualizovat — otevře se GitHub, kde dáš <b>Run workflow → Run workflow</b>. Nový snímek je na webu do dvou minut a odkaz ve WhatsAppu zůstává stejný.
            </p>
          </Card>}
          <Card style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--tx2)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12, fontFamily: "'Barlow Condensed',sans-serif" }}>Aplikace</div>
            {installState === "standalone" ? <p style={{ fontSize: 13, color: "var(--grn)", margin: 0 }}>✓ Běžíš v nainstalované aplikaci.</p>
              : installState === "installable" ? <>
                <Btn warm onClick={onInstall}>📲 Nainstalovat aplikaci</Btn>
                <p style={{ fontSize: 12, color: "var(--tx3)", margin: "10px 0 0" }}>Přidá ShiftFlow na plochu — spouští se pak na celou obrazovku jako běžná aplikace, bez lišty prohlížeče.</p>
              </>
              : installState === "ios" ? <p style={{ fontSize: 13, color: "var(--tx2)", margin: 0 }}>Na iPhonu: <b>Sdílet</b> (čtvereček se šipkou) → <b>Přidat na plochu</b>. Safari přímé tlačítko nenabízí.</p>
              : <p style={{ fontSize: 13, color: "var(--tx2)", margin: 0 }}>Instalaci nabídne menu prohlížeče (⋮ → „Přidat na plochu" / „Nainstalovat aplikaci"). Pokud už je nainstalovaná, tlačítko se tady nezobrazuje.</p>}
          </Card>
          {showGyro && <Card style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--tx2)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12, fontFamily: "'Barlow Condensed',sans-serif" }}>Vzhled</div>
            <Toggle checked={gyroOn} label="Parallax pozadí (gyroskop)" onChange={onGyroChange} />
            <p style={{ fontSize: 12, color: "var(--tx3)", margin: 0 }}>Experiment: pozadí se lehce hýbe podle náklonu telefonu. Pokud by aplikace ztratila plynulost, vypni to tady — projeví se okamžitě, bez restartu.</p>
          </Card>}
          <Card style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--tx2)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12, fontFamily: "'Barlow Condensed',sans-serif" }}>Google Calendar</div>
            {!gcalConfigured ? <p style={{ fontSize: 13, color: "var(--tx3)" }}>Google Calendar integrace není nakonfigurována (chybí VITE_GOOGLE_CLIENT_ID).</p> : <>
              <Toggle checked={profile.gcalEnabled || false} onChange={onGcalToggle} label="Synchronizovat rozvrh do Google Calendar" />
              {profile.gcalEnabled && <>
                <p style={{ fontSize: 12, color: "var(--tx3)", marginBottom: 10 }}>Směny se zapíšou do vašeho primárního Google kalendáře jako události s tagem [ShiftFlow].</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Btn warm onClick={onGcalSyncWeek}>Sync týden</Btn>
                  <Btn warm onClick={onGcalSyncYear}>Sync celý rok</Btn>
                  <Btn ghost onClick={onGcalClear} style={{ color: "var(--red)", borderColor: "var(--red)" }}>Smazat vše z kalendáře</Btn>
                  <Btn ghost onClick={onGcalDisconnect}>Odpojit</Btn>
                </div>
              </>}
            </>}
          </Card>
          {isA && <Card style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--tx2)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12, fontFamily: "'Barlow Condensed',sans-serif" }}>Pravidla směn</div>
            <Input label="Minimum lidí v kanceláři" type="number" value={draft.officeMin ?? 4} onChange={e => edit(r => ({ ...r, officeMin: +e.target.value }))} /><Input label="Minimum v kanceláři od 8:00" type="number" value={draft.min8 ?? 2} onChange={e => edit(r => ({ ...r, min8: +e.target.value }))} /><Input label="Minimum na 10:00 (vč. HO)" type="number" value={draft.min10 ?? 2} onChange={e => edit(r => ({ ...r, min10: +e.target.value }))} /><Input label="Max HO / den" type="number" value={draft.hoCapDay ?? 3} onChange={e => edit(r => ({ ...r, hoCapDay: +e.target.value }))} /><Input label="Max HO / osoba / týden" type="number" value={draft.hoPerWeek ?? 2} onChange={e => edit(r => ({ ...r, hoPerWeek: +e.target.value }))} /><Toggle checked={draft.cover8 !== false} onChange={v => edit(r => ({ ...r, cover8: v }))} label="Vyžadovat minimum na 8:00" /><Toggle checked={draft.cover10 !== false} onChange={v => edit(r => ({ ...r, cover10: v }))} label="Vyžadovat minimum na 10:00" /><div style={{ borderTop: "1px solid var(--brd)", marginTop: 12, paddingTop: 12 }}><Toggle checked={draft.allowAllDnD || false} onChange={v => edit(r => ({ ...r, allowAllDnD: v }))} label="Povolit Drag & Drop pro všechny" /><p style={{ fontSize: 12, color: "var(--tx3)", marginTop: -8, marginBottom: 12 }}>Zaměstnanci budou moci přesouvat kohokoliv v rozvrhu.</p></div><div style={{ borderTop: "1px solid var(--brd)", marginTop: 16, paddingTop: 12 }}>
              <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 15, letterSpacing: 1, textTransform: "uppercase", color: "var(--w)", marginBottom: 4 }}>Rotace dvojic</div>
              <p style={{ fontSize: 12, color: "var(--tx3)", marginBottom: 10 }}>Dvojici se v daný den každý týden prohodí směna. Ruční úprava rozvrhu má vždy přednost — rotace se uplatní jen tam, kde nikdo nezasáhl.</p>
              {(draft.rotations || []).map((rot, i) => {
                const nameOf = id => employees.find(e => e.id === id)?.name || "?";
                const swapped = rotIsSwapped(wk, rot.anchor);
                return <div key={i} style={{ border: "1px solid var(--brd)", padding: "9px 11px", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                    <Badge small color="var(--acc2)">{rot.day}</Badge>
                    <span style={{ fontSize: 13, color: "var(--w)", flex: 1 }}>{nameOf(rot.aId)} ⇄ {nameOf(rot.bId)} · {rot.shiftA} / {rot.shiftB}{rot.ho !== false ? " · HO" : ""}</span>
                    <Btn small danger onClick={() => edit(r => ({ ...r, rotations: (r.rotations || []).filter((_, j) => j !== i) }))}>Odebrat</Btn>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--tx3)", fontFamily: "'IBM Plex Mono',monospace", lineHeight: 1.6 }}>
                    {[0, 1, 2, 3].map(k => {
                      const d = new Date(wk + "T00:00:00"); d.setDate(d.getDate() + k * 7);
                      const key = localISO(getMon(d)); const sw = rotIsSwapped(key, rot.anchor);
                      return <div key={k} style={{ color: k === 0 ? "var(--tx2)" : "var(--tx3)" }}>
                        {k === 0 ? "tento týden" : fmtDate(localISO(d))}: {nameOf(rot.aId)} {sw ? rot.shiftB : rot.shiftA} · {nameOf(rot.bId)} {sw ? rot.shiftA : rot.shiftB}
                      </div>;
                    })}
                    <div style={{ color: "var(--tx3)", marginTop: 3 }}>V den Nástupů se časy prohodí, ale bez HO.</div>
                  </div>
                </div>;
              })}
              <RotationForm employees={employees} onAdd={rot => edit(r => ({ ...r, rotations: [...(r.rotations || []), rot] }))} />
            </div>
            {dirty && <p style={{ fontSize: 12, color: "var(--amb)", margin: "4px 0 8px" }}>● Neuložené změny — platí až po uložení.</p>}
                    <Btn warm onClick={save} disabled={!dirty}>{dirty ? "Uložit pravidla" : "Uloženo"}</Btn>
          </Card>}
          {isA && <Card><div style={{ display: "flex", gap: 8 }}><Btn danger onClick={onResetWeek}>Reset týden</Btn><Btn ghost onClick={onExportCSV}>CSV</Btn></div></Card>}
    </div>
  );
}
