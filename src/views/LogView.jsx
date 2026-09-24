/* Obrazovka Log — auditní záznam změn, jen ke čtení. */
export default function LogView({ logs }) {
  return (
    <div><div style={{ fontSize: 20, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2, marginBottom: 20, borderBottom: "1px solid var(--brd)", paddingBottom: 12 }}>Log</div>{logs.map(h => <div key={h.id} style={{ display: "flex", gap: 10, padding: "10px 12px", borderBottom: "1px solid var(--brd)", fontSize: 14 }}><span style={{ fontSize: 12, color: "var(--tx3)", fontFamily: "'IBM Plex Mono',monospace", minWidth: 130 }}>{h.time ? new Date(h.time).toLocaleString("cs") : ""}</span><span style={{ flex: 1 }}>{h.msg}</span></div>)}</div>
  );
}
