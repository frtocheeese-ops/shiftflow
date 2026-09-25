/* Obrazovka Stálý rozvrh (jen admin) — přehled a úprava výchozích rozvrhů členů.
   Nic nezapisuje: uložení volá funkci předanou z App.jsx. */
import { useState } from "react";
import { DAYS, SHIFTS } from "../schedule";
import { Btn, Card, Modal } from "../ui";

function DefEditor({ employees, onSave }) {
  const [editEmp, setEditEmp] = useState(null); const [es, setEs] = useState({}); const [saving, setSaving] = useState(false);
  const start = emp => { setEditEmp(emp); const s = {}; DAYS.forEach(d => { s[d] = emp.defaultSchedule?.[d] || "09:00"; s[`${d}_ho`] = emp.defaultSchedule?.[`${d}_ho`] || false; }); setEs(s); };
  return <div><div style={{ marginBottom: 28 }}>
    <div className="gl" style={{ overflow: "auto", padding: 0 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}><thead><tr>
        <th style={{ padding: "12px 14px", textAlign: "left", color: "var(--tx3)", borderBottom: "1px solid var(--brd)" }}>Zaměstnanec</th>
        {DAYS.map(d => <th key={d} style={{ padding: "12px 8px", textAlign: "center", color: "var(--tx3)", borderBottom: "1px solid var(--brd)" }}>{d}</th>)}
        <th style={{ padding: 12, borderBottom: "1px solid var(--brd)" }} />
      </tr></thead><tbody>{employees.filter(e => e.role !== "admin").map(emp => <tr key={emp.id} style={{ borderBottom: "1px solid var(--brd)" }}>
        <td style={{ padding: "12px 14px", fontWeight: 500, color: "var(--w)" }}>{emp.name}</td>
        {DAYS.map(d => <td key={d} style={{ padding: 8, textAlign: "center" }}>{emp.setupDone && emp.defaultSchedule?.[d] ? <span style={{ fontFamily: "'IBM Plex Mono',monospace", color: emp.defaultSchedule[`${d}_ho`] ? "var(--grn)" : "var(--acc2)", fontSize: 13 }}>{emp.defaultSchedule[`${d}_ho`] ? "HO" : emp.defaultSchedule[d]}</span> : "—"}</td>)}
        <td style={{ padding: "8px 12px", textAlign: "right" }}><Btn small onClick={() => start(emp)}>✏</Btn></td>
      </tr>)}</tbody></table>
    </div>
  </div>
    <Modal open={!!editEmp} onClose={() => setEditEmp(null)} title={editEmp?.name || ""}>{editEmp && <div>
      {DAYS.map(day => <div key={day} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--bg3)", marginBottom: 4 }}>
        <span style={{ fontWeight: 600, minWidth: 50, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif" }}>{day}</span>
        <div style={{ display: "flex", gap: 2, flex: 1 }}>{SHIFTS.map(sh => <button key={sh} onClick={() => setEs(s => ({ ...s, [day]: sh }))} style={{ flex: 1, padding: "10px 0", border: `1px solid ${es[day] === sh ? "var(--acc2)" : "var(--brd)"}`, fontFamily: "'IBM Plex Mono',monospace", cursor: "pointer", background: es[day] === sh ? "var(--adim)" : "transparent", color: es[day] === sh ? "var(--w)" : "var(--tx3)", minHeight: 44 }}>{sh}</button>)}<button onClick={() => setEs(s => ({ ...s, [`${day}_ho`]: !s[`${day}_ho`] }))} style={{ padding: "10px 12px", border: `1px solid ${es[`${day}_ho`] ? "var(--grn)" : "var(--brd)"}`, fontFamily: "'IBM Plex Mono',monospace", cursor: "pointer", background: "transparent", color: es[`${day}_ho`] ? "var(--grn)" : "var(--tx3)", minHeight: 44 }}>HO</button></div>
      </div>)}
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}><Btn warm disabled={saving} onClick={async () => { setSaving(true); try { await onSave(editEmp.id, es); setEditEmp(null); } catch { /* chybu už ohlásil App; okno zůstane otevřené */ } finally { setSaving(false); } }} style={{ flex: 1 }}>Uložit</Btn><Btn ghost onClick={() => setEditEmp(null)}>Zrušit</Btn></div>
    </div>}</Modal></div>;
}

export default function DefaultsView({ employees, onSaveDefault }) {
  return (
    <div><div style={{ fontSize: 20, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2, marginBottom: 16, borderBottom: "1px solid var(--brd)", paddingBottom: 12 }}>Stálý rozvrh</div>
      <DefEditor employees={employees} onSave={onSaveDefault} /></div>
  );
}
