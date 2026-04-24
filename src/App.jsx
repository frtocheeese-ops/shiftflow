import { useState, useEffect, useMemo, useRef } from "react";
import { auth, db, getMsg } from "./firebase";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, onSnapshot } from "firebase/firestore";
import { getToken, onMessage } from "firebase/messaging";

/* ═══ CONSTANTS ═══ */
const TEAMS = { L1: "L1 Support", SD: "Service Desk" };
const SHIFTS = ["08:00", "09:00", "10:00"];
const DAYS = ["Po", "Út", "St", "Čt", "Pá"];
const DAYS_F = ["Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek"];
const ABS = [
  { id: "sick", label: "Sick Day", icon: "🤒", color: "#c04040" },
  { id: "doctor", label: "Lékař", icon: "🏥", color: "#d48020" },
  { id: "vacation", label: "Dovolená", icon: "🏖️", color: "#4080b0" },
  { id: "whatever", label: "Whatever", icon: "☕", color: "#8070b0" },
  { id: "training", label: "Školení", icon: "📚", color: "#308060" },
  { id: "half_vacation", label: "½ Dovolená", icon: "½🏖", color: "#4080b0" },
  { id: "half_ho", label: "½ HO", icon: "½🏠", color: "#50a060" },
];
const EVTS = [{ id: "training", label: "Školení", icon: "📚" }, { id: "dinner", label: "Večeře", icon: "🍽️" }, { id: "teambuilding", label: "Teambuilding", icon: "🎯" }, { id: "meeting", label: "Porada", icon: "💬" }, { id: "other", label: "Jiné", icon: "📌" }];
const HMAP = {
  '2025-01-01':'Nový rok','2025-04-18':'Velký pátek','2025-04-21':'Vel. pondělí','2025-05-01':'Svátek práce','2025-05-08':'Den vítězství','2025-07-05':'Cyril a Metoděj','2025-07-06':'Jan Hus','2025-09-28':'Den české státnosti','2025-10-28':'Den vzniku ČSR','2025-11-17':'Den svobody','2025-12-24':'Štědrý den','2025-12-25':'1. svátek vánoční','2025-12-26':'2. svátek vánoční',
  '2026-01-01':'Nový rok','2026-04-03':'Velký pátek','2026-04-06':'Vel. pondělí','2026-05-01':'Svátek práce','2026-05-08':'Den vítězství','2026-07-05':'Cyril a Metoděj','2026-07-06':'Jan Hus','2026-09-28':'Den české státnosti','2026-10-28':'Den vzniku ČSR','2026-11-17':'Den svobody','2026-12-24':'Štědrý den','2026-12-25':'1. svátek vánoční','2026-12-26':'2. svátek vánoční',
  '2027-01-01':'Nový rok','2027-03-26':'Velký pátek','2027-03-29':'Vel. pondělí','2027-05-01':'Svátek práce','2027-05-08':'Den vítězství','2027-07-05':'Cyril a Metoděj','2027-07-06':'Jan Hus','2027-09-28':'Den české státnosti','2027-10-28':'Den vzniku ČSR','2027-11-17':'Den svobody','2027-12-24':'Štědrý den','2027-12-25':'1. svátek vánoční','2027-12-26':'2. svátek vánoční',
};
const AE = "admin@shiftflow.app", AP = "ShiftFlowAdmin2026!";

/* ═══ HELPERS ═══ */
const dc = o => JSON.parse(JSON.stringify(o));
const uid = () => "u" + Math.random().toString(36).slice(2, 9);
function getMon(d) { const dt = new Date(d); const dy = dt.getDay(); dt.setDate(dt.getDate() - dy + (dy === 0 ? -6 : 1)); dt.setHours(0, 0, 0, 0); return dt; }
function localISO(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
const wKey = d => localISO(getMon(d));
const fmtW = d => { const m = getMon(d), f = new Date(m); f.setDate(f.getDate() + 4); return `${m.getDate()}.${m.getMonth() + 1}. — ${f.getDate()}.${f.getMonth() + 1}.${f.getFullYear()}`; };
function buildDef(emps) { const s = {}; DAYS.forEach(day => { s[day] = {}; SHIFTS.forEach(sh => s[day][sh] = []); emps.forEach(emp => { if (!emp.defaultSchedule || !emp.setupDone) return; const shift = emp.defaultSchedule[day]; if (shift && SHIFTS.includes(shift)) s[day][shift].push({ empId: emp.id, ho: emp.defaultSchedule[`${day}_ho`] || false, isDefault: true }); }); }); return s; }
function getWeekDates(wo) { const d = new Date(); d.setDate(d.getDate() + wo * 7); const mon = getMon(d); return DAYS.map((_, i) => { const x = new Date(mon); x.setDate(mon.getDate() + i); return localISO(x); }); }
function fmtDate(iso) { const p = iso.split('-'); return `${parseInt(p[2])}.${parseInt(p[1])}.`; }
const todayIdx = (() => { const d = new Date().getDay(); return d >= 1 && d <= 5 ? d - 1 : 0; })();
const isTd = (i, wo) => wo === 0 && i === todayIdx;
const GAS = import.meta.env.VITE_GAS_URL;
async function callGAS(a, d) { if (!GAS) return; try { await fetch(GAS, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ action: a, data: d }) }); } catch { } }
async function initPush(u) { try { const m = await getMsg(); if (!m) return; if ((await Notification.requestPermission()) !== "granted") return; const v = import.meta.env.VITE_FIREBASE_VAPID_KEY; if (!v) return; const t = await getToken(m, { vapidKey: v }); await updateDoc(doc(db, "users", u), { fcmToken: t }); onMessage(m, p => { if (p.notification) new Notification(p.notification.title || "SF", { body: p.notification.body, icon: "/icon-192.png" }); }); } catch { } }
// Firestore-safe key: no dots, slashes or special chars
const fsKey = (...parts) => parts.join("__");

