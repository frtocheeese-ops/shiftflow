/* Obrazovka Statistiky — jen čte data, nic nezapisuje.
   Výpočet férovosti je v schedule.js (computeFairness), tady jen zobrazení. */
import { Card, RankBadge } from "../ui";
import { FAIR_SPREAD } from "../schedule";

export default function StatsView({ isA, profile, employees, openSwapsCount, fairness, onEditDays }) {
  return (
    <div>
        <div style={{ fontSize: 20, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2, marginBottom: 20, borderBottom: "1px solid var(--brd)", paddingBottom: 12 }}>Status</div>
        {!isA && <Card style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}><div style={{ fontSize: 16, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase" }}>Moje dny</div><button onClick={onEditDays} style={{ background: "none", border: "1px solid var(--brd2)", color: "var(--tx3)", cursor: "pointer", width: 34, height: 34 }}>✏</button></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>{[{ l: "Dovolená", v: (profile.vacationTotal || 20) - (profile.vacationUsed || 0), t: profile.vacationTotal || 20, c: "var(--sd)" }, { l: "Sick", v: (profile.sickTotal || 5) - (profile.sickUsed || 0), t: profile.sickTotal || 5, c: "var(--red)" }, { l: "Whatever", v: (profile.whateverTotal || 3) - (profile.whateverUsed || 0), t: profile.whateverTotal || 3, c: "var(--amb)" }].map(b => <div key={b.l} style={{ textAlign: "center", padding: 12, border: "1px solid var(--brd)", background: "var(--bg3)" }}><div style={{ fontSize: 28, fontWeight: 600, color: b.c, fontFamily: "'IBM Plex Mono',monospace" }}>{b.v}</div><div style={{ fontSize: 11, color: "var(--tx3)", textTransform: "uppercase" }}>{b.l} (z {b.t})</div></div>)}</div>
        </Card>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 12 }}>{[{ l: "Crew", v: employees.filter(e => e.role !== "admin").length, c: "var(--acc2)" }, { l: "Active", v: employees.filter(e => e.setupDone).length, c: "var(--grn)" }, { l: "Swaps", v: openSwapsCount, c: "var(--amb)" }].map(s => <Card key={s.l}><div style={{ fontSize: 32, fontWeight: 600, color: s.c, fontFamily: "'IBM Plex Mono',monospace" }}>{s.v}</div><div style={{ fontSize: 12, color: "var(--tx3)", textTransform: "uppercase", marginTop: 4 }}>{s.l}</div></Card>)}</div>
  
        {/* ═══ FÉROVOST ═══ */}
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 1, margin: "28px 0 6px" }}>Férovost · od 22. 7. 2026</div>
        <p style={{ fontSize: 12, color: "var(--tx3)", marginBottom: 12 }}>Počty odpracovaných směn od 8:00, od 10:00 a dnů home office, počítané od 22. 7. 2026 (start nového modelu). Hlídač upozorní, když se rozdíl mezi lidmi zvětší nad {FAIR_SPREAD}.</p>
        {fairness.warn.length > 0 && <div className="gl" style={{ padding: "10px 14px", marginBottom: 12, borderLeft: "3px solid var(--amb)" }}>
          {fairness.warn.map((w, i) => <div key={i} style={{ fontSize: 13, color: "var(--amb)", padding: "2px 0" }}>⚠️ {w.msg}</div>)}
        </div>}
        {fairness.warn.length === 0 && fairness.rows.some(r => r.weeks > 0) && <div className="gl" style={{ padding: "10px 14px", marginBottom: 12, borderLeft: "3px solid var(--grn)", fontSize: 13, color: "var(--grn)" }}>✓ Rozložení směn i HO je vyrovnané.</div>}
        <div className="gl" style={{ overflow: "auto", padding: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 420 }}>
            <thead><tr>
              {["Člen", "8:00", "10:00", "HO", "HO −", "🛠 Fixy", "Týdnů"].map((h, i) => <th key={h} style={{ padding: "10px 12px", textAlign: i === 0 ? "left" : "center", color: "var(--tx3)", borderBottom: "1px solid var(--brd)", fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: 1 }} title={h === "HO −" ? "HO deficit: dny, kdy stálý rozvrh říká HO, ale člověk byl v kanceláři" : h === "🛠 Fixy" ? "Kolikrát jeho směna vyřešila problém (Provést úpravu)" : undefined}>{h}</th>)}
            </tr></thead>
            <tbody>{fairness.rows.map(r => {
              const maxV = Math.max(1, ...fairness.rows.map(x => Math.max(x.eight, x.ten, x.ho)));
              const bar = (v, c) => <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}><div style={{ width: 40, height: 6, background: "var(--brd)", position: "relative" }}><div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${100 * v / maxV}%`, background: c }} /></div><span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, minWidth: 18, textAlign: "right" }}>{v}</span></div>;
              return <tr key={r.id} style={{ borderBottom: "1px solid var(--brd)" }}>
                <td style={{ padding: "8px 12px", fontWeight: 600, color: "var(--w)" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{r.name}<RankBadge fixes={r.fixes} /></span></td>
                <td style={{ padding: "8px 12px" }}>{bar(r.eight, "var(--acc2)")}</td>
                <td style={{ padding: "8px 12px" }}>{bar(r.ten, "var(--amb)")}</td>
                <td style={{ padding: "8px 12px" }}>{bar(r.ho, "var(--grn)")}</td>
                <td style={{ padding: "8px 12px", textAlign: "center", fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: r.deficit > 0 ? "var(--red)" : "var(--tx3)" }}>{r.deficit > 0 ? `−${r.deficit}` : "0"}</td>
                <td style={{ padding: "8px 12px", textAlign: "center" }}>{r.fixes > 0 ? <span style={{ display: "inline-block", padding: "1px 8px", border: "1px solid var(--amb)", color: "var(--amb)", fontFamily: "'IBM Plex Mono',monospace", fontSize: 13 }}>🛠 {r.fixes}</span> : <span style={{ color: "var(--tx3)", fontFamily: "'IBM Plex Mono',monospace", fontSize: 13 }}>0</span>}</td>
                <td style={{ padding: "8px 12px", textAlign: "center", fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: "var(--tx3)" }}>{r.weeks}</td>
              </tr>; })}</tbody>
          </table>
        </div>
  </div>
  );
}
