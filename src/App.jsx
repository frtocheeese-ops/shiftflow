import { useState, useEffect, useMemo, useRef } from "react";
import { auth, db, getMsg } from "./firebase";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, onSnapshot } from "firebase/firestore";
import { getToken, onMessage } from "firebase/messaging";

/* ═══════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════ */
const TEAMS = { L1: "L1 Support", SD: "Service Desk" };
const SHIFTS = ["08:00", "09:00", "10:00"];
const DAYS = ["Po", "Út", "St", "Čt", "Pá"];
const DAYS_F = ["Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek"];
const ABS = [
  { id: "sick", label: "Sick Day", icon: "🤒", color: "#c04040" },
  { id: "doctor", label: "Lékař", icon: "🏥", color: "#d48020" },
  { id: "vacation", label: "Dovolená", icon: "🏖️", color: "#4080b0" },
  { id: "whatever", label: "Whatever Day", icon: "☕", color: "#8070b0" },
  { id: "training", label: "Školení", icon: "📚", color: "#308060" },
];
const EVTS = [
  { id: "training", label: "Školení", icon: "📚" }, { id: "dinner", label: "Večeře", icon: "🍽️" },
  { id: "teambuilding", label: "Teambuilding", icon: "🎯" }, { id: "meeting", label: "Porada", icon: "💬" },
  { id: "other", label: "Jiné", icon: "📌" },
];
const HOLIDAY_MAP = {
  '2025-01-01':'Nový rok','2025-04-18':'Velký pátek','2025-04-21':'Vel. pondělí','2025-05-01':'Svátek práce','2025-05-08':'Den vítězství','2025-07-05':'Cyril a Metoděj','2025-07-06':'Jan Hus','2025-09-28':'Den české státnosti','2025-10-28':'Den vzniku ČSR','2025-11-17':'Den svobody','2025-12-24':'Štědrý den','2025-12-25':'1. svátek vánoční','2025-12-26':'2. svátek vánoční',
  '2026-01-01':'Nový rok','2026-04-03':'Velký pátek','2026-04-06':'Vel. pondělí','2026-05-01':'Svátek práce','2026-05-08':'Den vítězství','2026-07-05':'Cyril a Metoděj','2026-07-06':'Jan Hus','2026-09-28':'Den české státnosti','2026-10-28':'Den vzniku ČSR','2026-11-17':'Den svobody','2026-12-24':'Štědrý den','2026-12-25':'1. svátek vánoční','2026-12-26':'2. svátek vánoční',
  '2027-01-01':'Nový rok','2027-03-26':'Velký pátek','2027-03-29':'Vel. pondělí','2027-05-01':'Svátek práce','2027-05-08':'Den vítězství','2027-07-05':'Cyril a Metoděj','2027-07-06':'Jan Hus','2027-09-28':'Den české státnosti','2027-10-28':'Den vzniku ČSR','2027-11-17':'Den svobody','2027-12-24':'Štědrý den','2027-12-25':'1. svátek vánoční','2027-12-26':'2. svátek vánoční',
};
const AE = "admin@shiftflow.app";
const AP = "ShiftFlowAdmin2026!";

/* ═══════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════ */
const dc = o => JSON.parse(JSON.stringify(o));
const uid = () => "u" + Math.random().toString(36).slice(2, 9);
function getMon(d) { const dt = new Date(d); const dy = dt.getDay(); dt.setDate(dt.getDate() - dy + (dy === 0 ? -6 : 1)); dt.setHours(0, 0, 0, 0); return dt; }
const wKey = d => getMon(d).toISOString().slice(0, 10);
const fmtW = d => { const m = getMon(d), f = new Date(m); f.setDate(f.getDate() + 4); return `${m.getDate()}.${m.getMonth() + 1}. — ${f.getDate()}.${f.getMonth() + 1}.${f.getFullYear()}`; };
function buildDef(emps) { const s = {}; DAYS.forEach(day => { s[day] = {}; SHIFTS.forEach(sh => s[day][sh] = []); emps.forEach(emp => { if (!emp.defaultSchedule || !emp.setupDone) return; const shift = emp.defaultSchedule[day]; if (shift && SHIFTS.includes(shift)) s[day][shift].push({ empId: emp.id, ho: emp.defaultSchedule[`${day}_ho`] || false, isDefault: true }); }); }); return s; }
function getWeekDates(weekOffset) { const d = new Date(); d.setDate(d.getDate() + weekOffset * 7); const dow = d.getDay(); const mon = new Date(d); mon.setDate(d.getDate() - dow + (dow === 0 ? -6 : 1)); mon.setHours(0, 0, 0, 0); return DAYS.map((_, i) => { const x = new Date(mon); x.setDate(mon.getDate() + i); return x.toISOString().slice(0, 10); }); }
const todayDayIdx = (() => { const d = new Date().getDay(); if (d === 0 || d === 6) return 0; return d - 1; })();
function isCurrentWeekDay(dayIndex, weekOffset) { return weekOffset === 0 && dayIndex === todayDayIdx; }

const GAS = import.meta.env.VITE_GAS_URL;
async function callGAS(a, d) { if (!GAS) return; try { await fetch(GAS, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ action: a, data: d }) }); } catch { } }
async function initPush(u) { try { const m = await getMsg(); if (!m) return; if ((await Notification.requestPermission()) !== "granted") return; const v = import.meta.env.VITE_FIREBASE_VAPID_KEY; if (!v) return; const t = await getToken(m, { vapidKey: v }); await updateDoc(doc(db, "users", u), { fcmToken: t }); onMessage(m, p => { if (p.notification) new Notification(p.notification.title || "SF", { body: p.notification.body, icon: "/icon-192.png" }); }); } catch { } }

/* ═══════════════════════════════════════════════════
   CSS
   ═══════════════════════════════════════════════════ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@300;400;500;600;700&family=Barlow:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
:root,[data-theme="light"]{
  --bg:#bec4d0;--bg2:rgba(210,215,225,.45);--bg3:rgba(200,208,222,.38);--bg4:rgba(190,198,215,.48);
  --panel:rgba(215,220,230,.6);--card:rgba(220,225,235,.42);--card-h:rgba(210,218,230,.55);
  --brd:rgba(50,60,85,.3);--brd2:rgba(40,50,75,.4);--brd-thick:rgba(35,45,70,.5);
  --tx:#2e3440;--tx2:#555e70;--tx3:#7a8290;--w:#1a1e28;
  --acc:#3a4558;--acc2:#d47820;--acc3:#c05828;
  --acc-dim:rgba(212,120,32,.1);--acc-brd:rgba(212,120,32,.32);
  --l1:#5050d0;--sd:#2878a8;--l1-dim:rgba(80,80,208,.08);--sd-dim:rgba(40,120,168,.08);
  --red:#b83030;--grn:#388040;--amb:#c87020;
  --sel:#2e3848;--sel-tx:#e8eaf0;--blur:blur(24px);--glass:rgba(215,220,230,.6);
  --sheen:linear-gradient(135deg,rgba(255,255,255,.28) 0%,rgba(255,255,255,.02) 38%,rgba(255,255,255,.07) 65%,rgba(255,255,255,.20) 100%);
  --grid:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cdefs%3E%3Cpattern id='g' width='40' height='40' patternUnits='userSpaceOnUse'%3E%3Cpath d='M40 0H0v40' fill='none' stroke='rgba(80,90,120,.055)' stroke-width='.5'/%3E%3Ccircle cx='0' cy='0' r='.8' fill='rgba(80,90,120,.05)'/%3E%3C/pattern%3E%3C/defs%3E%3Crect width='200' height='200' fill='url(%23g)'/%3E%3C/svg%3E");
  --moon:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='800'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='.012' numOctaves='8' seed='3' type='fractalNoise'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3CfeComponentTransfer%3E%3CfeFuncR type='linear' slope='.18' intercept='.68'/%3E%3CfeFuncG type='linear' slope='.18' intercept='.7'/%3E%3CfeFuncB type='linear' slope='.18' intercept='.76'/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3Ccircle cx='120' cy='180' r='45' fill='rgba(0,0,0,.06)'/%3E%3Ccircle cx='380' cy='100' r='70' fill='rgba(0,0,0,.05)'/%3E%3Ccircle cx='550' cy='300' r='85' fill='rgba(0,0,0,.045)'/%3E%3Ccircle cx='250' cy='420' r='55' fill='rgba(0,0,0,.055)'/%3E%3Ccircle cx='650' cy='550' r='40' fill='rgba(0,0,0,.04)'/%3E%3Ccircle cx='80' cy='600' r='60' fill='rgba(0,0,0,.05)'/%3E%3C/svg%3E");
}
[data-theme="dark"]{
  --bg:#0c0c12;--bg2:rgba(18,18,28,.85);--bg3:rgba(24,24,36,.8);--bg4:rgba(30,30,44,.8);
  --panel:rgba(16,16,26,.85);--card:rgba(20,20,32,.7);--card-h:rgba(28,28,42,.8);
  --brd:rgba(255,255,255,.08);--brd2:rgba(255,255,255,.12);--brd-thick:rgba(255,255,255,.14);
  --tx:#c0c4d0;--tx2:#7880a0;--tx3:#4a5070;--w:#e8eaf0;
  --acc:#7b8fad;--acc2:#d47820;--acc3:#c05828;
  --acc-dim:rgba(212,120,32,.12);--acc-brd:rgba(212,120,32,.3);
  --l1:#7c7cf5;--sd:#50a0d0;--l1-dim:rgba(124,124,245,.08);--sd-dim:rgba(80,160,208,.08);
  --red:#c04040;--grn:#50a060;--amb:#c87020;
  --sel:rgba(123,143,173,.15);--sel-tx:#e8eaf0;--blur:blur(16px);--glass:rgba(16,16,26,.8);
  --sheen:linear-gradient(135deg,rgba(255,255,255,.06) 0%,transparent 50%,rgba(255,255,255,.03) 100%);
  --grid:none;--moon:none;
}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{background:var(--bg);transition:background .4s}
::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--brd2)}
@keyframes fi{from{opacity:0}to{opacity:1}}
@keyframes su{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes viewIn{from{opacity:0;transform:translateX(30px)}to{opacity:1;transform:translateX(0)}}
@keyframes modalUp{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes slideToast{from{transform:translateY(-30px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes slideFromRight{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:translateX(0)}}
@keyframes slideFromLeft{from{opacity:0;transform:translateX(-24px)}to{opacity:1;transform:translateX(0)}}
@keyframes todayPulse{0%,100%{box-shadow:0 0 0 0 rgba(212,120,32,.4)}50%{box-shadow:0 0 0 4px rgba(212,120,32,.0)}}
.view-enter{animation:viewIn .35s cubic-bezier(.22,.68,.36,1)}
.slide-r{animation:slideFromRight .26s cubic-bezier(.22,.68,.36,1) both}
.slide-l{animation:slideFromLeft .26s cubic-bezier(.22,.68,.36,1) both}
.today-pill{animation:todayPulse 2.5s ease-in-out infinite}
.chg{box-shadow:inset 2px 0 0 var(--acc2)}
.ent{transition:all .15s;cursor:pointer;min-height:48px;display:flex;align-items:center}
.ent:hover,.ent:active{background:var(--card-h)!important}
.glass{background:var(--card);backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);border:1px solid var(--brd-thick);position:relative;overflow:hidden}
.glass::before{content:'';position:absolute;inset:0;background:var(--sheen);pointer-events:none;z-index:1}
.glass::after{content:'';position:absolute;inset:0;background-image:var(--grid);background-size:200px 200px;opacity:.7;pointer-events:none;z-index:0}
.glass>*{position:relative;z-index:2}
.panel-glass{background:var(--panel);backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);position:relative;overflow:hidden}
.panel-glass::before{content:'';position:absolute;inset:0;background:var(--sheen);pointer-events:none;z-index:1}
.panel-glass>*{position:relative;z-index:2}
`;

/* ═══════════════════════════════════════════════════
   UI COMPONENTS
   ═══════════════════════════════════════════════════ */