/* ═══ CSS ═══ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@300;400;500;600;700&family=Barlow:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
:root,[data-theme="light"]{
  --bg:#bec4d0;--bg2:rgba(210,215,225,.45);--bg3:rgba(200,208,222,.35);--bg4:rgba(190,198,215,.48);
  --panel:rgba(215,220,230,.65);--card:rgba(220,225,235,.42);--card-h:rgba(210,218,230,.6);
  --brd:rgba(50,60,85,.22);--brd2:rgba(40,50,75,.35);--bt:rgba(35,45,70,.45);
  --tx:#2e3440;--tx2:#555e70;--tx3:#7a8290;--w:#1a1e28;
  --acc:#3a4558;--acc2:#d47820;--acc3:#c05828;--adim:rgba(212,120,32,.1);--abrd:rgba(212,120,32,.32);
  --l1:#5050d0;--sd:#2878a8;--red:#b83030;--grn:#388040;--amb:#c87020;
  --sel:#2e3848;--stx:#e8eaf0;--blur:blur(24px);--glass:rgba(215,220,230,.65);
  --sheen:linear-gradient(135deg,rgba(255,255,255,.28) 0%,rgba(255,255,255,.02) 38%,rgba(255,255,255,.07) 65%,rgba(255,255,255,.20) 100%);
  --grid:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cdefs%3E%3Cpattern id='g' width='40' height='40' patternUnits='userSpaceOnUse'%3E%3Cpath d='M40 0H0v40' fill='none' stroke='rgba(80,90,120,.06)' stroke-width='.5'/%3E%3Ccircle cx='0' cy='0' r='.8' fill='rgba(80,90,120,.05)'/%3E%3C/pattern%3E%3C/defs%3E%3Crect width='200' height='200' fill='url(%23g)'/%3E%3C/svg%3E");
  --moon:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='800'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='.012' numOctaves='8' seed='3' type='fractalNoise'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3CfeComponentTransfer%3E%3CfeFuncR type='linear' slope='.18' intercept='.68'/%3E%3CfeFuncG type='linear' slope='.18' intercept='.7'/%3E%3CfeFuncB type='linear' slope='.18' intercept='.76'/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3Ccircle cx='120' cy='180' r='45' fill='rgba(0,0,0,.06)'/%3E%3Ccircle cx='380' cy='100' r='70' fill='rgba(0,0,0,.05)'/%3E%3Ccircle cx='550' cy='300' r='85' fill='rgba(0,0,0,.045)'/%3E%3C/svg%3E");
}
[data-theme="dark"]{
  --bg:#0c0c12;--bg2:rgba(18,18,28,.85);--bg3:rgba(24,24,36,.8);--bg4:rgba(30,30,44,.8);
  --panel:rgba(16,16,26,.88);--card:rgba(20,20,32,.7);--card-h:rgba(28,28,42,.8);
  --brd:rgba(255,255,255,.08);--brd2:rgba(255,255,255,.12);--bt:rgba(255,255,255,.14);
  --tx:#c0c4d0;--tx2:#7880a0;--tx3:#4a5070;--w:#e8eaf0;
  --acc:#7b8fad;--acc2:#d47820;--acc3:#c05828;--adim:rgba(212,120,32,.12);--abrd:rgba(212,120,32,.3);
  --l1:#7c7cf5;--sd:#50a0d0;--red:#c04040;--grn:#50a060;--amb:#c87020;
  --sel:rgba(123,143,173,.15);--stx:#e8eaf0;--blur:blur(16px);--glass:rgba(16,16,26,.82);
  --sheen:linear-gradient(135deg,rgba(255,255,255,.06) 0%,transparent 50%,rgba(255,255,255,.03) 100%);
  --grid:none;--moon:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='600'%3E%3Crect width='600' height='600' fill='%23080810'/%3E%3Ccircle cx='80' cy='120' r='1' fill='rgba(255,255,255,.5)'/%3E%3Ccircle cx='200' cy='60' r='.7' fill='rgba(255,255,255,.35)'/%3E%3Ccircle cx='350' cy='150' r='1.1' fill='rgba(255,255,255,.45)'/%3E%3Ccircle cx='500' cy='80' r='.8' fill='rgba(255,255,255,.4)'/%3E%3Ccircle cx='120' cy='280' r='.6' fill='rgba(255,255,255,.5)'/%3E%3Ccircle cx='300' cy='320' r='1' fill='rgba(255,255,255,.35)'/%3E%3Ccircle cx='450' cy='280' r='.9' fill='rgba(255,255,255,.45)'/%3E%3Ccircle cx='550' cy='400' r='.7' fill='rgba(255,255,255,.3)'/%3E%3Ccircle cx='150' cy='420' r='1' fill='rgba(255,255,255,.4)'/%3E%3Ccircle cx='380' cy='480' r='.8' fill='rgba(255,255,255,.45)'/%3E%3Ccircle cx='520' cy='550' r='1.2' fill='rgba(255,255,255,.3)'/%3E%3Ccircle cx='60' cy='530' r='.6' fill='rgba(255,255,255,.35)'/%3E%3Ccircle cx='250' cy='560' r='1' fill='rgba(255,255,255,.4)'/%3E%3C/svg%3E");
}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{background:var(--bg)}
::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-thumb{background:var(--brd2)}
@keyframes fi{from{opacity:0}to{opacity:1}}
@keyframes su{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes vi{from{opacity:0;transform:translateX(30px)}to{opacity:1;transform:translateX(0)}}
@keyframes mu{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:translateY(0)}}
@keyframes sr{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:translateX(0)}}
@keyframes sl2{from{opacity:0;transform:translateX(-24px)}to{opacity:1;transform:translateX(0)}}
@keyframes tp{0%,100%{box-shadow:0 0 0 0 rgba(212,120,32,.4)}50%{box-shadow:0 0 0 4px rgba(212,120,32,0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes st{from{transform:translateY(-30px);opacity:0}to{transform:translateY(0);opacity:1}}
.avi{animation:vi .35s cubic-bezier(.22,.68,.36,1)}.asr{animation:sr .26s both}.asl{animation:sl2 .26s both}
.atp{animation:tp 2.5s ease-in-out infinite}
.chg{box-shadow:inset 3px 0 0 var(--acc2)}
.ent{transition:all .15s;cursor:pointer;min-height:48px;display:flex;align-items:center}.ent:hover,.ent:active{background:var(--card-h)!important}
.gl{background:var(--card);backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);border:1px solid var(--bt)}
.pg{background:var(--panel);backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur)}
.dz{transition:background .15s}.dz.over{background:var(--adim)!important;outline:2px dashed var(--abrd)}
@media(max-width:768px){.gl,.pg{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}}
`;

/* ═══ UI ═══ */
const Badge = ({ children, color = "var(--acc)", small, style: sx }) => <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: small ? "2px 8px" : "4px 12px", fontSize: small ? 11 : 13, fontWeight: 500, fontFamily: "'Barlow Condensed',sans-serif", color, letterSpacing: .8, textTransform: "uppercase", border: `1px solid ${color}`, whiteSpace: "nowrap", ...sx }}>{children}</span>;
const Btn = ({ children, onClick, primary, danger, small, ghost, warm, disabled, style: sx }) => <button disabled={disabled} onClick={onClick} style={{ padding: small ? "8px 14px" : "12px 24px", border: `1px solid ${danger ? "var(--red)" : warm ? "var(--acc2)" : primary ? "var(--acc)" : "var(--brd2)"}`, fontWeight: 500, cursor: disabled ? "not-allowed" : "pointer", fontSize: small ? 13 : 15, fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 1, background: warm ? "var(--adim)" : primary ? "var(--sel)" : "transparent", color: danger ? "var(--red)" : warm ? "var(--acc2)" : primary ? "var(--stx)" : "var(--tx2)", opacity: disabled ? .3 : 1, transition: "all .2s", minHeight: 44, ...sx }}>{children}</button>;
const Input = ({ label, ...p }) => <div style={{ marginBottom: 18 }}>{label && <label style={{ fontSize: 12, color: "var(--tx3)", display: "block", marginBottom: 6, fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 1.5 }}>{label}</label>}<input {...p} style={{ width: "100%", padding: "12px 14px", border: "1px solid var(--brd2)", background: "var(--bg)", color: "var(--w)", fontSize: 16, fontFamily: "'Barlow',sans-serif", outline: "none", boxSizing: "border-box", minHeight: 48, ...(p.style || {}) }} onFocus={e => e.target.style.borderColor = "var(--acc2)"} onBlur={e => e.target.style.borderColor = ""} /></div>;
const Sel = ({ label, options, ...p }) => <div style={{ marginBottom: 18 }}>{label && <label style={{ fontSize: 12, color: "var(--tx3)", display: "block", marginBottom: 6, fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 1.5 }}>{label}</label>}<select {...p} style={{ width: "100%", padding: "12px 14px", border: "1px solid var(--brd2)", background: "var(--bg)", color: "var(--w)", fontSize: 16, fontFamily: "'Barlow',sans-serif", outline: "none", minHeight: 48 }}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>;
const Toggle = ({ checked, onChange, label }) => <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 15, color: "var(--tx)", marginBottom: 14, minHeight: 44 }}><div onClick={() => onChange(!checked)} style={{ width: 40, height: 20, border: `1px solid ${checked ? "var(--acc2)" : "var(--brd2)"}`, position: "relative", cursor: "pointer", flexShrink: 0, background: checked ? "var(--adim)" : "transparent", transition: "all .25s" }}><div style={{ width: 16, height: 16, background: checked ? "var(--acc2)" : "var(--tx3)", position: "absolute", top: 1, left: checked ? 21 : 1, transition: "all .25s" }} /></div>{label}</label>;
const Modal = ({ open, onClose, title, children }) => { if (!open) return null; return <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.35)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-end", justifyContent: "center", animation: "fi .2s" }} onClick={onClose}><div onClick={e => e.stopPropagation()} className="gl" style={{ borderBottom: "none", padding: "28px 24px 36px", width: "100%", maxWidth: 520, maxHeight: "85vh", overflowY: "auto", animation: "mu .3s cubic-bezier(.22,.68,.36,1)" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, borderBottom: "1px solid var(--brd)", paddingBottom: 16 }}><h3 style={{ margin: 0, fontSize: 18, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600, textTransform: "uppercase", letterSpacing: 2 }}>{title}</h3><button onClick={onClose} style={{ background: "none", border: "1px solid var(--brd2)", color: "var(--tx3)", width: 40, height: 40, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button></div>{children}</div></div>; };
const Card = ({ children, style: sx }) => <div className="gl" style={{ padding: 20, ...sx }}>{children}</div>;

/* ═══ PARALLAX ═══ */
function ParallaxBg() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const upd = (x, y) => { el.style.transform = `translate(${x * 24}px,${y * 18}px) scale(1.1)`; };
    const onM = e => upd(e.clientX / window.innerWidth - .5, e.clientY / window.innerHeight - .5);
    const onG = e => upd(Math.max(-1, Math.min(1, (e.gamma || 0) / 40)), Math.max(-1, Math.min(1, ((e.beta || 0) - 30) / 40)));
    window.addEventListener('mousemove', onM, { passive: true });
    window.addEventListener('deviceorientation', onG, { passive: true });
    return () => { window.removeEventListener('mousemove', onM); window.removeEventListener('deviceorientation', onG); };
  }, []);
  return <div ref={ref} style={{ position: 'fixed', inset: '-80px', zIndex: 0, pointerEvents: 'none', backgroundImage: 'var(--moon)', backgroundSize: 'cover', willChange: 'transform', transition: 'transform .12s linear' }} />;
}

