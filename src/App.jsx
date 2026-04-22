import { useState, useEffect, useMemo } from "react";
import { auth, db, getMsg } from "./firebase";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, onSnapshot } from "firebase/firestore";
import { getToken, onMessage } from "firebase/messaging";

// ─── CONSTANTS ────────────────────────
const TEAMS = { L1: "L1 Support", SD: "Service Desk" };
const SHIFTS = ["08:00", "09:00", "10:00"];
const DAYS = ["Po", "Út", "St", "Čt", "Pá"];
const DAYS_FULL = ["Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek"];
const ABSENCE_TYPES = [
  { id: "sick", label: "Sick Day", icon: "🤒", color: "#ef4444" },
  { id: "doctor", label: "Lékař", icon: "🏥", color: "#f0a030" },
  { id: "vacation", label: "Dovolená", icon: "🏖️", color: "#00d4ff" },
  { id: "whatever", label: "Whatever Day", icon: "☕", color: "#a78bfa" },
];
const EVENT_TYPES = [
  { id: "training", label: "Školení", icon: "📚" }, { id: "dinner", label: "Večeře", icon: "🍽️" },
  { id: "teambuilding", label: "Teambuilding", icon: "🎯" }, { id: "meeting", label: "Porada", icon: "💬" }, { id: "other", label: "Jiné", icon: "📌" },
];
const ADMIN_EMAIL = "admin@shiftflow.app";
const ADMIN_FB_PASS = "ShiftFlowAdmin2026!";

// ─── HELPERS ──────────────────────────
const dc = o => JSON.parse(JSON.stringify(o));
const uid = () => "u" + Math.random().toString(36).slice(2, 9);
function getMonday(d) { const dt = new Date(d); const day = dt.getDay(); dt.setDate(dt.getDate() - day + (day === 0 ? -6 : 1)); dt.setHours(0,0,0,0); return dt; }
const weekKey = d => { const m = getMonday(d); return m.toISOString().slice(0,10); };
const fmtWeek = d => { const m = getMonday(d), f = new Date(m); f.setDate(f.getDate()+4); return `${m.getDate()}.${m.getMonth()+1}. – ${f.getDate()}.${f.getMonth()+1}.${f.getFullYear()}`; };

function buildFromDefaults(emps) {
  const s = {}; DAYS.forEach(day => { s[day] = {}; SHIFTS.forEach(sh => s[day][sh] = []);
    emps.forEach(emp => { if (!emp.defaultSchedule || !emp.setupDone) return; const shift = emp.defaultSchedule[day];
      if (shift && SHIFTS.includes(shift)) s[day][shift].push({ empId: emp.id, ho: emp.defaultSchedule[`${day}_ho`] || false, isDefault: true });
    });
  }); return s;
}

const GAS_URL = import.meta.env.VITE_GAS_URL;
async function callGAS(action, data) { if (!GAS_URL) return null; try { const r = await fetch(GAS_URL, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ action, data }) }); return r.json(); } catch { return null; } }
async function setupPush(userId) { try { const messaging = await getMsg(); if (!messaging) return; const permission = await Notification.requestPermission(); if (permission !== "granted") return; const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY; if (!vapidKey) return; const token = await getToken(messaging, { vapidKey }); await updateDoc(doc(db, "users", userId), { fcmToken: token }); onMessage(messaging, payload => { const n = payload.notification; if (n) new Notification(n.title || "ShiftFlow", { body: n.body, icon: "/icon-192.png" }); }); } catch (e) { console.warn("Push:", e); } }