const Badge = ({ children, color = "var(--acc)", small, style: sx }) => <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: small ? "2px 8px" : "4px 12px", fontSize: small ? 11 : 13, fontWeight: 500, fontFamily: "'Barlow Condensed',sans-serif", color, letterSpacing: .8, textTransform: "uppercase", border: `1px solid ${color}`, whiteSpace: "nowrap", ...sx }}>{children}</span>;
const Btn = ({ children, onClick, primary, danger, small, ghost, warm, disabled, style: sx }) => <button disabled={disabled} onClick={onClick} style={{ padding: small ? "8px 14px" : "12px 24px", border: `1px solid ${danger ? "var(--red)" : warm ? "var(--acc2)" : primary ? "var(--acc)" : "var(--brd2)"}`, fontWeight: 500, cursor: disabled ? "not-allowed" : "pointer", fontSize: small ? 13 : 15, fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 1, background: warm ? "var(--acc-dim)" : primary ? "var(--sel)" : "transparent", color: danger ? "var(--red)" : warm ? "var(--acc2)" : primary ? "var(--sel-tx)" : "var(--tx2)", opacity: disabled ? .3 : 1, transition: "all .2s", minHeight: 44, ...sx }}>{children}</button>;
const Input = ({ label, ...p }) => <div style={{ marginBottom: 18 }}>{label && <label style={{ fontSize: 12, color: "var(--tx3)", display: "block", marginBottom: 6, fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 1.5 }}>{label}</label>}<input {...p} style={{ width: "100%", padding: "12px 14px", border: "1px solid var(--brd2)", background: "var(--bg)", color: "var(--w)", fontSize: 16, fontFamily: "'Barlow',sans-serif", outline: "none", boxSizing: "border-box", minHeight: 48, transition: "border .2s", ...(p.style || {}) }} onFocus={e => { e.target.style.borderColor = "var(--acc2)"; }} onBlur={e => { e.target.style.borderColor = ""; }} /></div>;
const Sel = ({ label, options, ...p }) => <div style={{ marginBottom: 18 }}>{label && <label style={{ fontSize: 12, color: "var(--tx3)", display: "block", marginBottom: 6, fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 1.5 }}>{label}</label>}<select {...p} style={{ width: "100%", padding: "12px 14px", border: "1px solid var(--brd2)", background: "var(--bg)", color: "var(--w)", fontSize: 16, fontFamily: "'Barlow',sans-serif", outline: "none", minHeight: 48 }}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>;
const Toggle = ({ checked, onChange, label }) => <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 15, color: "var(--tx)", marginBottom: 14, minHeight: 44 }}><div onClick={() => onChange(!checked)} style={{ width: 40, height: 20, border: `1px solid ${checked ? "var(--acc2)" : "var(--brd2)"}`, position: "relative", transition: "all .25s", cursor: "pointer", flexShrink: 0, background: checked ? "var(--acc-dim)" : "transparent" }}><div style={{ width: 16, height: 16, background: checked ? "var(--acc2)" : "var(--tx3)", position: "absolute", top: 1, left: checked ? 21 : 1, transition: "all .25s" }} /></div>{label}</label>;
const Modal = ({ open, onClose, title, children }) => { if (!open) return null; return <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.35)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-end", justifyContent: "center", animation: "fi .2s" }} onClick={onClose}><div onClick={e => e.stopPropagation()} className="glass" style={{ borderBottom: "none", padding: "28px 24px 36px", width: "100%", maxWidth: 520, maxHeight: "85vh", overflowY: "auto", animation: "modalUp .3s cubic-bezier(.22,.68,.36,1)" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, borderBottom: "1px solid var(--brd)", paddingBottom: 16 }}><h3 style={{ margin: 0, fontSize: 18, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600, textTransform: "uppercase", letterSpacing: 2 }}>{title}</h3><button onClick={onClose} style={{ background: "none", border: "1px solid var(--brd2)", color: "var(--tx3)", width: 40, height: 40, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button></div>{children}</div></div>; };
const Card = ({ children, style: sx }) => <div className="glass" style={{ padding: 20, ...sx }}>{children}</div>;

/* ═══════════════════════════════════════════════════
   PARALLAX BACKGROUND
   ═══════════════════════════════════════════════════ */
function ParallaxBg() {
  const bgRef = useRef(null);
  const pos = useRef({ x: 0, y: 0 });
  const raf = useRef(null);
  useEffect(() => {
    const update = () => { if (bgRef.current) bgRef.current.style.transform = `translate(${pos.current.x * 24}px,${pos.current.y * 18}px)`; };
    const onMouse = e => { pos.current = { x: e.clientX / window.innerWidth - .5, y: e.clientY / window.innerHeight - .5 }; cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(update); };
    const onGyro = e => { pos.current = { x: Math.max(-1, Math.min(1, (e.gamma || 0) / 40)), y: Math.max(-1, Math.min(1, ((e.beta || 0) - 30) / 40)) }; cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(update); };
    window.addEventListener('mousemove', onMouse, { passive: true });
    window.addEventListener('deviceorientation', onGyro, { passive: true });
    return () => { window.removeEventListener('mousemove', onMouse); window.removeEventListener('deviceorientation', onGyro); cancelAnimationFrame(raf.current); };
  }, []);
  return <div ref={bgRef} style={{ position: 'fixed', inset: -60, zIndex: -1, pointerEvents: 'none', backgroundImage: 'var(--moon)', backgroundSize: 'cover', willChange: 'transform', transition: 'transform .08s linear' }} />;
}

/* ═══════════════════════════════════════════════════
   PILL NAV
   ═══════════════════════════════════════════════════ */
function PillNav({ view, setView, NAV }) {
  return <nav className="panel-glass" style={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 100, display: 'flex', gap: 2, padding: 4, border: '1px solid var(--brd-thick)', boxShadow: '0 8px 32px rgba(0,0,0,.22)' }}>
    {NAV.map(item => <button key={item.id} onClick={() => setView(item.id)} style={{ display: 'flex', alignItems: 'center', gap: view === item.id ? 7 : 0, padding: view === item.id ? '10px 16px' : '10px 13px', border: 'none', background: view === item.id ? 'var(--acc-dim)' : 'transparent', outline: view === item.id ? '1px solid var(--acc-brd)' : 'none', cursor: 'pointer', color: view === item.id ? 'var(--acc2)' : 'var(--tx3)', transition: 'all .28s cubic-bezier(.22,.68,.36,1)', minHeight: 44, position: 'relative' }}>
      <span style={{ fontSize: 18 }}>{item.i}</span>
      <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, overflow: 'hidden', maxWidth: view === item.id ? 80 : 0, whiteSpace: 'nowrap', transition: 'max-width .28s cubic-bezier(.22,.68,.36,1)' }}>{item.l}</span>
      {item.b > 0 && view !== item.id && <span style={{ position: 'absolute', top: 2, right: 2, background: 'var(--red)', color: '#fff', fontSize: 8, fontWeight: 700, width: 14, height: 14, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{item.b}</span>}
    </button>)}
  </nav>;
}