/* ═══ NAV ═══ */
function SideNav({ view, setView, NAV, theme, setTheme }) {
  return <aside className="pg" style={{ width: 200, height: "100vh", position: "fixed", left: 0, top: 0, zIndex: 50, display: "flex", flexDirection: "column", borderRight: "1px solid var(--bt)" }}>
    <div style={{ padding: "20px 20px 16px", fontSize: 20, fontWeight: 700, color: "var(--w)", letterSpacing: 4, fontFamily: "'Barlow Condensed',sans-serif", borderBottom: "1px solid var(--brd)" }}>SHIFTFLOW</div>
    <div style={{ flex: 1, padding: "12px 0", overflowY: "auto" }}>
      {NAV.map(n => <button key={n.id} onClick={() => setView(n.id)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "12px 20px", border: "none", background: view === n.id ? "var(--adim)" : "transparent", borderLeft: view === n.id ? "3px solid var(--acc2)" : "3px solid transparent", color: view === n.id ? "var(--acc2)" : "var(--tx2)", cursor: "pointer", fontSize: 14, fontWeight: 600, fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 1, transition: "all .2s", minHeight: 44, textAlign: "left", position: "relative" }}>
        <span style={{ fontSize: 16, fontFamily: "'IBM Plex Mono',monospace", width: 20, textAlign: "center", opacity: .8 }}>{n.ic}</span>{n.l}
        {n.b > 0 && <span style={{ background: "var(--red)", color: "#fff", fontSize: 10, fontWeight: 700, width: 18, height: 18, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", marginLeft: "auto" }}>{n.b}</span>}
      </button>)}
    </div>
    <div style={{ padding: "12px 20px", borderTop: "1px solid var(--brd)" }}>
      <button onClick={() => setTheme(t => t === "light" ? "dark" : "light")} style={{ background: "none", border: "1px solid var(--brd2)", width: "100%", height: 38, cursor: "pointer", fontSize: 14, color: "var(--tx2)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 1 }}>{theme === "light" ? "● Dark" : "○ Light"}</button>
    </div>
  </aside>;
}
function PillNav({ view, setView, NAV }) {
  return <nav className="pg" style={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 100, display: 'flex', gap: 2, padding: 4, border: '1px solid var(--bt)', boxShadow: '0 8px 32px rgba(0,0,0,.22)' }}>
    {NAV.map(n => <button key={n.id} onClick={() => setView(n.id)} style={{ display: 'flex', alignItems: 'center', gap: view === n.id ? 7 : 0, padding: view === n.id ? '10px 16px' : '10px 13px', border: 'none', background: view === n.id ? 'var(--adim)' : 'transparent', outline: view === n.id ? '1px solid var(--abrd)' : 'none', cursor: 'pointer', color: view === n.id ? 'var(--acc2)' : 'var(--tx3)', transition: 'all .28s', minHeight: 44, position: 'relative' }}>
      <span style={{ fontSize: 16, fontFamily: "'IBM Plex Mono',monospace" }}>{n.ic}</span>
      <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, overflow: 'hidden', maxWidth: view === n.id ? 80 : 0, whiteSpace: 'nowrap', transition: 'max-width .28s' }}>{n.l}</span>
      {n.b > 0 && view !== n.id && <span style={{ position: 'absolute', top: 2, right: 2, background: 'var(--red)', color: '#fff', fontSize: 8, fontWeight: 700, width: 14, height: 14, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{n.b}</span>}
    </button>)}
  </nav>;
}

/* ═══ COMPONENTS (before App) ═══ */
function Setup({ profile, onDone }) {
  const [sched, setSched] = useState(() => { const s = {}; DAYS.forEach(d => { s[d] = "09:00"; s[`${d}_ho`] = false; }); return s; });
  const [saving, setSaving] = useState(false);
  return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", padding: 16 }}><style>{CSS}</style><ParallaxBg />
    <div className="gl" style={{ width: "100%", maxWidth: 520, padding: "36px 24px", animation: "mu .5s", position: "relative", zIndex: 1 }}>
      <div style={{ textAlign: "center", marginBottom: 32, borderBottom: "1px solid var(--brd)", paddingBottom: 24 }}>
        <h2 style={{ fontSize: 24, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2 }}>Stálý rozvrh</h2>
      </div>
      {DAYS.map(day => <div key={day} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--bg3)", border: "1px solid var(--brd)", marginBottom: 4 }}>
        <span style={{ fontWeight: 600, fontSize: 16, minWidth: 50, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif" }}>{day}</span>
        <div style={{ display: "flex", gap: 2, flex: 1 }}>{SHIFTS.map(sh => <button key={sh} onClick={() => setSched(s => ({ ...s, [day]: sh }))} style={{ flex: 1, padding: "10px 0", border: `1px solid ${sched[day] === sh ? "var(--acc2)" : "var(--brd)"}`, fontSize: 15, fontFamily: "'IBM Plex Mono',monospace", cursor: "pointer", background: sched[day] === sh ? "var(--adim)" : "transparent", color: sched[day] === sh ? "var(--w)" : "var(--tx3)", minHeight: 44 }}>{sh}</button>)}</div>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--tx3)", cursor: "pointer" }}><input type="checkbox" checked={sched[`${day}_ho`] || false} onChange={e => setSched(s => ({ ...s, [`${day}_ho`]: e.target.checked }))} style={{ width: 18, height: 18 }} />HO</label>
      </div>)}
      <Btn warm disabled={saving} onClick={async () => { setSaving(true); await updateDoc(doc(db, "users", profile.id), { defaultSchedule: sched, setupDone: true }); onDone(); }} style={{ width: "100%", marginTop: 20, padding: "14px 0", fontSize: 17 }}>{saving ? "..." : "POTVRDIT"}</Btn>
    </div>
  </div>;
}

function AuthScreen() {
  const [mode, setMode] = useState("login"); const [login, setLogin] = useState(""); const [pass, setPass] = useState("");
  const [err, setErr] = useState(""); const [loading, setLoading] = useState(false);
  const [rn, setRn] = useState(""); const [rEmail, setREmail] = useState(""); const [rp, setRp] = useState(""); const [rp2, setRp2] = useState("");
  const [rt, setRt] = useState("L1"); const [rNotify, setRNotify] = useState(false); const [rNotifEmail, setRNotifEmail] = useState("");
  const doLogin = async () => { setErr(""); setLoading(true); try { if (login === "Admin" && pass === "0000") await signInWithEmailAndPassword(auth, AE, AP); else await signInWithEmailAndPassword(auth, login, pass); } catch (e) { setErr(e.code === "auth/invalid-credential" ? "Neplatné údaje" : e.message); } setLoading(false); };
  const doReg = async () => { setErr(""); setLoading(true); try { if (!rn.trim() || !rEmail || !rp) { setErr("Vyplňte pole"); setLoading(false); return; } if (rp !== rp2) { setErr("Hesla neshodují"); setLoading(false); return; } if (rp.length < 6) { setErr("Min. 6 znaků"); setLoading(false); return; } const c = await createUserWithEmailAndPassword(auth, rEmail, rp); await updateProfile(c.user, { displayName: rn.trim() }); await setDoc(doc(db, "users", c.user.uid), { name: rn.trim(), email: rEmail, team: rt, role: "employee", notify: rNotify, notifyEmail: rNotify ? rNotifEmail : "", fcmToken: null, defaultSchedule: null, setupDone: false, vacationTotal: 20, sickTotal: 5, whateverTotal: 3, vacationUsed: 0, sickUsed: 0, whateverUsed: 0, createdAt: new Date().toISOString() }); } catch (e) { setErr(e.message); } setLoading(false); };
  return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", padding: 16 }}><style>{CSS}</style><ParallaxBg />
    <div className="gl" style={{ width: "100%", maxWidth: 440, padding: "40px 28px", animation: "mu .5s", position: "relative", zIndex: 1 }}>
      <div style={{ textAlign: "center", marginBottom: 36, borderBottom: "1px solid var(--brd)", paddingBottom: 28 }}>
        <div style={{ fontSize: 36, letterSpacing: 8, fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 300, color: "var(--w)" }}>SHIFTFLOW</div>
        <div style={{ width: 40, height: 2, background: "var(--acc2)", margin: "8px auto" }} />
      </div>
      <div style={{ display: "flex", marginBottom: 28, border: "1px solid var(--brd)" }}>{["login", "register"].map(m => <button key={m} onClick={() => { setMode(m); setErr(""); }} style={{ flex: 1, padding: "12px 0", border: "none", fontSize: 14, fontFamily: "'Barlow Condensed',sans-serif", cursor: "pointer", background: mode === m ? "var(--sel)" : "transparent", color: mode === m ? "var(--stx)" : "var(--tx3)", textTransform: "uppercase", letterSpacing: 1.5, minHeight: 48 }}>{m === "login" ? "Přihlášení" : "Registrace"}</button>)}</div>
      {mode === "login" ? <>
        <Input label="Email" value={login} onChange={e => setLogin(e.target.value)} />
        <Input label="Heslo" type="password" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === "Enter" && doLogin()} />
        <div style={{ display: "flex", gap: 8 }}><Btn warm disabled={loading} onClick={doLogin} style={{ flex: 1 }}>{loading ? "..." : "Přihlásit"}</Btn><Btn ghost onClick={async () => { try { const s = localStorage.getItem("sf_bio_email"), p = localStorage.getItem("sf_bio_token"); if (!s || !p) return setErr("Přihlaste se heslem a povolte biometrii"); await signInWithEmailAndPassword(auth, s, p); } catch (e) { setErr("Bio: " + e.message); } }} style={{ fontSize: 20 }}>🔐</Btn></div>
      </> : <>
        <Input label="Jméno" value={rn} onChange={e => setRn(e.target.value)} />
        <Input label="Email" value={rEmail} onChange={e => setREmail(e.target.value)} />
        <Input label="Heslo (min. 6)" type="password" value={rp} onChange={e => setRp(e.target.value)} />
        <Input label="Heslo znovu" type="password" value={rp2} onChange={e => setRp2(e.target.value)} />
        <Sel label="Tým" value={rt} onChange={e => setRt(e.target.value)} options={[{ value: "L1", label: "L1 Support" }, { value: "SD", label: "Service Desk" }]} />
        <Btn warm disabled={loading} onClick={doReg} style={{ width: "100%" }}>{loading ? "..." : "Zaregistrovat"}</Btn>
      </>}
      {err && <p style={{ color: "var(--red)", fontSize: 14, marginTop: 12, padding: "10px 14px", border: "1px solid var(--red)" }}>{err}</p>}
    </div>
  </div>;
}

function DefEditor({ employees }) {
  const [editEmp, setEditEmp] = useState(null); const [es, setEs] = useState({}); const [saving, setSaving] = useState(false);
  const start = emp => { setEditEmp(emp); const s = {}; DAYS.forEach(d => { s[d] = emp.defaultSchedule?.[d] || "09:00"; s[`${d}_ho`] = emp.defaultSchedule?.[`${d}_ho`] || false; }); setEs(s); };
  return <div>{["L1", "SD"].map(team => <div key={team} style={{ marginBottom: 28 }}>
    <div style={{ fontSize: 16, fontWeight: 600, color: team === "L1" ? "var(--l1)" : "var(--sd)", marginBottom: 12, fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 1.5 }}>{TEAMS[team]}</div>
    <div className="gl" style={{ overflow: "auto", padding: 0 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}><thead><tr>
        <th style={{ padding: "12px 14px", textAlign: "left", color: "var(--tx3)", borderBottom: "1px solid var(--brd)" }}>Zaměstnanec</th>
        {DAYS.map(d => <th key={d} style={{ padding: "12px 8px", textAlign: "center", color: "var(--tx3)", borderBottom: "1px solid var(--brd)" }}>{d}</th>)}
        <th style={{ padding: 12, borderBottom: "1px solid var(--brd)" }} />
      </tr></thead><tbody>{employees.filter(e => e.team === team && e.role !== "admin").map(emp => <tr key={emp.id} style={{ borderBottom: "1px solid var(--brd)" }}>
        <td style={{ padding: "12px 14px", fontWeight: 500, color: "var(--w)" }}>{emp.name}</td>
        {DAYS.map(d => <td key={d} style={{ padding: 8, textAlign: "center" }}>{emp.setupDone && emp.defaultSchedule?.[d] ? <span style={{ fontFamily: "'IBM Plex Mono',monospace", color: "var(--acc2)", fontSize: 13 }}>{emp.defaultSchedule[d]}</span> : "—"}</td>)}
        <td style={{ padding: "8px 12px", textAlign: "right" }}><Btn small onClick={() => start(emp)}>✏</Btn></td>
      </tr>)}</tbody></table>
    </div>
  </div>)}
    <Modal open={!!editEmp} onClose={() => setEditEmp(null)} title={editEmp?.name || ""}>{editEmp && <div>
      {DAYS.map(day => <div key={day} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--bg3)", marginBottom: 4 }}>
        <span style={{ fontWeight: 600, minWidth: 50, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif" }}>{day}</span>
        <div style={{ display: "flex", gap: 2, flex: 1 }}>{SHIFTS.map(sh => <button key={sh} onClick={() => setEs(s => ({ ...s, [day]: sh }))} style={{ flex: 1, padding: "10px 0", border: `1px solid ${es[day] === sh ? "var(--acc2)" : "var(--brd)"}`, fontFamily: "'IBM Plex Mono',monospace", cursor: "pointer", background: es[day] === sh ? "var(--adim)" : "transparent", color: es[day] === sh ? "var(--w)" : "var(--tx3)", minHeight: 44 }}>{sh}</button>)}</div>
      </div>)}
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}><Btn warm disabled={saving} onClick={async () => { setSaving(true); await updateDoc(doc(db, "users", editEmp.id), { defaultSchedule: es, setupDone: true }); setSaving(false); setEditEmp(null); }} style={{ flex: 1 }}>Uložit</Btn><Btn ghost onClick={() => setEditEmp(null)}>Zrušit</Btn></div>
    </div>}</Modal></div>;
}

function AbsF({ emps, wd, onSubmit }) { const [eid, setEid] = useState(emps[0]?.id || ""); const [dayIdx, setDayIdx] = useState(0); const [t, setT] = useState(ABS[0].id); return <div><Sel label="Zaměstnanec" value={eid} onChange={e => setEid(e.target.value)} options={emps.map(e => ({ value: e.id, label: e.name }))} /><Sel label="Den" value={dayIdx} onChange={e => setDayIdx(+e.target.value)} options={DAYS.map((d, i) => ({ value: i, label: `${DAYS_F[i]} ${fmtDate(wd[i])}` }))} /><Sel label="Typ" value={t} onChange={e => setT(e.target.value)} options={ABS.map(a => ({ value: a.id, label: `${a.icon} ${a.label}` }))} /><Btn warm onClick={() => onSubmit(eid, DAYS[dayIdx], t)} style={{ width: "100%", marginTop: 8 }}>Přidat</Btn></div>; }
function EvF({ onSubmit }) { const [day, setDay] = useState(DAYS[0]); const [t, setT] = useState(EVTS[0].id); const [n, setN] = useState(""); return <div><Sel label="Den" value={day} onChange={e => setDay(e.target.value)} options={DAYS.map((d, i) => ({ value: d, label: DAYS_F[i] }))} /><Sel label="Typ" value={t} onChange={e => setT(e.target.value)} options={EVTS.map(e => ({ value: e.id, label: `${e.icon} ${e.label}` }))} /><Input label="Poznámka" value={n} onChange={e => setN(e.target.value)} /><Btn warm onClick={() => onSubmit(day, t, n)} style={{ width: "100%", marginTop: 8 }}>Přidat</Btn></div>; }
function SwF({ dDay, dShift, onSubmit }) { const [day, setDay] = useState(dDay || DAYS[0]); const [sh, setSh] = useState(dShift || SHIFTS[0]); return <div><Sel label="Den" value={day} onChange={e => setDay(e.target.value)} options={DAYS.map((d, i) => ({ value: d, label: DAYS_F[i] }))} /><Sel label="Směna" value={sh} onChange={e => setSh(e.target.value)} options={SHIFTS.map(s => ({ value: s, label: s }))} /><Btn warm onClick={() => onSubmit(day, sh)} style={{ width: "100%", marginTop: 8 }}>Odeslat</Btn></div>; }
function MyAbsF({ profile, wd, onSubmit }) { const [dayIdx, setDayIdx] = useState(todayIdx); const [t, setT] = useState(ABS[0].id); const r = { sick: (profile.sickTotal || 5) - (profile.sickUsed || 0), vacation: (profile.vacationTotal || 20) - (profile.vacationUsed || 0), whatever: (profile.whateverTotal || 3) - (profile.whateverUsed || 0) }; return <div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>{[{ l: "Dovol.", v: r.vacation, c: "var(--sd)" }, { l: "Sick", v: r.sick, c: "var(--red)" }, { l: "What.", v: r.whatever, c: "var(--amb)" }].map(b => <div key={b.l} style={{ textAlign: "center", padding: 12, border: "1px solid var(--brd)", background: "var(--bg3)" }}><div style={{ fontSize: 28, fontWeight: 600, color: b.c, fontFamily: "'IBM Plex Mono',monospace" }}>{b.v}</div><div style={{ fontSize: 11, color: "var(--tx3)", textTransform: "uppercase" }}>{b.l}</div></div>)}</div><Sel label="Den" value={dayIdx} onChange={e => setDayIdx(+e.target.value)} options={DAYS.map((d, i) => ({ value: i, label: `${DAYS_F[i]} ${fmtDate(wd[i])}` }))} /><Sel label="Typ" value={t} onChange={e => setT(e.target.value)} options={ABS.map(a => ({ value: a.id, label: `${a.icon} ${a.label}` }))} /><Btn warm onClick={() => onSubmit(DAYS[dayIdx], t)} style={{ width: "100%", marginTop: 8 }}>Zadat</Btn></div>; }
function EditDF({ emp, onDone }) { const [vac, setVac] = useState(emp?.vacationTotal || 20); const [sick, setSick] = useState(emp?.sickTotal || 5); const [what, setWhat] = useState(emp?.whateverTotal || 3); const [l, setL] = useState(false); if (!emp) return null; return <div><Input label="Dovolená" type="number" value={vac} onChange={e => setVac(+e.target.value)} /><Input label="Sick Days" type="number" value={sick} onChange={e => setSick(+e.target.value)} /><Input label="Whatever Days" type="number" value={what} onChange={e => setWhat(+e.target.value)} /><Btn warm disabled={l} onClick={async () => { setL(true); await updateDoc(doc(db, "users", emp.id), { vacationTotal: vac, sickTotal: sick, whateverTotal: what }); setL(false); onDone(); }} style={{ width: "100%", marginTop: 8 }}>Uložit</Btn></div>; }
function AddF({ onDone }) { const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [pass, setPass] = useState(""); const [team, setTeam] = useState("L1"); const [l, setL] = useState(false); const [err, setErr] = useState(""); return <div><Input label="Jméno" value={name} onChange={e => setName(e.target.value)} /><Input label="Email" value={email} onChange={e => setEmail(e.target.value)} /><Input label="Heslo (min. 6)" type="password" value={pass} onChange={e => setPass(e.target.value)} /><Sel label="Tým" value={team} onChange={e => setTeam(e.target.value)} options={[{ value: "L1", label: "L1 Support" }, { value: "SD", label: "Service Desk" }]} />{err && <p style={{ color: "var(--red)", fontSize: 14, marginBottom: 8, padding: 10, border: "1px solid var(--red)" }}>{err}</p>}<Btn warm disabled={l} onClick={async () => { setErr(""); if (!name.trim() || !email || !pass) return setErr("Vyplňte vše"); if (pass.length < 6) return setErr("Min. 6 znaků"); setL(true); try { const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${import.meta.env.VITE_FIREBASE_API_KEY}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pass, displayName: name.trim(), returnSecureToken: false }) }); const d = await r.json(); if (d.error) { setErr(d.error.message); setL(false); return; } await setDoc(doc(db, "users", d.localId), { name: name.trim(), email, team, role: "employee", notify: false, notifyEmail: "", fcmToken: null, defaultSchedule: null, setupDone: false, vacationTotal: 20, sickTotal: 5, whateverTotal: 3, vacationUsed: 0, sickUsed: 0, whateverUsed: 0, createdAt: new Date().toISOString() }); onDone(`Přidán: ${name.trim()}`); } catch (e) { setErr(e.message); } setL(false); }} style={{ width: "100%" }}>Přidat</Btn></div>; }
function NoteInput({ onSubmit }) { const [n, setN] = useState(""); return <div><Input value={n} onChange={e => setN(e.target.value)} placeholder="Přijdu o 20 min později" /><Btn warm onClick={() => onSubmit(n)} style={{ width: "100%", marginTop: 4 }}>Uložit poznámku</Btn></div>; }