// ═══════ GLOBAL STYLES ═══════
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Share+Tech+Mono&display=swap');
:root {
  --bg-deep: #05060f;
  --bg-panel: #0b0d1a;
  --bg-card: #0f1225;
  --bg-hover: #151935;
  --border: #1a2040;
  --border-glow: #00d4ff25;
  --cyan: #00d4ff;
  --cyan-dim: #00d4ff80;
  --teal: #0ef6cc;
  --amber: #f0a030;
  --red: #ff4060;
  --text: #d0d8f0;
  --text-dim: #5a6080;
  --text-bright: #eef0ff;
  --l1: #6366f1;
  --sd: #00d4ff;
}
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
body { background: var(--bg-deep); }
@keyframes fadeIn { from{opacity:0} to{opacity:1} }
@keyframes slideUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
@keyframes glow { 0%,100%{box-shadow:0 0 4px var(--cyan-dim)} 50%{box-shadow:0 0 16px var(--cyan-dim)} }
@keyframes slideIn { from{transform:translateX(100px);opacity:0} to{transform:translateX(0);opacity:1} }
@keyframes scanline { 0%{background-position:0 0} 100%{background-position:0 4px} }
::-webkit-scrollbar { width:6px; height:6px; }
::-webkit-scrollbar-track { background:transparent; }
::-webkit-scrollbar-thumb { background:var(--border); border-radius:3px; }
.chg { animation: glow 2.5s infinite; }
.tst { animation: slideIn .35s ease-out; }
.ent { transition: all .2s; cursor: pointer; min-height: 44px; display: flex; align-items: center; }
.ent:hover, .ent:active { background: var(--bg-hover)!important; transform: scale(1.02); }
.nb { transition: all .15s; min-height: 44px; }
.nb:hover, .nb:active { background: var(--bg-hover)!important; }
`;

// ═══════ UI COMPONENTS (Starfield theme) ═══════
const Badge = ({ children, color="var(--cyan)", small, style: sx }) => (
  <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding: small?"2px 8px":"4px 12px",
    borderRadius:2, fontSize: small?11:13, fontWeight:600, fontFamily:"'Rajdhani',sans-serif",
    background: `${color}15`, color, border:`1px solid ${color}40`,
    textTransform:"uppercase", letterSpacing:0.5, whiteSpace:"nowrap", ...sx }}>{children}</span>
);

const Pill = ({ active, onClick, children, color, count }) => (
  <button onClick={onClick} style={{ padding:"10px 18px", borderRadius:2, border:`1px solid ${active?(color||"var(--cyan)"):"var(--border)"}`,
    background: active?`${color||"var(--cyan)"}18`:"transparent", color: active?(color||"var(--cyan)"):"var(--text-dim)",
    fontSize:14, fontWeight:600, fontFamily:"'Rajdhani',sans-serif", cursor:"pointer", transition:"all .2s",
    display:"flex", alignItems:"center", gap:8, textTransform:"uppercase", letterSpacing:0.5, minHeight:44 }}>
    {children}{count!==undefined&&<span style={{ background:active?`${color||"var(--cyan)"}30`:"var(--bg-card)", borderRadius:2, padding:"1px 8px", fontSize:12, fontWeight:700 }}>{count}</span>}
  </button>
);

const Card = ({ children, style: sx, glow }) => (
  <div style={{ background:"var(--bg-card)", borderRadius:4, border:`1px solid ${glow?glow+"40":"var(--border)"}`,
    padding:20, boxShadow: glow?`0 0 20px ${glow}10, inset 0 1px 0 ${glow}15`:"none", ...sx }}>{children}</div>
);

const Btn = ({ children, onClick, primary, danger, small, ghost, disabled, style: sx }) => (
  <button disabled={disabled} onClick={onClick} style={{ padding: small?"8px 14px":"12px 22px", borderRadius:2,
    border: ghost?`1px solid var(--border)`:`1px solid ${danger?"var(--red)":primary?"var(--cyan)":"var(--border)"}`,
    fontWeight:600, cursor: disabled?"not-allowed":"pointer", fontSize: small?13:15,
    fontFamily:"'Rajdhani',sans-serif", textTransform:"uppercase", letterSpacing:0.5,
    background: danger?"var(--red)15":primary?"var(--cyan)15":ghost?"transparent":"var(--bg-card)",
    color: danger?"var(--red)":primary?"var(--cyan)":"var(--text)", opacity: disabled?0.3:1,
    transition:"all .15s", minHeight:44, ...sx }}>{children}</button>
);

const Input = ({ label, ...p }) => (
  <div style={{ marginBottom:16 }}>
    {label&&<label style={{ fontSize:13, color:"var(--text-dim)", display:"block", marginBottom:6, fontFamily:"'Rajdhani',sans-serif", textTransform:"uppercase", letterSpacing:0.5 }}>{label}</label>}
    <input {...p} style={{ width:"100%", padding:"12px 14px", borderRadius:2, border:"1px solid var(--border)", background:"var(--bg-deep)", color:"var(--text-bright)", fontSize:16, fontFamily:"'Rajdhani',sans-serif", outline:"none", boxSizing:"border-box", minHeight:48, ...(p.style||{}) }} onFocus={e=>{e.target.style.borderColor="var(--cyan)";e.target.style.boxShadow="0 0 8px var(--cyan-dim)";}} onBlur={e=>{e.target.style.borderColor="var(--border)";e.target.style.boxShadow="none";}} />
  </div>
);

const Select = ({ label, options, ...p }) => (
  <div style={{ marginBottom:16 }}>
    {label&&<label style={{ fontSize:13, color:"var(--text-dim)", display:"block", marginBottom:6, fontFamily:"'Rajdhani',sans-serif", textTransform:"uppercase", letterSpacing:0.5 }}>{label}</label>}
    <select {...p} style={{ width:"100%", padding:"12px 14px", borderRadius:2, border:"1px solid var(--border)", background:"var(--bg-deep)", color:"var(--text-bright)", fontSize:16, fontFamily:"'Rajdhani',sans-serif", outline:"none", minHeight:48 }}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>
  </div>
);

const Toggle = ({ checked, onChange, label }) => (
  <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer", fontSize:15, color:"var(--text)", marginBottom:12, fontFamily:"'Rajdhani',sans-serif", minHeight:44 }}>
    <div onClick={()=>onChange(!checked)} style={{ width:44, height:24, borderRadius:2, background: checked?"var(--cyan)20":"var(--bg-deep)", border:`1px solid ${checked?"var(--cyan)":"var(--border)"}`, position:"relative", transition:"all .2s", cursor:"pointer", flexShrink:0 }}>
      <div style={{ width:18, height:18, borderRadius:2, background: checked?"var(--cyan)":"var(--text-dim)", position:"absolute", top:2, left: checked?22:2, transition:"all .2s" }} />
    </div>{label}
  </label>
);

const Modal = ({ open, onClose, title, children }) => {
  if (!open) return null;
  return <div style={{ position:"fixed", inset:0, zIndex:1000, background:"rgba(5,6,15,0.85)", backdropFilter:"blur(12px)", display:"flex", alignItems:"flex-end", justifyContent:"center", animation:"fadeIn .2s" }} onClick={onClose}>
    <div onClick={e=>e.stopPropagation()} style={{ background:"var(--bg-panel)", borderRadius:"8px 8px 0 0", border:"1px solid var(--border)", borderBottom:"none", padding:"24px 20px 32px", width:"100%", maxWidth:520, maxHeight:"85vh", overflowY:"auto", animation:"slideUp .3s" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
        <h3 style={{ margin:0, fontSize:20, color:"var(--cyan)", fontFamily:"'Rajdhani',sans-serif", fontWeight:700, textTransform:"uppercase", letterSpacing:1 }}>{title}</h3>
        <button onClick={onClose} style={{ background:"none", border:"1px solid var(--border)", color:"var(--text-dim)", width:40, height:40, borderRadius:2, cursor:"pointer", fontSize:18, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
      </div>{children}
    </div>
  </div>;
};

// ═══════ SCHEDULE SETUP ═══════
function ScheduleSetup({ profile, onDone }) {
  const [sched, setSched] = useState(() => { const s = {}; DAYS.forEach(d => { s[d] = "09:00"; s[`${d}_ho`] = false; }); return s; });
  const [saving, setSaving] = useState(false);
  const save = async () => { setSaving(true); await updateDoc(doc(db, "users", profile.id), { defaultSchedule: sched, setupDone: true }); onDone(); };
  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"var(--bg-deep)", fontFamily:"'Rajdhani',sans-serif", padding:16 }}>
      <style>{CSS}</style>
      <div style={{ width:"100%", maxWidth:520, padding:"32px 24px", borderRadius:4, background:"var(--bg-panel)", border:"1px solid var(--border)", animation:"slideUp .4s" }}>
        <div style={{ textAlign:"center", marginBottom:28 }}>
          <div style={{ fontSize:48, marginBottom:8 }}>📅</div>
          <h2 style={{ fontSize:26, fontWeight:700, color:"var(--cyan)", margin:0, textTransform:"uppercase", letterSpacing:2 }}>Stálý rozvrh</h2>
          <p style={{ color:"var(--text-dim)", fontSize:15, marginTop:8 }}>Ahoj {profile.name}, vyber si směnu pro každý den.</p>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {DAYS.map((day, i) => (
            <div key={day} style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 14px", borderRadius:4, background:"var(--bg-card)", border:"1px solid var(--border)" }}>
              <span style={{ fontWeight:700, fontSize:16, minWidth:50, color:"var(--text-bright)" }}>{day}</span>
              <div style={{ display:"flex", gap:4, flex:1 }}>
                {SHIFTS.map(sh => <button key={sh} onClick={() => setSched(s => ({ ...s, [day]: sh }))} style={{ flex:1, padding:"10px 0", borderRadius:2, border:`1px solid ${sched[day]===sh?"var(--cyan)":"var(--border)"}`, fontSize:15, fontWeight:600, fontFamily:"'Share Tech Mono',monospace", cursor:"pointer", background:sched[day]===sh?"var(--cyan)15":"var(--bg-deep)", color:sched[day]===sh?"var(--cyan)":"var(--text-dim)", transition:"all .15s", minHeight:44 }}>{sh}</button>)}
              </div>
              <label style={{ display:"flex", alignItems:"center", gap:4, fontSize:13, color:"var(--text-dim)", cursor:"pointer" }}>
                <input type="checkbox" checked={sched[`${day}_ho`]||false} onChange={e => setSched(s => ({ ...s, [`${day}_ho`]: e.target.checked }))} style={{ accentColor:"var(--teal)", width:20, height:20 }} /> HO
              </label>
            </div>
          ))}
        </div>
        <Btn primary disabled={saving} onClick={save} style={{ width:"100%", marginTop:20, padding:"14px 0", fontSize:17 }}>{saving ? "Ukládám..." : "Potvrdit rozvrh"}</Btn>
      </div>
    </div>
  );
}

// ═══════ AUTH ═══════
function AuthScreen() {
  const [mode, setMode] = useState("login"); const [login, setLogin] = useState(""); const [pass, setPass] = useState("");
  const [err, setErr] = useState(""); const [loading, setLoading] = useState(false);
  const [rn, setRn] = useState(""); const [rEmail, setREmail] = useState(""); const [rp, setRp] = useState(""); const [rp2, setRp2] = useState("");
  const [rt, setRt] = useState("L1"); const [rNotify, setRNotify] = useState(false); const [rNotifEmail, setRNotifEmail] = useState("");
  const doLogin = async () => { setErr(""); setLoading(true); try { if (login==="Admin"&&pass==="0000") await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_FB_PASS); else await signInWithEmailAndPassword(auth, login, pass); } catch(e) { setErr(e.code==="auth/invalid-credential"?"Neplatné údaje":e.message); } setLoading(false); };
  const doReg = async () => { setErr(""); setLoading(true); try { if(!rn.trim()||!rEmail||!rp){setErr("Vyplňte povinná pole");setLoading(false);return;} if(rp!==rp2){setErr("Hesla se neshodují");setLoading(false);return;} if(rp.length<6){setErr("Heslo min. 6 znaků");setLoading(false);return;} if(rNotify&&!rNotifEmail.includes("@")){setErr("Zadejte platný email");setLoading(false);return;} const cred=await createUserWithEmailAndPassword(auth,rEmail,rp); await updateProfile(cred.user,{displayName:rn.trim()}); await setDoc(doc(db,"users",cred.user.uid),{name:rn.trim(),email:rEmail,team:rt,role:"employee",notify:rNotify,notifyEmail:rNotify?rNotifEmail:"",fcmToken:null,defaultSchedule:null,setupDone:false,vacationTotal:20,sickTotal:5,whateverTotal:3,vacationUsed:0,sickUsed:0,whateverUsed:0,createdAt:new Date().toISOString()}); } catch(e) { setErr(e.code==="auth/email-already-in-use"?"Email registrován":e.message); } setLoading(false); };
  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"var(--bg-deep)", fontFamily:"'Rajdhani',sans-serif", padding:16 }}>
      <style>{CSS}</style>
      <div style={{ width:"100%", maxWidth:440, padding:"36px 24px", borderRadius:4, background:"var(--bg-panel)", border:"1px solid var(--border)", animation:"slideUp .4s" }}>
        <div style={{ textAlign:"center", marginBottom:32 }}>
          <div style={{ fontSize:56, marginBottom:8, filter:"drop-shadow(0 0 24px rgba(0,212,255,0.4))" }}>📅</div>
          <h1 style={{ fontSize:32, fontWeight:700, color:"var(--text-bright)", margin:0, letterSpacing:3, textTransform:"uppercase" }}>ShiftFlow</h1>
          <div style={{ width:60, height:2, background:"var(--cyan)", margin:"8px auto 0" }} />
          <p style={{ color:"var(--text-dim)", fontSize:14, marginTop:10, letterSpacing:1 }}>SHIFT MANAGEMENT SYSTEM</p>
        </div>
        <div style={{ display:"flex", marginBottom:28, borderRadius:2, overflow:"hidden", border:"1px solid var(--border)" }}>
          {["login","register"].map(m=><button key={m} onClick={()=>{setMode(m);setErr("");}} style={{ flex:1, padding:"12px 0", border:"none", fontSize:15, fontWeight:600, fontFamily:"'Rajdhani',sans-serif", cursor:"pointer", background:mode===m?"var(--cyan)15":"var(--bg-deep)", color:mode===m?"var(--cyan)":"var(--text-dim)", textTransform:"uppercase", letterSpacing:1, minHeight:48 }}>{m==="login"?"Přihlášení":"Registrace"}</button>)}
        </div>
        {mode==="login"?<>
          <Input label="Email" value={login} onChange={e=>setLogin(e.target.value)} placeholder="vas@email.cz" />
          <Input label="Heslo" type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="••••••" onKeyDown={e=>e.key==="Enter"&&doLogin()} />
        </>:<>
          <Input label="Celé jméno" value={rn} onChange={e=>setRn(e.target.value)} placeholder="Jan Novák" />
          <Input label="Email" value={rEmail} onChange={e=>setREmail(e.target.value)} placeholder="vas@email.cz" />
          <Input label="Heslo (min. 6 znaků)" type="password" value={rp} onChange={e=>setRp(e.target.value)} />
          <Input label="Heslo znovu" type="password" value={rp2} onChange={e=>setRp2(e.target.value)} />
          <Select label="Tým" value={rt} onChange={e=>setRt(e.target.value)} options={[{value:"L1",label:"L1 Support"},{value:"SD",label:"Service Desk"}]} />
          <div style={{ background:"var(--bg-card)", borderRadius:4, padding:16, marginBottom:16, border:"1px solid var(--border)" }}>
            <Toggle checked={rNotify} onChange={setRNotify} label="Dostávat upozornění na změny" />
            {rNotify&&<Input label="Email pro notifikace" type="email" value={rNotifEmail} onChange={e=>setRNotifEmail(e.target.value)} placeholder="notifikace@email.cz" style={{ marginBottom:0 }} />}
          </div>
        </>}
        {err&&<p style={{ color:"var(--red)", fontSize:14, margin:"0 0 12px", padding:"10px 12px", borderRadius:2, background:"var(--red)10", border:"1px solid var(--red)30" }}>{err}</p>}
        <Btn primary disabled={loading} onClick={mode==="login"?doLogin:doReg} style={{ width:"100%", padding:"14px 0", fontSize:17 }}>{loading?"Načítání...":mode==="login"?"Přihlásit":"Zaregistrovat"}</Btn>
      </div>
    </div>
  );
}

// ═══════ ADMIN: DEFAULT SCHEDULE EDITOR ═══════
function DefaultScheduleEditor({ employees }) {
  const [editEmp, setEditEmp] = useState(null);
  const [editSched, setEditSched] = useState({});
  const [saving, setSaving] = useState(false);
  const startEdit = emp => { setEditEmp(emp); const s = {}; DAYS.forEach(d => { s[d] = emp.defaultSchedule?.[d] || "09:00"; s[`${d}_ho`] = emp.defaultSchedule?.[`${d}_ho`] || false; }); setEditSched(s); };
  const saveEdit = async () => { if(!editEmp)return; setSaving(true); await updateDoc(doc(db,"users",editEmp.id),{defaultSchedule:editSched,setupDone:true}); setSaving(false); setEditEmp(null); };
  const removeFrom = async id => { await updateDoc(doc(db,"users",id),{defaultSchedule:null,setupDone:false}); };
  return <div>
    {["L1","SD"].map(team => <div key={team} style={{ marginBottom:28 }}>
      <h4 style={{ fontSize:18, fontWeight:700, color:team==="L1"?"var(--l1)":"var(--sd)", marginBottom:12, fontFamily:"'Rajdhani',sans-serif", textTransform:"uppercase", letterSpacing:1 }}>{TEAMS[team]}</h4>
      <div style={{ overflowX:"auto", borderRadius:4, border:"1px solid var(--border)" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:14, fontFamily:"'Rajdhani',sans-serif" }}>
          <thead><tr style={{ background:"var(--bg-card)" }}>
            <th style={{ padding:"12px 14px", textAlign:"left", color:"var(--text-dim)", fontWeight:600, borderBottom:"1px solid var(--border)" }}>Zaměstnanec</th>
            {DAYS.map(d=><th key={d} style={{ padding:"12px 8px", textAlign:"center", color:"var(--text-dim)", fontWeight:600, borderBottom:"1px solid var(--border)" }}>{d}</th>)}
            <th style={{ padding:"12px", borderBottom:"1px solid var(--border)" }}></th>
          </tr></thead>
          <tbody>{employees.filter(e=>e.team===team&&e.role!=="admin").map(emp=><tr key={emp.id} style={{ borderBottom:"1px solid var(--border)" }}>
            <td style={{ padding:"12px 14px", fontWeight:600, color:"var(--text-bright)", fontSize:15 }}>{emp.name} {!emp.setupDone&&<Badge small color="var(--amber)">N/A</Badge>}</td>
            {DAYS.map(d=><td key={d} style={{ padding:"8px", textAlign:"center" }}>{emp.setupDone&&emp.defaultSchedule?.[d]?<span style={{ display:"inline-flex", alignItems:"center", gap:3 }}><span style={{ fontFamily:"'Share Tech Mono',monospace", color:"var(--cyan)", fontSize:14 }}>{emp.defaultSchedule[d]}</span>{emp.defaultSchedule[`${d}_ho`]&&<Badge small color="var(--teal)">HO</Badge>}</span>:<span style={{ color:"var(--text-dim)" }}>—</span>}</td>)}
            <td style={{ padding:"8px 12px", textAlign:"right" }}><div style={{ display:"flex", gap:6, justifyContent:"flex-end" }}><Btn small onClick={()=>startEdit(emp)}>✏️</Btn>{emp.setupDone&&<Btn small danger onClick={()=>removeFrom(emp.id)}>✕</Btn>}</div></td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>)}
    <Modal open={!!editEmp} onClose={()=>setEditEmp(null)} title={editEmp?.name}>{editEmp&&<div>
      <p style={{ fontSize:14, color:"var(--text-dim)", marginBottom:16 }}>Nastavte směnu pro každý den.</p>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {DAYS.map((day,i)=><div key={day} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:4, background:"var(--bg-card)" }}>
          <span style={{ fontWeight:700, fontSize:16, minWidth:50, color:"var(--text-bright)" }}>{day}</span>
          <div style={{ display:"flex", gap:4, flex:1 }}>{SHIFTS.map(sh=><button key={sh} onClick={()=>setEditSched(s=>({...s,[day]:sh}))} style={{ flex:1, padding:"10px 0", borderRadius:2, border:`1px solid ${editSched[day]===sh?"var(--cyan)":"var(--border)"}`, fontSize:14, fontWeight:600, fontFamily:"'Share Tech Mono',monospace", cursor:"pointer", background:editSched[day]===sh?"var(--cyan)15":"var(--bg-deep)", color:editSched[day]===sh?"var(--cyan)":"var(--text-dim)", minHeight:44 }}>{sh}</button>)}</div>
          <label style={{ display:"flex", alignItems:"center", gap:4, fontSize:14, color:"var(--text-dim)", cursor:"pointer" }}><input type="checkbox" checked={editSched[`${day}_ho`]||false} onChange={e=>setEditSched(s=>({...s,[`${day}_ho`]:e.target.checked}))} style={{ accentColor:"var(--teal)", width:20, height:20 }} /> HO</label>
        </div>)}
      </div>
      <div style={{ display:"flex", gap:8, marginTop:20 }}><Btn primary disabled={saving} onClick={saveEdit} style={{ flex:1 }}>{saving?"Ukládám...":"Uložit"}</Btn><Btn ghost onClick={()=>setEditEmp(null)}>Zrušit</Btn></div>
    </div>}</Modal>
  </div>;
}

// ═══════ MAIN APP ═══════
export default function App() {
  const [authUser, setAuthUser] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [view, setView] = useState("schedule");
  const [teamFilter, setTeamFilter] = useState("all");
  const [employees, setEmployees] = useState([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [schedule, setSchedule] = useState(null);
  const [absences, setAbsences] = useState({});
  const [events, setEvents] = useState({});
  const [swaps, setSwaps] = useState([]);
  const [selectedCell, setSelectedCell] = useState(null);
  const [modal, setModal] = useState(null);
  const [notifs, setNotifs] = useState([]);
  const [logs, setLogs] = useState([]);
  const [rules, setRules] = useState({ L1_max:2, SD_max8:2, SD_maxHO:2, SD_noHO8:true, SD_noHO10:true });

  const curWeek = useMemo(() => { const d = new Date(); d.setDate(d.getDate()+weekOffset*7); return d; }, [weekOffset]);
  const wk = weekKey(curWeek);
  const isAdmin = profile?.role === "admin";
  const getEmp = id => employees.find(e=>e.id===id);
  const defSched = useMemo(() => buildFromDefaults(employees), [employees]);
  const curSched = schedule || defSched;

  useEffect(() => { const unsub = onAuthStateChanged(auth, async u => { if(u){ setAuthUser(u); const snap = await getDoc(doc(db,"users",u.uid)); if(snap.exists()) setProfile({id:u.uid,...snap.data()}); else setProfile({id:u.uid,name:u.displayName||u.email,role:"employee",team:"L1",setupDone:false}); setupPush(u.uid); } else { setAuthUser(null); setProfile(null); } }); return unsub; }, []);
  useEffect(() => { const unsub = onSnapshot(collection(db,"users"), snap => { const emps=snap.docs.map(d=>({id:d.id,...d.data()})); setEmployees(emps); if(profile){const me=emps.find(e=>e.id===profile.id);if(me)setProfile(p=>({...p,...me}));} }); return unsub; }, [profile?.id]);
  useEffect(() => { const unsub = onSnapshot(doc(db,"schedules",wk), snap => { if(snap.exists()){const data=snap.data();setSchedule(data.entries||null);setAbsences(data.absences||{});setEvents(data.events||{});} else {setSchedule(null);setAbsences({});setEvents({});} }); return unsub; }, [wk]);
  useEffect(() => { const unsub = onSnapshot(collection(db,"swapRequests"), snap => { setSwaps(snap.docs.map(d=>({id:d.id,...d.data()}))); }); return unsub; }, []);
  useEffect(() => { const unsub = onSnapshot(doc(db,"rules","global"), snap => { if(snap.exists()) setRules(snap.data()); }); return unsub; }, []);
  useEffect(() => { const unsub = onSnapshot(collection(db,"auditLog"), snap => { const all=snap.docs.map(d=>({id:d.id,...d.data()})); all.sort((a,b)=>(b.time||"").localeCompare(a.time||"")); setLogs(all.slice(0,100)); }); return unsub; }, []);

  const notify = msg => { const n={id:uid(),msg,time:new Date().toLocaleTimeString("cs")}; setNotifs(p=>[n,...p]); setTimeout(()=>setNotifs(p=>p.filter(x=>x.id!==n.id)),5000); };
  const log = async msg => { try{await addDoc(collection(db,"auditLog"),{msg,time:new Date().toISOString(),week:wk,userId:profile?.id||"system"});}catch{} };
  const saveSched = async entries => { await setDoc(doc(db,"schedules",wk),{entries,weekStart:wk,modifiedAt:new Date().toISOString(),modifiedBy:profile?.id},{merge:true}); };
  const emailNotif = (emp,message) => { if(emp?.notify&&(emp?.notifyEmail||emp?.email)) callGAS("sendEmail",{to:emp.notifyEmail||emp.email,employeeName:emp.name,changeDescription:message,weekLabel:fmtWeek(curWeek)}); };

  const validate = (sched,day) => { const w=[]; const d=sched[day]; if(!d)return w; SHIFTS.forEach(sh=>{const ent=d[sh]||[];const l1=ent.filter(e=>getEmp(e.empId)?.team==="L1");const sd=ent.filter(e=>getEmp(e.empId)?.team==="SD");if(l1.length>rules.L1_max)w.push(`${day} ${sh}: L1 ${l1.length}/${rules.L1_max}`);if(sh==="08:00"&&sd.length>rules.SD_max8)w.push(`${day} ${sh}: SD ${sd.length}/${rules.SD_max8}`);}); const allSD=SHIFTS.flatMap(s=>(d[s]||[]).filter(e=>getEmp(e.empId)?.team==="SD")); if(allSD.filter(e=>e.ho).length>rules.SD_maxHO)w.push(`${day}: SD HO>${rules.SD_maxHO}`); if(rules.SD_noHO8&&(d["08:00"]||[]).some(e=>e.ho&&getEmp(e.empId)?.team==="SD"))w.push(`${day} 08:00: SD HO zakázán`); if(rules.SD_noHO10&&(d["10:00"]||[]).some(e=>e.ho&&getEmp(e.empId)?.team==="SD"))w.push(`${day} 10:00: SD HO zakázán`); return w; };
  const allWarn = DAYS.flatMap(d=>validate(curSched,d));
  const isChanged = (day,sh,eid) => { const df=defSched[day]?.[sh]?.find(e=>e.empId===eid); const cu=curSched[day]?.[sh]?.find(e=>e.empId===eid); if(!df&&cu)return true;if(df&&!cu)return true;if(df&&cu&&df.ho!==cu.ho)return true;return false; };

  const moveEmp = async (eid,fd,fs,td,ts) => { const s=dc(curSched);const from=s[fd]?.[fs];if(!from)return;const i=from.findIndex(e=>e.empId===eid);if(i===-1)return;const[en]=from.splice(i,1);en.isDefault=false;if(!s[td])s[td]={};if(!s[td][ts])s[td][ts]=[];s[td][ts].push(en);await saveSched(s);const emp=getEmp(eid);const msg=`${emp?.name}: ${fd} ${fs} → ${td} ${ts}`;notify(msg);log(msg);emailNotif(emp,msg); };
  const toggleHO = async (day,sh,eid) => { const s=dc(curSched);const en=s[day]?.[sh]?.find(e=>e.empId===eid);if(en){en.ho=!en.ho;en.isDefault=false;}await saveSched(s);const emp=getEmp(eid);const msg=`${emp?.name}: HO ${en?.ho?"✓":"✗"} (${day} ${sh})`;notify(msg);log(msg);emailNotif(emp,msg); };
  const addAbsence = async (eid,day,type) => { if(!isAdmin&&eid!==profile.id)return;const s=dc(curSched);SHIFTS.forEach(sh=>{if(s[day]?.[sh])s[day][sh]=s[day][sh].filter(e=>e.empId!==eid);});await saveSched(s);await setDoc(doc(db,"schedules",wk),{[`absences.${eid}-${day}`]:type},{merge:true});const emp=getEmp(eid);if(emp){const field=type==="sick"?"sickUsed":type==="vacation"?"vacationUsed":type==="whatever"?"whateverUsed":null;if(field)await updateDoc(doc(db,"users",eid),{[field]:(emp[field]||0)+1});}const al=ABSENCE_TYPES.find(a=>a.id===type)?.label;const msg=`${emp?.name}: ${al} (${day})`;notify(msg);log(msg);emailNotif(emp,msg); };
  const addEvent = async (day,eventType,note) => { await setDoc(doc(db,"schedules",wk),{[`events.${day}`]:{type:eventType,note,title:EVENT_TYPES.find(e=>e.id===eventType)?.label}},{merge:true});const msg=`Událost: ${EVENT_TYPES.find(e=>e.id===eventType)?.label} — ${day}`;notify(msg);log(msg); };
  const createSwap = async (rid,day,sh) => { await addDoc(collection(db,"swapRequests"),{rid,day,sh,week:wk,status:"open",created:new Date().toISOString()});notify(`Výměna: ${getEmp(rid)?.name} – ${day} ${sh}`);log(`Swap: ${getEmp(rid)?.name} – ${day} ${sh}`); };
  const acceptSwap = async (swId,aid) => { const sw=swaps.find(s=>s.id===swId);if(!sw)return;await updateDoc(doc(db,"swapRequests",swId),{status:"done",aid,resolvedAt:new Date().toISOString()});const s=dc(curSched);let aDay,aSh;DAYS.forEach(d=>SHIFTS.forEach(sh=>{if(s[d]?.[sh]?.some(e=>e.empId===aid)&&!aDay){aDay=d;aSh=sh;}}));if(aDay&&aSh&&s[sw.day]?.[sw.sh]){const ri=s[sw.day][sw.sh].findIndex(e=>e.empId===sw.rid);const ai=s[aDay][aSh].findIndex(e=>e.empId===aid);if(ri!==-1&&ai!==-1){const rE=s[sw.day][sw.sh][ri];const aE=s[aDay][aSh][ai];s[sw.day][sw.sh][ri]={...aE,isDefault:false};s[aDay][aSh][ai]={...rE,isDefault:false};await saveSched(s);}}const re=getEmp(sw.rid);const ae=getEmp(aid);const msg=`Výměna: ${re?.name} ↔ ${ae?.name}`;notify(msg);log(msg);emailNotif(re,msg);emailNotif(ae,msg); };
  const deleteUser = async eid => { if(!isAdmin)return;if(!confirm(`Smazat ${getEmp(eid)?.name}?`))return;await deleteDoc(doc(db,"users",eid));notify(`Zaměstnanec smazán`);log(`Smazán: ${getEmp(eid)?.name}`); };
  const exportCSV = () => { let csv="\ufeffDen,Směna,Zaměstnanec,Tým,HO\n";DAYS.forEach(day=>{SHIFTS.forEach(sh=>{(curSched[day]?.[sh]||[]).forEach(en=>{const e=getEmp(en.empId);if(e)csv+=`${day},${sh},${e.name},${e.team},${en.ho?"Ano":"Ne"}\n`;});});});const b=new Blob([csv],{type:"text/csv;charset=utf-8;"});const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download=`rozvrh_${wk}.csv`;a.click();URL.revokeObjectURL(u); };

  if (authUser===undefined) return <div style={{ minHeight:"100vh", background:"var(--bg-deep)", display:"flex", alignItems:"center", justifyContent:"center", color:"var(--text-dim)", fontFamily:"'Rajdhani',sans-serif" }}><style>{CSS}</style><div style={{ textAlign:"center" }}><div style={{ fontSize:56, marginBottom:12, animation:"pulse 1.5s infinite" }}>📅</div><div style={{ fontSize:16, letterSpacing:2, textTransform:"uppercase" }}>Načítání…</div></div></div>;
  if (!authUser) return <AuthScreen />;
  if (!profile) return <div style={{ minHeight:"100vh", background:"var(--bg-deep)", display:"flex", alignItems:"center", justifyContent:"center", color:"var(--text-dim)", fontFamily:"'Rajdhani',sans-serif" }}><style>{CSS}</style>Načítání profilu…</div>;
  if (!isAdmin && !profile.setupDone) return <ScheduleSetup profile={profile} onDone={() => setProfile(p => ({ ...p, setupDone: true }))} />;

  const openSwaps = swaps.filter(s=>s.status==="open"&&s.week===wk);
  const NAV = [{id:"schedule",label:"Rozvrh",icon:"📋"},{id:"swaps",label:"Výměny",icon:"🔄",badge:openSwaps.length},{id:"people",label:"Tým",icon:"👥"},{id:"stats",label:"Stats",icon:"📊"},{id:"log",label:"Log",icon:"📜"},...(isAdmin?[{id:"defaults",label:"Default",icon:"📐"},{id:"settings",label:"Config",icon:"⚙️"}]:[])];

  return (
    <div style={{ minHeight:"100vh", background:"var(--bg-deep)", fontFamily:"'Rajdhani',sans-serif", color:"var(--text)", paddingBottom:72 }}>
      <style>{CSS}</style>

      {/* TOASTS */}
      <div style={{ position:"fixed", top:12, left:12, right:12, zIndex:9999, display:"flex", flexDirection:"column", gap:8 }}>
        {notifs.map(n=><div key={n.id} className="tst" style={{ background:"var(--bg-panel)", border:"1px solid var(--cyan)30", borderRadius:4, padding:"14px 16px", fontSize:15, color:"var(--cyan)", display:"flex", gap:10, alignItems:"center" }}>
          <span style={{ fontSize:18 }}>🔔</span><span style={{ flex:1 }}>{n.msg}</span><span style={{ fontSize:12, color:"var(--text-dim)", fontFamily:"'Share Tech Mono',monospace" }}>{n.time}</span>
        </div>)}
      </div>

      {/* HEADER */}
      <header style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 16px", borderBottom:"1px solid var(--border)", background:"var(--bg-panel)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:28 }}>📅</span>
          <div><div style={{ fontSize:20, fontWeight:700, color:"var(--text-bright)", letterSpacing:2, textTransform:"uppercase", lineHeight:1 }}>ShiftFlow</div><div style={{ fontSize:10, color:"var(--text-dim)", letterSpacing:1.5 }}>SHIFT MANAGEMENT</div></div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <Badge color={isAdmin?"var(--amber)":"var(--teal)"} small>{isAdmin?"ADMIN":"CREW"}</Badge>
          <button onClick={()=>signOut(auth)} style={{ background:"none", border:"1px solid var(--border)", color:"var(--text-dim)", cursor:"pointer", fontSize:14, width:40, height:40, borderRadius:2, display:"flex", alignItems:"center", justifyContent:"center" }}>↪</button>
        </div>
      </header>

      {/* CONTENT */}
      <main style={{ padding:16, maxWidth:1440, margin:"0 auto" }}>

        {/* ── SCHEDULE ── */}
        {view==="schedule"&&<div style={{ animation:"fadeIn .3s" }}>
          {/* Week nav */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:12, marginBottom:16 }}>
            <button className="nb" onClick={()=>setWeekOffset(w=>w-1)} style={{ width:44, height:44, borderRadius:2, border:"1px solid var(--border)", background:"var(--bg-card)", color:"var(--text)", cursor:"pointer", fontSize:20, display:"flex", alignItems:"center", justifyContent:"center" }}>‹</button>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:18, fontWeight:700, color:"var(--text-bright)", fontFamily:"'Share Tech Mono',monospace" }}>{fmtWeek(curWeek)}</div>
              <div style={{ fontSize:12, color:"var(--text-dim)" }}>{weekOffset===0?"TENTO TÝDEN":weekOffset>0?`+${weekOffset}`:`${weekOffset}`}</div>
            </div>
            <button className="nb" onClick={()=>setWeekOffset(w=>w+1)} style={{ width:44, height:44, borderRadius:2, border:"1px solid var(--border)", background:"var(--bg-card)", color:"var(--text)", cursor:"pointer", fontSize:20, display:"flex", alignItems:"center", justifyContent:"center" }}>›</button>
            {weekOffset!==0&&<Btn small ghost onClick={()=>setWeekOffset(0)}>Dnes</Btn>}
          </div>

          {/* Team filter + actions */}
          <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap" }}>
            <Pill active={teamFilter==="all"} onClick={()=>setTeamFilter("all")} count={employees.filter(e=>e.setupDone).length}>Vše</Pill>
            <Pill active={teamFilter==="L1"} onClick={()=>setTeamFilter("L1")} color="var(--l1)" count={employees.filter(e=>e.team==="L1"&&e.setupDone).length}>L1</Pill>
            <Pill active={teamFilter==="SD"} onClick={()=>setTeamFilter("SD")} color="var(--sd)" count={employees.filter(e=>e.team==="SD"&&e.setupDone).length}>SD</Pill>
            <div style={{ flex:1 }} />
            {isAdmin&&<Btn small onClick={()=>setModal("absence")}>+ Nepřít.</Btn>}
            {isAdmin&&<Btn small onClick={()=>setModal("event")}>+ Event</Btn>}
            {!isAdmin&&<Btn small onClick={()=>setModal("myabsence")}>📋 Nepřít.</Btn>}
            <Btn small ghost onClick={exportCSV}>📥</Btn>
          </div>

          {allWarn.length>0&&<Card style={{ marginBottom:14, borderColor:"var(--red)30", padding:14 }}><div style={{ fontSize:14, fontWeight:700, color:"var(--red)", marginBottom:6 }}>⚠ PORUŠENÍ ({allWarn.length})</div>{allWarn.map((w,i)=><div key={i} style={{ fontSize:13, color:"var(--red)", padding:"2px 0" }}>• {w}</div>)}</Card>}

          {/* ── SCHEDULE GRID (mobile-friendly with sticky col) ── */}
          <div style={{ position:"relative", borderRadius:4, border:"1px solid var(--border)", overflow:"hidden" }}>
            <div style={{ overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
              <table style={{ width:"100%", minWidth:680, borderCollapse:"collapse" }}>
                <thead>
                  <tr>
                    <th style={{ position:"sticky", left:0, zIndex:10, background:"var(--bg-panel)", padding:"10px 8px", borderBottom:"1px solid var(--border)", borderRight:"2px solid var(--border)", width:64, fontFamily:"'Share Tech Mono',monospace", fontSize:13, color:"var(--text-dim)", textAlign:"center" }}>⏱</th>
                    {DAYS.map((d,i)=>{const ev=events[d]; return <th key={d} style={{ padding:"10px 6px", borderBottom:"1px solid var(--border)", background:"var(--bg-card)", textAlign:"center", minWidth:110 }}>
                      <div style={{ fontSize:15, fontWeight:700, color:"var(--text-bright)" }}>{DAYS_FULL[i]}</div>
                      {ev&&<div style={{ marginTop:4 }}><Badge small color="var(--amber)">{EVENT_TYPES.find(e=>e.id===ev.type)?.icon} {ev.note||ev.title||""}</Badge></div>}
                    </th>;})}
                  </tr>
                </thead>
                <tbody>
                  {SHIFTS.map(shift=><tr key={shift}>
                    <td style={{ position:"sticky", left:0, zIndex:10, background:"var(--bg-panel)", padding:"8px 6px", borderBottom:"1px solid var(--border)", borderRight:"2px solid var(--border)", textAlign:"center", fontFamily:"'Share Tech Mono',monospace", fontSize:16, fontWeight:600, color:"var(--cyan)" }}>{shift}</td>
                    {DAYS.map(day=>{
                      const entries=(curSched[day]?.[shift]||[]).filter(e=>{const emp=getEmp(e.empId);return emp&&(teamFilter==="all"||emp.team===teamFilter);});
                      return <td key={`${day}-${shift}`} style={{ padding:4, borderBottom:"1px solid var(--border)", borderLeft:"1px solid var(--border)", verticalAlign:"top", minHeight:60, background:"var(--bg-deep)" }}
                        onDragOver={e=>{if(isAdmin){e.preventDefault();e.currentTarget.style.background="var(--cyan)08";}}} onDragLeave={e=>{e.currentTarget.style.background="var(--bg-deep)";}} onDrop={e=>{e.currentTarget.style.background="var(--bg-deep)";if(!isAdmin)return;try{const d=JSON.parse(e.dataTransfer.getData("text/plain"));if(d.day!==day||d.shift!==shift)moveEmp(d.empId,d.day,d.shift,day,shift);}catch{}}}>
                        {entries.map(en=>{const emp=getEmp(en.empId);if(!emp)return null;const ch=isChanged(day,shift,en.empId);const tc=emp.team==="L1"?"var(--l1)":"var(--sd)";
                          return <div key={en.empId} className={`ent ${ch?"chg":""}`} draggable={isAdmin} onDragStart={e=>isAdmin&&e.dataTransfer.setData("text/plain",JSON.stringify({empId:en.empId,day,shift}))} onClick={()=>isAdmin?setSelectedCell({day,shift,empId:en.empId}):profile.id===en.empId&&setModal({type:"myshift",day,shift})}
                            style={{ gap:6, padding:"6px 8px", borderRadius:2, marginBottom:3, background:ch?"var(--cyan)08":"var(--bg-card)", border:`1px solid ${ch?"var(--cyan)25":"var(--border)"}`, fontSize:14 }}>
                            <span style={{ width:8, height:8, borderRadius:1, background:tc, flexShrink:0 }} />
                            <span style={{ fontWeight:600, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", color:"var(--text-bright)" }}>{emp.name?.split(" ").pop()}</span>
                            {en.ho&&<Badge small color="var(--teal)">HO</Badge>}
                            {ch&&<span style={{ color:"var(--cyan)", fontSize:12 }}>✦</span>}
                          </div>;})}
                      </td>;})}
                  </tr>)}
                  {/* Absence row */}
                  <tr>
                    <td style={{ position:"sticky", left:0, zIndex:10, background:"var(--bg-panel)", padding:"8px 6px", borderRight:"2px solid var(--border)", textAlign:"center", fontSize:12, color:"var(--text-dim)", fontWeight:600 }}>N/A</td>
                    {DAYS.map(day=>{const dayAbs=Object.entries(absences).filter(([k])=>k.endsWith(`-${day}`)).map(([k,type])=>({empId:k.replace(`-${day}`,""),type})).filter(a=>{const e=getEmp(a.empId);return e&&(teamFilter==="all"||e.team===teamFilter);});
                      return <td key={`a-${day}`} style={{ padding:4, borderLeft:"1px solid var(--border)", verticalAlign:"top", background:"var(--bg-deep)" }}>
                        {dayAbs.map(a=>{const e=getEmp(a.empId);const at=ABSENCE_TYPES.find(t=>t.id===a.type);return e&&<div key={a.empId} style={{ display:"flex", alignItems:"center", gap:4, padding:"4px 8px", borderRadius:2, marginBottom:2, background:at?.color+"12", border:`1px solid ${at?.color}25`, fontSize:13 }}><span>{at?.icon}</span><span style={{ fontWeight:600 }}>{e.name?.split(" ").pop()}</span></div>;})}
                      </td>;})}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ display:"flex", gap:14, marginTop:14, flexWrap:"wrap", fontSize:13, color:"var(--text-dim)" }}>
            <span style={{ display:"flex",alignItems:"center",gap:5 }}><span style={{ width:8,height:8,borderRadius:1,background:"var(--l1)" }}/>L1</span>
            <span style={{ display:"flex",alignItems:"center",gap:5 }}><span style={{ width:8,height:8,borderRadius:1,background:"var(--sd)" }}/>SD</span>
            <Badge small color="var(--teal)">HO</Badge>
            <span style={{ color:"var(--cyan)" }}>✦ Změna</span>
          </div>
        </div>}

        {/* ── SWAPS ── */}
        {view==="swaps"&&<div style={{ animation:"fadeIn .3s" }}>
          <h2 style={{ fontSize:22, fontWeight:700, marginBottom:16, color:"var(--text-bright)", textTransform:"uppercase", letterSpacing:1 }}>🔄 Výměny <Badge color="var(--cyan)">Free-for-all</Badge></h2>
          {!isAdmin&&<Card style={{ marginBottom:18, borderColor:"var(--cyan)25" }}><p style={{ fontSize:15, color:"var(--text-dim)", margin:"0 0 12px" }}>Požádej o výměnu – kdokoliv ji může přijmout.</p><Btn primary onClick={()=>setModal({type:"swap",day:DAYS[0],shift:SHIFTS[0]})}>+ Nová žádost</Btn></Card>}
          <h3 style={{ fontSize:16, fontWeight:600, color:"var(--text-dim)", marginBottom:12 }}>OTEVŘENÉ ({openSwaps.length})</h3>
          {!openSwaps.length&&<p style={{ fontSize:15, color:"var(--text-dim)" }}>Žádné otevřené žádosti.</p>}
          {openSwaps.map(sw=>{const re=getEmp(sw.rid);const me=profile.id===sw.rid;const can=!isAdmin&&!me;
            return <Card key={sw.id} style={{ padding:16, marginBottom:10, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
              <div><div style={{ fontWeight:700, fontSize:17, color:"var(--text-bright)" }}>{re?.name||"?"}</div><div style={{ fontSize:14, color:"var(--text-dim)", marginTop:4 }}>Výměna: <Badge small color="var(--cyan)">{sw.day} {sw.sh}</Badge></div></div>
              {can&&<Btn primary small onClick={()=>acceptSwap(sw.id,profile.id)}>Přijmout</Btn>}{me&&<Badge color="var(--amber)">Tvoje</Badge>}
            </Card>;})}
        </div>}

        {/* ── PEOPLE ── */}
        {view==="people"&&<div style={{ animation:"fadeIn .3s" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:18 }}>
            <h2 style={{ fontSize:22, fontWeight:700, color:"var(--text-bright)", textTransform:"uppercase", letterSpacing:1, margin:0 }}>👥 Tým</h2>
            {isAdmin&&<Btn primary onClick={()=>setModal("addMember")}>+ Přidat</Btn>}
          </div>
          {["L1","SD"].map(team=><div key={team} style={{ marginBottom:28 }}>
            <h3 style={{ fontSize:18, fontWeight:700, color:team==="L1"?"var(--l1)":"var(--sd)", marginBottom:12, textTransform:"uppercase", letterSpacing:1 }}>{TEAMS[team]}</h3>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:12 }}>{employees.filter(e=>e.team===team&&e.role!=="admin").map(emp=><Card key={emp.id}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"start" }}>
                <div><div style={{ fontWeight:700, fontSize:17, color:"var(--text-bright)" }}>{emp.name}</div><div style={{ display:"flex", gap:4, marginTop:6, flexWrap:"wrap" }}><Badge small color={team==="L1"?"var(--l1)":"var(--sd)"}>{team}</Badge>{emp.notify&&<Badge small color="var(--teal)">📧</Badge>}{!emp.setupDone&&<Badge small color="var(--amber)">Bez rozvrhu</Badge>}</div></div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  {isAdmin&&<button onClick={()=>deleteUser(emp.id)} style={{ background:"none", border:"1px solid var(--red)30", color:"var(--red)", cursor:"pointer", fontSize:14, width:36, height:36, borderRadius:2, display:"flex", alignItems:"center", justifyContent:"center" }}>🗑️</button>}
                  <div style={{ width:40, height:40, borderRadius:2, background:`linear-gradient(135deg,${team==="L1"?"var(--l1),#8b5cf6":"var(--sd),var(--teal)"})`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, fontWeight:700, color:"#fff" }}>{(emp.name||"?").charAt(0)}</div>
                </div>
              </div>
              {emp.setupDone&&emp.defaultSchedule&&<div style={{ marginTop:12, display:"flex", gap:6 }}>{DAYS.map(d=><div key={d} style={{ textAlign:"center", padding:"4px 8px", borderRadius:2, background:"var(--bg-deep)", border:"1px solid var(--border)", flex:1, fontSize:12 }}><div style={{ color:"var(--text-dim)", fontWeight:600 }}>{d}</div><div style={{ color:"var(--cyan)", fontFamily:"'Share Tech Mono',monospace", fontSize:13 }}>{emp.defaultSchedule[d]||"—"}</div></div>)}</div>}
              <div style={{ marginTop:12, display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>{[{l:"Dovolená",v:(emp.vacationTotal||20)-(emp.vacationUsed||0),c:"var(--sd)"},{l:"Sick",v:(emp.sickTotal||5)-(emp.sickUsed||0),c:"var(--red)"},{l:"Whatever",v:(emp.whateverTotal||3)-(emp.whateverUsed||0),c:"#a78bfa"}].map(b=><div key={b.l} style={{ textAlign:"center", padding:8, borderRadius:2, background:"var(--bg-deep)", border:"1px solid var(--border)" }}><div style={{ fontSize:22, fontWeight:800, color:b.c }}>{b.v}</div><div style={{ fontSize:11, color:"var(--text-dim)", textTransform:"uppercase" }}>{b.l}</div></div>)}</div>
            </Card>)}</div></div>)}
        </div>}

        {/* ── STATS ── */}
        {view==="stats"&&<div style={{ animation:"fadeIn .3s" }}>
          <h2 style={{ fontSize:22, fontWeight:700, marginBottom:18, color:"var(--text-bright)", textTransform:"uppercase", letterSpacing:1 }}>📊 Status</h2>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:12, marginBottom:24 }}>{[{l:"Crew",v:employees.filter(e=>e.role!=="admin").length,i:"👥",c:"var(--l1)"},{l:"Active",v:employees.filter(e=>e.setupDone).length,i:"📋",c:"var(--sd)"},{l:"HO",v:Object.values(curSched).flatMap(d=>Object.values(d).flat()).filter(e=>e.ho).length,i:"🏠",c:"var(--teal)"},{l:"Swaps",v:openSwaps.length,i:"🔄",c:"var(--amber)"},{l:"Alerts",v:allWarn.length,i:"⚠️",c:allWarn.length?"var(--red)":"var(--teal)"}].map(s=><Card key={s.l} glow={s.c}><div style={{ display:"flex", alignItems:"center", gap:10 }}><span style={{ fontSize:28 }}>{s.i}</span><div><div style={{ fontSize:28, fontWeight:800, color:s.c, fontFamily:"'Share Tech Mono',monospace" }}>{s.v}</div><div style={{ fontSize:12, color:"var(--text-dim)", textTransform:"uppercase", letterSpacing:0.5 }}>{s.l}</div></div></div></Card>)}</div>
          <Card><h3 style={{ fontSize:16, fontWeight:700, color:"var(--text-dim)", marginBottom:14, textTransform:"uppercase", letterSpacing:1 }}>Distribuce</h3>{SHIFTS.map(sh=>{const cnt=Object.values(curSched).flatMap(d=>(d[sh]||[])).length;const mx=employees.filter(e=>e.setupDone).length*5;const p=mx?Math.round(cnt/mx*100):0; return <div key={sh} style={{ marginBottom:14 }}><div style={{ display:"flex", justifyContent:"space-between", fontSize:14, color:"var(--text-dim)", marginBottom:4 }}><span style={{ fontFamily:"'Share Tech Mono',monospace", color:"var(--cyan)" }}>{sh}</span><span>{cnt} ({p}%)</span></div><div style={{ height:8, borderRadius:2, background:"var(--bg-card)", border:"1px solid var(--border)" }}><div style={{ height:"100%", borderRadius:2, width:`${p}%`, background:`linear-gradient(90deg,var(--cyan),var(--teal))`, transition:"width .5s" }}/></div></div>;})}</Card>
        </div>}

        {/* ── LOG ── */}
        {view==="log"&&<div style={{ animation:"fadeIn .3s" }}><h2 style={{ fontSize:22, fontWeight:700, marginBottom:18, color:"var(--text-bright)", textTransform:"uppercase", letterSpacing:1 }}>📜 Log</h2>{!logs.length&&<p style={{ color:"var(--text-dim)", fontSize:15 }}>Žádné záznamy.</p>}{logs.map(h=><div key={h.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:2, background:"var(--bg-card)", border:"1px solid var(--border)", fontSize:14, marginBottom:4 }}><span style={{ fontSize:12, color:"var(--text-dim)", fontFamily:"'Share Tech Mono',monospace", minWidth:130 }}>{h.time?new Date(h.time).toLocaleString("cs"):""}</span><span style={{ color:"var(--text)", flex:1 }}>{h.msg}</span></div>)}</div>}

        {/* ── DEFAULTS ── */}
        {view==="defaults"&&isAdmin&&<div style={{ animation:"fadeIn .3s" }}><h2 style={{ fontSize:22, fontWeight:700, marginBottom:4, color:"var(--text-bright)", textTransform:"uppercase", letterSpacing:1 }}>📐 Stálý rozvrh</h2><p style={{ fontSize:15, color:"var(--text-dim)", marginBottom:18 }}>Výchozí směny. Klikněte ✏️ pro editaci.</p><DefaultScheduleEditor employees={employees} /></div>}

        {/* ── SETTINGS ── */}
        {view==="settings"&&isAdmin&&<div style={{ animation:"fadeIn .3s", maxWidth:560 }}><h2 style={{ fontSize:22, fontWeight:700, marginBottom:18, color:"var(--text-bright)", textTransform:"uppercase", letterSpacing:1 }}>⚙️ Config</h2>
          <Card style={{ marginBottom:16 }}><Input label="L1: Max agentů/směna" type="number" value={rules.L1_max} onChange={e=>setRules(r=>({...r,L1_max:+e.target.value}))} /><Input label="SD: Max agentů na 8:00" type="number" value={rules.SD_max8} onChange={e=>setRules(r=>({...r,SD_max8:+e.target.value}))} /><Input label="SD: Max HO/den" type="number" value={rules.SD_maxHO} onChange={e=>setRules(r=>({...r,SD_maxHO:+e.target.value}))} /><Toggle checked={rules.SD_noHO8} onChange={v=>setRules(r=>({...r,SD_noHO8:v}))} label="SD: Zákaz HO na 08:00" /><Toggle checked={rules.SD_noHO10} onChange={v=>setRules(r=>({...r,SD_noHO10:v}))} label="SD: Zákaz HO na 10:00" /><Btn primary onClick={async()=>{await setDoc(doc(db,"rules","global"),rules);notify("Uloženo ✓");}} style={{ marginTop:8 }}>Uložit pravidla</Btn></Card>
          <Card><div style={{ display:"flex", gap:8, flexWrap:"wrap" }}><Btn danger onClick={async()=>{try{await deleteDoc(doc(db,"schedules",wk));notify("Reset ✓");}catch{}}}>Reset týden</Btn><Btn ghost onClick={exportCSV}>📥 Export CSV</Btn></div></Card>
        </div>}
      </main>

      {/* ── BOTTOM NAV (mobile-friendly) ── */}
      <nav style={{ position:"fixed", bottom:0, left:0, right:0, display:"flex", background:"var(--bg-panel)", borderTop:"1px solid var(--border)", zIndex:100, overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
        {NAV.map(t=><button key={t.id} className="nb" onClick={()=>setView(t.id)} style={{ flex:"1 0 auto", padding:"10px 8px", border:"none", borderTop:view===t.id?"2px solid var(--cyan)":"2px solid transparent", background:"transparent", color:view===t.id?"var(--cyan)":"var(--text-dim)", fontSize:11, fontWeight:600, fontFamily:"'Rajdhani',sans-serif", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:2, minWidth:56, textTransform:"uppercase", letterSpacing:0.3 }}>
          <span style={{ fontSize:20 }}>{t.icon}</span>{t.label}
          {t.badge>0&&<span style={{ position:"absolute", top:4, right:"50%", marginRight:-16, background:"var(--red)", color:"#fff", borderRadius:8, padding:"0 5px", fontSize:10, fontWeight:700 }}>{t.badge}</span>}
        </button>)}
      </nav>

      {/* ── MODALS ── */}
      <Modal open={!!selectedCell} onClose={()=>setSelectedCell(null)} title="Akce">{selectedCell&&(()=>{const emp=getEmp(selectedCell.empId);if(!emp)return null;return<div>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16, padding:14, borderRadius:4, background:"var(--bg-card)" }}><div style={{ width:40, height:40, borderRadius:2, background:`linear-gradient(135deg,${emp.team==="L1"?"var(--l1),#8b5cf6":"var(--sd),var(--teal)"})`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, fontWeight:700, color:"#fff" }}>{(emp.name||"?").charAt(0)}</div><div><div style={{ fontWeight:700, fontSize:17, color:"var(--text-bright)" }}>{emp.name}</div><div style={{ fontSize:14, color:"var(--text-dim)" }}>{selectedCell.day} · {selectedCell.shift}</div></div></div>
        <Btn onClick={()=>{toggleHO(selectedCell.day,selectedCell.shift,selectedCell.empId);setSelectedCell(null);}} style={{ width:"100%", marginBottom:8 }}>🏠 Toggle HO</Btn>
        <div style={{ fontSize:13, color:"var(--text-dim)", margin:"12px 0 6px", fontWeight:600, textTransform:"uppercase", letterSpacing:0.5 }}>Přesunout</div>
        <div style={{ display:"flex", gap:8 }}>{SHIFTS.filter(s=>s!==selectedCell.shift).map(s=><Btn key={s} small style={{ flex:1 }} onClick={()=>{moveEmp(selectedCell.empId,selectedCell.day,selectedCell.shift,selectedCell.day,s);setSelectedCell(null);}}>→ {s}</Btn>)}</div>
        <div style={{ fontSize:13, color:"var(--text-dim)", margin:"12px 0 6px", fontWeight:600, textTransform:"uppercase", letterSpacing:0.5 }}>Nepřítomnost</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>{ABSENCE_TYPES.map(a=><Btn key={a.id} small onClick={()=>{addAbsence(selectedCell.empId,selectedCell.day,a.id);setSelectedCell(null);}}>{a.icon} {a.label}</Btn>)}</div>
      </div>;})()}</Modal>

      <Modal open={modal==="absence"} onClose={()=>setModal(null)} title="Nepřítomnost"><AbsForm emps={employees.filter(e=>e.role!=="admin"&&(teamFilter==="all"||e.team===teamFilter))} onSubmit={(eid,day,t)=>{addAbsence(eid,day,t);setModal(null);}}/></Modal>
      <Modal open={modal==="event"} onClose={()=>setModal(null)} title="Událost"><EvForm onSubmit={(d,t,n)=>{addEvent(d,t,n);setModal(null);}}/></Modal>
      <Modal open={modal?.type==="swap"} onClose={()=>setModal(null)} title="Žádost o výměnu"><SwForm dDay={modal?.day} dShift={modal?.shift} onSubmit={(d,s)=>{createSwap(profile.id,d,s);setModal(null);}}/></Modal>

      <Modal open={modal?.type==="myshift"} onClose={()=>setModal(null)} title="Moje směna"><div>
        <p style={{ fontSize:15, color:"var(--text-dim)", marginBottom:16 }}>{modal?.day} · {modal?.shift}</p>
        <div style={{ fontSize:14, color:"var(--text-dim)", marginBottom:8, fontWeight:600, textTransform:"uppercase" }}>Zadat nepřítomnost</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:16 }}>{ABSENCE_TYPES.map(a=><Btn key={a.id} onClick={()=>{addAbsence(profile.id,modal.day,a.id);setModal(null);}}>{a.icon} {a.label}</Btn>)}</div>
        <Btn primary onClick={()=>setModal({type:"swap",day:modal?.day,shift:modal?.shift})} style={{ width:"100%" }}>🔄 Požádat o výměnu</Btn>
      </div></Modal>

      <Modal open={modal==="myabsence"} onClose={()=>setModal(null)} title="Moje nepřítomnost"><MyAbsForm profile={profile} onSubmit={(day,type)=>{addAbsence(profile.id,day,type);setModal(null);}}/></Modal>
      <Modal open={modal==="addMember"} onClose={()=>setModal(null)} title="Přidat člena"><AddMemberForm onDone={msg=>{notify(msg);log(msg);setModal(null);}}/></Modal>
    </div>
  );
}

// ─── FORMS ───────────────────────
function AbsForm({emps,onSubmit}){const[eid,setEid]=useState(emps[0]?.id||"");const[day,setDay]=useState(DAYS[0]);const[t,setT]=useState(ABSENCE_TYPES[0].id);return<div><Select label="Zaměstnanec" value={eid} onChange={e=>setEid(e.target.value)} options={emps.map(e=>({value:e.id,label:e.name}))}/><Select label="Den" value={day} onChange={e=>setDay(e.target.value)} options={DAYS.map((d,i)=>({value:d,label:DAYS_FULL[i]}))}/><Select label="Typ" value={t} onChange={e=>setT(e.target.value)} options={ABSENCE_TYPES.map(a=>({value:a.id,label:`${a.icon} ${a.label}`}))}/><Btn primary onClick={()=>onSubmit(eid,day,t)} style={{marginTop:8,width:"100%"}}>Přidat</Btn></div>;}
function EvForm({onSubmit}){const[day,setDay]=useState(DAYS[0]);const[t,setT]=useState(EVENT_TYPES[0].id);const[n,setN]=useState("");return<div><Select label="Den" value={day} onChange={e=>setDay(e.target.value)} options={DAYS.map((d,i)=>({value:d,label:DAYS_FULL[i]}))}/><Select label="Typ" value={t} onChange={e=>setT(e.target.value)} options={EVENT_TYPES.map(e=>({value:e.id,label:`${e.icon} ${e.label}`}))}/><Input label="Poznámka" value={n} onChange={e=>setN(e.target.value)}/><Btn primary onClick={()=>onSubmit(day,t,n)} style={{marginTop:8,width:"100%"}}>Přidat</Btn></div>;}
function SwForm({dDay,dShift,onSubmit}){const[day,setDay]=useState(dDay||DAYS[0]);const[sh,setSh]=useState(dShift||SHIFTS[0]);return<div><p style={{fontSize:14,color:"var(--text-dim)",margin:"0 0 14px"}}>Kdokoliv ji může přijmout – směny se automaticky prohodí.</p><Select label="Den" value={day} onChange={e=>setDay(e.target.value)} options={DAYS.map((d,i)=>({value:d,label:DAYS_FULL[i]}))}/><Select label="Směna" value={sh} onChange={e=>setSh(e.target.value)} options={SHIFTS.map(s=>({value:s,label:s}))}/><Btn primary onClick={()=>onSubmit(day,sh)} style={{marginTop:8,width:"100%"}}>Odeslat žádost</Btn></div>;}
function MyAbsForm({profile,onSubmit}){const[day,setDay]=useState(DAYS[0]);const[t,setT]=useState(ABSENCE_TYPES[0].id);const r={sick:(profile.sickTotal||5)-(profile.sickUsed||0),vacation:(profile.vacationTotal||20)-(profile.vacationUsed||0),whatever:(profile.whateverTotal||3)-(profile.whateverUsed||0)};return<div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:18}}>{[{l:"Dovolená",v:r.vacation,c:"var(--sd)"},{l:"Sick",v:r.sick,c:"var(--red)"},{l:"Whatever",v:r.whatever,c:"#a78bfa"}].map(b=><div key={b.l} style={{textAlign:"center",padding:10,borderRadius:2,background:"var(--bg-deep)",border:"1px solid var(--border)"}}><div style={{fontSize:24,fontWeight:800,color:b.c,fontFamily:"'Share Tech Mono',monospace"}}>{b.v}</div><div style={{fontSize:12,color:"var(--text-dim)",textTransform:"uppercase"}}>{b.l}</div></div>)}</div><Select label="Den" value={day} onChange={e=>setDay(e.target.value)} options={DAYS.map((d,i)=>({value:d,label:DAYS_FULL[i]}))}/><Select label="Typ" value={t} onChange={e=>setT(e.target.value)} options={ABSENCE_TYPES.map(a=>({value:a.id,label:`${a.icon} ${a.label}`}))}/><Btn primary onClick={()=>onSubmit(day,t)} style={{marginTop:8,width:"100%"}}>Zadat nepřítomnost</Btn></div>;}
function AddMemberForm({onDone}){const[name,setName]=useState("");const[email,setEmail]=useState("");const[pass,setPass]=useState("");const[team,setTeam]=useState("L1");const[loading,setLoading]=useState(false);const[err,setErr]=useState("");const submit=async()=>{setErr("");if(!name.trim()||!email||!pass){setErr("Vyplňte všechna pole");return;}if(pass.length<6){setErr("Heslo min. 6 znaků");return;}setLoading(true);try{const resp=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${import.meta.env.VITE_FIREBASE_API_KEY}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password:pass,displayName:name.trim(),returnSecureToken:false})});const data=await resp.json();if(data.error){setErr(data.error.message);setLoading(false);return;}await setDoc(doc(db,"users",data.localId),{name:name.trim(),email,team,role:"employee",notify:false,notifyEmail:"",fcmToken:null,defaultSchedule:null,setupDone:false,vacationTotal:20,sickTotal:5,whateverTotal:3,vacationUsed:0,sickUsed:0,whateverUsed:0,createdAt:new Date().toISOString()});onDone(`Přidán: ${name.trim()}`)}catch(e){setErr(e.message)}setLoading(false)};return<div><Input label="Jméno" value={name} onChange={e=>setName(e.target.value)} placeholder="Jan Novák"/><Input label="Email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="jan@firma.cz"/><Input label="Heslo (min. 6)" type="password" value={pass} onChange={e=>setPass(e.target.value)}/><Select label="Tým" value={team} onChange={e=>setTeam(e.target.value)} options={[{value:"L1",label:"L1 Support"},{value:"SD",label:"Service Desk"}]}/>{err&&<p style={{color:"var(--red)",fontSize:14,margin:"0 0 8px",padding:"10px 12px",borderRadius:2,background:"var(--red)10"}}>{err}</p>}<Btn primary disabled={loading} onClick={submit} style={{width:"100%"}}>{loading?"Vytvářím...":"Přidat člena"}</Btn></div>;}