/* ═══════════════════════════════════════════════════
   SETUP + AUTH + EDITOR (defined before App)
   ═══════════════════════════════════════════════════ */
function Setup({ profile, onDone }) {
  const [sched, setSched] = useState(() => { const s = {}; DAYS.forEach(d => { s[d] = "09:00"; s[`${d}_ho`] = false; }); return s; });
  const [saving, setSaving] = useState(false);
  return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", padding: 16 }}><style>{CSS}</style><ParallaxBg />
    <div className="glass" style={{ width: "100%", maxWidth: 520, padding: "36px 24px", animation: "modalUp .5s cubic-bezier(.22,.68,.36,1)" }}>
      <div style={{ textAlign: "center", marginBottom: 32, borderBottom: "1px solid var(--brd)", paddingBottom: 24 }}>
        <div style={{ fontSize: 14, color: "var(--tx3)", letterSpacing: 3, textTransform: "uppercase", marginBottom: 8 }}>ShiftFlow</div>
        <h2 style={{ fontSize: 24, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2 }}>Stálý rozvrh</h2>
        <p style={{ color: "var(--tx2)", fontSize: 14, marginTop: 10 }}>{profile.name} — vyberte směnu pro každý den</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {DAYS.map((day) => <div key={day} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--bg3)", border: "1px solid var(--brd)" }}>
          <span style={{ fontWeight: 600, fontSize: 16, minWidth: 50, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif" }}>{day}</span>
          <div style={{ display: "flex", gap: 2, flex: 1 }}>{SHIFTS.map(sh => <button key={sh} onClick={() => setSched(s => ({ ...s, [day]: sh }))} style={{ flex: 1, padding: "10px 0", border: `1px solid ${sched[day] === sh ? "var(--acc2)" : "var(--brd)"}`, fontSize: 15, fontFamily: "'IBM Plex Mono',monospace", cursor: "pointer", background: sched[day] === sh ? "var(--acc-dim)" : "transparent", color: sched[day] === sh ? "var(--w)" : "var(--tx3)", transition: "all .2s", minHeight: 44, fontWeight: 500 }}>{sh}</button>)}</div>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--tx3)", cursor: "pointer" }}><input type="checkbox" checked={sched[`${day}_ho`] || false} onChange={e => setSched(s => ({ ...s, [`${day}_ho`]: e.target.checked }))} style={{ accentColor: "var(--grn)", width: 18, height: 18 }} />HO</label>
        </div>)}
      </div>
      <Btn warm disabled={saving} onClick={async () => { setSaving(true); await updateDoc(doc(db, "users", profile.id), { defaultSchedule: sched, setupDone: true }); onDone(); }} style={{ width: "100%", marginTop: 24, padding: "14px 0", fontSize: 17 }}>{saving ? "UKLÁDÁM..." : "POTVRDIT ROZVRH"}</Btn>
    </div>
  </div>;
}

function AuthScreen() {
  const [mode, setMode] = useState("login"); const [login, setLogin] = useState(""); const [pass, setPass] = useState("");
  const [err, setErr] = useState(""); const [loading, setLoading] = useState(false);
  const [rn, setRn] = useState(""); const [rEmail, setREmail] = useState(""); const [rp, setRp] = useState(""); const [rp2, setRp2] = useState("");
  const [rt, setRt] = useState("L1"); const [rNotify, setRNotify] = useState(false); const [rNotifEmail, setRNotifEmail] = useState("");
  const doLogin = async () => { setErr(""); setLoading(true); try { if (login === "Admin" && pass === "0000") await signInWithEmailAndPassword(auth, AE, AP); else await signInWithEmailAndPassword(auth, login, pass); } catch (e) { setErr(e.code === "auth/invalid-credential" ? "Neplatné údaje" : e.message); } setLoading(false); };
  const doReg = async () => { setErr(""); setLoading(true); try { if (!rn.trim() || !rEmail || !rp) { setErr("Vyplňte povinná pole"); setLoading(false); return; } if (rp !== rp2) { setErr("Hesla se neshodují"); setLoading(false); return; } if (rp.length < 6) { setErr("Min. 6 znaků"); setLoading(false); return; } const c = await createUserWithEmailAndPassword(auth, rEmail, rp); await updateProfile(c.user, { displayName: rn.trim() }); await setDoc(doc(db, "users", c.user.uid), { name: rn.trim(), email: rEmail, team: rt, role: "employee", notify: rNotify, notifyEmail: rNotify ? rNotifEmail : "", fcmToken: null, defaultSchedule: null, setupDone: false, vacationTotal: 20, sickTotal: 5, whateverTotal: 3, vacationUsed: 0, sickUsed: 0, whateverUsed: 0, createdAt: new Date().toISOString() }); } catch (e) { setErr(e.code === "auth/email-already-in-use" ? "Email registrován" : e.message); } setLoading(false); };
  const doBio = async () => { try { const stored = localStorage.getItem("sf_bio_email"), storedP = localStorage.getItem("sf_bio_token"); if (!stored || !storedP) return setErr("Přihlaste se heslem a povolte biometrii"); await signInWithEmailAndPassword(auth, stored, storedP); } catch (e) { setErr("Biometrie: " + e.message); } };
  return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", padding: 16 }}><style>{CSS}</style><ParallaxBg />
    <div className="glass" style={{ width: "100%", maxWidth: 440, padding: "40px 28px", animation: "modalUp .5s cubic-bezier(.22,.68,.36,1)" }}>
      <div style={{ textAlign: "center", marginBottom: 36, borderBottom: "1px solid var(--brd)", paddingBottom: 28 }}>
        <div style={{ fontSize: 36, letterSpacing: 8, fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 300, color: "var(--w)" }}>SHIFTFLOW</div>
        <div style={{ width: 40, height: 2, background: "var(--acc2)", margin: "8px auto 12px" }} />
        <p style={{ color: "var(--tx3)", fontSize: 12, letterSpacing: 2, textTransform: "uppercase" }}>Shift Management System</p>
      </div>
      <div style={{ display: "flex", marginBottom: 28, border: "1px solid var(--brd)" }}>{["login", "register"].map(m => <button key={m} onClick={() => { setMode(m); setErr(""); }} style={{ flex: 1, padding: "12px 0", border: "none", fontSize: 14, fontWeight: 500, fontFamily: "'Barlow Condensed',sans-serif", cursor: "pointer", background: mode === m ? "var(--sel)" : "transparent", color: mode === m ? "var(--sel-tx)" : "var(--tx3)", textTransform: "uppercase", letterSpacing: 1.5, minHeight: 48, transition: "all .25s" }}>{m === "login" ? "Přihlášení" : "Registrace"}</button>)}</div>
      {mode === "login" ? <>
        <Input label="Email" value={login} onChange={e => setLogin(e.target.value)} placeholder="vas@email.cz" />
        <Input label="Heslo" type="password" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === "Enter" && doLogin()} />
        <div style={{ display: "flex", gap: 8 }}><Btn warm disabled={loading} onClick={doLogin} style={{ flex: 1, padding: "14px 0" }}>{loading ? "Načítání..." : "Přihlásit"}</Btn><Btn ghost onClick={doBio} style={{ padding: "14px 18px", fontSize: 20 }}>🔐</Btn></div>
      </> : <>
        <Input label="Celé jméno" value={rn} onChange={e => setRn(e.target.value)} />
        <Input label="Email" value={rEmail} onChange={e => setREmail(e.target.value)} />
        <Input label="Heslo (min. 6)" type="password" value={rp} onChange={e => setRp(e.target.value)} />
        <Input label="Heslo znovu" type="password" value={rp2} onChange={e => setRp2(e.target.value)} />
        <Sel label="Tým" value={rt} onChange={e => setRt(e.target.value)} options={[{ value: "L1", label: "L1 Support" }, { value: "SD", label: "Service Desk" }]} />
        <div style={{ background: "var(--bg3)", border: "1px solid var(--brd)", padding: 16, marginBottom: 18 }}><Toggle checked={rNotify} onChange={setRNotify} label="Upozornění na změny" />{rNotify && <Input label="Email notifikací" type="email" value={rNotifEmail} onChange={e => setRNotifEmail(e.target.value)} style={{ marginBottom: 0 }} />}</div>
        <Btn warm disabled={loading} onClick={doReg} style={{ width: "100%", padding: "14px 0" }}>{loading ? "Načítání..." : "Zaregistrovat"}</Btn>
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
    <div className="glass" style={{ overflow: "auto", padding: 0 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}><thead><tr>
        <th style={{ padding: "12px 14px", textAlign: "left", color: "var(--tx3)", fontWeight: 500, borderBottom: "1px solid var(--brd)" }}>Zaměstnanec</th>
        {DAYS.map(d => <th key={d} style={{ padding: "12px 8px", textAlign: "center", color: "var(--tx3)", fontWeight: 500, borderBottom: "1px solid var(--brd)" }}>{d}</th>)}
        <th style={{ padding: 12, borderBottom: "1px solid var(--brd)" }} />
      </tr></thead><tbody>{employees.filter(e => e.team === team && e.role !== "admin").map(emp => <tr key={emp.id} style={{ borderBottom: "1px solid var(--brd)" }}>
        <td style={{ padding: "12px 14px", fontWeight: 500, color: "var(--w)", fontSize: 15 }}>{emp.name}</td>
        {DAYS.map(d => <td key={d} style={{ padding: 8, textAlign: "center" }}>{emp.setupDone && emp.defaultSchedule?.[d] ? <span style={{ fontFamily: "'IBM Plex Mono',monospace", color: "var(--acc2)", fontSize: 13 }}>{emp.defaultSchedule[d]}{emp.defaultSchedule[`${d}_ho`] ? " ·HO" : ""}</span> : <span style={{ color: "var(--tx3)" }}>—</span>}</td>)}
        <td style={{ padding: "8px 12px", textAlign: "right" }}><Btn small onClick={() => start(emp)}>✏️</Btn></td>
      </tr>)}</tbody></table>
    </div>
  </div>)}
    <Modal open={!!editEmp} onClose={() => setEditEmp(null)} title={editEmp?.name || ""}>{editEmp && <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{DAYS.map(day => <div key={day} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--bg3)" }}>
        <span style={{ fontWeight: 600, fontSize: 15, minWidth: 50, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif" }}>{day}</span>
        <div style={{ display: "flex", gap: 2, flex: 1 }}>{SHIFTS.map(sh => <button key={sh} onClick={() => setEs(s => ({ ...s, [day]: sh }))} style={{ flex: 1, padding: "10px 0", border: `1px solid ${es[day] === sh ? "var(--acc2)" : "var(--brd)"}`, fontSize: 14, fontFamily: "'IBM Plex Mono',monospace", cursor: "pointer", background: es[day] === sh ? "var(--acc-dim)" : "transparent", color: es[day] === sh ? "var(--w)" : "var(--tx3)", minHeight: 44, transition: "all .2s" }}>{sh}</button>)}</div>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--tx3)", cursor: "pointer" }}><input type="checkbox" checked={es[`${day}_ho`] || false} onChange={e => setEs(s => ({ ...s, [`${day}_ho`]: e.target.checked }))} style={{ accentColor: "var(--grn)", width: 18, height: 18 }} />HO</label>
      </div>)}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 20 }}><Btn warm disabled={saving} onClick={async () => { setSaving(true); await updateDoc(doc(db, "users", editEmp.id), { defaultSchedule: es, setupDone: true }); setSaving(false); setEditEmp(null); }} style={{ flex: 1 }}>Uložit</Btn><Btn ghost onClick={() => setEditEmp(null)}>Zrušit</Btn></div>
    </div>}</Modal></div>;
}

