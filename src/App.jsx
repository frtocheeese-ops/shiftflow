import { useState, useEffect, useMemo } from "react";
import { auth, db, getMsg } from "./firebase";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, onSnapshot } from "firebase/firestore";
import { getToken, onMessage } from "firebase/messaging";

const TEAMS = { L1: "L1 Support", SD: "Service Desk" };
const SHIFTS = ["08:00", "09:00", "10:00"];
const DAYS = ["Po", "Út", "St", "Čt", "Pá"];
const DAYS_FULL = ["Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek"];
const ABSENCE_TYPES = [
  { id: "sick", label: "Sick Day", icon: "🤒", color: "#ef4444" },
  { id: "doctor", label: "Lékař", icon: "🏥", color: "#f97316" },
  { id: "vacation", label: "Dovolená", icon: "🏖️", color: "#06b6d4" },
  { id: "whatever", label: "Whatever Day", icon: "☕", color: "#8b5cf6" },
];
const EVENT_TYPES = [
  { id: "training", label: "Školení", icon: "📚" }, { id: "dinner", label: "Týmová večeře", icon: "🍽️" },
  { id: "teambuilding", label: "Teambuilding", icon: "🎯" }, { id: "meeting", label: "Porada", icon: "💬" }, { id: "other", label: "Jiné", icon: "📌" },
];
const ADMIN_EMAIL = "admin@shiftflow.app";
const ADMIN_FB_PASS = "ShiftFlowAdmin2026!";

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

// ─── UI ───────────────────────────────
const Badge = ({ children, color="#6366f1", small, style:sx }) => <span style={{ display:"inline-flex", alignItems:"center", gap:3, padding:small?"1px 6px":"2px 10px", borderRadius:99, fontSize:small?10:11, fontWeight:600, background:color+"1a", color, border:`1px solid ${color}33`, whiteSpace:"nowrap", ...sx }}>{children}</span>;
const Pill = ({ active, onClick, children, color, count }) => <button onClick={onClick} style={{ padding:"6px 14px", borderRadius:99, border:"none", background:active?(color||"#6366f1"):"rgba(255,255,255,0.05)", color:active?"#fff":"rgba(255,255,255,0.45)", fontSize:13, fontWeight:600, cursor:"pointer", transition:"all .2s", display:"flex", alignItems:"center", gap:6 }}>{children}{count!==undefined&&<span style={{ background:active?"rgba(255,255,255,0.25)":"rgba(255,255,255,0.08)", borderRadius:99, padding:"0 6px", fontSize:10 }}>{count}</span>}</button>;
const Card = ({ children, style:sx, glow }) => <div style={{ background:"rgba(255,255,255,0.035)", borderRadius:16, border:"1px solid rgba(255,255,255,0.07)", padding:20, backdropFilter:"blur(20px)", boxShadow:glow?`0 0 30px ${glow}12`:"none", ...sx }}>{children}</div>;
const Btn = ({ children, onClick, primary, danger, small, ghost, disabled, style:sx }) => <button disabled={disabled} onClick={onClick} style={{ padding:small?"4px 10px":"8px 18px", borderRadius:10, border:ghost?"1px solid rgba(255,255,255,0.12)":"none", fontWeight:600, cursor:disabled?"not-allowed":"pointer", fontSize:small?11:13, background:danger?"#ef4444":primary?"#6366f1":ghost?"transparent":"rgba(255,255,255,0.07)", color:"#fff", opacity:disabled?0.35:1, transition:"all .15s", ...sx }}>{children}</button>;
const Input = ({ label, ...p }) => <div style={{ marginBottom:14 }}>{label&&<label style={{ fontSize:12, color:"#94a3b8", display:"block", marginBottom:4 }}>{label}</label>}<input {...p} style={{ width:"100%", padding:"8px 12px", borderRadius:10, border:"1px solid rgba(255,255,255,0.1)", background:"rgba(255,255,255,0.05)", color:"#e2e8f0", fontSize:14, outline:"none", boxSizing:"border-box", ...(p.style||{}) }} /></div>;
const Select = ({ label, options, ...p }) => <div style={{ marginBottom:14 }}>{label&&<label style={{ fontSize:12, color:"#94a3b8", display:"block", marginBottom:4 }}>{label}</label>}<select {...p} style={{ width:"100%", padding:"8px 12px", borderRadius:10, border:"1px solid rgba(255,255,255,0.1)", background:"rgba(12,12,28,0.95)", color:"#e2e8f0", fontSize:14, outline:"none" }}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></div>;
const Toggle = ({ checked, onChange, label }) => <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontSize:13, color:"#94a3b8", marginBottom:10 }}><div onClick={()=>onChange(!checked)} style={{ width:36, height:20, borderRadius:10, background:checked?"#6366f1":"rgba(255,255,255,0.1)", position:"relative", transition:"all .2s", cursor:"pointer", flexShrink:0 }}><div style={{ width:16, height:16, borderRadius:8, background:"#fff", position:"absolute", top:2, left:checked?18:2, transition:"all .2s" }}/></div>{label}</label>;
const Modal = ({ open, onClose, title, children }) => { if(!open) return null; return <div style={{ position:"fixed", inset:0, zIndex:1000, background:"rgba(0,0,0,0.7)", backdropFilter:"blur(8px)", display:"flex", alignItems:"center", justifyContent:"center", animation:"fadeIn .2s" }} onClick={onClose}><div onClick={e=>e.stopPropagation()} style={{ background:"#16162a", borderRadius:20, padding:28, border:"1px solid rgba(255,255,255,0.1)", width:500, maxWidth:"95vw", maxHeight:"85vh", overflowY:"auto", animation:"slideUp .25s" }}><div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}><h3 style={{ margin:0, fontSize:18, color:"#e2e8f0" }}>{title}</h3><button onClick={onClose} style={{ background:"none", border:"none", color:"#64748b", fontSize:20, cursor:"pointer" }}>✕</button></div>{children}</div></div>; };

