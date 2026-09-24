/* Obrazovka Výměny — seznam otevřených žádostí o výměnu směny.
   Nic nezapisuje: přijetí, zrušení i smazání volá funkce předané z App.jsx. */
import { Badge, Btn, Card } from "../ui";

export default function SwapsView({ isA, profile, swaps, ge, onAccept, onCancel, onDelete, onNewRequest }) {
  return (
    <div>
          <div style={{ fontSize: 20, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2, marginBottom: 20, borderBottom: "1px solid var(--brd)", paddingBottom: 12 }}>Výměny</div>
          {!isA && <Card style={{ marginBottom: 20 }}><Btn warm onClick={onNewRequest}>+ Nová žádost</Btn></Card>}
          {swaps.map(sw => { const re = ge(sw.rid); const me = profile.id === sw.rid; const tgt = sw.targetId ? ge(sw.targetId) : null; const isTarget = sw.targetId === profile.id; const can = !isA && !me && (!sw.targetId ? true : isTarget); const dateLabel = sw.dateISO ? new Date(sw.dateISO + "T00:00:00").toLocaleDateString("cs", { weekday: "short", day: "numeric", month: "numeric" }) : `${sw.day} (týden ${sw.week})`; return <Card key={sw.id} style={{ padding: 16, marginBottom: 8 }}><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}><div><div style={{ fontWeight: 600, fontSize: 17, color: "var(--w)" }}>{re?.name}</div><div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center", flexWrap: "wrap" }}><Badge small color="var(--acc2)">{dateLabel} · {sw.sh}</Badge>{tgt && <Badge small color="var(--amb)">→ {tgt.name}</Badge>}</div></div><div style={{ display: "flex", gap: 6, alignItems: "center" }}>{can && <Btn warm small onClick={() => onAccept(sw)}>Přijmout</Btn>}{me && <><Badge color="var(--amb)">Tvoje</Badge><Btn small danger onClick={() => onCancel(sw, dateLabel)}>✕ Zrušit</Btn></>}{isA && !me && <Btn small danger onClick={() => onDelete(sw)}>✕</Btn>}</div></div>{sw.comment && <div style={{ marginTop: 8, fontSize: 13, color: "var(--tx2)", padding: "6px 10px", border: "1px solid var(--brd)", background: "var(--bg3)" }}>💬 {sw.comment}</div>}</Card>; })}
          {!swaps.length && <p style={{ color: "var(--tx3)" }}>Žádné žádosti.</p>}
    </div>
  );
}