/* ═══════════════════════════════════════════════════
   FORM COMPONENTS (all before App to avoid TDZ)
   ═══════════════════════════════════════════════════ */
function AbsF({ emps, onSubmit }) { const [eid, setEid] = useState(emps[0]?.id || ""); const [day, setDay] = useState(DAYS[0]); const [t, setT] = useState(ABS[0].id); return <div><Sel label="Zaměstnanec" value={eid} onChange={e => setEid(e.target.value)} options={emps.map(e => ({ value: e.id, label: e.name }))} /><Sel label="Den" value={day} onChange={e => setDay(e.target.value)} options={DAYS.map((d, i) => ({ value: d, label: DAYS_F[i] }))} /><Sel label="Typ" value={t} onChange={e => setT(e.target.value)} options={ABS.map(a => ({ value: a.id, label: `${a.icon} ${a.label}` }))} /><Btn warm onClick={() => onSubmit(eid, day, t)} style={{ width: "100%", marginTop: 8 }}>Přidat</Btn></div>; }
function EvF({ onSubmit }) { const [day, setDay] = useState(DAYS[0]); const [t, setT] = useState(EVTS[0].id); const [n, setN] = useState(""); return <div><Sel label="Den" value={day} onChange={e => setDay(e.target.value)} options={DAYS.map((d, i) => ({ value: d, label: DAYS_F[i] }))} /><Sel label="Typ" value={t} onChange={e => setT(e.target.value)} options={EVTS.map(e => ({ value: e.id, label: `${e.icon} ${e.label}` }))} /><Input label="Poznámka" value={n} onChange={e => setN(e.target.value)} /><Btn warm onClick={() => onSubmit(day, t, n)} style={{ width: "100%", marginTop: 8 }}>Přidat</Btn></div>; }
function SwF({ dDay, dShift, onSubmit }) { const [day, setDay] = useState(dDay || DAYS[0]); const [sh, setSh] = useState(dShift || SHIFTS[0]); return <div><p style={{ fontSize: 14, color: "var(--tx2)", margin: "0 0 14px" }}>Kdokoliv může přijmout — směny se prohodí.</p><Sel label="Den" value={day} onChange={e => setDay(e.target.value)} options={DAYS.map((d, i) => ({ value: d, label: DAYS_F[i] }))} /><Sel label="Směna" value={sh} onChange={e => setSh(e.target.value)} options={SHIFTS.map(s => ({ value: s, label: s }))} /><Btn warm onClick={() => onSubmit(day, sh)} style={{ width: "100%", marginTop: 8 }}>Odeslat</Btn></div>; }
function MyAbsF({ profile, onSubmit }) { const [day, setDay] = useState(DAYS[0]); const [t, setT] = useState(ABS[0].id); const r = { sick: (profile.sickTotal || 5) - (profile.sickUsed || 0), vacation: (profile.vacationTotal || 20) - (profile.vacationUsed || 0), whatever: (profile.whateverTotal || 3) - (profile.whateverUsed || 0) }; return <div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>{[{ l: "Dovolená", v: r.vacation, c: "var(--sd)" }, { l: "Sick", v: r.sick, c: "var(--red)" }, { l: "Whatever", v: r.whatever, c: "var(--amb)" }].map(b => <div key={b.l} style={{ textAlign: "center", padding: 12, border: "1px solid var(--brd)", background: "var(--bg3)" }}><div style={{ fontSize: 28, fontWeight: 600, color: b.c, fontFamily: "'IBM Plex Mono',monospace" }}>{b.v}</div><div style={{ fontSize: 11, color: "var(--tx3)", textTransform: "uppercase" }}>{b.l}</div></div>)}</div><Sel label="Den" value={day} onChange={e => setDay(e.target.value)} options={DAYS.map((d, i) => ({ value: d, label: DAYS_F[i] }))} /><Sel label="Typ" value={t} onChange={e => setT(e.target.value)} options={ABS.map(a => ({ value: a.id, label: `${a.icon} ${a.label}` }))} /><Btn warm onClick={() => onSubmit(day, t)} style={{ width: "100%", marginTop: 8 }}>Zadat</Btn></div>; }
function EditDF({ emp, onDone }) { const [vac, setVac] = useState(emp?.vacationTotal || 20); const [sick, setSick] = useState(emp?.sickTotal || 5); const [what, setWhat] = useState(emp?.whateverTotal || 3); const [l, setL] = useState(false); if (!emp) return null; return <div><p style={{ fontSize: 14, color: "var(--tx2)", marginBottom: 16 }}>{emp.name}</p><Input label="Dovolená" type="number" value={vac} onChange={e => setVac(+e.target.value)} /><Input label="Sick Days" type="number" value={sick} onChange={e => setSick(+e.target.value)} /><Input label="Whatever Days" type="number" value={what} onChange={e => setWhat(+e.target.value)} /><Btn warm disabled={l} onClick={async () => { setL(true); await updateDoc(doc(db, "users", emp.id), { vacationTotal: vac, sickTotal: sick, whateverTotal: what }); setL(false); onDone(); }} style={{ width: "100%", marginTop: 8 }}>Uložit</Btn></div>; }
function AddF({ onDone }) { const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [pass, setPass] = useState(""); const [team, setTeam] = useState("L1"); const [l, setL] = useState(false); const [err, setErr] = useState(""); return <div><Input label="Jméno" value={name} onChange={e => setName(e.target.value)} /><Input label="Email" value={email} onChange={e => setEmail(e.target.value)} /><Input label="Heslo (min. 6)" type="password" value={pass} onChange={e => setPass(e.target.value)} /><Sel label="Tým" value={team} onChange={e => setTeam(e.target.value)} options={[{ value: "L1", label: "L1 Support" }, { value: "SD", label: "Service Desk" }]} />{err && <p style={{ color: "var(--red)", fontSize: 14, marginBottom: 8, padding: "10px 12px", border: "1px solid var(--red)" }}>{err}</p>}<Btn warm disabled={l} onClick={async () => { setErr(""); if (!name.trim() || !email || !pass) return setErr("Vyplňte vše"); if (pass.length < 6) return setErr("Min. 6 znaků"); setL(true); try { const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${import.meta.env.VITE_FIREBASE_API_KEY}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pass, displayName: name.trim(), returnSecureToken: false }) }); const d = await r.json(); if (d.error) { setErr(d.error.message); setL(false); return; } await setDoc(doc(db, "users", d.localId), { name: name.trim(), email, team, role: "employee", notify: false, notifyEmail: "", fcmToken: null, defaultSchedule: null, setupDone: false, vacationTotal: 20, sickTotal: 5, whateverTotal: 3, vacationUsed: 0, sickUsed: 0, whateverUsed: 0, createdAt: new Date().toISOString() }); onDone(`Přidán: ${name.trim()}`); } catch (e) { setErr(e.message); } setL(false); }} style={{ width: "100%" }}>Přidat</Btn></div>; }