// ═══════ SCHEDULE SETUP (new employee) ═══════
function ScheduleSetup({ profile, onDone }) {
  const [sched, setSched] = useState(() => { const s = {}; DAYS.forEach(d => { s[d] = "09:00"; s[`${d}_ho`] = false; }); return s; });
  const [saving, setSaving] = useState(false);
  const save = async () => { setSaving(true); await updateDoc(doc(db, "users", profile.id), { defaultSchedule: sched, setupDone: true }); onDone(); };
  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"linear-gradient(140deg, #080818, #12122e, #0a0a1c)", fontFamily:"'DM Sans', sans-serif" }}>
      <div style={{ width:500, padding:40, borderRadius:24, background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.07)", backdropFilter:"blur(40px)", animation:"slideUp .4s" }}>
        <div style={{ textAlign:"center", marginBottom:28 }}>
          <div style={{ fontSize:42, marginBottom:6 }}>📅</div>
          <h2 style={{ fontSize:22, fontWeight:800, color:"#e2e8f0", margin:0 }}>Nastavte si stálý rozvrh</h2>
          <p style={{ color:"#64748b", fontSize:13, marginTop:6 }}>Ahoj {profile.name}! Vyberte směnu pro každý den.</p>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {DAYS.map((day, i) => (
            <div key={day} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 14px", borderRadius:12, background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.06)" }}>
              <span style={{ fontWeight:700, fontSize:14, minWidth:80, color:"#e2e8f0" }}>{DAYS_FULL[i]}</span>
              <div style={{ display:"flex", gap:4, flex:1 }}>
                {SHIFTS.map(sh => <button key={sh} onClick={() => setSched(s => ({ ...s, [day]: sh }))} style={{ flex:1, padding:"8px 0", borderRadius:8, border:"none", fontSize:13, fontWeight:600, cursor:"pointer", background: sched[day]===sh ? "#6366f1" : "rgba(255,255,255,0.06)", color: sched[day]===sh ? "#fff" : "#64748b", transition:"all .15s" }}>{sh}</button>)}
              </div>
              <label style={{ display:"flex", alignItems:"center", gap:4, fontSize:11, color:"#64748b", cursor:"pointer", whiteSpace:"nowrap" }}>
                <input type="checkbox" checked={sched[`${day}_ho`]||false} onChange={e => setSched(s => ({ ...s, [`${day}_ho`]: e.target.checked }))} style={{ accentColor:"#22c55e" }} /> HO
              </label>
            </div>
          ))}
        </div>
        <Btn primary disabled={saving} onClick={save} style={{ width:"100%", padding:"12px 0", fontSize:15, marginTop:20 }}>{saving ? "Ukládám..." : "Uložit stálý rozvrh"}</Btn>
        <p style={{ textAlign:"center", fontSize:11, color:"#475569", marginTop:10 }}>Změny stálého rozvrhu pak provádí admin.</p>
      </div>
    </div>
  );
}

