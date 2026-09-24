/* Obrazovka Tým (jen admin) — členové, zbývající dny, vyřešené problémy.
   Nic nezapisuje: přidání, úprava, smazání i změna počtu fixů volá funkce z App.jsx. */
import { Btn, Card, RankBadge } from "../ui";

export default function PeopleView({ employees, onAdd, onEditDays, onDelete, onAdjustFixes }) {
  return (
    <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20, borderBottom: "1px solid var(--brd)", paddingBottom: 12 }}><div style={{ fontSize: 20, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2 }}>Tým</div><Btn warm onClick={onAdd}>+ Přidat</Btn></div>
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>{employees.filter(e => e.role !== "admin").map(emp => <Card key={emp.id}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div style={{ fontWeight: 600, fontSize: 17, color: "var(--w)", display: "flex", alignItems: "center", gap: 8 }}>{emp.name}<RankBadge fixes={emp.fixCount} size={26} /></div>
                <div style={{ display: "flex", gap: 4 }}><button onClick={() => onEditDays(emp)} style={{ background: "none", border: "1px solid var(--brd2)", color: "var(--tx3)", cursor: "pointer", width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center" }}>✏</button><button onClick={() => onDelete(emp.id)} style={{ background: "none", border: "1px solid rgba(192,48,48,.3)", color: "var(--red)", cursor: "pointer", width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button></div>
              </div>
              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>{[{ l: "Dovol.", v: (emp.vacationTotal || 20) - (emp.vacationUsed || 0), c: "var(--sd)" }, { l: "Sick", v: (emp.sickTotal || 5) - (emp.sickUsed || 0), c: "var(--red)" }, { l: "What.", v: (emp.whateverTotal || 3) - (emp.whateverUsed || 0), c: "var(--amb)" }].map(b => <div key={b.l} style={{ textAlign: "center", padding: 8, border: "1px solid var(--brd)" }}><div style={{ fontSize: 20, fontWeight: 600, color: b.c, fontFamily: "'IBM Plex Mono',monospace" }}>{b.v}</div><div style={{ fontSize: 10, color: "var(--tx3)", textTransform: "uppercase" }}>{b.l}</div></div>)}</div>
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", border: "1px solid var(--brd)" }}>
                <span style={{ fontSize: 12, color: "var(--tx3)", textTransform: "uppercase", letterSpacing: 1, flex: 1 }}>🛠 Vyřešené problémy</span>
                <button onClick={() => onAdjustFixes(emp, -1)} style={{ background: "none", border: "1px solid var(--brd2)", color: "var(--tx3)", cursor: "pointer", width: 28, height: 28 }}>−</button>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 16, fontWeight: 600, color: "var(--amb)", minWidth: 24, textAlign: "center" }}>{emp.fixCount || 0}</span>
                <button onClick={() => onAdjustFixes(emp, 1)} style={{ background: "none", border: "1px solid var(--brd2)", color: "var(--tx3)", cursor: "pointer", width: 28, height: 28 }}>+</button>
              </div>
            </Card>)}</div>
          </div>
    </div>
  );
}