/* ═══════════════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════════════ */
export default function App() {
  const [authUser, setAuthUser] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [view, setView] = useState("schedule");
  const [tf, setTf] = useState("all");
  const [employees, setEmployees] = useState([]);
  const [wo, setWo] = useState(0);
  const [schedule, setSchedule] = useState(null);
  const [absences, setAbsences] = useState({});
  const [events, setEvents] = useState({});
  const [swaps, setSwaps] = useState([]);
  const [selCell, setSelCell] = useState(null);
  const [modal, setModal] = useState(null);
  const [notifs, setNotifs] = useState([]);
  const [logs, setLogs] = useState([]);
  const [rules, setRules] = useState({ L1_max: 2, SD_max8: 2, SD_maxHO: 2, SD_noHO8: true, SD_noHO10: true });
  const [theme, setTheme] = useState(() => localStorage.getItem("sf_theme") || "light");
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 768);
  const [selectedDay, setSelectedDay] = useState(todayDayIdx);
  const [slideDir, setSlideDir] = useState('right');
  const viewKey = useRef(0);

  const goToDay = (i) => { setSlideDir(i > selectedDay ? 'right' : 'left'); setSelectedDay(i); };
  const switchView = v => { viewKey.current++; setView(v); };

  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); localStorage.setItem("sf_theme", theme); }, [theme]);
  useEffect(() => { const fn = () => setIsMobile(window.innerWidth < 768); window.addEventListener('resize', fn); return () => window.removeEventListener('resize', fn); }, []);

  const cw = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + wo * 7); return d; }, [wo]);
  const wk = wKey(cw);
  const isA = profile?.role === "admin";
  const ge = id => employees.find(e => e.id === id);
  const ds = useMemo(() => buildDef(employees), [employees]);
  const cs = schedule || ds;
  const weekDates = useMemo(() => getWeekDates(wo), [wo]);
  const weekHolidays = weekDates.map(d => HOLIDAY_MAP[d] || null);

  useEffect(() => { const u = onAuthStateChanged(auth, async u => { if (u) { setAuthUser(u); const s = await getDoc(doc(db, "users", u.uid)); if (s.exists()) setProfile({ id: u.uid, ...s.data() }); else setProfile({ id: u.uid, name: u.displayName || u.email, role: "employee", team: "L1", setupDone: false }); initPush(u.uid); } else { setAuthUser(null); setProfile(null); } }); return u; }, []);
  useEffect(() => { const u = onSnapshot(collection(db, "users"), s => { const e = s.docs.map(d => ({ id: d.id, ...d.data() })); setEmployees(e); if (profile) { const m = e.find(x => x.id === profile.id); if (m) setProfile(p => ({ ...p, ...m })); } }); return u; }, [profile?.id]);
  useEffect(() => { const u = onSnapshot(doc(db, "schedules", wk), s => { if (s.exists()) { const d = s.data(); setSchedule(d.entries || null); setAbsences(d.absences || {}); setEvents(d.events || {}); } else { setSchedule(null); setAbsences({}); setEvents({}); } }); return u; }, [wk]);
  useEffect(() => { const u = onSnapshot(collection(db, "swapRequests"), s => setSwaps(s.docs.map(d => ({ id: d.id, ...d.data() })))); return u; }, []);
  useEffect(() => { const u = onSnapshot(doc(db, "rules", "global"), s => { if (s.exists()) setRules(s.data()); }); return u; }, []);
  useEffect(() => { const u = onSnapshot(collection(db, "auditLog"), s => { const a = s.docs.map(d => ({ id: d.id, ...d.data() })); a.sort((a, b) => (b.time || "").localeCompare(a.time || "")); setLogs(a.slice(0, 100)); }); return u; }, []);

  const notify = msg => { const n = { id: uid(), msg, time: new Date().toLocaleTimeString("cs") }; setNotifs(p => [n, ...p]); setTimeout(() => setNotifs(p => p.filter(x => x.id !== n.id)), 5000); };
  const log = async msg => { try { await addDoc(collection(db, "auditLog"), { msg, time: new Date().toISOString(), week: wk, userId: profile?.id }); } catch { } };
  const saveS = async en => { await setDoc(doc(db, "schedules", wk), { entries: en, weekStart: wk, modifiedAt: new Date().toISOString(), modifiedBy: profile?.id }, { merge: true }); };
  const eN = (emp, msg) => { if (emp?.notify && (emp?.notifyEmail || emp?.email)) callGAS("sendEmail", { to: emp.notifyEmail || emp.email, employeeName: emp.name, changeDescription: msg, weekLabel: fmtW(cw) }); };

  // === SCHEDULE ACTIONS ===
  const moveE = async (eid, fd, fs, td, ts) => { const s = dc(cs); const f = s[fd]?.[fs]; if (!f) return; const i = f.findIndex(e => e.empId === eid); if (i === -1) return; const [en] = f.splice(i, 1); en.isDefault = false; if (!s[td]) s[td] = {}; if (!s[td][ts]) s[td][ts] = []; s[td][ts].push(en); await saveS(s); const emp = ge(eid); notify(`${emp?.name}: ${fd} ${fs} → ${td} ${ts}`); log(`${emp?.name}: ${fd} ${fs} → ${td} ${ts}`); };
  const togHO = async (day, sh, eid) => { const s = dc(cs); const en = s[day]?.[sh]?.find(e => e.empId === eid); if (en) { en.ho = !en.ho; en.isDefault = false; } await saveS(s); const emp = ge(eid); notify(`${emp?.name}: HO ${en?.ho ? "ON" : "OFF"}`); };

  // === ABSENCE (optimistic update) ===
  const addAbs = async (eid, day, type) => {
    if (!isA && eid !== profile.id) return;
    const newSched = dc(cs);
    SHIFTS.forEach(sh => { if (newSched[day]?.[sh]) newSched[day][sh] = newSched[day][sh].filter(e => e.empId !== eid); });
    setSchedule(newSched);
    setAbsences(prev => ({ ...prev, [`${eid}-${day}`]: type }));
    try {
      await saveS(newSched);
      await setDoc(doc(db, "schedules", wk), { [`absences.${eid}-${day}`]: type }, { merge: true });
      const emp = ge(eid);
      if (emp && type !== "doctor" && type !== "training") {
        const field = type === "sick" ? "sickUsed" : type === "vacation" ? "vacationUsed" : type === "whatever" ? "whateverUsed" : null;
        if (field) await updateDoc(doc(db, "users", eid), { [field]: (emp[field] || 0) + 1 });
      }
      const al = ABS.find(a => a.id === type)?.label;
      notify(`${emp?.name}: ${al}`); log(`${emp?.name}: ${al} ${day}`); eN(emp, `${al} (${day})`);
    } catch (err) { console.error('addAbs:', err); notify('Chyba při ukládání'); }
  };

  const addEv = async (day, et, note) => { await setDoc(doc(db, "schedules", wk), { [`events.${day}`]: { type: et, note, title: EVTS.find(e => e.id === et)?.label } }, { merge: true }); notify("Událost přidána"); };
  const mkSwap = async (rid, day, sh) => { await addDoc(collection(db, "swapRequests"), { rid, day, sh, week: wk, status: "open", created: new Date().toISOString() }); notify("Žádost odeslána"); };

  // === SWAP (optimistic, same-day) ===
  const doSwap = async (swId, aid) => {
    const sw = swaps.find(s => s.id === swId); if (!sw) return;
    const newSched = dc(cs);
    let aidShift = null;
    SHIFTS.forEach(sh => { if (!aidShift && newSched[sw.day]?.[sh]?.some(e => e.empId === aid)) aidShift = sh; });
    const reqEntry = newSched[sw.day]?.[sw.sh]?.find(e => e.empId === sw.rid);
    if (reqEntry && aidShift) {
      const aidEntry = newSched[sw.day][aidShift].find(e => e.empId === aid);
      newSched[sw.day][sw.sh] = newSched[sw.day][sw.sh].filter(e => e.empId !== sw.rid);
      newSched[sw.day][aidShift] = newSched[sw.day][aidShift].filter(e => e.empId !== aid);
      newSched[sw.day][sw.sh].push({ ...aidEntry, empId: aid, isDefault: false });
      newSched[sw.day][aidShift].push({ ...reqEntry, empId: sw.rid, isDefault: false });
    } else if (reqEntry) {
      newSched[sw.day][sw.sh] = newSched[sw.day][sw.sh].filter(e => e.empId !== sw.rid);
      newSched[sw.day][sw.sh].push({ empId: aid, ho: false, isDefault: false });
    }
    setSchedule(newSched);
    try {
      await updateDoc(doc(db, 'swapRequests', swId), { status: 'done', aid, resolvedAt: new Date().toISOString() });
      await saveS(newSched);
      notify('Výměna provedena'); log('Swap done');
    } catch (err) { console.error('doSwap:', err); notify('Chyba při výměně'); }
  };

  const delUser = async eid => { if (!confirm(`Smazat ${ge(eid)?.name}?`)) return; await deleteDoc(doc(db, "users", eid)); notify("Smazán"); };
  const exportCSV = () => { let csv = "\ufeffDen,Směna,Jméno,Tým,HO\n"; DAYS.forEach(d => SHIFTS.forEach(sh => (cs[d]?.[sh] || []).forEach(en => { const e = ge(en.empId); if (e) csv += `${d},${sh},${e.name},${e.team},${en.ho ? "Ano" : "Ne"}\n`; }))); const b = new Blob([csv], { type: "text/csv;charset=utf-8;" }); const u = URL.createObjectURL(b); Object.assign(document.createElement("a"), { href: u, download: `rozvrh_${wk}.csv` }).click(); URL.revokeObjectURL(u); };

  // === GUARDS ===
  if (authUser === undefined) return <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}><style>{CSS}</style><div style={{ color: "var(--tx3)", fontSize: 14, letterSpacing: 4, textTransform: "uppercase", fontFamily: "'Barlow Condensed',sans-serif", animation: "pulse 1.5s infinite" }}>SHIFTFLOW · LOADING</div></div>;
  if (!authUser) return <AuthScreen />;
  if (!profile) return <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--tx3)" }}><style>{CSS}</style>Načítání…</div>;
  if (!isA && !profile.setupDone) return <Setup profile={profile} onDone={() => setProfile(p => ({ ...p, setupDone: true }))} />;

  const openSw = swaps.filter(s => s.status === "open" && s.week === wk);
  const NAV = [{ id: "schedule", l: "Rozvrh", i: "📋" }, { id: "swaps", l: "Výměny", i: "🔄", b: openSw.length }, ...(isA ? [{ id: "people", l: "Tým", i: "👥" }] : []), { id: "stats", l: "Stats", i: "📊" }, { id: "log", l: "Log", i: "📜" }, ...(isA ? [{ id: "defaults", l: "Default", i: "📐" }, { id: "settings", l: "Config", i: "⚙️" }] : [])];
  const dayHoliday = weekHolidays[selectedDay];

  // === RENDER ===
  return <div style={{ minHeight: "100vh", background: "var(--bg)", fontFamily: "'Barlow',sans-serif", color: "var(--tx)", paddingBottom: 80, transition: "color .3s" }} data-theme={theme}>
    <style>{CSS}</style>
    <ParallaxBg />

    {/* TOASTS */}
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999, padding: "8px 12px" }}>{notifs.map(n => <div key={n.id} className="glass" style={{ padding: "14px 16px", fontSize: 15, color: "var(--acc2)", display: "flex", gap: 10, alignItems: "center", marginBottom: 6, animation: "slideToast .3s ease-out" }}><span style={{ flex: 1 }}>{n.msg}</span><span style={{ fontSize: 12, color: "var(--tx3)", fontFamily: "'IBM Plex Mono',monospace" }}>{n.time}</span></div>)}</div>

    {/* HEADER */}
    <header className="panel-glass" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "2px solid var(--brd-thick)" }}>
      <div style={{ fontSize: 18, fontWeight: 600, color: "var(--w)", letterSpacing: 3, fontFamily: "'Barlow Condensed',sans-serif" }}>SHIFTFLOW</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={() => setTheme(t => t === "light" ? "dark" : "light")} style={{ background: "none", border: "1px solid var(--brd2)", width: 40, height: 40, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--tx2)" }}>{theme === "light" ? "🌙" : "☀️"}</button>
        <span style={{ fontSize: 14, color: "var(--tx2)" }}>{profile.name}</span>
        <button onClick={() => signOut(auth)} style={{ background: "none", border: "1px solid var(--brd2)", color: "var(--tx3)", width: 40, height: 40, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>↪</button>
      </div>
    </header>

    <main style={{ padding: 16, maxWidth: 1440, margin: "0 auto" }}>
      <div key={viewKey.current} className="view-enter">

        {/* ══ SCHEDULE ══ */}
        {view === "schedule" && <div>
          {/* Week nav */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 16 }}>
            <button onClick={() => setWo(w => w - 1)} style={{ width: 44, height: 44, border: "1px solid var(--brd2)", background: "transparent", color: "var(--tx)", cursor: "pointer", fontSize: 18 }}>‹</button>
            <div style={{ textAlign: "center" }}><div style={{ fontSize: 18, fontWeight: 500, color: "var(--w)", fontFamily: "'IBM Plex Mono',monospace" }}>{fmtW(cw)}</div><div style={{ fontSize: 12, color: "var(--tx3)", textTransform: "uppercase", letterSpacing: 1 }}>{wo === 0 ? "Aktuální týden" : `${wo > 0 ? "+" : ""}${wo}`}</div></div>
            <button onClick={() => setWo(w => w + 1)} style={{ width: 44, height: 44, border: "1px solid var(--brd2)", background: "transparent", color: "var(--tx)", cursor: "pointer", fontSize: 18 }}>›</button>
            {wo !== 0 && <Btn small ghost onClick={() => setWo(0)}>Dnes</Btn>}
          </div>

          {/* Team filter + actions */}
          <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}>
            {[{ k: "all", l: "Vše" }, { k: "L1", l: "L1" }, { k: "SD", l: "SD" }].map(f => <Btn key={f.k} small={tf !== f.k} warm={tf === f.k} onClick={() => setTf(f.k)}>{f.l}</Btn>)}
            <div style={{ flex: 1 }} />
            {isA && <Btn small onClick={() => setModal("absence")}>+ Nepřít.</Btn>}
            {isA && <Btn small onClick={() => setModal("event")}>+ Event</Btn>}
            {!isA && <Btn small onClick={() => setModal("myabsence")}>Nepřít.</Btn>}
            <Btn small ghost onClick={exportCSV}>CSV</Btn>
          </div>

          {/* Mobile: day pills */}
          {isMobile && <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 3, marginBottom: 16 }}>
            {DAYS.map((d, i) => { const isToday = isCurrentWeekDay(i, wo); const isHol = !!weekHolidays[i]; return <button key={d} className={isToday && selectedDay === i ? 'today-pill' : ''} onClick={() => goToDay(i)} style={{ padding: "10px 0", border: `1px solid ${selectedDay === i ? "var(--acc-brd)" : "var(--brd)"}`, background: selectedDay === i ? "var(--acc-dim)" : "transparent", color: selectedDay === i ? "var(--acc2)" : "var(--tx3)", cursor: "pointer", fontFamily: "'Barlow Condensed',sans-serif", fontSize: 14, fontWeight: 600, textTransform: "uppercase", opacity: isHol ? .65 : 1, textAlign: "center", minHeight: 48 }}>{d}{isToday && <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--acc2)", display: "block", margin: "2px auto 0" }} />}{isHol && <span style={{ fontSize: 7, color: "var(--acc2)", display: "block" }}>svátek</span>}</button>; })}
          </div>}

          {/* Today/holiday banners */}
          {isMobile && isCurrentWeekDay(selectedDay, wo) && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", border: "1px solid var(--acc-brd)", background: "var(--acc-dim)", marginBottom: 12 }}><div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--acc2)" }} /><span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 12, color: "var(--acc2)", textTransform: "uppercase", letterSpacing: 1.5 }}>Dnes</span></div>}
          {dayHoliday && isMobile && <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", border: "1px solid var(--acc-brd)", background: "var(--acc-dim)", marginBottom: 12 }}><span style={{ fontSize: 16 }}>🎉</span><span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, color: "var(--acc2)", textTransform: "uppercase", letterSpacing: 1, fontSize: 14 }}>{dayHoliday} — pracovní volno</span></div>}

          {/* ── MOBILE: day-by-day view ── */}
          {isMobile ? <div key={`${selectedDay}-${wo}`} className={slideDir === 'right' ? 'slide-r' : 'slide-l'}>
            {!dayHoliday && SHIFTS.map(shift => { const entries = (cs[DAYS[selectedDay]]?.[shift] || []).filter(e => { const emp = ge(e.empId); return emp && (tf === "all" || emp.team === tf); }); return <div key={shift} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}><span style={{ fontFamily: "'IBM Plex Mono',monospace", color: "var(--acc2)", fontSize: 15 }}>{shift}</span><div style={{ flex: 1, height: 1, background: "var(--brd)" }} /></div>
              <div className="glass" style={{ padding: 0 }}>
                {entries.map((en, i) => { const emp = ge(en.empId); const tc = emp?.team === "L1" ? "var(--l1)" : "var(--sd)"; return <div key={en.empId} className="ent" onClick={() => isA ? setSelCell({ day: DAYS[selectedDay], shift, empId: en.empId }) : profile.id === en.empId && setModal({ type: "myshift", day: DAYS[selectedDay], shift })} style={{ gap: 10, padding: "12px 14px", borderBottom: i < entries.length - 1 ? "1px solid var(--brd)" : "none" }}><div style={{ width: 3, height: 24, background: tc }} /><span style={{ fontWeight: 500, color: "var(--w)", flex: 1 }}>{emp?.name}</span>{en.ho && <Badge small color="var(--grn)">HO</Badge>}</div>; })}
                {entries.length === 0 && <div style={{ padding: "12px 14px", color: "var(--tx3)", fontSize: 13 }}>prázdná směna</div>}
              </div>
            </div>; })}
            {/* Absence for this day */}
            {(() => { const da = Object.entries(absences).filter(([k]) => k.endsWith(`-${DAYS[selectedDay]}`)).map(([k, t]) => ({ empId: k.replace(`-${DAYS[selectedDay]}`, ""), type: t })).filter(a => ge(a.empId)); if (!da.length) return null; return <div style={{ marginTop: 8 }}><div style={{ fontSize: 12, color: "var(--tx3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Nepřítomní</div>{da.map(a => { const e = ge(a.empId); const at = ABS.find(t => t.id === a.type); return <div key={a.empId} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", marginBottom: 4, border: `1px solid ${at?.color}`, fontSize: 14, minHeight: 44 }}><span>{at?.icon}</span><span style={{ fontWeight: 500 }}>{e?.name}</span></div>; })}</div>; })()}
          </div>

            /* ── DESKTOP: table view ── */
            : <div className="glass" style={{ overflow: "hidden", padding: 0 }}>
              <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                <table style={{ width: "100%", minWidth: 700, borderCollapse: "collapse" }}>
                  <thead><tr>
                    <th style={{ position: "sticky", left: 0, zIndex: 10, background: "var(--panel)", backdropFilter: "var(--blur)", padding: "10px 8px", borderBottom: "2px solid var(--brd-thick)", borderRight: "2px solid var(--brd-thick)", width: 64, fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: "var(--tx3)" }}>⏱</th>
                    {DAYS.map((d, i) => { const ev = events[d]; const hol = weekHolidays[i]; const isToday = isCurrentWeekDay(i, wo); return <th key={d} style={{ padding: "10px 6px", borderBottom: isToday ? "3px solid var(--acc2)" : "2px solid var(--brd-thick)", borderLeft: "2px solid var(--brd-thick)", background: isToday ? "var(--acc-dim)" : hol ? "var(--sd-dim)" : "var(--bg3)", textAlign: "center", minWidth: 115, opacity: hol ? .6 : 1 }}><div style={{ fontSize: 15, fontWeight: 600, color: isToday ? "var(--acc2)" : "var(--w)", fontFamily: "'Barlow Condensed',sans-serif" }}>{DAYS_F[i]}</div>{hol && <Badge small color="var(--grn)">🎉 {hol}</Badge>}{ev && !hol && <Badge small color="var(--acc2)">{EVTS.find(e => e.id === ev.type)?.icon} {ev.note || ev.title}</Badge>}</th>; })}
                  </tr></thead>
                  <tbody>
                    {SHIFTS.map(shift => <tr key={shift}>
                      <td style={{ position: "sticky", left: 0, zIndex: 10, background: "var(--panel)", backdropFilter: "var(--blur)", padding: "8px 6px", borderBottom: "2px solid var(--brd-thick)", borderRight: "2px solid var(--brd-thick)", textAlign: "center", fontFamily: "'IBM Plex Mono',monospace", fontSize: 17, fontWeight: 500, color: "var(--acc2)" }}>{shift}</td>
                      {DAYS.map((day, di) => { const entries = (cs[day]?.[shift] || []).filter(e => { const emp = ge(e.empId); return emp && (tf === "all" || emp.team === tf); }); const hol = !!weekHolidays[di]; const isToday = isCurrentWeekDay(di, wo);
                        return <td key={`${day}-${shift}`} style={{ padding: 4, borderBottom: "2px solid var(--brd-thick)", borderLeft: "2px solid var(--brd-thick)", verticalAlign: "top", background: isToday ? "var(--acc-dim)" : hol ? "var(--sd-dim)" : "var(--bg3)", opacity: hol ? .5 : 1 }}
                          onDragOver={e => { if (isA && !hol) { e.preventDefault(); e.currentTarget.style.background = "var(--bg4)"; } }} onDragLeave={e => { e.currentTarget.style.background = ""; }} onDrop={e => { e.currentTarget.style.background = ""; if (!isA || hol) return; try { const d = JSON.parse(e.dataTransfer.getData("text/plain")); if (d.day !== day || d.shift !== shift) moveE(d.empId, d.day, d.shift, day, shift); } catch { } }}>
                          {hol && entries.length === 0 && <div style={{ padding: "6px", fontSize: 11, color: "var(--grn)", textAlign: "center" }}>svátek</div>}
                          {entries.map(en => { const emp = ge(en.empId); if (!emp) return null; const ch = (() => { const df = ds[day]?.[shift]?.find(e => e.empId === en.empId); const cu = cs[day]?.[shift]?.find(e => e.empId === en.empId); return (!df && !!cu) || (!!df && !cu) || (!!df && !!cu && df.ho !== cu.ho); })(); const tc = emp.team === "L1" ? "var(--l1)" : "var(--sd)";
                            return <div key={en.empId} className={`ent ${ch ? "chg" : ""}`} draggable={isA} onDragStart={e => isA && e.dataTransfer.setData("text/plain", JSON.stringify({ empId: en.empId, day, shift }))} onClick={() => isA ? setSelCell({ day, shift, empId: en.empId }) : profile.id === en.empId && setModal({ type: "myshift", day, shift })} style={{ gap: 6, padding: "6px 10px", marginBottom: 2, background: "var(--bg3)", border: "1px solid var(--brd)", fontSize: 14, transition: "all .2s" }}><span style={{ width: 8, height: 3, background: tc, flexShrink: 0 }} /><span style={{ fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--w)" }}>{emp.name?.split(" ").pop()}</span>{en.ho && <Badge small color="var(--grn)">HO</Badge>}</div>; })}
                        </td>; })}
                    </tr>)}
                    <tr><td style={{ position: "sticky", left: 0, zIndex: 10, background: "var(--panel)", padding: 8, borderRight: "2px solid var(--brd-thick)", fontSize: 12, color: "var(--tx3)", textAlign: "center", fontWeight: 500 }}>N/A</td>
                      {DAYS.map((day, di) => { const da = Object.entries(absences).filter(([k]) => k.endsWith(`-${day}`)).map(([k, t]) => ({ empId: k.replace(`-${day}`, ""), type: t })).filter(a => { const e = ge(a.empId); return e && (tf === "all" || e.team === tf); }); const isToday = isCurrentWeekDay(di, wo);
                        return <td key={`a-${day}`} style={{ padding: 4, borderLeft: "2px solid var(--brd-thick)", borderTop: "2px solid var(--brd-thick)", background: isToday ? "var(--acc-dim)" : "transparent" }}>{da.map(a => { const e = ge(a.empId); const at = ABS.find(t => t.id === a.type); return e && <div key={a.empId} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 8px", marginBottom: 2, border: `1px solid ${at?.color}`, fontSize: 13, minHeight: 36, background: "var(--bg3)" }}><span>{at?.icon}</span><span style={{ fontWeight: 500 }}>{e.name?.split(" ").pop()}</span></div>; })}</td>; })}</tr>
                  </tbody>
                </table>
              </div>
            </div>}
        </div>}

        {/* ══ SWAPS ══ */}
        {view === "swaps" && <div>
          <div style={{ fontSize: 20, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2, marginBottom: 20, borderBottom: "1px solid var(--brd)", paddingBottom: 12 }}>Výměny směn</div>
          {!isA && <Card style={{ marginBottom: 20 }}><p style={{ fontSize: 15, color: "var(--tx2)", marginBottom: 12 }}>Požádej o výměnu — kdokoliv může přijmout.</p><Btn warm onClick={() => setModal({ type: "swap", day: DAYS[0], shift: SHIFTS[0] })}>+ Nová žádost</Btn></Card>}
          {openSw.map(sw => { const re = ge(sw.rid); const me = profile.id === sw.rid; const can = !isA && !me; return <Card key={sw.id} style={{ padding: 16, marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}><div><div style={{ fontWeight: 600, fontSize: 17, color: "var(--w)" }}>{re?.name || "?"}</div><Badge small color="var(--acc2)">{sw.day} {sw.sh}</Badge></div>{can && <Btn warm small onClick={() => doSwap(sw.id, profile.id)}>Přijmout</Btn>}{me && <Badge color="var(--amb)">Tvoje</Badge>}</Card>; })}
          {!openSw.length && <p style={{ color: "var(--tx3)", fontSize: 15 }}>Žádné žádosti.</p>}
        </div>}

        {/* ══ PEOPLE (admin only) ══ */}
        {view === "people" && isA && <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, borderBottom: "1px solid var(--brd)", paddingBottom: 12 }}>
            <div style={{ fontSize: 20, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2 }}>Tým</div>
            <Btn warm onClick={() => setModal("addMember")}>+ Přidat</Btn>
          </div>
          {["L1", "SD"].map(team => <div key={team} style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: team === "L1" ? "var(--l1)" : "var(--sd)", marginBottom: 12, fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 1.5 }}>{TEAMS[team]}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 12 }}>
              {employees.filter(e => e.team === team && e.role !== "admin").map(emp => <Card key={emp.id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                  <div><div style={{ fontWeight: 600, fontSize: 17, color: "var(--w)" }}>{emp.name}</div><div style={{ display: "flex", gap: 6, marginTop: 6 }}><Badge small color={team === "L1" ? "var(--l1)" : "var(--sd)"}>{team}</Badge></div></div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => setModal({ type: "editDays", emp })} style={{ background: "none", border: "1px solid var(--brd2)", color: "var(--tx3)", cursor: "pointer", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>✏️</button>
                    <button onClick={() => delUser(emp.id)} style={{ background: "none", border: "1px solid rgba(192,48,48,.3)", color: "var(--red)", cursor: "pointer", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                  </div>
                </div>
                <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  {[{ l: "Dovolená", v: (emp.vacationTotal || 20) - (emp.vacationUsed || 0), t: emp.vacationTotal || 20, c: "var(--sd)" }, { l: "Sick", v: (emp.sickTotal || 5) - (emp.sickUsed || 0), t: emp.sickTotal || 5, c: "var(--red)" }, { l: "Whatever", v: (emp.whateverTotal || 3) - (emp.whateverUsed || 0), t: emp.whateverTotal || 3, c: "var(--amb)" }].map(b => <div key={b.l} style={{ textAlign: "center", padding: 10, border: "1px solid var(--brd)", background: "var(--bg3)" }}><div style={{ fontSize: 24, fontWeight: 600, color: b.c, fontFamily: "'IBM Plex Mono',monospace" }}>{b.v}</div><div style={{ fontSize: 11, color: "var(--tx3)", textTransform: "uppercase" }}>{b.l}</div></div>)}
                </div>
              </Card>)}
            </div>
          </div>)}
        </div>}

        {/* ══ STATS ══ */}
        {view === "stats" && <div>
          <div style={{ fontSize: 20, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2, marginBottom: 20, borderBottom: "1px solid var(--brd)", paddingBottom: 12 }}>Status</div>
          {/* Employee: own balance */}
          {!isA && <Card style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase" }}>Moje dny</div>
              <button onClick={() => setModal({ type: "editDays", emp: profile })} style={{ background: "none", border: "1px solid var(--brd2)", color: "var(--tx3)", cursor: "pointer", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center" }}>✏️</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              {[{ l: "Dovolená", v: (profile.vacationTotal || 20) - (profile.vacationUsed || 0), t: profile.vacationTotal || 20, c: "var(--sd)" }, { l: "Sick", v: (profile.sickTotal || 5) - (profile.sickUsed || 0), t: profile.sickTotal || 5, c: "var(--red)" }, { l: "Whatever", v: (profile.whateverTotal || 3) - (profile.whateverUsed || 0), t: profile.whateverTotal || 3, c: "var(--amb)" }].map(b => <div key={b.l} style={{ textAlign: "center", padding: 12, border: "1px solid var(--brd)", background: "var(--bg3)" }}><div style={{ fontSize: 28, fontWeight: 600, color: b.c, fontFamily: "'IBM Plex Mono',monospace" }}>{b.v}</div><div style={{ fontSize: 11, color: "var(--tx3)", textTransform: "uppercase" }}>{b.l}</div><div style={{ fontSize: 10, color: "var(--tx3)" }}>z {b.t}</div></div>)}
            </div>
          </Card>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 12, marginBottom: 24 }}>
            {[{ l: "Crew", v: employees.filter(e => e.role !== "admin").length, c: "var(--l1)" }, { l: "Active", v: employees.filter(e => e.setupDone).length, c: "var(--sd)" }, { l: "HO", v: Object.values(cs).flatMap(d => Object.values(d).flat()).filter(e => e.ho).length, c: "var(--grn)" }, { l: "Swaps", v: openSw.length, c: "var(--amb)" }].map(s => <Card key={s.l}><div style={{ fontSize: 32, fontWeight: 600, color: s.c, fontFamily: "'IBM Plex Mono',monospace" }}>{s.v}</div><div style={{ fontSize: 12, color: "var(--tx3)", textTransform: "uppercase", letterSpacing: 1, marginTop: 4 }}>{s.l}</div></Card>)}
          </div>
        </div>}

        {/* ══ LOG ══ */}
        {view === "log" && <div><div style={{ fontSize: 20, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2, marginBottom: 20, borderBottom: "1px solid var(--brd)", paddingBottom: 12 }}>Log</div>{logs.map(h => <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: "1px solid var(--brd)", fontSize: 14 }}><span style={{ fontSize: 12, color: "var(--tx3)", fontFamily: "'IBM Plex Mono',monospace", minWidth: 130 }}>{h.time ? new Date(h.time).toLocaleString("cs") : ""}</span><span style={{ flex: 1 }}>{h.msg}</span></div>)}</div>}

        {view === "defaults" && isA && <div><div style={{ fontSize: 20, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2, marginBottom: 20, borderBottom: "1px solid var(--brd)", paddingBottom: 12 }}>Stálý rozvrh</div><DefEditor employees={employees} /></div>}

        {view === "settings" && isA && <div style={{ maxWidth: 560 }}>
          <div style={{ fontSize: 20, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2, marginBottom: 20, borderBottom: "1px solid var(--brd)", paddingBottom: 12 }}>Konfigurace</div>
          <Card style={{ marginBottom: 16 }}><Input label="L1 Max/směna" type="number" value={rules.L1_max} onChange={e => setRules(r => ({ ...r, L1_max: +e.target.value }))} /><Input label="SD Max na 8:00" type="number" value={rules.SD_max8} onChange={e => setRules(r => ({ ...r, SD_max8: +e.target.value }))} /><Input label="SD Max HO/den" type="number" value={rules.SD_maxHO} onChange={e => setRules(r => ({ ...r, SD_maxHO: +e.target.value }))} /><Toggle checked={rules.SD_noHO8} onChange={v => setRules(r => ({ ...r, SD_noHO8: v }))} label="Zákaz HO 08:00" /><Toggle checked={rules.SD_noHO10} onChange={v => setRules(r => ({ ...r, SD_noHO10: v }))} label="Zákaz HO 10:00" /><Btn warm onClick={async () => { await setDoc(doc(db, "rules", "global"), rules); notify("Uloženo"); }}>Uložit</Btn></Card>
          <Card><div style={{ display: "flex", gap: 8 }}><Btn danger onClick={async () => { await deleteDoc(doc(db, "schedules", wk)); notify("Reset"); }}>Reset týden</Btn><Btn ghost onClick={exportCSV}>Export CSV</Btn></div></Card>
        </div>}
      </div>
    </main>

    {/* PILL NAV */}
    <PillNav view={view} setView={switchView} NAV={NAV} />

    {/* MODALS */}
    <Modal open={!!selCell} onClose={() => setSelCell(null)} title="Akce">{selCell && (() => { const emp = ge(selCell.empId); if (!emp) return null; return <div>
      <div style={{ padding: 14, background: "var(--bg3)", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}><div style={{ width: 40, height: 40, background: emp.team === "L1" ? "var(--l1)" : "var(--sd)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 600, color: "#fff" }}>{(emp.name || "?").charAt(0)}</div><div><div style={{ fontWeight: 600, fontSize: 17, color: "var(--w)" }}>{emp.name}</div><div style={{ fontSize: 14, color: "var(--tx2)" }}>{selCell.day} · {selCell.shift}</div></div></div>
      <Btn onClick={() => { togHO(selCell.day, selCell.shift, selCell.empId); setSelCell(null); }} style={{ width: "100%", marginBottom: 8 }}>Toggle HO</Btn>
      <div style={{ fontSize: 12, color: "var(--tx3)", margin: "14px 0 6px", textTransform: "uppercase", letterSpacing: 1 }}>Přesunout</div>
      <div style={{ display: "flex", gap: 8 }}>{SHIFTS.filter(s => s !== selCell.shift).map(s => <Btn key={s} small style={{ flex: 1 }} onClick={() => { moveE(selCell.empId, selCell.day, selCell.shift, selCell.day, s); setSelCell(null); }}>→ {s}</Btn>)}</div>
      <div style={{ fontSize: 12, color: "var(--tx3)", margin: "14px 0 6px", textTransform: "uppercase", letterSpacing: 1 }}>Nepřítomnost</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>{ABS.map(a => <Btn key={a.id} small onClick={() => { addAbs(selCell.empId, selCell.day, a.id); setSelCell(null); }}>{a.icon} {a.label}</Btn>)}</div>
    </div>; })()}</Modal>

    <Modal open={modal === "absence"} onClose={() => setModal(null)} title="Nepřítomnost"><AbsF emps={employees.filter(e => e.role !== "admin" && (tf === "all" || e.team === tf))} onSubmit={(e, d, t) => { addAbs(e, d, t); setModal(null); }} /></Modal>
    <Modal open={modal === "event"} onClose={() => setModal(null)} title="Událost"><EvF onSubmit={(d, t, n) => { addEv(d, t, n); setModal(null); }} /></Modal>
    <Modal open={modal?.type === "swap"} onClose={() => setModal(null)} title="Výměna"><SwF dDay={modal?.day} dShift={modal?.shift} onSubmit={(d, s) => { mkSwap(profile.id, d, s); setModal(null); }} /></Modal>
    <Modal open={modal?.type === "myshift"} onClose={() => setModal(null)} title="Moje směna"><div>
      <p style={{ fontSize: 15, color: "var(--tx2)", marginBottom: 16 }}>{modal?.day} · {modal?.shift}</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>{ABS.map(a => <Btn key={a.id} onClick={() => { addAbs(profile.id, modal.day, a.id); setModal(null); }}>{a.icon} {a.label}</Btn>)}</div>
      <Btn warm onClick={() => setModal({ type: "swap", day: modal?.day, shift: modal?.shift })} style={{ width: "100%" }}>Požádat o výměnu</Btn>
    </div></Modal>
    <Modal open={modal === "myabsence"} onClose={() => setModal(null)} title="Moje nepřítomnost"><MyAbsF profile={profile} onSubmit={(d, t) => { addAbs(profile.id, d, t); setModal(null); }} /></Modal>
    <Modal open={modal === "addMember"} onClose={() => setModal(null)} title="Nový člen"><AddF onDone={m => { notify(m); log(m); setModal(null); }} /></Modal>
    <Modal open={modal?.type === "editDays"} onClose={() => setModal(null)} title="Upravit dny"><EditDF emp={modal?.emp} onDone={() => { notify("Uloženo"); setModal(null); }} /></Modal>
  </div>;
}