// ═══════ AUTH ═══════
function AuthScreen() {
  const [mode, setMode] = useState("login"); const [login, setLogin] = useState(""); const [pass, setPass] = useState("");
  const [remember, setRemember] = useState(false); const [err, setErr] = useState(""); const [loading, setLoading] = useState(false);
  const [rn, setRn] = useState(""); const [rEmail, setREmail] = useState(""); const [rp, setRp] = useState(""); const [rp2, setRp2] = useState("");
  const [rt, setRt] = useState("L1"); const [rNotify, setRNotify] = useState(false); const [rNotifEmail, setRNotifEmail] = useState("");
  const doLogin = async () => { setErr(""); setLoading(true); try { if (login==="Admin"&&pass==="0000") await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_FB_PASS); else await signInWithEmailAndPassword(auth, login, pass); } catch(e) { setErr(e.code==="auth/invalid-credential"?"Neplatné údaje":e.message); } setLoading(false); };
  const doReg = async () => { setErr(""); setLoading(true); try { if(!rn.trim()||!rEmail||!rp){setErr("Vyplňte povinná pole");setLoading(false);return;} if(rp!==rp2){setErr("Hesla se neshodují");setLoading(false);return;} if(rp.length<6){setErr("Heslo min. 6 znaků");setLoading(false);return;} if(rNotify&&!rNotifEmail.includes("@")){setErr("Zadejte platný email");setLoading(false);return;} const cred=await createUserWithEmailAndPassword(auth,rEmail,rp); await updateProfile(cred.user,{displayName:rn.trim()}); await setDoc(doc(db,"users",cred.user.uid),{name:rn.trim(),email:rEmail,team:rt,role:"employee",notify:rNotify,notifyEmail:rNotify?rNotifEmail:"",fcmToken:null,defaultSchedule:null,setupDone:false,vacationTotal:20,sickTotal:5,whateverTotal:3,vacationUsed:0,sickUsed:0,whateverUsed:0,createdAt:new Date().toISOString()}); } catch(e) { setErr(e.code==="auth/email-already-in-use"?"Email registrován":e.message); } setLoading(false); };
  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"linear-gradient(140deg, #080818, #12122e, #0a0a1c)", fontFamily:"'DM Sans', sans-serif" }}>
      <div style={{ width:410, padding:40, borderRadius:24, background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.07)", backdropFilter:"blur(40px)", animation:"slideUp .4s" }}>
        <div style={{ textAlign:"center", marginBottom:28 }}><div style={{ fontSize:48, marginBottom:6, filter:"drop-shadow(0 0 20px rgba(99,102,241,0.4))" }}>📅</div><h1 style={{ fontSize:26, fontWeight:800, color:"#e2e8f0", margin:0, letterSpacing:-1 }}>ShiftFlow</h1><p style={{ color:"#475569", fontSize:13, marginTop:4 }}>Inteligentní správa směn</p></div>
        <div style={{ display:"flex", marginBottom:24, borderRadius:10, overflow:"hidden", border:"1px solid rgba(255,255,255,0.08)" }}>{["login","register"].map(m=><button key={m} onClick={()=>{setMode(m);setErr("");}} style={{ flex:1, padding:"9px 0", border:"none", fontSize:13, fontWeight:600, cursor:"pointer", background:mode===m?"rgba(99,102,241,0.2)":"rgba(255,255,255,0.03)", color:mode===m?"#a5b4fc":"#64748b" }}>{m==="login"?"Přihlášení":"Registrace"}</button>)}</div>
        {mode==="login"?<><Input label="Email (nebo 'Admin')" value={login} onChange={e=>setLogin(e.target.value)} placeholder="vas@email.cz nebo Admin" /><Input label="Heslo" type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="••••••" onKeyDown={e=>e.key==="Enter"&&doLogin()} /><div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16 }}><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)} style={{ accentColor:"#6366f1" }} /><span style={{ fontSize:12, color:"#64748b" }}>Zapamatovat si mě</span><span style={{ marginLeft:"auto", fontSize:11, color:"#6366f1", cursor:"pointer" }}>🔐 Biometrie</span></div></>:<><Input label="Celé jméno *" value={rn} onChange={e=>setRn(e.target.value)} placeholder="Jan Novák" /><Input label="Přihlašovací email *" value={rEmail} onChange={e=>setREmail(e.target.value)} placeholder="vas@email.cz" /><Input label="Heslo * (min. 6 znaků)" type="password" value={rp} onChange={e=>setRp(e.target.value)} /><Input label="Heslo znovu *" type="password" value={rp2} onChange={e=>setRp2(e.target.value)} /><Select label="Tým *" value={rt} onChange={e=>setRt(e.target.value)} options={[{value:"L1",label:"L1 Support"},{value:"SD",label:"Service Desk"}]} /><div style={{ background:"rgba(255,255,255,0.03)", borderRadius:12, padding:14, marginBottom:14, border:"1px solid rgba(255,255,255,0.06)" }}><Toggle checked={rNotify} onChange={setRNotify} label="Dostávat upozornění na změny" />{rNotify&&<Input label="Email pro notifikace *" type="email" value={rNotifEmail} onChange={e=>setRNotifEmail(e.target.value)} placeholder="notifikace@email.cz" style={{ marginBottom:0 }} />}</div></>}
        {err&&<p style={{ color:"#fca5a5", fontSize:12, margin:"0 0 12px", padding:"6px 10px", borderRadius:8, background:"rgba(239,68,68,0.1)" }}>{err}</p>}
        <Btn primary disabled={loading} onClick={mode==="login"?doLogin:doReg} style={{ width:"100%", padding:"12px 0", fontSize:15 }}>{loading?"Načítání...":mode==="login"?"Přihlásit se":"Zaregistrovat se"}</Btn>
        {mode==="login"&&<p style={{ textAlign:"center", fontSize:11, color:"#334155", marginTop:16 }}>Admin: <b>Admin</b> / <b>0000</b></p>}
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
    {["L1","SD"].map(team => <div key={team} style={{ marginBottom:24 }}>
      <h4 style={{ fontSize:14, fontWeight:700, color:team==="L1"?"#a5b4fc":"#67e8f9", marginBottom:10 }}>{TEAMS[team]}</h4>
      <div style={{ overflowX:"auto", borderRadius:12, border:"1px solid rgba(255,255,255,0.06)" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
          <thead><tr style={{ background:"rgba(255,255,255,0.03)" }}>
            <th style={{ padding:"8px 12px", textAlign:"left", color:"#94a3b8", fontWeight:600, borderBottom:"1px solid rgba(255,255,255,0.06)" }}>Zaměstnanec</th>
            {DAYS.map(d=><th key={d} style={{ padding:"8px 6px", textAlign:"center", color:"#94a3b8", fontWeight:600, borderBottom:"1px solid rgba(255,255,255,0.06)" }}>{d}</th>)}
            <th style={{ padding:"8px", borderBottom:"1px solid rgba(255,255,255,0.06)" }}></th>
          </tr></thead>
          <tbody>{employees.filter(e=>e.team===team&&e.role!=="admin").map(emp=><tr key={emp.id} style={{ borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
            <td style={{ padding:"8px 12px", fontWeight:600, color:"#e2e8f0" }}>{emp.name} {!emp.setupDone&&<Badge small color="#f59e0b">Nenastaveno</Badge>}</td>
            {DAYS.map(d=><td key={d} style={{ padding:"6px", textAlign:"center" }}>{emp.setupDone&&emp.defaultSchedule?.[d]?<span style={{ display:"inline-flex", alignItems:"center", gap:2 }}><span style={{ fontFamily:"'JetBrains Mono',monospace", color:"#a5b4fc", fontSize:11 }}>{emp.defaultSchedule[d]}</span>{emp.defaultSchedule[`${d}_ho`]&&<Badge small color="#22c55e">HO</Badge>}</span>:<span style={{ color:"#334155" }}>—</span>}</td>)}
            <td style={{ padding:"6px 8px", textAlign:"right" }}><div style={{ display:"flex", gap:4, justifyContent:"flex-end" }}><Btn small onClick={()=>startEdit(emp)}>✏️</Btn>{emp.setupDone&&<Btn small danger onClick={()=>removeFrom(emp.id)}>✕</Btn>}</div></td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>)}
    <Modal open={!!editEmp} onClose={()=>setEditEmp(null)} title={`Stálý rozvrh – ${editEmp?.name}`}>{editEmp&&<div>
      <p style={{ fontSize:13, color:"#64748b", marginBottom:16 }}>Nastavte směnu pro každý den.</p>
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {DAYS.map((day,i)=><div key={day} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px", borderRadius:10, background:"rgba(255,255,255,0.03)" }}>
          <span style={{ fontWeight:700, fontSize:13, minWidth:70, color:"#e2e8f0" }}>{DAYS_FULL[i]}</span>
          <div style={{ display:"flex", gap:3, flex:1 }}>{SHIFTS.map(sh=><button key={sh} onClick={()=>setEditSched(s=>({...s,[day]:sh}))} style={{ flex:1, padding:"7px 0", borderRadius:7, border:"none", fontSize:12, fontWeight:600, cursor:"pointer", background:editSched[day]===sh?"#6366f1":"rgba(255,255,255,0.06)", color:editSched[day]===sh?"#fff":"#64748b", transition:"all .15s" }}>{sh}</button>)}</div>
          <label style={{ display:"flex", alignItems:"center", gap:4, fontSize:11, color:"#64748b", cursor:"pointer" }}><input type="checkbox" checked={editSched[`${day}_ho`]||false} onChange={e=>setEditSched(s=>({...s,[`${day}_ho`]:e.target.checked}))} style={{ accentColor:"#22c55e" }} /> HO</label>
        </div>)}
      </div>
      <div style={{ display:"flex", gap:8, marginTop:16 }}><Btn primary disabled={saving} onClick={saveEdit} style={{ flex:1 }}>{saving?"Ukládám...":"Uložit"}</Btn><Btn ghost onClick={()=>setEditEmp(null)}>Zrušit</Btn></div>
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
  const addAbsence = async (eid,day,type) => { const s=dc(curSched);SHIFTS.forEach(sh=>{if(s[day]?.[sh])s[day][sh]=s[day][sh].filter(e=>e.empId!==eid);});await saveSched(s);await setDoc(doc(db,"schedules",wk),{[`absences.${eid}-${day}`]:type},{merge:true});const emp=getEmp(eid);if(emp){const field=type==="sick"?"sickUsed":type==="vacation"?"vacationUsed":type==="whatever"?"whateverUsed":null;if(field)await updateDoc(doc(db,"users",eid),{[field]:(emp[field]||0)+1});}const al=ABSENCE_TYPES.find(a=>a.id===type)?.label;const msg=`${emp?.name}: ${al} (${day})`;notify(msg);log(msg);emailNotif(emp,msg); };
  const addEvent = async (day,eventType,note) => { await setDoc(doc(db,"schedules",wk),{[`events.${day}`]:{type:eventType,note,title:EVENT_TYPES.find(e=>e.id===eventType)?.label}},{merge:true});const msg=`Událost: ${EVENT_TYPES.find(e=>e.id===eventType)?.label} — ${day}`;notify(msg);log(msg); };
  const createSwap = async (rid,day,sh) => { await addDoc(collection(db,"swapRequests"),{rid,day,sh,week:wk,status:"open",created:new Date().toISOString()});notify(`Výměna: ${getEmp(rid)?.name} – ${day} ${sh}`);log(`Swap: ${getEmp(rid)?.name} – ${day} ${sh}`); };
  const acceptSwap = async (swId,aid) => { const sw=swaps.find(s=>s.id===swId);if(!sw)return;await updateDoc(doc(db,"swapRequests",swId),{status:"done",aid,resolvedAt:new Date().toISOString()});const s=dc(curSched);let aDay,aSh;DAYS.forEach(d=>SHIFTS.forEach(sh=>{if(s[d]?.[sh]?.some(e=>e.empId===aid)&&!aDay){aDay=d;aSh=sh;}}));if(aDay&&aSh&&s[sw.day]?.[sw.sh]){const ri=s[sw.day][sw.sh].findIndex(e=>e.empId===sw.rid);const ai=s[aDay][aSh].findIndex(e=>e.empId===aid);if(ri!==-1&&ai!==-1){const rE=s[sw.day][sw.sh][ri];const aE=s[aDay][aSh][ai];s[sw.day][sw.sh][ri]={...aE,isDefault:false};s[aDay][aSh][ai]={...rE,isDefault:false};await saveSched(s);}}const re=getEmp(sw.rid);const ae=getEmp(aid);const msg=`Výměna: ${re?.name} ↔ ${ae?.name}`;notify(msg);log(msg);emailNotif(re,msg);emailNotif(ae,msg); };
  const exportCSV = () => { let csv="\ufeffDen,Směna,Zaměstnanec,Tým,HO\n";DAYS.forEach(day=>{SHIFTS.forEach(sh=>{(curSched[day]?.[sh]||[]).forEach(en=>{const e=getEmp(en.empId);if(e)csv+=`${day},${sh},${e.name},${e.team},${en.ho?"Ano":"Ne"}\n`;});});});const b=new Blob([csv],{type:"text/csv;charset=utf-8;"});const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download=`rozvrh_${wk}.csv`;a.click();URL.revokeObjectURL(u); };

  if (authUser===undefined) return <div style={{ minHeight:"100vh", background:"#080818", display:"flex", alignItems:"center", justifyContent:"center", color:"#64748b", fontFamily:"'DM Sans',sans-serif" }}><div style={{ textAlign:"center" }}><div style={{ fontSize:48, marginBottom:12, animation:"pulse 1.5s infinite" }}>📅</div>Načítání…</div></div>;
  if (!authUser) return <AuthScreen />;
  if (!profile) return <div style={{ minHeight:"100vh", background:"#080818", display:"flex", alignItems:"center", justifyContent:"center", color:"#64748b", fontFamily:"'DM Sans',sans-serif" }}>Načítání profilu…</div>;
  if (!isAdmin && !profile.setupDone) return <ScheduleSetup profile={profile} onDone={() => setProfile(p => ({ ...p, setupDone: true }))} />;

  const openSwaps = swaps.filter(s=>s.status==="open"&&s.week===wk);

  return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(155deg, #080818, #10102a 35%, #0c0c1e)", fontFamily:"'DM Sans',sans-serif", color:"#e2e8f0" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes slideUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}@keyframes glow{0%,100%{box-shadow:0 0 6px #6366f133}50%{box-shadow:0 0 18px #6366f155}}@keyframes slideIn{from{transform:translateX(80px);opacity:0}to{transform:translateX(0);opacity:1}}*{box-sizing:border-box;scrollbar-width:thin;scrollbar-color:#1e293b transparent}.chg{animation:glow 2s infinite}.tst{animation:slideIn .3s ease-out}.ent{transition:all .2s;cursor:pointer}.ent:hover{transform:translateY(-1px);background:rgba(255,255,255,0.08)!important}.nb{transition:all .15s}.nb:hover{background:rgba(255,255,255,0.06)!important}.wb:hover{background:rgba(99,102,241,0.12)!important}`}</style>

      <div style={{ position:"fixed", top:16, right:16, zIndex:9999, display:"flex", flexDirection:"column", gap:8, maxWidth:360 }}>{notifs.map(n=><div key={n.id} className="tst" style={{ background:"rgba(99,102,241,0.12)", border:"1px solid rgba(99,102,241,0.25)", borderRadius:12, padding:"10px 16px", fontSize:13, color:"#c7d2fe", backdropFilter:"blur(16px)", display:"flex", gap:8, alignItems:"center" }}><span>🔔</span><span style={{ flex:1 }}>{n.msg}</span><span style={{ fontSize:10, color:"#6366f1" }}>{n.time}</span></div>)}</div>

      <header style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 20px", borderBottom:"1px solid rgba(255,255,255,0.05)", background:"rgba(8,8,24,0.85)", backdropFilter:"blur(24px)", position:"sticky", top:0, zIndex:100, flexWrap:"wrap", gap:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}><span style={{ fontSize:26 }}>📅</span><div><h1 style={{ margin:0, fontSize:17, fontWeight:800, letterSpacing:-.5 }}>ShiftFlow</h1><span style={{ fontSize:9, color:"#475569", letterSpacing:.5 }}>SHIFT MANAGEMENT</span></div></div>
        <nav style={{ display:"flex", gap:2, flexWrap:"wrap" }}>{[{id:"schedule",label:"Rozvrh",icon:"📋"},{id:"swaps",label:"Výměny",icon:"🔄",badge:openSwaps.length},{id:"people",label:"Tým",icon:"👥"},{id:"stats",label:"Přehled",icon:"📊"},{id:"log",label:"Log",icon:"📜"},...(isAdmin?[{id:"defaults",label:"Stálý rozvrh",icon:"📐"},{id:"settings",label:"Nastavení",icon:"⚙️"}]:[])].map(t=><button key={t.id} className="nb" onClick={()=>setView(t.id)} style={{ padding:"7px 10px", borderRadius:8, border:"none", background:view===t.id?"rgba(99,102,241,0.18)":"transparent", color:view===t.id?"#a5b4fc":"#64748b", fontSize:11, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}>{t.icon} {t.label}{t.badge>0&&<span style={{ background:"#ef4444", color:"#fff", borderRadius:99, padding:"0 5px", fontSize:9 }}>{t.badge}</span>}</button>)}</nav>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}><Badge color={isAdmin?"#f59e0b":"#22c55e"} small>{isAdmin?"Admin":"Zaměstnanec"}</Badge><span style={{ fontSize:13, color:"#94a3b8" }}>{profile.name}</span><button onClick={()=>signOut(auth)} style={{ background:"none", border:"none", color:"#475569", cursor:"pointer", fontSize:12 }}>↪</button></div>
      </header>

      <main style={{ padding:"20px 24px", maxWidth:1440, margin:"0 auto" }}>
        {view==="schedule"&&<div style={{ animation:"fadeIn .3s" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:18, flexWrap:"wrap", gap:10 }}>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <button className="wb" onClick={()=>setWeekOffset(w=>w-1)} style={{ width:30,height:30,borderRadius:8,border:"1px solid rgba(255,255,255,0.1)",background:"transparent",color:"#94a3b8",cursor:"pointer",fontSize:15 }}>‹</button>
              <div style={{ textAlign:"center", minWidth:190 }}><div style={{ fontSize:14, fontWeight:700 }}>{fmtWeek(curWeek)}</div><div style={{ fontSize:10, color:"#475569" }}>{weekOffset===0?"Tento týden":weekOffset===1?"Příští":weekOffset===-1?"Minulý":`${weekOffset>0?"+":""}${weekOffset}t`}</div></div>
              <button className="wb" onClick={()=>setWeekOffset(w=>w+1)} style={{ width:30,height:30,borderRadius:8,border:"1px solid rgba(255,255,255,0.1)",background:"transparent",color:"#94a3b8",cursor:"pointer",fontSize:15 }}>›</button>
              {weekOffset!==0&&<Btn small ghost onClick={()=>setWeekOffset(0)}>Dnes</Btn>}
            </div>
            <div style={{ display:"flex", gap:4 }}>
              <Pill active={teamFilter==="all"} onClick={()=>setTeamFilter("all")} count={employees.filter(e=>e.setupDone).length}>Vše</Pill>
              <Pill active={teamFilter==="L1"} onClick={()=>setTeamFilter("L1")} color="#6366f1" count={employees.filter(e=>e.team==="L1"&&e.setupDone).length}>L1</Pill>
              <Pill active={teamFilter==="SD"} onClick={()=>setTeamFilter("SD")} color="#06b6d4" count={employees.filter(e=>e.team==="SD"&&e.setupDone).length}>SD</Pill>
            </div>
            <div style={{ display:"flex", gap:6 }}>{isAdmin&&<><Btn small onClick={()=>setModal("absence")}>+ Nepřít.</Btn><Btn small onClick={()=>setModal("event")}>+ Událost</Btn></>}<Btn small ghost onClick={exportCSV}>📥 CSV</Btn></div>
          </div>
          {allWarn.length>0&&<Card style={{ marginBottom:14,borderColor:"rgba(239,68,68,0.25)",background:"rgba(239,68,68,0.04)",padding:12 }}><div style={{ fontSize:12,fontWeight:700,color:"#fca5a5",marginBottom:4 }}>⚠️ Porušení ({allWarn.length})</div>{allWarn.map((w,i)=><div key={i} style={{ fontSize:11,color:"#fca5a5",padding:"1px 0" }}>• {w}</div>)}</Card>}
          <div style={{ overflowX:"auto", borderRadius:14, border:"1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ display:"grid", gridTemplateColumns:"70px repeat(5,1fr)", minWidth:880 }}>
              <div style={{ background:"rgba(255,255,255,0.03)", padding:10, borderBottom:"1px solid rgba(255,255,255,0.05)" }} />
              {DAYS.map((d,i)=>{const ev=events[d];return<div key={d} style={{ textAlign:"center",padding:"8px 4px",background:"rgba(255,255,255,0.03)",borderBottom:"1px solid rgba(255,255,255,0.05)",borderLeft:"1px solid rgba(255,255,255,0.03)" }}><div style={{ fontSize:13,fontWeight:700 }}>{DAYS_FULL[i]}</div>{ev&&<div style={{ marginTop:3 }}><Badge small color="#f59e0b">{EVENT_TYPES.find(e=>e.id===ev.type)?.icon} {ev.note||ev.title||""}</Badge></div>}</div>;})}
              {SHIFTS.map(shift=><>
                <div key={`l${shift}`} style={{ display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(255,255,255,0.02)",fontFamily:"'JetBrains Mono',monospace",fontSize:13,fontWeight:600,color:"#64748b",borderBottom:"1px solid rgba(255,255,255,0.04)" }}>{shift}</div>
                {DAYS.map(day=>{const entries=(curSched[day]?.[shift]||[]).filter(e=>{const emp=getEmp(e.empId);return emp&&(teamFilter==="all"||emp.team===teamFilter);});
                  return<div key={`${day}-${shift}`} style={{ background:"rgba(255,255,255,0.015)",padding:4,minHeight:62,borderLeft:"1px solid rgba(255,255,255,0.03)",borderBottom:"1px solid rgba(255,255,255,0.04)" }}
                    onDragOver={e=>{if(isAdmin){e.preventDefault();e.currentTarget.style.background="rgba(99,102,241,0.08)";}}} onDragLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,0.015)";}} onDrop={e=>{e.currentTarget.style.background="rgba(255,255,255,0.015)";if(!isAdmin)return;try{const d=JSON.parse(e.dataTransfer.getData("text/plain"));if(d.day!==day||d.shift!==shift)moveEmp(d.empId,d.day,d.shift,day,shift);}catch{}}}>
                    {entries.map(en=>{const emp=getEmp(en.empId);if(!emp)return null;const ch=isChanged(day,shift,en.empId);const tc=emp.team==="L1"?"#6366f1":"#06b6d4";
                      return<div key={en.empId} className={`ent ${ch?"chg":""}`} draggable={isAdmin} onDragStart={e=>isAdmin&&e.dataTransfer.setData("text/plain",JSON.stringify({empId:en.empId,day,shift}))} onClick={()=>isAdmin?setSelectedCell({day,shift,empId:en.empId}):profile.id===en.empId&&setModal({type:"swap",day,shift})} style={{ display:"flex",alignItems:"center",gap:4,padding:"3px 6px",borderRadius:7,marginBottom:2,background:ch?"rgba(99,102,241,0.1)":"rgba(255,255,255,0.03)",border:`1px solid ${ch?"rgba(99,102,241,0.25)":"rgba(255,255,255,0.05)"}`,fontSize:11 }}>
                        <span style={{ width:5,height:5,borderRadius:"50%",background:tc,flexShrink:0 }}/><span style={{ fontWeight:600,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{emp.name?.split(" ").pop()}</span>{en.ho&&<Badge small color="#22c55e">HO</Badge>}{ch&&<span style={{ fontSize:8,color:"#a5b4fc" }}>✦</span>}
                      </div>;})}
                  </div>;})}
              </>)}
              <div style={{ display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:600,color:"#475569",background:"rgba(255,255,255,0.02)" }}>Nepřít.</div>
              {DAYS.map(day=>{const dayAbs=Object.entries(absences).filter(([k])=>k.endsWith(`-${day}`)).map(([k,type])=>({empId:k.replace(`-${day}`,""),type})).filter(a=>{const e=getEmp(a.empId);return e&&(teamFilter==="all"||e.team===teamFilter);});return<div key={`a-${day}`} style={{ background:"rgba(255,255,255,0.01)",padding:4,minHeight:30,borderLeft:"1px solid rgba(255,255,255,0.03)" }}>{dayAbs.map(a=>{const e=getEmp(a.empId);const at=ABSENCE_TYPES.find(t=>t.id===a.type);return e&&<div key={a.empId} style={{ display:"flex",alignItems:"center",gap:3,padding:"2px 5px",borderRadius:5,marginBottom:1,background:at?.color+"14",border:`1px solid ${at?.color}25`,fontSize:10 }}><span>{at?.icon}</span><span style={{ fontWeight:600 }}>{e.name?.split(" ").pop()}</span></div>;})}</div>;})}
            </div>
          </div>
          <div style={{ display:"flex", gap:12, marginTop:12, flexWrap:"wrap", fontSize:11, color:"#475569" }}>
            <span style={{ display:"flex",alignItems:"center",gap:4 }}><span style={{ width:6,height:6,borderRadius:"50%",background:"#6366f1" }}/>L1</span>
            <span style={{ display:"flex",alignItems:"center",gap:4 }}><span style={{ width:6,height:6,borderRadius:"50%",background:"#06b6d4" }}/>SD</span>
            <Badge small color="#22c55e">HO</Badge><span style={{ color:"#a5b4fc" }}>✦ Změna oproti stálému</span>
            {isAdmin?<span>💡 Drag & drop</span>:<span>💡 Klik na svou směnu → výměna</span>}
          </div>
        </div>}

        {view==="swaps"&&<div style={{ animation:"fadeIn .3s" }}>
          <h2 style={{ fontSize:20,fontWeight:800,marginBottom:18 }}>🔄 Výměny směn <Badge small color="#6366f1">Free-for-all</Badge></h2>
          {!isAdmin&&<Card style={{ marginBottom:18,borderColor:"rgba(99,102,241,0.15)" }}><p style={{ fontSize:13,color:"#94a3b8",margin:"0 0 10px" }}>Požádej o výměnu – kdokoliv ji může přijmout.</p><Btn primary onClick={()=>setModal({type:"swap",day:DAYS[0],shift:SHIFTS[0]})}>+ Nová žádost</Btn></Card>}
          <h3 style={{ fontSize:13,fontWeight:600,color:"#94a3b8",marginBottom:10 }}>Otevřené ({openSwaps.length})</h3>
          {!openSwaps.length&&<p style={{ fontSize:13,color:"#475569" }}>Žádné otevřené žádosti.</p>}
          {openSwaps.map(sw=>{const re=getEmp(sw.rid);const me=profile.id===sw.rid;const can=!isAdmin&&!me;return<Card key={sw.id} style={{ padding:14,marginBottom:8,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10 }}><div><div style={{ fontWeight:700,fontSize:14 }}>{re?.name||"?"}</div><div style={{ fontSize:12,color:"#64748b" }}>Výměna: <Badge small color="#6366f1">{sw.day} {sw.sh}</Badge></div></div>{can&&<Btn primary small onClick={()=>acceptSwap(sw.id,profile.id)}>Přijmout</Btn>}{me&&<Badge color="#f59e0b">Tvoje</Badge>}</Card>;})}
          {(()=>{const done=swaps.filter(s=>s.status==="done"&&s.week===wk);if(!done.length)return null;return<div style={{ marginTop:20 }}><h3 style={{ fontSize:13,fontWeight:600,color:"#94a3b8",marginBottom:10 }}>Dokončené</h3>{done.map(sw=><Card key={sw.id} style={{ padding:12,marginBottom:6 }}><div style={{ fontSize:13 }}><b>{getEmp(sw.rid)?.name}</b><span style={{ color:"#64748b" }}> ↔ </span><b>{getEmp(sw.aid)?.name}</b> <Badge small color="#22c55e">✓</Badge></div></Card>)}</div>;})()}
        </div>}

        {view==="people"&&<div style={{ animation:"fadeIn .3s" }}>
          <h2 style={{ fontSize:20,fontWeight:800,marginBottom:18 }}>👥 Tým</h2>
          {["L1","SD"].map(team=><div key={team} style={{ marginBottom:24 }}><h3 style={{ fontSize:14,fontWeight:700,color:team==="L1"?"#a5b4fc":"#67e8f9",marginBottom:10 }}>{TEAMS[team]}</h3>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:10 }}>{employees.filter(e=>e.team===team&&e.role!=="admin").map(emp=><Card key={emp.id}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"start" }}><div><div style={{ fontWeight:700,fontSize:14 }}>{emp.name}</div><div style={{ display:"flex",gap:4,marginTop:3 }}><Badge small color={team==="L1"?"#6366f1":"#06b6d4"}>{team}</Badge>{emp.notify&&<Badge small color="#22c55e">📧</Badge>}{!emp.setupDone&&<Badge small color="#f59e0b">Bez rozvrhu</Badge>}</div></div><div style={{ width:34,height:34,borderRadius:"50%",background:`linear-gradient(135deg,${team==="L1"?"#6366f1,#8b5cf6":"#06b6d4,#22d3ee"})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700 }}>{(emp.name||"?").charAt(0)}</div></div>
              {emp.setupDone&&emp.defaultSchedule&&<div style={{ marginTop:10, display:"flex", gap:4, flexWrap:"wrap" }}>{DAYS.map(d=><div key={d} style={{ textAlign:"center", padding:"3px 6px", borderRadius:6, background:"rgba(255,255,255,0.03)", fontSize:10 }}><div style={{ color:"#64748b", fontWeight:600 }}>{d}</div><div style={{ color:"#a5b4fc", fontFamily:"'JetBrains Mono',monospace" }}>{emp.defaultSchedule[d]||"—"}</div></div>)}</div>}
              <div style={{ marginTop:10,display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6 }}>{[{l:"Dovolená",v:(emp.vacationTotal||20)-(emp.vacationUsed||0),c:"#06b6d4"},{l:"Sick",v:(emp.sickTotal||5)-(emp.sickUsed||0),c:"#ef4444"},{l:"Whatever",v:(emp.whateverTotal||3)-(emp.whateverUsed||0),c:"#8b5cf6"}].map(b=><div key={b.l} style={{ textAlign:"center",padding:5,borderRadius:8,background:b.c+"0d" }}><div style={{ fontSize:17,fontWeight:800,color:b.c }}>{b.v}</div><div style={{ fontSize:9,color:"#475569" }}>{b.l}</div></div>)}</div>
            </Card>)}</div></div>)}
        </div>}

        {view==="stats"&&<div style={{ animation:"fadeIn .3s" }}>
          <h2 style={{ fontSize:20,fontWeight:800,marginBottom:18 }}>📊 Přehled</h2>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(170px,1fr))",gap:10,marginBottom:20 }}>{[{l:"Zaměstnanci",v:employees.filter(e=>e.role!=="admin").length,i:"👥",c:"#6366f1"},{l:"S rozvrhem",v:employees.filter(e=>e.setupDone).length,i:"📋",c:"#06b6d4"},{l:"HO",v:Object.values(curSched).flatMap(d=>Object.values(d).flat()).filter(e=>e.ho).length,i:"🏠",c:"#22c55e"},{l:"Výměny",v:openSwaps.length,i:"🔄",c:"#f59e0b"},{l:"Porušení",v:allWarn.length,i:"⚠️",c:allWarn.length?"#ef4444":"#22c55e"}].map(s=><Card key={s.l} glow={s.c}><div style={{ display:"flex",alignItems:"center",gap:8 }}><span style={{ fontSize:24 }}>{s.i}</span><div><div style={{ fontSize:22,fontWeight:800,color:s.c }}>{s.v}</div><div style={{ fontSize:10,color:"#475569" }}>{s.l}</div></div></div></Card>)}</div>
          <Card><h3 style={{ fontSize:13,fontWeight:700,color:"#94a3b8",marginBottom:12 }}>Distribuce</h3>{SHIFTS.map(sh=>{const cnt=Object.values(curSched).flatMap(d=>(d[sh]||[])).length;const mx=employees.filter(e=>e.setupDone).length*5;const p=mx?Math.round(cnt/mx*100):0;return<div key={sh} style={{ marginBottom:10 }}><div style={{ display:"flex",justifyContent:"space-between",fontSize:12,color:"#64748b",marginBottom:3 }}><span style={{ fontFamily:"'JetBrains Mono',monospace" }}>{sh}</span><span>{cnt} ({p}%)</span></div><div style={{ height:7,borderRadius:4,background:"rgba(255,255,255,0.05)" }}><div style={{ height:"100%",borderRadius:4,width:`${p}%`,background:"linear-gradient(90deg,#6366f1,#06b6d4)",transition:"width .5s" }}/></div></div>;})}</Card>
        </div>}

        {view==="log"&&<div style={{ animation:"fadeIn .3s" }}><h2 style={{ fontSize:20,fontWeight:800,marginBottom:18 }}>📜 Historie</h2>{!logs.length&&<p style={{ color:"#475569",fontSize:13 }}>Žádné záznamy.</p>}{logs.map(h=><div key={h.id} style={{ display:"flex",alignItems:"center",gap:8,padding:"7px 10px",borderRadius:8,background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.04)",fontSize:12,marginBottom:3 }}><span style={{ fontSize:10,color:"#475569",fontFamily:"'JetBrains Mono',monospace",minWidth:120 }}>{h.time?new Date(h.time).toLocaleString("cs"):""}</span><span style={{ color:"#94a3b8",flex:1 }}>{h.msg}</span></div>)}</div>}

        {view==="defaults"&&isAdmin&&<div style={{ animation:"fadeIn .3s" }}><h2 style={{ fontSize:20,fontWeight:800,marginBottom:4 }}>📐 Stálý rozvrh</h2><p style={{ fontSize:13, color:"#64748b", marginBottom:18 }}>Výchozí směny zaměstnanců. Týdenní rozvrh se generuje automaticky. Kliknutím na ✏️ upravíte rozvrh zaměstnance.</p><DefaultScheduleEditor employees={employees} /></div>}

        {view==="settings"&&isAdmin&&<div style={{ animation:"fadeIn .3s",maxWidth:560 }}><h2 style={{ fontSize:20,fontWeight:800,marginBottom:18 }}>⚙️ Pravidla</h2>
          <Card style={{ marginBottom:14 }}><Input label="L1: Max agentů/směna" type="number" value={rules.L1_max} onChange={e=>setRules(r=>({...r,L1_max:+e.target.value}))} /><Input label="SD: Max agentů na 8:00" type="number" value={rules.SD_max8} onChange={e=>setRules(r=>({...r,SD_max8:+e.target.value}))} /><Input label="SD: Max HO/den" type="number" value={rules.SD_maxHO} onChange={e=>setRules(r=>({...r,SD_maxHO:+e.target.value}))} /><Toggle checked={rules.SD_noHO8} onChange={v=>setRules(r=>({...r,SD_noHO8:v}))} label="SD: Zákaz HO na 08:00" /><Toggle checked={rules.SD_noHO10} onChange={v=>setRules(r=>({...r,SD_noHO10:v}))} label="SD: Zákaz HO na 10:00" /><Btn primary onClick={async()=>{await setDoc(doc(db,"rules","global"),rules);notify("Pravidla uložena ✓");}} style={{ marginTop:6 }}>Uložit</Btn></Card>
          <Card><h3 style={{ fontSize:13,fontWeight:700,color:"#94a3b8",marginBottom:10 }}>Správa</h3><div style={{ display:"flex",gap:8,flexWrap:"wrap" }}><Btn danger onClick={async()=>{try{await deleteDoc(doc(db,"schedules",wk));notify("Reset ✓");}catch{}}}>Reset týden</Btn><Btn ghost onClick={exportCSV}>📥 CSV</Btn></div></Card>
        </div>}
      </main>

      <Modal open={!!selectedCell} onClose={()=>setSelectedCell(null)} title="Akce">{selectedCell&&(()=>{const emp=getEmp(selectedCell.empId);if(!emp)return null;return<div>
        <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:14,padding:10,borderRadius:10,background:"rgba(255,255,255,0.03)" }}><div style={{ width:34,height:34,borderRadius:"50%",background:`linear-gradient(135deg,${emp.team==="L1"?"#6366f1,#8b5cf6":"#06b6d4,#22d3ee"})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700 }}>{(emp.name||"?").charAt(0)}</div><div><div style={{ fontWeight:700 }}>{emp.name}</div><div style={{ fontSize:12,color:"#64748b" }}>{selectedCell.day} · {selectedCell.shift}</div></div></div>
        <Btn onClick={()=>{toggleHO(selectedCell.day,selectedCell.shift,selectedCell.empId);setSelectedCell(null);}} style={{ width:"100%",marginBottom:6 }}>🏠 Toggle HO</Btn>
        <div style={{ fontSize:11,color:"#64748b",margin:"10px 0 4px",fontWeight:600 }}>Přesunout</div><div style={{ display:"flex",gap:6 }}>{SHIFTS.filter(s=>s!==selectedCell.shift).map(s=><Btn key={s} small style={{ flex:1 }} onClick={()=>{moveEmp(selectedCell.empId,selectedCell.day,selectedCell.shift,selectedCell.day,s);setSelectedCell(null);}}>→ {s}</Btn>)}</div>
        <div style={{ fontSize:11,color:"#64748b",margin:"10px 0 4px",fontWeight:600 }}>Nepřítomnost</div><div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:4 }}>{ABSENCE_TYPES.map(a=><Btn key={a.id} small onClick={()=>{addAbsence(selectedCell.empId,selectedCell.day,a.id);setSelectedCell(null);}}>{a.icon} {a.label}</Btn>)}</div>
      </div>;})()}</Modal>
      <Modal open={modal==="absence"} onClose={()=>setModal(null)} title="Nepřítomnost"><AbsForm emps={employees.filter(e=>e.role!=="admin"&&(teamFilter==="all"||e.team===teamFilter))} onSubmit={(eid,day,t)=>{addAbsence(eid,day,t);setModal(null);}}/></Modal>
      <Modal open={modal==="event"} onClose={()=>setModal(null)} title="Událost"><EvForm onSubmit={(d,t,n)=>{addEvent(d,t,n);setModal(null);}}/></Modal>
      <Modal open={modal?.type==="swap"} onClose={()=>setModal(null)} title="Žádost o výměnu"><SwForm dDay={modal?.day} dShift={modal?.shift} onSubmit={(d,s)=>{createSwap(profile.id,d,s);setModal(null);}}/></Modal>
    </div>
  );
}

function AbsForm({emps,onSubmit}){const[eid,setEid]=useState(emps[0]?.id||"");const[day,setDay]=useState(DAYS[0]);const[t,setT]=useState(ABSENCE_TYPES[0].id);return<div><Select label="Zaměstnanec" value={eid} onChange={e=>setEid(e.target.value)} options={emps.map(e=>({value:e.id,label:e.name}))}/><Select label="Den" value={day} onChange={e=>setDay(e.target.value)} options={DAYS.map((d,i)=>({value:d,label:DAYS_FULL[i]}))}/><Select label="Typ" value={t} onChange={e=>setT(e.target.value)} options={ABSENCE_TYPES.map(a=>({value:a.id,label:`${a.icon} ${a.label}`}))}/><Btn primary onClick={()=>onSubmit(eid,day,t)} style={{marginTop:8}}>Přidat</Btn></div>;}
function EvForm({onSubmit}){const[day,setDay]=useState(DAYS[0]);const[t,setT]=useState(EVENT_TYPES[0].id);const[n,setN]=useState("");return<div><Select label="Den" value={day} onChange={e=>setDay(e.target.value)} options={DAYS.map((d,i)=>({value:d,label:DAYS_FULL[i]}))}/><Select label="Typ" value={t} onChange={e=>setT(e.target.value)} options={EVENT_TYPES.map(e=>({value:e.id,label:`${e.icon} ${e.label}`}))}/><Input label="Poznámka" value={n} onChange={e=>setN(e.target.value)}/><Btn primary onClick={()=>onSubmit(day,t,n)} style={{marginTop:8}}>Přidat</Btn></div>;}
function SwForm({dDay,dShift,onSubmit}){const[day,setDay]=useState(dDay||DAYS[0]);const[sh,setSh]=useState(dShift||SHIFTS[0]);return<div><p style={{fontSize:13,color:"#94a3b8",margin:"0 0 12px"}}>Kdokoliv ji může přijmout – směny se automaticky prohodí.</p><Select label="Den" value={day} onChange={e=>setDay(e.target.value)} options={DAYS.map((d,i)=>({value:d,label:DAYS_FULL[i]}))}/><Select label="Směna" value={sh} onChange={e=>setSh(e.target.value)} options={SHIFTS.map(s=>({value:s,label:s}))}/><Btn primary onClick={()=>onSubmit(day,sh)} style={{marginTop:8,width:"100%"}}>Odeslat žádost</Btn></div>;}