/* ═══ MAIN APP ═══ */
export default function App() {
  const [authUser, setAuthUser] = useState(undefined); const [profile, setProfile] = useState(null);
  const [view, setView] = useState("schedule"); const [schedView, setSchedView] = useState("day");
  const [tf, setTf] = useState("all"); const [employees, setEmployees] = useState([]);
  const [wo, setWo] = useState(0); const [schedule, setSchedule] = useState(null);
  const [absences, setAbsences] = useState({}); const [events, setEvents] = useState({});
  const [swaps, setSwaps] = useState([]); const [selCell, setSelCell] = useState(null);
  const [modal, setModal] = useState(null); const [notifs, setNotifs] = useState([]);
  const [logs, setLogs] = useState([]); const [notes, setNotes] = useState({});
  const [rules, setRules] = useState({ L1_max: 2, SD_max8: 2, SD_maxHO: 2, SD_noHO8: true, SD_noHO10: true });
  const [theme, setTheme] = useState(() => localStorage.getItem("sf_theme") || "light");
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 900);
  const [selDay, setSelDay] = useState(todayIdx);
  const [slideDir, setSlideDir] = useState('right');
  const viewKey = useRef(0);

  const goDay = i => { setSlideDir(i > selDay ? 'right' : 'left'); setSelDay(i); };
  const switchV = v => { viewKey.current++; setView(v); };

  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); localStorage.setItem("sf_theme", theme); }, [theme]);
  useEffect(() => { const fn = () => setIsMobile(window.innerWidth < 900); window.addEventListener('resize', fn); return () => window.removeEventListener('resize', fn); }, []);

  const cw = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + wo * 7); return d; }, [wo]);
  const wk = wKey(cw); const isA = profile?.role === "admin";
  const ge = id => employees.find(e => e.id === id);
  const ds = useMemo(() => buildDef(employees), [employees]);
  const cs = schedule || ds;
  const wd = useMemo(() => getWeekDates(wo), [wo]);
  const wh = wd.map(d => HMAP[d] || null);

  useEffect(() => { const u = onAuthStateChanged(auth, async u => { if (u) { setAuthUser(u); const s = await getDoc(doc(db, "users", u.uid)); if (s.exists()) setProfile({ id: u.uid, ...s.data() }); else setProfile({ id: u.uid, name: u.displayName || u.email, role: "employee", team: "L1", setupDone: false }); initPush(u.uid); } else { setAuthUser(null); setProfile(null); } }); return u; }, []);
  useEffect(() => { const u = onSnapshot(collection(db, "users"), s => { const e = s.docs.map(d => ({ id: d.id, ...d.data() })); setEmployees(e); if (profile) { const m = e.find(x => x.id === profile.id); if (m) setProfile(p => ({ ...p, ...m })); } }); return u; }, [profile?.id]);
  useEffect(() => { const u = onSnapshot(doc(db, "schedules", wk), s => { if (s.exists()) { const d = s.data(); setSchedule(d.entries || null); setAbsences(d.absences || {}); setEvents(d.events || {}); setNotes(d.notes || {}); } else { setSchedule(null); setAbsences({}); setEvents({}); setNotes({}); } }); return u; }, [wk]);
  useEffect(() => { const u = onSnapshot(collection(db, "swapRequests"), s => setSwaps(s.docs.map(d => ({ id: d.id, ...d.data() })))); return u; }, []);
  useEffect(() => { const u = onSnapshot(doc(db, "rules", "global"), s => { if (s.exists()) setRules(s.data()); }); return u; }, []);
  useEffect(() => { const u = onSnapshot(collection(db, "auditLog"), s => { const a = s.docs.map(d => ({ id: d.id, ...d.data() })); a.sort((a, b) => (b.time || "").localeCompare(a.time || "")); setLogs(a.slice(0, 100)); }); return u; }, []);

  const notify = msg => { const n = { id: uid(), msg, time: new Date().toLocaleTimeString("cs") }; setNotifs(p => [n, ...p]); setTimeout(() => setNotifs(p => p.filter(x => x.id !== n.id)), 5000); };
  const log = async msg => { try { await addDoc(collection(db, "auditLog"), { msg, time: new Date().toISOString(), week: wk, userId: profile?.id }); } catch { } };
  const saveS = async en => { await setDoc(doc(db, "schedules", wk), { entries: en, weekStart: wk, modifiedAt: new Date().toISOString(), modifiedBy: profile?.id }, { merge: true }); };
  const eN = (emp, msg) => { if (emp?.notify) callGAS("sendEmail", { to: emp.notifyEmail || emp.email, employeeName: emp.name, changeDescription: msg, weekLabel: fmtW(cw) }); };

  // D&D: admin can move anyone, employee can move self within own team
  const canDrag = eid => isA || eid === profile?.id;
  const handleDrop = (targetDay, targetShift, e) => {
    e.preventDefault(); e.currentTarget.classList.remove("over");
    try {
      const d = JSON.parse(e.dataTransfer.getData("text/plain"));
      if (d.day === targetDay && d.shift === targetShift) return;
      if (!isA && d.empId !== profile?.id) return;
      if (!isA) { const emp = ge(d.empId); if (emp?.team !== profile?.team) return; }
      const s = dc(cs); const f = s[d.day]?.[d.shift]; if (!f) return;
      const i = f.findIndex(x => x.empId === d.empId); if (i === -1) return;
      const [en] = f.splice(i, 1); en.isDefault = false;
      if (!s[targetDay]) s[targetDay] = {}; if (!s[targetDay][targetShift]) s[targetDay][targetShift] = [];
      s[targetDay][targetShift].push(en);
      setSchedule(s); saveS(s); notify(`Přesun: ${ge(d.empId)?.name}`);
    } catch { }
  };

  const moveE = async (eid, fd, fs, td, ts) => { const s = dc(cs); const f = s[fd]?.[fs]; if (!f) return; const i = f.findIndex(e => e.empId === eid); if (i === -1) return; const [en] = f.splice(i, 1); en.isDefault = false; if (!s[td]) s[td] = {}; if (!s[td][ts]) s[td][ts] = []; s[td][ts].push(en); setSchedule(s); await saveS(s); notify(`Přesun: ${ge(eid)?.name}`); };
  const togHO = async (day, sh, eid) => { const s = dc(cs); const en = s[day]?.[sh]?.find(e => e.empId === eid); if (en) { en.ho = !en.ho; en.isDefault = false; } setSchedule(s); await saveS(s); notify(`HO ${en?.ho ? "ON" : "OFF"}`); };

  // ABSENCE: single Firestore write, optimistic
  const addAbs = async (eid, day, type) => {
    if (!isA && eid !== profile.id) return;
    const s = dc(cs);
    SHIFTS.forEach(sh => { if (s[day]?.[sh]) s[day][sh] = s[day][sh].filter(e => e.empId !== eid); });
    const absKey = fsKey(eid, day);
    const newAbs = { ...absences, [absKey]: type };
    setSchedule(s); setAbsences(newAbs);
    try {
      // SINGLE write with both entries and absence
      const writeData = { entries: s, weekStart: wk, modifiedAt: new Date().toISOString(), modifiedBy: profile?.id, absences: newAbs };
      await setDoc(doc(db, "schedules", wk), writeData, { merge: true });
      const emp = ge(eid);
      if (emp && !["doctor", "training", "half_ho"].includes(type)) {
        const f = type === "sick" ? "sickUsed" : type === "vacation" || type === "half_vacation" ? "vacationUsed" : type === "whatever" ? "whateverUsed" : null;
        if (f) await updateDoc(doc(db, "users", eid), { [f]: (emp[f] || 0) + (type.startsWith("half_") ? 0.5 : 1) });
      }
      const al = ABS.find(a => a.id === type)?.label;
      notify(`${emp?.name}: ${al}`); log(`${emp?.name}: ${al} ${day}`);
    } catch (err) { console.error("addAbs:", err); notify("Chyba: " + err.message); }
  };

  const removeAbs = async (eid, day) => {
    const k = fsKey(eid, day);
    const newAbs = { ...absences }; delete newAbs[k];
    setAbsences(newAbs);
    try { await setDoc(doc(db, "schedules", wk), { absences: newAbs }, { merge: true }); notify("Nepřítomnost odebrána"); } catch { notify("Chyba"); }
  };

  const saveNote = async (eid, day, shift, note) => {
    const key = fsKey(eid, day, shift.replace(":", ""));
    const newNotes = { ...notes, [key]: note };
    setNotes(newNotes);
    try {
      await setDoc(doc(db, "schedules", wk), { notes: newNotes }, { merge: true });
      notify("Poznámka uložena");
    } catch (err) { console.error("saveNote:", err); notify("Chyba poznámky"); }
  };

  const addEv = async (day, et, note) => { await setDoc(doc(db, "schedules", wk), { [`events.${day}`]: { type: et, note, title: EVTS.find(e => e.id === et)?.label } }, { merge: true }); notify("Událost přidána"); };
  const mkSwap = async (rid, day, sh) => { await addDoc(collection(db, "swapRequests"), { rid, day, sh, week: wk, status: "open", created: new Date().toISOString() }); notify("Žádost odeslána"); };
  const doSwap = async (swId, aid) => {
    const sw = swaps.find(s => s.id === swId); if (!sw) return;
    const s = dc(cs); let aSh = null;
    SHIFTS.forEach(sh => { if (!aSh && s[sw.day]?.[sh]?.some(e => e.empId === aid)) aSh = sh; });
    if (aSh && s[sw.day]?.[sw.sh]) {
      const re = s[sw.day][sw.sh].find(e => e.empId === sw.rid);
      const ae = s[sw.day][aSh].find(e => e.empId === aid);
      if (re && ae) { s[sw.day][sw.sh] = s[sw.day][sw.sh].filter(e => e.empId !== sw.rid); s[sw.day][aSh] = s[sw.day][aSh].filter(e => e.empId !== aid); s[sw.day][sw.sh].push({ ...ae, empId: aid, isDefault: false }); s[sw.day][aSh].push({ ...re, empId: sw.rid, isDefault: false }); }
    } else if (s[sw.day]?.[sw.sh]) { s[sw.day][sw.sh] = s[sw.day][sw.sh].filter(e => e.empId !== sw.rid); s[sw.day][sw.sh].push({ empId: aid, ho: false, isDefault: false }); }
    setSchedule(s);
    try { await updateDoc(doc(db, 'swapRequests', swId), { status: 'done', aid, resolvedAt: new Date().toISOString() }); await saveS(s); notify('Výměna OK'); } catch { notify('Chyba'); }
  };
  const delUser = async eid => { if (!confirm(`Smazat ${ge(eid)?.name}?`)) return; await deleteDoc(doc(db, "users", eid)); notify("Smazán"); };
  const exportCSV = () => { let csv = "\ufeffDen,Směna,Jméno,Tým,HO\n"; DAYS.forEach(d => SHIFTS.forEach(sh => (cs[d]?.[sh] || []).forEach(en => { const e = ge(en.empId); if (e) csv += `${d},${sh},${e.name},${e.team},${en.ho ? "Ano" : "Ne"}\n`; }))); const b = new Blob([csv], { type: "text/csv;charset=utf-8;" }); const u = URL.createObjectURL(b); Object.assign(document.createElement("a"), { href: u, download: `rozvrh_${wk}.csv` }).click(); };

  if (authUser === undefined) return <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}><style>{CSS}</style><div style={{ color: "var(--tx3)", fontSize: 14, letterSpacing: 4, fontFamily: "'Barlow Condensed',sans-serif", animation: "pulse 1.5s infinite" }}>SHIFTFLOW</div></div>;
  if (!authUser) return <AuthScreen />;
  if (!profile) return <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--tx3)" }}><style>{CSS}</style>Načítání…</div>;
  if (!isA && !profile.setupDone) return <Setup profile={profile} onDone={() => setProfile(p => ({ ...p, setupDone: true }))} />;

  const openSw = swaps.filter(s => s.status === "open" && s.week === wk);
  const NAV = [{ id: "schedule", l: "Rozvrh", ic: "▦", b: 0 }, { id: "swaps", l: "Výměny", ic: "⇄", b: openSw.length }, ...(isA ? [{ id: "people", l: "Tým", ic: "◉", b: 0 }] : []), { id: "stats", l: "Stats", ic: "◫", b: 0 }, { id: "log", l: "Log", ic: "≡", b: 0 }, ...(isA ? [{ id: "defaults", l: "Default", ic: "⊞", b: 0 }, { id: "settings", l: "Config", ic: "⚙", b: 0 }] : [])];
  const dayHol = wh[selDay];
  const getEntries = (day, shift) => (cs[day]?.[shift] || []).filter(e => { const emp = ge(e.empId); return emp && (tf === "all" || emp.team === tf); });
  const getDayAbs = day => Object.entries(absences).filter(([k]) => k.endsWith(`__${day}`)).map(([k, t]) => ({ empId: k.split("__")[0], type: t })).filter(a => ge(a.empId));

  // Shift card renderer (reused in day + week views)
  const ShiftCard = ({ day, shift }) => {
    const entries = getEntries(day, shift);
    return <div className="gl dz" style={{ padding: 0 }}
      onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("over"); }}
      onDragLeave={e => e.currentTarget.classList.remove("over")}
      onDrop={e => handleDrop(day, shift, e)}>
      {entries.map((en, idx) => { const emp = ge(en.empId); if (!emp) return null; const tc = emp.team === "L1" ? "var(--l1)" : "var(--sd)"; const nk = fsKey(en.empId, day, shift.replace(":", "")); const note = notes[nk];
        return <div key={en.empId} className="ent" draggable={canDrag(en.empId)}
          onDragStart={e => e.dataTransfer.setData("text/plain", JSON.stringify({ empId: en.empId, day, shift }))}
          onClick={() => isA ? setSelCell({ day, shift, empId: en.empId }) : en.empId === profile.id && setModal({ type: "myshift", day, shift })}
          style={{ gap: 10, padding: "12px 14px", borderBottom: idx < entries.length - 1 ? "1px solid var(--brd)" : "none" }}>
          <div style={{ width: 3, height: 24, background: tc }} />
          <span style={{ fontWeight: 500, color: "var(--w)", flex: 1 }}>{emp.name}</span>
          {note && <span title={note} style={{ color: "var(--acc2)", cursor: "help", fontSize: 15, fontWeight: 700, border: "1px solid var(--acc2)", width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>i</span>}
          <Badge small color={tc}>{emp.team}</Badge>
          {en.ho && <Badge small color="var(--grn)">HO</Badge>}
        </div>; })}
      {entries.length === 0 && <div style={{ padding: "14px", color: "var(--tx3)", fontSize: 14 }}>—</div>}
    </div>;
  };

  return <div style={{ minHeight: "100vh", background: "var(--bg)", fontFamily: "'Barlow',sans-serif", color: "var(--tx)", display: "flex" }} data-theme={theme}>
    <style>{CSS}</style>
    <ParallaxBg />

    {/* TOASTS */}
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999, padding: "8px 12px" }}>{notifs.map(n => <div key={n.id} className="gl" style={{ padding: "14px 16px", fontSize: 15, color: "var(--acc2)", display: "flex", gap: 10, alignItems: "center", marginBottom: 6, animation: "st .3s" }}><span style={{ flex: 1 }}>{n.msg}</span></div>)}</div>

    {/* SIDEBAR (desktop) */}
    {!isMobile && <SideNav view={view} setView={switchV} NAV={NAV} theme={theme} setTheme={setTheme} />}

    {/* MAIN */}
    <div style={{ flex: 1, marginLeft: isMobile ? 0 : 200, paddingBottom: isMobile ? 80 : 20, position: "relative", zIndex: 1 }}>
      <header className="pg" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--bt)" }}>
        <div style={{ fontSize: 14, color: "var(--tx2)", fontFamily: "'Barlow Condensed',sans-serif" }}>{profile.name} · <Badge small color={isA ? "var(--amb)" : "var(--acc)"}>{isA ? "ADM" : "CREW"}</Badge></div>
        <div style={{ display: "flex", gap: 6 }}>
          {isMobile && <button onClick={() => setTheme(t => t === "light" ? "dark" : "light")} style={{ background: "none", border: "1px solid var(--brd2)", width: 38, height: 38, cursor: "pointer", color: "var(--tx2)", fontSize: 14 }}>{theme === "light" ? "●" : "○"}</button>}
          <button onClick={() => signOut(auth)} style={{ background: "none", border: "1px solid var(--brd2)", color: "var(--tx3)", width: 38, height: 38, cursor: "pointer", fontSize: 13 }}>↪</button>
        </div>
      </header>

      <main style={{ padding: 16, maxWidth: 1000, margin: "0 auto" }}>
        <div key={viewKey.current} className="avi">

          {/* ═══ SCHEDULE ═══ */}
          {view === "schedule" && <div>
            {/* Week nav */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 16 }}>
              <button onClick={() => setWo(w => w - 1)} style={{ width: 44, height: 44, border: "1px solid var(--brd2)", background: "transparent", color: "var(--tx)", cursor: "pointer", fontSize: 18 }}>‹</button>
              <div style={{ textAlign: "center" }}><div style={{ fontSize: 18, fontWeight: 500, color: "var(--w)", fontFamily: "'IBM Plex Mono',monospace" }}>{fmtW(cw)}</div><div style={{ fontSize: 12, color: wo === 0 ? "var(--acc2)" : "var(--tx3)", textTransform: "uppercase", letterSpacing: 1 }}>{wo === 0 ? "Aktuální týden" : `${wo > 0 ? "+" : ""}${wo}`}</div></div>
              <button onClick={() => setWo(w => w + 1)} style={{ width: 44, height: 44, border: "1px solid var(--brd2)", background: "transparent", color: "var(--tx)", cursor: "pointer", fontSize: 18 }}>›</button>
              {wo !== 0 && <Btn small ghost onClick={() => setWo(0)}>Dnes</Btn>}
            </div>

            {/* View toggle: Den / Týden */}
            <div style={{ display: "flex", gap: 2, marginBottom: 14, border: "1px solid var(--brd)", width: "fit-content" }}>
              {[{ k: "day", l: "Den" }, { k: "week", l: "Týden" }].map(v => <button key={v.k} onClick={() => setSchedView(v.k)} style={{ padding: "8px 18px", border: "none", background: schedView === v.k ? "var(--sel)" : "transparent", color: schedView === v.k ? "var(--stx)" : "var(--tx3)", cursor: "pointer", fontSize: 13, fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 1, minHeight: 38 }}>{v.l}</button>)}
            </div>

            {/* Filters + actions */}
            <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
              {[{ k: "all", l: "Vše" }, { k: "L1", l: "L1" }, { k: "SD", l: "SD" }].map(f => <Btn key={f.k} small warm={tf === f.k} onClick={() => setTf(f.k)}>{f.l}</Btn>)}
              <div style={{ flex: 1 }} />
              {isA && <Btn small onClick={() => setModal("absence")}>+ Nepřít.</Btn>}
              {!isA && <Btn small warm onClick={() => setModal("myabsence")}>+ Nepřítomnost</Btn>}
              <Btn small ghost onClick={exportCSV}>CSV</Btn>
            </div>

            {/* ── DAY VIEW ── */}
            {schedView === "day" && <>
              {/* Day pills */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 3, marginBottom: 16 }}>
                {DAYS.map((d, i) => { const it = isTd(i, wo); const hol = !!wh[i]; return <button key={d} className={it && selDay === i ? 'atp' : ''} onClick={() => goDay(i)} style={{ padding: "8px 4px", border: `1px solid ${selDay === i ? "var(--abrd)" : "var(--brd)"}`, background: selDay === i ? "var(--adim)" : "transparent", color: selDay === i ? "var(--acc2)" : "var(--tx3)", cursor: "pointer", fontFamily: "'Barlow Condensed',sans-serif", fontSize: 14, fontWeight: 600, textTransform: "uppercase", textAlign: "center", minHeight: 52, opacity: hol ? .6 : 1 }}>
                  <div>{d}</div>
                  <div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", marginTop: 2 }}>{fmtDate(wd[i])}</div>
                  {it && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--acc2)", display: "block", margin: "2px auto 0" }} />}
                  {hol && <div style={{ fontSize: 7, color: "var(--acc2)" }}>svátek</div>}
                </button>; })}
              </div>

              {/* Banners */}
              {isTd(selDay, wo) && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", border: "1px solid var(--abrd)", background: "var(--adim)", marginBottom: 12 }}><div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--acc2)" }} /><span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 12, color: "var(--acc2)", textTransform: "uppercase", letterSpacing: 1.5 }}>Dnes</span></div>}
              {dayHol && <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", border: "1px solid var(--abrd)", background: "var(--adim)", marginBottom: 12 }}><span>🎉</span><span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, color: "var(--acc2)", textTransform: "uppercase", letterSpacing: 1, fontSize: 14 }}>{dayHol} — volno</span></div>}

              {/* Shifts */}
              <div key={`${selDay}-${wo}`} className={slideDir === 'right' ? 'asr' : 'asl'}>
                {!dayHol && SHIFTS.map(shift => <div key={shift} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <span style={{ fontFamily: "'IBM Plex Mono',monospace", color: "var(--acc2)", fontSize: 16, fontWeight: 500 }}>{shift}</span>
                    <div style={{ flex: 1, height: 1, background: "var(--brd)" }} />
                    <span style={{ fontSize: 12, color: "var(--tx3)" }}>{getEntries(DAYS[selDay], shift).length} os.</span>
                  </div>
                  <ShiftCard day={DAYS[selDay]} shift={shift} />
                </div>)}
                {/* Day absences */}
                {(() => { const da = getDayAbs(DAYS[selDay]); if (!da.length) return null; return <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12, color: "var(--tx3)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8, fontFamily: "'Barlow Condensed',sans-serif" }}>Nepřítomnost</div>
                  {da.map(a => { const e = ge(a.empId); const at = ABS.find(t => t.id === a.type); return e && <div key={a.empId} className="gl" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", marginBottom: 6, minHeight: 48 }}><span>{at?.icon}</span><span style={{ fontWeight: 500, color: "var(--w)", flex: 1 }}>{e.name}</span><Badge small color={at?.color}>{at?.label}</Badge>{(isA || a.empId === profile.id) && <button onClick={() => removeAbs(a.empId, DAYS[selDay])} style={{ background: "none", border: "1px solid var(--red)", color: "var(--red)", width: 28, height: 28, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>✕</button>}</div>; })}
                </div>; })()}
              </div>
            </>}

            {/* ── WEEK VIEW (table) ── */}
            {schedView === "week" && <div className="gl" style={{ overflow: "hidden", padding: 0 }}>
              <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                <table style={{ width: "100%", minWidth: 700, borderCollapse: "collapse" }}>
                  <thead><tr>
                    <th style={{ position: "sticky", left: 0, zIndex: 10, background: "var(--panel)", backdropFilter: "var(--blur)", padding: "10px 8px", borderBottom: "2px solid var(--bt)", borderRight: "2px solid var(--bt)", width: 64, fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: "var(--tx3)" }}>⏱</th>
                    {DAYS.map((d, i) => { const hol = wh[i]; const td = isTd(i, wo); return <th key={d} style={{ padding: "8px 6px", borderBottom: td ? "3px solid var(--acc2)" : "2px solid var(--bt)", borderLeft: "2px solid var(--bt)", background: td ? "var(--adim)" : hol ? "rgba(48,128,96,.06)" : "var(--bg3)", textAlign: "center", minWidth: 115, opacity: hol ? .6 : 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: td ? "var(--acc2)" : "var(--w)", fontFamily: "'Barlow Condensed',sans-serif" }}>{DAYS_F[i]}</div>
                      <div style={{ fontSize: 11, color: "var(--tx3)", fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDate(wd[i])}</div>
                      {hol && <Badge small color="var(--grn)">{hol}</Badge>}
                    </th>; })}
                  </tr></thead>
                  <tbody>{SHIFTS.map(shift => <tr key={shift}>
                    <td style={{ position: "sticky", left: 0, zIndex: 10, background: "var(--panel)", padding: "8px 6px", borderBottom: "2px solid var(--bt)", borderRight: "2px solid var(--bt)", textAlign: "center", fontFamily: "'IBM Plex Mono',monospace", fontSize: 17, fontWeight: 500, color: "var(--acc2)" }}>{shift}</td>
                    {DAYS.map((day, di) => { const entries = getEntries(day, shift); const td = isTd(di, wo); const hol = !!wh[di];
                      return <td key={`${day}-${shift}`} className="dz" style={{ padding: 4, borderBottom: "2px solid var(--bt)", borderLeft: "2px solid var(--bt)", verticalAlign: "top", background: td ? "var(--adim)" : hol ? "rgba(48,128,96,.04)" : "var(--bg3)", opacity: hol ? .5 : 1 }}
                        onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("over"); }}
                        onDragLeave={e => e.currentTarget.classList.remove("over")}
                        onDrop={e => handleDrop(day, shift, e)}>
                        {entries.map(en => { const emp = ge(en.empId); if (!emp) return null; const tc = emp.team === "L1" ? "var(--l1)" : "var(--sd)";
                          return <div key={en.empId} className="ent" draggable={canDrag(en.empId)} onDragStart={e => e.dataTransfer.setData("text/plain", JSON.stringify({ empId: en.empId, day, shift }))} onClick={() => isA ? setSelCell({ day, shift, empId: en.empId }) : en.empId === profile.id && setModal({ type: "myshift", day, shift })} style={{ gap: 6, padding: "6px 10px", marginBottom: 2, background: "var(--bg3)", border: "1px solid var(--brd)", fontSize: 14 }}>
                            <span style={{ width: 8, height: 3, background: tc }} /><span style={{ fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--w)" }}>{emp.name?.split(" ").pop()}</span>{en.ho && <Badge small color="var(--grn)">HO</Badge>}
                          </div>; })}
                      </td>; })}
                  </tr>)}
                  <tr><td style={{ position: "sticky", left: 0, zIndex: 10, background: "var(--panel)", padding: 8, borderRight: "2px solid var(--bt)", fontSize: 12, color: "var(--tx3)", textAlign: "center" }}>N/A</td>
                    {DAYS.map((day, di) => { const da = getDayAbs(day); const td = isTd(di, wo);
                      return <td key={`a-${day}`} style={{ padding: 4, borderLeft: "2px solid var(--bt)", borderTop: "2px solid var(--bt)", background: td ? "var(--adim)" : "transparent" }}>{da.map(a => { const e = ge(a.empId); const at = ABS.find(t => t.id === a.type); return e && <div key={a.empId} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 8px", marginBottom: 2, border: `1px solid ${at?.color}`, fontSize: 13, minHeight: 36, background: "var(--bg3)" }}><span>{at?.icon}</span><span style={{ fontWeight: 500 }}>{e.name?.split(" ").pop()}</span></div>; })}</td>; })}</tr>
                  </tbody>
                </table>
              </div>
            </div>}
          </div>}

          {/* ═══ OTHER VIEWS ═══ */}
          {view === "swaps" && <div>
            <div style={{ fontSize: 20, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2, marginBottom: 20, borderBottom: "1px solid var(--brd)", paddingBottom: 12 }}>Výměny</div>
            {!isA && <Card style={{ marginBottom: 20 }}><Btn warm onClick={() => setModal({ type: "swap", day: DAYS[selDay], shift: SHIFTS[0] })}>+ Nová žádost</Btn></Card>}
            {openSw.map(sw => { const re = ge(sw.rid); const me = profile.id === sw.rid; const can = !isA && !me; return <Card key={sw.id} style={{ padding: 16, marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}><div><div style={{ fontWeight: 600, fontSize: 17, color: "var(--w)" }}>{re?.name}</div><Badge small color="var(--acc2)">{sw.day} {sw.sh}</Badge></div>{can && <Btn warm small onClick={() => doSwap(sw.id, profile.id)}>Přijmout</Btn>}{me && <Badge color="var(--amb)">Tvoje</Badge>}</Card>; })}
            {!openSw.length && <p style={{ color: "var(--tx3)" }}>Žádné žádosti.</p>}
          </div>}

          {view === "people" && isA && <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20, borderBottom: "1px solid var(--brd)", paddingBottom: 12 }}><div style={{ fontSize: 20, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2 }}>Tým</div><Btn warm onClick={() => setModal("addMember")}>+ Přidat</Btn></div>
            {["L1", "SD"].map(team => <div key={team} style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: team === "L1" ? "var(--l1)" : "var(--sd)", marginBottom: 12, fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase" }}>{TEAMS[team]}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>{employees.filter(e => e.team === team && e.role !== "admin").map(emp => <Card key={emp.id}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div style={{ fontWeight: 600, fontSize: 17, color: "var(--w)" }}>{emp.name}</div>
                  <div style={{ display: "flex", gap: 4 }}><button onClick={() => setModal({ type: "editDays", emp })} style={{ background: "none", border: "1px solid var(--brd2)", color: "var(--tx3)", cursor: "pointer", width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center" }}>✏</button><button onClick={() => delUser(emp.id)} style={{ background: "none", border: "1px solid rgba(192,48,48,.3)", color: "var(--red)", cursor: "pointer", width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button></div>
                </div>
                <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>{[{ l: "Dovol.", v: (emp.vacationTotal || 20) - (emp.vacationUsed || 0), c: "var(--sd)" }, { l: "Sick", v: (emp.sickTotal || 5) - (emp.sickUsed || 0), c: "var(--red)" }, { l: "What.", v: (emp.whateverTotal || 3) - (emp.whateverUsed || 0), c: "var(--amb)" }].map(b => <div key={b.l} style={{ textAlign: "center", padding: 8, border: "1px solid var(--brd)" }}><div style={{ fontSize: 20, fontWeight: 600, color: b.c, fontFamily: "'IBM Plex Mono',monospace" }}>{b.v}</div><div style={{ fontSize: 10, color: "var(--tx3)", textTransform: "uppercase" }}>{b.l}</div></div>)}</div>
              </Card>)}</div>
            </div>)}
          </div>}

          {view === "stats" && <div>
            <div style={{ fontSize: 20, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2, marginBottom: 20, borderBottom: "1px solid var(--brd)", paddingBottom: 12 }}>Status</div>
            {!isA && <Card style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}><div style={{ fontSize: 16, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase" }}>Moje dny</div><button onClick={() => setModal({ type: "editDays", emp: profile })} style={{ background: "none", border: "1px solid var(--brd2)", color: "var(--tx3)", cursor: "pointer", width: 34, height: 34 }}>✏</button></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>{[{ l: "Dovolená", v: (profile.vacationTotal || 20) - (profile.vacationUsed || 0), t: profile.vacationTotal || 20, c: "var(--sd)" }, { l: "Sick", v: (profile.sickTotal || 5) - (profile.sickUsed || 0), t: profile.sickTotal || 5, c: "var(--red)" }, { l: "Whatever", v: (profile.whateverTotal || 3) - (profile.whateverUsed || 0), t: profile.whateverTotal || 3, c: "var(--amb)" }].map(b => <div key={b.l} style={{ textAlign: "center", padding: 12, border: "1px solid var(--brd)", background: "var(--bg3)" }}><div style={{ fontSize: 28, fontWeight: 600, color: b.c, fontFamily: "'IBM Plex Mono',monospace" }}>{b.v}</div><div style={{ fontSize: 11, color: "var(--tx3)", textTransform: "uppercase" }}>{b.l} (z {b.t})</div></div>)}</div>
            </Card>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 12 }}>{[{ l: "Crew", v: employees.filter(e => e.role !== "admin").length, c: "var(--l1)" }, { l: "Active", v: employees.filter(e => e.setupDone).length, c: "var(--sd)" }, { l: "Swaps", v: openSw.length, c: "var(--amb)" }].map(s => <Card key={s.l}><div style={{ fontSize: 32, fontWeight: 600, color: s.c, fontFamily: "'IBM Plex Mono',monospace" }}>{s.v}</div><div style={{ fontSize: 12, color: "var(--tx3)", textTransform: "uppercase", marginTop: 4 }}>{s.l}</div></Card>)}</div>
          </div>}

          {view === "log" && <div><div style={{ fontSize: 20, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2, marginBottom: 20, borderBottom: "1px solid var(--brd)", paddingBottom: 12 }}>Log</div>{logs.map(h => <div key={h.id} style={{ display: "flex", gap: 10, padding: "10px 12px", borderBottom: "1px solid var(--brd)", fontSize: 14 }}><span style={{ fontSize: 12, color: "var(--tx3)", fontFamily: "'IBM Plex Mono',monospace", minWidth: 130 }}>{h.time ? new Date(h.time).toLocaleString("cs") : ""}</span><span style={{ flex: 1 }}>{h.msg}</span></div>)}</div>}
          {view === "defaults" && isA && <div><div style={{ fontSize: 20, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2, marginBottom: 20, borderBottom: "1px solid var(--brd)", paddingBottom: 12 }}>Stálý rozvrh</div><DefEditor employees={employees} /></div>}
          {view === "settings" && isA && <div style={{ maxWidth: 560 }}>
            <div style={{ fontSize: 20, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2, marginBottom: 20, borderBottom: "1px solid var(--brd)", paddingBottom: 12 }}>Konfigurace</div>
            <Card style={{ marginBottom: 16 }}><Input label="L1 Max/směna" type="number" value={rules.L1_max} onChange={e => setRules(r => ({ ...r, L1_max: +e.target.value }))} /><Input label="SD Max 8:00" type="number" value={rules.SD_max8} onChange={e => setRules(r => ({ ...r, SD_max8: +e.target.value }))} /><Input label="SD Max HO/den" type="number" value={rules.SD_maxHO} onChange={e => setRules(r => ({ ...r, SD_maxHO: +e.target.value }))} /><Toggle checked={rules.SD_noHO8} onChange={v => setRules(r => ({ ...r, SD_noHO8: v }))} label="Zákaz HO 08:00" /><Toggle checked={rules.SD_noHO10} onChange={v => setRules(r => ({ ...r, SD_noHO10: v }))} label="Zákaz HO 10:00" /><Btn warm onClick={async () => { await setDoc(doc(db, "rules", "global"), rules); notify("Uloženo"); }}>Uložit</Btn></Card>
            <Card><div style={{ display: "flex", gap: 8 }}><Btn danger onClick={async () => { await deleteDoc(doc(db, "schedules", wk)); notify("Reset"); }}>Reset</Btn><Btn ghost onClick={exportCSV}>CSV</Btn></div></Card>
          </div>}
        </div>
      </main>
    </div>

    {isMobile && <PillNav view={view} setView={switchV} NAV={NAV} />}

    {/* MODALS */}
    <Modal open={!!selCell} onClose={() => setSelCell(null)} title="Akce">{selCell && (() => { const emp = ge(selCell.empId); if (!emp) return null; return <div>
      <div style={{ padding: 14, background: "var(--bg3)", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}><div style={{ width: 40, height: 40, background: emp.team === "L1" ? "var(--l1)" : "var(--sd)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 600, color: "#fff" }}>{emp.name.charAt(0)}</div><div><div style={{ fontWeight: 600, fontSize: 17, color: "var(--w)" }}>{emp.name}</div><div style={{ fontSize: 14, color: "var(--tx2)" }}>{selCell.day} · {selCell.shift}</div></div></div>
      <Btn onClick={() => { togHO(selCell.day, selCell.shift, selCell.empId); setSelCell(null); }} style={{ width: "100%", marginBottom: 8 }}>Toggle HO</Btn>
      <div style={{ fontSize: 12, color: "var(--tx3)", margin: "14px 0 6px", textTransform: "uppercase", letterSpacing: 1 }}>Přesunout</div>
      <div style={{ display: "flex", gap: 8 }}>{SHIFTS.filter(s => s !== selCell.shift).map(s => <Btn key={s} small style={{ flex: 1 }} onClick={() => { moveE(selCell.empId, selCell.day, selCell.shift, selCell.day, s); setSelCell(null); }}>→ {s}</Btn>)}</div>
      <div style={{ fontSize: 12, color: "var(--tx3)", margin: "14px 0 6px", textTransform: "uppercase", letterSpacing: 1 }}>Nepřítomnost</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>{ABS.map(a => <Btn key={a.id} small onClick={() => { addAbs(selCell.empId, selCell.day, a.id); setSelCell(null); }}>{a.icon} {a.label}</Btn>)}</div>
      <div style={{ fontSize: 12, color: "var(--tx3)", margin: "14px 0 6px", textTransform: "uppercase", letterSpacing: 1 }}>Poznámka</div>
      <NoteInput onSubmit={n => { saveNote(selCell.empId, selCell.day, selCell.shift, n); setSelCell(null); }} />
    </div>; })()}</Modal>

    <Modal open={modal === "absence"} onClose={() => setModal(null)} title="Nepřítomnost"><AbsF emps={employees.filter(e => e.role !== "admin")} wd={wd} onSubmit={(e, d, t) => { addAbs(e, d, t); setModal(null); }} /></Modal>
    <Modal open={modal === "event"} onClose={() => setModal(null)} title="Událost"><EvF onSubmit={(d, t, n) => { addEv(d, t, n); setModal(null); }} /></Modal>
    <Modal open={modal?.type === "swap"} onClose={() => setModal(null)} title="Výměna"><SwF dDay={modal?.day} dShift={modal?.shift} onSubmit={(d, s) => { mkSwap(profile.id, d, s); setModal(null); }} /></Modal>
    <Modal open={modal?.type === "myshift"} onClose={() => setModal(null)} title="Moje směna"><div>
      <p style={{ fontSize: 15, color: "var(--tx2)", marginBottom: 16 }}>{modal?.day} · {modal?.shift}</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>{ABS.map(a => <Btn key={a.id} onClick={() => { addAbs(profile.id, modal.day, a.id); setModal(null); }}>{a.icon} {a.label}</Btn>)}</div>
      <Btn warm onClick={() => setModal({ type: "swap", day: modal?.day, shift: modal?.shift })} style={{ width: "100%", marginBottom: 10 }}>Požádat o výměnu</Btn>
      <div style={{ fontSize: 12, color: "var(--tx3)", margin: "8px 0 6px", textTransform: "uppercase" }}>Poznámka</div>
      <NoteInput onSubmit={n => { saveNote(profile.id, modal.day, modal.shift, n); setModal(null); }} />
    </div></Modal>
    <Modal open={modal === "myabsence"} onClose={() => setModal(null)} title="Nepřítomnost"><MyAbsF profile={profile} wd={wd} onSubmit={(d, t) => { addAbs(profile.id, d, t); setModal(null); }} /></Modal>
    <Modal open={modal === "addMember"} onClose={() => setModal(null)} title="Nový člen"><AddF onDone={m => { notify(m); log(m); setModal(null); }} /></Modal>
    <Modal open={modal?.type === "editDays"} onClose={() => setModal(null)} title="Upravit dny"><EditDF emp={modal?.emp} onDone={() => { notify("Uloženo"); setModal(null); }} /></Modal>
  </div>;
}
