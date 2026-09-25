/* Karta jedné směny v denním pohledu: lidé ve směně, HO, půlden, poznámka, výměna.
   Samostatná komponenta — dřív byla definovaná UVNITŘ App, takže ji React při každém
   překreslení bral jako novou a všechny karty zahazoval a vytvářel znovu. */
import { fsKey } from "../schedule";
import { Badge, RankBadge, HalfTag } from "../ui";

export default function ShiftCard({ day, shift, entries, ge, notes, meId, isA, canDrag, onDrop, onAdminClick, onMyShift, onDirectSwap, onNote }) {
  
  return <div className="gl dz" style={{ padding: 0 }}
    onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("over"); }}
    onDragLeave={e => e.currentTarget.classList.remove("over")}
    onDrop={e => onDrop(day, shift, e)}>
    {entries.map((en, idx) => { const emp = ge(en.empId); if (!emp) return null; const nk = fsKey(en.empId, day, shift.replace(":", "")); const note = notes[nk]; const isMe = en.empId === meId;
      return <div key={en.empId} className="ent" draggable={canDrag(en.empId)}
        onDragStart={e => e.dataTransfer.setData("text/plain", JSON.stringify({ empId: en.empId, day, shift }))}
        onClick={() => isA ? onAdminClick({ day, shift, empId: en.empId }) : isMe && onMyShift({ type: "myshift", day, shift })}
        style={{ gap: 10, padding: "12px 14px", borderBottom: idx < entries.length - 1 ? "1px solid var(--brd)" : "none" }}>
        <div style={{ width: 3, height: 24, background: en.ho ? "var(--grn)" : "var(--acc2)" }} />
        <span style={{ fontWeight: 500, color: "var(--w)", flex: 1, display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{emp.name}</span><RankBadge fixes={emp.fixCount} /><HalfTag en={en} /></span>
        {!isA && !isMe && <button title={`Požádat ${emp.name} o výměnu`} onClick={e => { e.stopPropagation(); onDirectSwap({ type: "directSwap", targetEmp: emp, targetDay: day, targetShift: shift }); }} style={{ background: "none", border: "1px solid var(--acc2)", color: "var(--acc2)", width: 26, height: 26, cursor: "pointer", fontSize: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontFamily: "'IBM Plex Mono',monospace" }}>⇄</button>}
        {note && <button aria-label="Zobrazit poznámku" onClick={e => { e.stopPropagation(); onNote({ name: emp.name, day, shift, text: note }); }} style={{ background: "none", color: "var(--acc2)", cursor: "pointer", fontSize: 15, fontWeight: 700, border: "1px solid var(--acc2)", width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontFamily: "'IBM Plex Mono',monospace" }}>i</button>}
        {en.ho && <Badge small color="var(--grn)">HO</Badge>}
      </div>; })}
    {entries.length === 0 && <div style={{ padding: "14px", color: "var(--tx3)", fontSize: 14 }}>—</div>}
  </div>;
}
