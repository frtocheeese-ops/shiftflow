/* ═══════════════════════════════════════════════════════════════════════════
   ui.jsx — sdílené UI prvky (tlačítka, karty, modaly, odznaky)
   Používá je App.jsx i jednotlivé obrazovky v src/views/.
   ═══════════════════════════════════════════════════════════════════════════ */
import { ABS } from "./schedule";

export const Badge = ({ children, color = "var(--acc)", small, style: sx }) => <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: small ? "2px 8px" : "4px 12px", fontSize: small ? 11 : 13, fontWeight: 500, fontFamily: "'Barlow Condensed',sans-serif", color, letterSpacing: .8, textTransform: "uppercase", border: `1px solid ${color}`, whiteSpace: "nowrap", ...sx }}>{children}</span>;
export const Btn = ({ children, onClick, primary, danger, small, ghost, warm, disabled, style: sx }) => <button disabled={disabled} onClick={onClick} style={{ padding: small ? "8px 14px" : "12px 24px", border: `1px solid ${danger ? "var(--red)" : warm ? "var(--acc2)" : primary ? "var(--acc)" : "var(--brd2)"}`, fontWeight: 500, cursor: disabled ? "not-allowed" : "pointer", fontSize: small ? 13 : 15, fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 1, background: warm ? "var(--adim)" : primary ? "var(--sel)" : "transparent", color: danger ? "var(--red)" : warm ? "var(--acc2)" : primary ? "var(--stx)" : "var(--tx2)", opacity: disabled ? .3 : 1, transition: "all .2s", minHeight: 44, ...sx }}>{children}</button>;
export const Input = ({ label, ...p }) => <div style={{ marginBottom: 18 }}>{label && <label style={{ fontSize: 12, color: "var(--tx3)", display: "block", marginBottom: 6, fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 1.5 }}>{label}</label>}<input {...p} style={{ width: "100%", padding: "12px 14px", border: "1px solid var(--brd2)", background: "var(--bg)", color: "var(--w)", fontSize: 16, fontFamily: "'Barlow',sans-serif", outline: "none", boxSizing: "border-box", minHeight: 48, ...(p.style || {}) }} onFocus={e => e.target.style.borderColor = "var(--acc2)"} onBlur={e => e.target.style.borderColor = ""} /></div>;
export const Sel = ({ label, options, ...p }) => <div style={{ marginBottom: 18 }}>{label && <label style={{ fontSize: 12, color: "var(--tx3)", display: "block", marginBottom: 6, fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 1.5 }}>{label}</label>}<select {...p} style={{ width: "100%", padding: "12px 14px", border: "1px solid var(--brd2)", background: "var(--bg)", color: "var(--w)", fontSize: 16, fontFamily: "'Barlow',sans-serif", outline: "none", minHeight: 48 }}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>;
export const Toggle = ({ checked, onChange, label }) => <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 15, color: "var(--tx)", marginBottom: 14, minHeight: 44 }}><div onClick={() => onChange(!checked)} style={{ width: 40, height: 20, border: `1px solid ${checked ? "var(--acc2)" : "var(--brd2)"}`, position: "relative", cursor: "pointer", flexShrink: 0, background: checked ? "var(--adim)" : "transparent", transition: "all .25s" }}><div style={{ width: 16, height: 16, background: checked ? "var(--acc2)" : "var(--tx3)", position: "absolute", top: 1, left: checked ? 21 : 1, transition: "all .25s" }} /></div>{label}</label>;
export const Modal = ({ open, onClose, title, children, wide }) => { if (!open) return null; return <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.35)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-end", justifyContent: "center", animation: "fi .2s" }} onClick={onClose}><div onClick={e => e.stopPropagation()} className="gl" style={{ borderBottom: "none", padding: "28px 24px 36px", width: "100%", maxWidth: wide ? 760 : 520, maxHeight: "85vh", overflowY: "auto", animation: "mu .3s cubic-bezier(.22,.68,.36,1)" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, borderBottom: "1px solid var(--brd)", paddingBottom: 16 }}><h3 style={{ margin: 0, fontSize: 18, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600, textTransform: "uppercase", letterSpacing: 2 }}>{title}</h3><button onClick={onClose} style={{ background: "none", border: "1px solid var(--brd2)", color: "var(--tx3)", width: 40, height: 40, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button></div>{children}</div></div>; };
export const Card = ({ children, style: sx }) => <div className="gl" style={{ padding: 20, ...sx }}>{children}</div>;

export const RANK_TIERS = [1, 15, 30, 45, 60, 80, 100, 130, 160, 200];
export const rankOf = n => { let r = 0; for (let i = 0; i < RANK_TIERS.length; i++) if ((n || 0) >= RANK_TIERS[i]) r = i + 1; return r; };
export const HALF_LBL = { first: "dopoledne", second: "odpoledne" };
export const HalfTag = ({ en, compact }) => {
  if (!en?.halfAbs) return null;
  const a = ABS.find(x => x.id === en.halfAbs);
  const second = en.halfPart === "second";
  return <span title={`${a?.label || "Půlden"} — chybí ${second ? "odpoledne (2. polovina směny)" : "dopoledne (1. polovina směny)"}`}
    style={{ flexShrink: 0, fontSize: compact ? 9 : 10, padding: compact ? "0 3px" : "1px 5px", border: `1px solid ${a?.color || "var(--brd2)"}`, color: a?.color || "var(--tx2)", fontFamily: "'IBM Plex Mono',monospace", whiteSpace: "nowrap", lineHeight: 1.6 }}>{a?.icon} {compact ? (second ? "odp." : "dop.") : `chybí ${HALF_LBL[second ? "second" : "first"]}`}</span>;
};

export const RankBadge = ({ fixes, size = 20 }) => {
  const r = rankOf(fixes);
  if (!r) return null;
  const next = RANK_TIERS[r] ? ` · další rank od ${RANK_TIERS[r]}` : " · maximální rank";
  return <img src={`/badges/rank${r}.png`} alt={`Rank ${r}`} title={`Rank ${r} · ${fixes} vyřešených problémů${next}`} loading="lazy"
    style={{ width: size, height: size, flexShrink: 0, verticalAlign: "middle", objectFit: "contain" }} />;
};
