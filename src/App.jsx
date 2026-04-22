import { useState, useEffect, useMemo, useRef } from "react";
import { auth, db, getMsg } from "./firebase";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, onSnapshot } from "firebase/firestore";
import { getToken, onMessage } from "firebase/messaging";

const TEAMS={L1:"L1 Support",SD:"Service Desk"};
const SHIFTS=["08:00","09:00","10:00"];
const DAYS=["Po","Út","St","Čt","Pá"];
const DAYS_F=["Pondělí","Úterý","Středa","Čtvrtek","Pátek"];
const ABS=[{id:"sick",label:"Sick Day",icon:"🤒",color:"#c04040"},{id:"doctor",label:"Lékař",icon:"🏥",color:"#d48020"},{id:"vacation",label:"Dovolená",icon:"🏖️",color:"#4080b0"},{id:"whatever",label:"Whatever Day",icon:"☕",color:"#8070b0"}];
const EVTS=[{id:"training",label:"Školení",icon:"📚"},{id:"dinner",label:"Večeře",icon:"🍽️"},{id:"teambuilding",label:"Teambuilding",icon:"🎯"},{id:"meeting",label:"Porada",icon:"💬"},{id:"other",label:"Jiné",icon:"📌"}];
const AE="admin@shiftflow.app",AP="ShiftFlowAdmin2026!";
const dc=o=>JSON.parse(JSON.stringify(o));
const uid=()=>"u"+Math.random().toString(36).slice(2,9);
function getMon(d){const dt=new Date(d);const dy=dt.getDay();dt.setDate(dt.getDate()-dy+(dy===0?-6:1));dt.setHours(0,0,0,0);return dt}
const wKey=d=>getMon(d).toISOString().slice(0,10);
const fmtW=d=>{const m=getMon(d),f=new Date(m);f.setDate(f.getDate()+4);return`${m.getDate()}.${m.getMonth()+1}. — ${f.getDate()}.${f.getMonth()+1}.${f.getFullYear()}`};
function buildDef(emps){const s={};DAYS.forEach(day=>{s[day]={};SHIFTS.forEach(sh=>s[day][sh]=[]);emps.forEach(emp=>{if(!emp.defaultSchedule||!emp.setupDone)return;const shift=emp.defaultSchedule[day];if(shift&&SHIFTS.includes(shift))s[day][shift].push({empId:emp.id,ho:emp.defaultSchedule[`${day}_ho`]||false,isDefault:true})})});return s}
const GAS=import.meta.env.VITE_GAS_URL;
async function callGAS(a,d){if(!GAS)return;try{await fetch(GAS,{method:"POST",headers:{"Content-Type":"text/plain"},body:JSON.stringify({action:a,data:d})})}catch{}}
async function initPush(u){try{const m=await getMsg();if(!m)return;if((await Notification.requestPermission())!=="granted")return;const v=import.meta.env.VITE_FIREBASE_VAPID_KEY;if(!v)return;const t=await getToken(m,{vapidKey:v});await updateDoc(doc(db,"users",u),{fcmToken:t});onMessage(m,p=>{if(p.notification)new Notification(p.notification.title||"SF",{body:p.notification.body,icon:"/icon-192.png"})})}catch{}}

// ═══ STARFIELD THEME SYSTEM ═══
const CSS=`
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@300;400;500;600;700&family=Barlow:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

/* LIGHT THEME (Starfield character creation) */
:root, [data-theme="light"] {
  --bg: #bec4d0;
  --bg2: rgba(195,200,212,.55);
  --bg3: rgba(185,192,208,.45);
  --bg4: rgba(175,182,200,.5);
  --panel: rgba(200,206,218,.65);
  --card: rgba(190,198,214,.5);
  --card-h: rgba(180,188,206,.65);
  --brd: rgba(90,100,125,.18);
  --brd2: rgba(70,80,105,.25);
  --tx: #2e3440;
  --tx2: #555e70;
  --tx3: #7a8290;
  --w: #1a1e28;
  --acc: #3a4558;
  --acc2: #d47820;
  --acc3: #c05828;
  --l1: #5050d0;
  --sd: #2878a8;
  --red: #b83030;
  --grn: #388040;
  --amb: #c87020;
  --sel: #2e3848;
  --sel-tx: #e8eaf0;
  --blur: blur(20px);
  --glass: rgba(200,206,218,.7);
}

/* DARK THEME */
[data-theme="dark"] {
  --bg: #0c0c12;
  --bg2: rgba(18,18,28,.85);
  --bg3: rgba(24,24,36,.8);
  --bg4: rgba(30,30,44,.8);
  --panel: rgba(16,16,26,.85);
  --card: rgba(20,20,32,.7);
  --card-h: rgba(28,28,42,.8);
  --brd: rgba(255,255,255,.08);
  --brd2: rgba(255,255,255,.12);
  --tx: #c0c4d0;
  --tx2: #7880a0;
  --tx3: #4a5070;
  --w: #e8eaf0;
  --acc: #7b8fad;
  --acc2: #d47820;
  --acc3: #c05828;
  --l1: #7c7cf5;
  --sd: #50a0d0;
  --red: #c04040;
  --grn: #50a060;
  --amb: #c87020;
  --sel: rgba(123,143,173,.15);
  --sel-tx: #e8eaf0;
  --blur: blur(16px);
  --glass: rgba(16,16,26,.8);
}

*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{background:var(--bg);transition:background .4s}
::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--brd2)}

/* Starfield-style transitions */
@keyframes viewIn{from{opacity:0;transform:translateX(30px)}to{opacity:1;transform:translateX(0)}}
@keyframes viewOut{from{opacity:1}to{opacity:0;transform:translateX(-20px)}}
@keyframes modalUp{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes cardIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes glowLine{0%{width:0}100%{width:100%}}
@keyframes slideToast{from{transform:translateY(-30px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes tabLine{from{transform:scaleX(0)}to{transform:scaleX(1)}}

.view-enter{animation:viewIn .35s cubic-bezier(.22,.68,.36,1)}
.card-i{animation:cardIn .3s cubic-bezier(.22,.68,.36,1) both}
.card-i:nth-child(1){animation-delay:.05s}.card-i:nth-child(2){animation-delay:.1s}.card-i:nth-child(3){animation-delay:.15s}.card-i:nth-child(4){animation-delay:.2s}.card-i:nth-child(5){animation-delay:.25s}.card-i:nth-child(6){animation-delay:.3s}
.chg{box-shadow:inset 2px 0 0 var(--acc2)}
.ent{transition:all .15s;cursor:pointer;min-height:48px;display:flex;align-items:center}
.ent:hover,.ent:active{background:var(--card-h)!important}
`;

// ═══ UI COMPONENTS ═══
const Badge=({children,color="var(--acc)",small,style:sx})=><span style={{display:"inline-flex",alignItems:"center",gap:4,padding:small?"2px 8px":"4px 12px",fontSize:small?11:13,fontWeight:500,fontFamily:"'Barlow Condensed',sans-serif",color,letterSpacing:.8,textTransform:"uppercase",border:`1px solid ${color}`,whiteSpace:"nowrap",...sx}}>{children}</span>;
const Btn=({children,onClick,primary,danger,small,ghost,warm,disabled,style:sx})=><button disabled={disabled} onClick={onClick} style={{padding:small?"8px 14px":"12px 24px",border:`1px solid ${danger?"var(--red)":warm?"var(--acc2)":primary?"var(--acc)":"var(--brd2)"}`,fontWeight:500,cursor:disabled?"not-allowed":"pointer",fontSize:small?13:15,fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase",letterSpacing:1,background:warm?"rgba(212,120,32,.1)":primary?"var(--sel)":"transparent",color:danger?"var(--red)":warm?"var(--acc2)":primary?"var(--sel-tx)":"var(--tx2)",opacity:disabled?.3:1,transition:"all .2s",minHeight:44,...sx}}>{children}</button>;
const Input=({label,...p})=><div style={{marginBottom:18}}>{label&&<label style={{fontSize:12,color:"var(--tx3)",display:"block",marginBottom:6,fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase",letterSpacing:1.5}}>{label}</label>}<input {...p} style={{width:"100%",padding:"12px 14px",border:"1px solid var(--brd2)",background:"var(--bg)",backdropFilter:undefined,color:"var(--w)",fontSize:16,fontFamily:"'Barlow',sans-serif",outline:"none",boxSizing:"border-box",minHeight:48,transition:"border .2s",...(p.style||{})}} onFocus={e=>{e.target.style.borderColor="var(--acc2)"}} onBlur={e=>{e.target.style.borderColor=""}} /></div>;
const Select=({label,options,...p})=><div style={{marginBottom:18}}>{label&&<label style={{fontSize:12,color:"var(--tx3)",display:"block",marginBottom:6,fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase",letterSpacing:1.5}}>{label}</label>}<select {...p} style={{width:"100%",padding:"12px 14px",border:"1px solid var(--brd2)",background:"var(--bg)",color:"var(--w)",fontSize:16,fontFamily:"'Barlow',sans-serif",outline:"none",minHeight:48}}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></div>;
const Toggle=({checked,onChange,label})=><label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",fontSize:15,color:"var(--tx)",marginBottom:14,minHeight:44}}><div onClick={()=>onChange(!checked)} style={{width:40,height:20,border:`1px solid ${checked?"var(--acc2)":"var(--brd2)"}`,position:"relative",transition:"all .25s",cursor:"pointer",flexShrink:0,background:checked?"rgba(212,120,32,.15)":"transparent"}}><div style={{width:16,height:16,background:checked?"var(--acc2)":"var(--tx3)",position:"absolute",top:1,left:checked?21:1,transition:"all .25s"}}/></div>{label}</label>;
const Modal=({open,onClose,title,children})=>{if(!open)return null;return<div style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,.35)",backdropFilter:"blur(4px)",display:"flex",alignItems:"flex-end",justifyContent:"center",animation:"fadeIn .2s"}} onClick={onClose}><div onClick={e=>e.stopPropagation()} style={{background:"var(--glass)",backdropFilter:"var(--blur)",border:"1px solid var(--brd2)",borderBottom:"none",padding:"28px 24px 36px",width:"100%",maxWidth:520,maxHeight:"85vh",overflowY:"auto",animation:"modalUp .3s cubic-bezier(.22,.68,.36,1)"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24,borderBottom:"1px solid var(--brd)",paddingBottom:16}}><h3 style={{margin:0,fontSize:18,color:"var(--w)",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:600,textTransform:"uppercase",letterSpacing:2}}>{title}</h3><button onClick={onClose} style={{background:"none",border:"1px solid var(--brd2)",color:"var(--tx3)",width:40,height:40,cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button></div>{children}</div></div>};
const Card=({children,style:sx,className:cn})=><div className={cn} style={{background:"var(--card)",backdropFilter:"var(--blur)",border:"1px solid var(--brd)",padding:20,transition:"all .2s",...sx}}>{children}</div>;

// ═══ SCHEDULE SETUP ═══
function Setup({profile,onDone}){
  const[sched,setSched]=useState(()=>{const s={};DAYS.forEach(d=>{s[d]="09:00";s[`${d}_ho`]=false});return s});
  const[saving,setSaving]=useState(false);
  return<div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"var(--bg)",padding:16}}><style>{CSS}</style>
    <div style={{width:"100%",maxWidth:520,padding:"36px 24px",background:"var(--glass)",backdropFilter:"var(--blur)",border:"1px solid var(--brd)",animation:"modalUp .5s cubic-bezier(.22,.68,.36,1)"}}>
      <div style={{textAlign:"center",marginBottom:32,borderBottom:"1px solid var(--brd)",paddingBottom:24}}>
        <div style={{fontSize:14,color:"var(--tx3)",letterSpacing:3,textTransform:"uppercase",marginBottom:8}}>ShiftFlow</div>
        <h2 style={{fontSize:24,fontWeight:600,color:"var(--w)",fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase",letterSpacing:2}}>Stálý rozvrh</h2>
        <p style={{color:"var(--tx2)",fontSize:14,marginTop:10}}>{profile.name} — vyberte směnu pro každý den</p>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {DAYS.map((day,i)=><div key={day} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"var(--bg3)",border:"1px solid var(--brd)",backdropFilter:"var(--blur)"}}>
          <span style={{fontWeight:600,fontSize:16,minWidth:50,color:"var(--w)",fontFamily:"'Barlow Condensed',sans-serif"}}>{day}</span>
          <div style={{display:"flex",gap:2,flex:1}}>{SHIFTS.map(sh=><button key={sh} onClick={()=>setSched(s=>({...s,[day]:sh}))} style={{flex:1,padding:"10px 0",border:`1px solid ${sched[day]===sh?"var(--acc2)":"var(--brd)"}`,fontSize:15,fontFamily:"'IBM Plex Mono',monospace",cursor:"pointer",background:sched[day]===sh?"rgba(212,120,32,.12)":"transparent",color:sched[day]===sh?"var(--w)":"var(--tx3)",transition:"all .2s",minHeight:44,fontWeight:500}}>{sh}</button>)}</div>
          <label style={{display:"flex",alignItems:"center",gap:4,fontSize:13,color:"var(--tx3)",cursor:"pointer"}}><input type="checkbox" checked={sched[`${day}_ho`]||false} onChange={e=>setSched(s=>({...s,[`${day}_ho`]:e.target.checked}))} style={{accentColor:"var(--grn)",width:18,height:18}}/>HO</label>
        </div>)}
      </div>
      <Btn warm disabled={saving} onClick={async()=>{setSaving(true);await updateDoc(doc(db,"users",profile.id),{defaultSchedule:sched,setupDone:true});onDone()}} style={{width:"100%",marginTop:24,padding:"14px 0",fontSize:17}}>{saving?"UKLÁDÁM...":"POTVRDIT ROZVRH"}</Btn>
    </div>
  </div>;
}

// ═══ AUTH ═══
function AuthScreen(){
  const[mode,setMode]=useState("login");const[login,setLogin]=useState("");const[pass,setPass]=useState("");
  const[err,setErr]=useState("");const[loading,setLoading]=useState(false);
  const[rn,setRn]=useState("");const[rEmail,setREmail]=useState("");const[rp,setRp]=useState("");const[rp2,setRp2]=useState("");
  const[rt,setRt]=useState("L1");const[rNotify,setRNotify]=useState(false);const[rNotifEmail,setRNotifEmail]=useState("");
  const doLogin=async()=>{setErr("");setLoading(true);try{if(login==="Admin"&&pass==="0000")await signInWithEmailAndPassword(auth,AE,AP);else await signInWithEmailAndPassword(auth,login,pass)}catch(e){setErr(e.code==="auth/invalid-credential"?"Neplatné údaje":e.message)}setLoading(false)};
  const doReg=async()=>{setErr("");setLoading(true);try{if(!rn.trim()||!rEmail||!rp){setErr("Vyplňte povinná pole");setLoading(false);return}if(rp!==rp2){setErr("Hesla se neshodují");setLoading(false);return}if(rp.length<6){setErr("Min. 6 znaků");setLoading(false);return}const c=await createUserWithEmailAndPassword(auth,rEmail,rp);await updateProfile(c.user,{displayName:rn.trim()});await setDoc(doc(db,"users",c.user.uid),{name:rn.trim(),email:rEmail,team:rt,role:"employee",notify:rNotify,notifyEmail:rNotify?rNotifEmail:"",fcmToken:null,defaultSchedule:null,setupDone:false,vacationTotal:20,sickTotal:5,whateverTotal:3,vacationUsed:0,sickUsed:0,whateverUsed:0,createdAt:new Date().toISOString()})}catch(e){setErr(e.code==="auth/email-already-in-use"?"Email registrován":e.message)}setLoading(false)};
  const doBio=async()=>{try{if(!window.PublicKeyCredential)return setErr("Biometrie není podporována");const stored=localStorage.getItem("sf_bio_email"),storedP=localStorage.getItem("sf_bio_token");if(!stored||!storedP)return setErr("Přihlaste se heslem a povolte biometrii v profilu");await signInWithEmailAndPassword(auth,stored,storedP)}catch(e){setErr("Biometrie: "+e.message)}};
  return<div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"var(--bg)",padding:16}}><style>{CSS}</style>
    <div style={{width:"100%",maxWidth:440,padding:"40px 28px",background:"var(--glass)",backdropFilter:"var(--blur)",border:"1px solid var(--brd)",animation:"modalUp .5s cubic-bezier(.22,.68,.36,1)"}}>
      <div style={{textAlign:"center",marginBottom:36,borderBottom:"1px solid var(--brd)",paddingBottom:28}}>
        <div style={{fontSize:36,marginBottom:8,letterSpacing:8,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:300,color:"var(--w)"}}>SHIFTFLOW</div>
        <div style={{width:40,height:2,background:"var(--acc2)",margin:"0 auto 12px",animation:"glowLine .8s ease-out"}}/>
        <p style={{color:"var(--tx3)",fontSize:12,letterSpacing:2,textTransform:"uppercase"}}>Shift Management System</p>
      </div>
      <div style={{display:"flex",marginBottom:28,border:"1px solid var(--brd)"}}>{["login","register"].map(m=><button key={m} onClick={()=>{setMode(m);setErr("")}} style={{flex:1,padding:"12px 0",border:"none",fontSize:14,fontWeight:500,fontFamily:"'Barlow Condensed',sans-serif",cursor:"pointer",background:mode===m?"var(--sel)":"transparent",color:mode===m?"var(--sel-tx)":"var(--tx3)",textTransform:"uppercase",letterSpacing:1.5,minHeight:48,transition:"all .25s",position:"relative"}}>{m==="login"?"Přihlášení":"Registrace"}</button>)}</div>
      {mode==="login"?<>
        <Input label="Email" value={login} onChange={e=>setLogin(e.target.value)} placeholder="vas@email.cz"/>
        <Input label="Heslo" type="password" value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doLogin()}/>
        <div style={{display:"flex",gap:8,marginBottom:8}}>
          <Btn warm disabled={loading} onClick={doLogin} style={{flex:1,padding:"14px 0"}}>{loading?"Načítání...":"Přihlásit"}</Btn>
          <Btn ghost onClick={doBio} style={{padding:"14px 18px",fontSize:20}} title="Biometrie">🔐</Btn>
        </div>
      </>:<>
        <Input label="Celé jméno" value={rn} onChange={e=>setRn(e.target.value)}/>
        <Input label="Email" value={rEmail} onChange={e=>setREmail(e.target.value)}/>
        <Input label="Heslo (min. 6)" type="password" value={rp} onChange={e=>setRp(e.target.value)}/>
        <Input label="Heslo znovu" type="password" value={rp2} onChange={e=>setRp2(e.target.value)}/>
        <Select label="Tým" value={rt} onChange={e=>setRt(e.target.value)} options={[{value:"L1",label:"L1 Support"},{value:"SD",label:"Service Desk"}]}/>
        <div style={{background:"var(--bg3)",backdropFilter:"var(--blur)",border:"1px solid var(--brd)",padding:16,marginBottom:18}}>
          <Toggle checked={rNotify} onChange={setRNotify} label="Upozornění na změny"/>
          {rNotify&&<Input label="Email notifikací" type="email" value={rNotifEmail} onChange={e=>setRNotifEmail(e.target.value)} style={{marginBottom:0}}/>}
        </div>
        <Btn warm disabled={loading} onClick={doReg} style={{width:"100%",padding:"14px 0"}}>{loading?"Načítání...":"Zaregistrovat"}</Btn>
      </>}
      {err&&<p style={{color:"var(--red)",fontSize:14,marginTop:12,padding:"10px 14px",border:"1px solid var(--red)"}}>{err}</p>}
    </div>
  </div>;
}

// ═══ ADMIN DEFAULT EDITOR ═══
function DefEditor({employees}){
  const[editEmp,setEditEmp]=useState(null);const[es,setEs]=useState({});const[saving,setSaving]=useState(false);
  const start=emp=>{setEditEmp(emp);const s={};DAYS.forEach(d=>{s[d]=emp.defaultSchedule?.[d]||"09:00";s[`${d}_ho`]=emp.defaultSchedule?.[`${d}_ho`]||false});setEs(s)};
  return<div>{["L1","SD"].map(team=><div key={team} style={{marginBottom:28}}>
    <div style={{fontSize:16,fontWeight:600,color:team==="L1"?"var(--l1)":"var(--sd)",marginBottom:12,fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase",letterSpacing:1.5}}>{TEAMS[team]}</div>
    <div style={{border:"1px solid var(--brd)",overflow:"auto",background:"var(--card)",backdropFilter:"var(--blur)"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:14}}><thead><tr>
        <th style={{padding:"12px 14px",textAlign:"left",color:"var(--tx3)",fontWeight:500,borderBottom:"1px solid var(--brd)"}}>Zaměstnanec</th>
        {DAYS.map(d=><th key={d} style={{padding:"12px 8px",textAlign:"center",color:"var(--tx3)",fontWeight:500,borderBottom:"1px solid var(--brd)"}}>{d}</th>)}
        <th style={{padding:12,borderBottom:"1px solid var(--brd)"}}/>
      </tr></thead><tbody>{employees.filter(e=>e.team===team&&e.role!=="admin").map(emp=><tr key={emp.id} style={{borderBottom:"1px solid var(--brd)"}}>
        <td style={{padding:"12px 14px",fontWeight:500,color:"var(--w)",fontSize:15}}>{emp.name}</td>
        {DAYS.map(d=><td key={d} style={{padding:8,textAlign:"center"}}>{emp.setupDone&&emp.defaultSchedule?.[d]?<span style={{fontFamily:"'IBM Plex Mono',monospace",color:"var(--acc2)",fontSize:13}}>{emp.defaultSchedule[d]}{emp.defaultSchedule[`${d}_ho`]?" ·HO":""}</span>:<span style={{color:"var(--tx3)"}}>—</span>}</td>)}
        <td style={{padding:"8px 12px",textAlign:"right"}}><Btn small onClick={()=>start(emp)}>✏️</Btn></td>
      </tr>)}</tbody></table>
    </div>
  </div>)}
  <Modal open={!!editEmp} onClose={()=>setEditEmp(null)} title={editEmp?.name||""}>{editEmp&&<div>
    <div style={{display:"flex",flexDirection:"column",gap:6}}>{DAYS.map(day=><div key={day} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:"var(--bg3)",backdropFilter:"var(--blur)"}}>
      <span style={{fontWeight:600,fontSize:15,minWidth:50,color:"var(--w)",fontFamily:"'Barlow Condensed',sans-serif"}}>{day}</span>
      <div style={{display:"flex",gap:2,flex:1}}>{SHIFTS.map(sh=><button key={sh} onClick={()=>setEs(s=>({...s,[day]:sh}))} style={{flex:1,padding:"10px 0",border:`1px solid ${es[day]===sh?"var(--acc2)":"var(--brd)"}`,fontSize:14,fontFamily:"'IBM Plex Mono',monospace",cursor:"pointer",background:es[day]===sh?"rgba(212,120,32,.12)":"transparent",color:es[day]===sh?"var(--w)":"var(--tx3)",minHeight:44,transition:"all .2s"}}>{sh}</button>)}</div>
      <label style={{display:"flex",alignItems:"center",gap:4,fontSize:13,color:"var(--tx3)",cursor:"pointer"}}><input type="checkbox" checked={es[`${day}_ho`]||false} onChange={e=>setEs(s=>({...s,[`${day}_ho`]:e.target.checked}))} style={{accentColor:"var(--grn)",width:18,height:18}}/>HO</label>
    </div>)}</div>
    <div style={{display:"flex",gap:8,marginTop:20}}><Btn warm disabled={saving} onClick={async()=>{setSaving(true);await updateDoc(doc(db,"users",editEmp.id),{defaultSchedule:es,setupDone:true});setSaving(false);setEditEmp(null)}} style={{flex:1}}>Uložit</Btn><Btn ghost onClick={()=>setEditEmp(null)}>Zrušit</Btn></div>
  </div>}</Modal></div>;
}

// ═══ MAIN ═══
export default function App(){
  const[authUser,setAuthUser]=useState(undefined);const[profile,setProfile]=useState(null);
  const[view,setView]=useState("schedule");const[prevView,setPrevView]=useState("");
  const[tf,setTf]=useState("all");const[employees,setEmployees]=useState([]);
  const[wo,setWo]=useState(0);const[schedule,setSchedule]=useState(null);
  const[absences,setAbsences]=useState({});const[events,setEvents]=useState({});
  const[swaps,setSwaps]=useState([]);const[selCell,setSelCell]=useState(null);
  const[modal,setModal]=useState(null);const[notifs,setNotifs]=useState([]);
  const[logs,setLogs]=useState([]);const[rules,setRules]=useState({L1_max:2,SD_max8:2,SD_maxHO:2,SD_noHO8:true,SD_noHO10:true});
  const[theme,setTheme]=useState(()=>localStorage.getItem("sf_theme")||"light");
  const viewKey=useRef(0);

  const switchView=v=>{setPrevView(view);viewKey.current++;setView(v)};

  useEffect(()=>{document.documentElement.setAttribute("data-theme",theme);localStorage.setItem("sf_theme",theme)},[theme]);

  const cw=useMemo(()=>{const d=new Date();d.setDate(d.getDate()+wo*7);return d},[wo]);
  const wk=wKey(cw);const isA=profile?.role==="admin";
  const ge=id=>employees.find(e=>e.id===id);
  const ds=useMemo(()=>buildDef(employees),[employees]);
  const cs=schedule||ds;

  useEffect(()=>{const u=onAuthStateChanged(auth,async u=>{if(u){setAuthUser(u);const s=await getDoc(doc(db,"users",u.uid));if(s.exists())setProfile({id:u.uid,...s.data()});else setProfile({id:u.uid,name:u.displayName||u.email,role:"employee",team:"L1",setupDone:false});initPush(u.uid)}else{setAuthUser(null);setProfile(null)}});return u},[]);
  useEffect(()=>{const u=onSnapshot(collection(db,"users"),s=>{const e=s.docs.map(d=>({id:d.id,...d.data()}));setEmployees(e);if(profile){const m=e.find(x=>x.id===profile.id);if(m)setProfile(p=>({...p,...m}))}});return u},[profile?.id]);
  useEffect(()=>{const u=onSnapshot(doc(db,"schedules",wk),s=>{if(s.exists()){const d=s.data();setSchedule(d.entries||null);setAbsences(d.absences||{});setEvents(d.events||{})}else{setSchedule(null);setAbsences({});setEvents({})}});return u},[wk]);
  useEffect(()=>{const u=onSnapshot(collection(db,"swapRequests"),s=>setSwaps(s.docs.map(d=>({id:d.id,...d.data()}))));return u},[]);
  useEffect(()=>{const u=onSnapshot(doc(db,"rules","global"),s=>{if(s.exists())setRules(s.data())});return u},[]);
  useEffect(()=>{const u=onSnapshot(collection(db,"auditLog"),s=>{const a=s.docs.map(d=>({id:d.id,...d.data()}));a.sort((a,b)=>(b.time||"").localeCompare(a.time||""));setLogs(a.slice(0,100))});return u},[]);

  const notify=msg=>{const n={id:uid(),msg,time:new Date().toLocaleTimeString("cs")};setNotifs(p=>[n,...p]);setTimeout(()=>setNotifs(p=>p.filter(x=>x.id!==n.id)),5000)};
  const log=async msg=>{try{await addDoc(collection(db,"auditLog"),{msg,time:new Date().toISOString(),week:wk,userId:profile?.id})}catch{}};
  const saveS=async en=>{await setDoc(doc(db,"schedules",wk),{entries:en,weekStart:wk,modifiedAt:new Date().toISOString(),modifiedBy:profile?.id},{merge:true})};
  const eN=(emp,msg)=>{if(emp?.notify&&(emp?.notifyEmail||emp?.email))callGAS("sendEmail",{to:emp.notifyEmail||emp.email,employeeName:emp.name,changeDescription:msg,weekLabel:fmtW(cw)})};

  const val=(s,day)=>{const w=[];const d=s[day];if(!d)return w;SHIFTS.forEach(sh=>{const e=d[sh]||[];const l=e.filter(x=>ge(x.empId)?.team==="L1");const sd=e.filter(x=>ge(x.empId)?.team==="SD");if(l.length>rules.L1_max)w.push(`${day} ${sh}: L1 ${l.length}/${rules.L1_max}`);if(sh==="08:00"&&sd.length>rules.SD_max8)w.push(`${day} ${sh}: SD ${sd.length}/${rules.SD_max8}`)});const allSD=SHIFTS.flatMap(sh=>(d[sh]||[]).filter(x=>ge(x.empId)?.team==="SD"));if(allSD.filter(x=>x.ho).length>rules.SD_maxHO)w.push(`${day}: HO>${rules.SD_maxHO}`);if(rules.SD_noHO8&&(d["08:00"]||[]).some(x=>x.ho&&ge(x.empId)?.team==="SD"))w.push(`${day} 08:00: HO!`);if(rules.SD_noHO10&&(d["10:00"]||[]).some(x=>x.ho&&ge(x.empId)?.team==="SD"))w.push(`${day} 10:00: HO!`);return w};
  const aw=DAYS.flatMap(d=>val(cs,d));
  const isCh=(day,sh,eid)=>{const df=ds[day]?.[sh]?.find(e=>e.empId===eid);const cu=cs[day]?.[sh]?.find(e=>e.empId===eid);return(!df&&!!cu)||(!!df&&!cu)||(!!df&&!!cu&&df.ho!==cu.ho)};

  const moveE=async(eid,fd,fs,td,ts)=>{const s=dc(cs);const f=s[fd]?.[fs];if(!f)return;const i=f.findIndex(e=>e.empId===eid);if(i===-1)return;const[en]=f.splice(i,1);en.isDefault=false;if(!s[td])s[td]={};if(!s[td][ts])s[td][ts]=[];s[td][ts].push(en);await saveS(s);const emp=ge(eid);const msg=`${emp?.name}: ${fd} ${fs} → ${td} ${ts}`;notify(msg);log(msg);eN(emp,msg)};
  const togHO=async(day,sh,eid)=>{const s=dc(cs);const en=s[day]?.[sh]?.find(e=>e.empId===eid);if(en){en.ho=!en.ho;en.isDefault=false}await saveS(s);const emp=ge(eid);notify(`${emp?.name}: HO ${en?.ho?"ON":"OFF"}`);log(`HO: ${emp?.name}`);eN(emp,`HO ${en?.ho?"ON":"OFF"}`)};
  const addAbs=async(eid,day,type)=>{if(!isA&&eid!==profile.id)return;const s=dc(cs);SHIFTS.forEach(sh=>{if(s[day]?.[sh])s[day][sh]=s[day][sh].filter(e=>e.empId!==eid)});await saveS(s);await setDoc(doc(db,"schedules",wk),{[`absences.${eid}-${day}`]:type},{merge:true});const emp=ge(eid);if(emp){const f=type==="sick"?"sickUsed":type==="vacation"?"vacationUsed":type==="whatever"?"whateverUsed":null;if(f)await updateDoc(doc(db,"users",eid),{[f]:(emp[f]||0)+1})}const al=ABS.find(a=>a.id===type)?.label;notify(`${emp?.name}: ${al}`);log(`${emp?.name}: ${al} ${day}`);eN(emp,`${al} (${day})`)};
  const addEv=async(day,et,note)=>{await setDoc(doc(db,"schedules",wk),{[`events.${day}`]:{type:et,note,title:EVTS.find(e=>e.id===et)?.label}},{merge:true});notify("Událost přidána");log(`Event: ${day}`)};
  const mkSwap=async(rid,day,sh)=>{await addDoc(collection(db,"swapRequests"),{rid,day,sh,week:wk,status:"open",created:new Date().toISOString()});notify("Žádost odeslána");log(`Swap: ${ge(rid)?.name}`)};
  const doSwap=async(swId,aid)=>{const sw=swaps.find(s=>s.id===swId);if(!sw)return;await updateDoc(doc(db,"swapRequests",swId),{status:"done",aid,resolvedAt:new Date().toISOString()});const s=dc(cs);let aD,aS;DAYS.forEach(d=>SHIFTS.forEach(sh=>{if(s[d]?.[sh]?.some(e=>e.empId===aid)&&!aD){aD=d;aS=sh}}));if(aD&&aS&&s[sw.day]?.[sw.sh]){const ri=s[sw.day][sw.sh].findIndex(e=>e.empId===sw.rid);const ai=s[aD][aS].findIndex(e=>e.empId===aid);if(ri!==-1&&ai!==-1){const rE=s[sw.day][sw.sh][ri];const aE=s[aD][aS][ai];s[sw.day][sw.sh][ri]={...aE,isDefault:false};s[aD][aS][ai]={...rE,isDefault:false};await saveS(s)}}notify("Výměna provedena");log(`Swap done`)};
  const delUser=async eid=>{if(!confirm(`Smazat ${ge(eid)?.name}?`))return;await deleteDoc(doc(db,"users",eid));notify("Smazán")};
  const exportCSV=()=>{let csv="\ufeffDen,Směna,Jméno,Tým,HO\n";DAYS.forEach(d=>SHIFTS.forEach(sh=>(cs[d]?.[sh]||[]).forEach(en=>{const e=ge(en.empId);if(e)csv+=`${d},${sh},${e.name},${e.team},${en.ho?"Ano":"Ne"}\n`})));const b=new Blob([csv],{type:"text/csv;charset=utf-8;"});const u=URL.createObjectURL(b);Object.assign(document.createElement("a"),{href:u,download:`rozvrh_${wk}.csv`}).click();URL.revokeObjectURL(u)};

  if(authUser===undefined)return<div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center"}}><style>{CSS}</style><div style={{color:"var(--tx3)",fontSize:14,letterSpacing:4,textTransform:"uppercase",fontFamily:"'Barlow Condensed',sans-serif",animation:"pulse 1.5s infinite"}}>SHIFTFLOW · LOADING</div></div>;
  if(!authUser)return<AuthScreen/>;
  if(!profile)return<div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--tx3)"}}><style>{CSS}</style>Načítání…</div>;
  if(!isA&&!profile.setupDone)return<Setup profile={profile} onDone={()=>setProfile(p=>({...p,setupDone:true}))}/>;

  const openSw=swaps.filter(s=>s.status==="open"&&s.week===wk);
  const NAV=[{id:"schedule",l:"Rozvrh",i:"📋"},{id:"swaps",l:"Výměny",i:"🔄",b:openSw.length},{id:"people",l:"Tým",i:"👥"},{id:"stats",l:"Stats",i:"📊"},{id:"log",l:"Log",i:"📜"},...(isA?[{id:"defaults",l:"Default",i:"📐"},{id:"settings",l:"Config",i:"⚙️"}]:[])];

  return<div style={{minHeight:"100vh",background:"var(--bg)",fontFamily:"'Barlow',sans-serif",color:"var(--tx)",paddingBottom:68,transition:"all .3s"}} data-theme={theme}>
    <style>{CSS}</style>

    {/* TOASTS */}
    <div style={{position:"fixed",top:0,left:0,right:0,zIndex:9999,padding:"8px 12px"}}>{notifs.map(n=><div key={n.id} style={{background:"var(--glass)",backdropFilter:"var(--blur)",border:"1px solid var(--acc2)",padding:"14px 16px",fontSize:15,color:"var(--acc2)",display:"flex",gap:10,alignItems:"center",marginBottom:6,animation:"slideToast .3s ease-out"}}><span style={{flex:1}}>{n.msg}</span><span style={{fontSize:12,color:"var(--tx3)",fontFamily:"'IBM Plex Mono',monospace"}}>{n.time}</span></div>)}</div>

    {/* HEADER */}
    <header style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",borderBottom:"1px solid var(--brd)",background:"var(--panel)",backdropFilter:"var(--blur)"}}>
      <div style={{fontSize:18,fontWeight:600,color:"var(--w)",letterSpacing:3,fontFamily:"'Barlow Condensed',sans-serif"}}>SHIFTFLOW</div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <button onClick={()=>setTheme(t=>t==="light"?"dark":"light")} style={{background:"none",border:"1px solid var(--brd2)",width:40,height:40,cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--tx2)"}} title="Přepnout téma">{theme==="light"?"🌙":"☀️"}</button>
        <span style={{fontSize:14,color:"var(--tx2)"}}>{profile.name}</span>
        <button onClick={()=>signOut(auth)} style={{background:"none",border:"1px solid var(--brd2)",color:"var(--tx3)",width:40,height:40,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>↪</button>
      </div>
    </header>

    <main style={{padding:16,maxWidth:1440,margin:"0 auto"}}>
      <div key={viewKey.current} className="view-enter">

      {/* SCHEDULE */}
      {view==="schedule"&&<div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:16,marginBottom:16}}>
          <button onClick={()=>setWo(w=>w-1)} style={{width:44,height:44,border:"1px solid var(--brd2)",background:"transparent",color:"var(--tx)",cursor:"pointer",fontSize:18}}>‹</button>
          <div style={{textAlign:"center"}}><div style={{fontSize:18,fontWeight:500,color:"var(--w)",fontFamily:"'IBM Plex Mono',monospace"}}>{fmtW(cw)}</div><div style={{fontSize:12,color:"var(--tx3)",textTransform:"uppercase",letterSpacing:1}}>{wo===0?"Aktuální týden":`${wo>0?"+":""}${wo}`}</div></div>
          <button onClick={()=>setWo(w=>w+1)} style={{width:44,height:44,border:"1px solid var(--brd2)",background:"transparent",color:"var(--tx)",cursor:"pointer",fontSize:18}}>›</button>
          {wo!==0&&<Btn small ghost onClick={()=>setWo(0)}>Dnes</Btn>}
        </div>
        <div style={{display:"flex",gap:4,marginBottom:14,flexWrap:"wrap"}}>
          {[{k:"all",l:"Vše",c:""},{k:"L1",l:"L1",c:"var(--l1)"},{k:"SD",l:"SD",c:"var(--sd)"}].map(f=><Btn key={f.k} small={tf!==f.k} warm={tf===f.k} onClick={()=>setTf(f.k)} style={tf===f.k&&f.c?{borderColor:f.c,color:f.c}:{}}>{f.l}</Btn>)}
          <div style={{flex:1}}/>
          {isA&&<Btn small onClick={()=>setModal("absence")}>+ Nepřít.</Btn>}
          {isA&&<Btn small onClick={()=>setModal("event")}>+ Event</Btn>}
          {!isA&&<Btn small onClick={()=>setModal("myabsence")}>Nepřít.</Btn>}
          <Btn small ghost onClick={exportCSV}>CSV</Btn>
        </div>
        {aw.length>0&&<div style={{border:"1px solid var(--red)",padding:14,marginBottom:14}}><div style={{fontSize:14,fontWeight:600,color:"var(--red)",fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase",letterSpacing:1}}>⚠ Porušení ({aw.length})</div>{aw.map((w,i)=><div key={i} style={{fontSize:13,color:"var(--red)",marginTop:4}}>· {w}</div>)}</div>}

        <div style={{border:"1px solid var(--brd)",overflow:"hidden",background:"var(--card)",backdropFilter:"var(--blur)"}}>
          <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
            <table style={{width:"100%",minWidth:700,borderCollapse:"collapse"}}>
              <thead><tr>
                <th style={{position:"sticky",left:0,zIndex:10,background:"var(--panel)",backdropFilter:"var(--blur)",padding:"10px 8px",borderBottom:"1px solid var(--brd)",borderRight:"2px solid var(--brd2)",width:64,fontFamily:"'IBM Plex Mono',monospace",fontSize:13,color:"var(--tx3)"}}>⏱</th>
                {DAYS.map((d,i)=>{const ev=events[d];return<th key={d} style={{padding:"10px 6px",borderBottom:"1px solid var(--brd)",background:"var(--bg3)",backdropFilter:"var(--blur)",textAlign:"center",minWidth:115}}><div style={{fontSize:15,fontWeight:600,color:"var(--w)",fontFamily:"'Barlow Condensed',sans-serif"}}>{DAYS_F[i]}</div>{ev&&<div style={{marginTop:4}}><Badge small color="var(--acc2)">{EVTS.find(e=>e.id===ev.type)?.icon} {ev.note||ev.title}</Badge></div>}</th>})}
              </tr></thead>
              <tbody>
                {SHIFTS.map(shift=><tr key={shift}>
                  <td style={{position:"sticky",left:0,zIndex:10,background:"var(--panel)",backdropFilter:"var(--blur)",padding:"8px 6px",borderBottom:"1px solid var(--brd)",borderRight:"2px solid var(--brd2)",textAlign:"center",fontFamily:"'IBM Plex Mono',monospace",fontSize:17,fontWeight:500,color:"var(--acc2)"}}>{shift}</td>
                  {DAYS.map(day=>{const entries=(cs[day]?.[shift]||[]).filter(e=>{const emp=ge(e.empId);return emp&&(tf==="all"||emp.team===tf)});
                    return<td key={`${day}-${shift}`} style={{padding:4,borderBottom:"1px solid var(--brd)",borderLeft:"1px solid var(--brd)",verticalAlign:"top",background:"transparent"}}
                      onDragOver={e=>{if(isA){e.preventDefault();e.currentTarget.style.background="var(--bg4)"}}} onDragLeave={e=>{e.currentTarget.style.background="transparent"}} onDrop={e=>{e.currentTarget.style.background="transparent";if(!isA)return;try{const d=JSON.parse(e.dataTransfer.getData("text/plain"));if(d.day!==day||d.shift!==shift)moveE(d.empId,d.day,d.shift,day,shift)}catch{}}}>
                      {entries.map(en=>{const emp=ge(en.empId);if(!emp)return null;const ch=isCh(day,shift,en.empId);const tc=emp.team==="L1"?"var(--l1)":"var(--sd)";
                        return<div key={en.empId} className={`ent ${ch?"chg":""}`} draggable={isA} onDragStart={e=>isA&&e.dataTransfer.setData("text/plain",JSON.stringify({empId:en.empId,day,shift}))} onClick={()=>isA?setSelCell({day,shift,empId:en.empId}):profile.id===en.empId&&setModal({type:"myshift",day,shift})}
                          style={{gap:6,padding:"6px 10px",marginBottom:2,background:"var(--bg3)",backdropFilter:"var(--blur)",border:"1px solid var(--brd)",fontSize:14,transition:"all .2s"}}>
                          <span style={{width:8,height:3,background:tc,flexShrink:0}}/>
                          <span style={{fontWeight:500,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:"var(--w)"}}>{emp.name?.split(" ").pop()}</span>
                          {en.ho&&<Badge small color="var(--grn)">HO</Badge>}
                        </div>})}
                    </td>})}
                </tr>)}
                <tr><td style={{position:"sticky",left:0,zIndex:10,background:"var(--panel)",backdropFilter:"var(--blur)",padding:8,borderRight:"2px solid var(--brd2)",fontSize:12,color:"var(--tx3)",textAlign:"center",fontWeight:500}}>N/A</td>
                  {DAYS.map(day=>{const da=Object.entries(absences).filter(([k])=>k.endsWith(`-${day}`)).map(([k,t])=>({empId:k.replace(`-${day}`,""),type:t})).filter(a=>{const e=ge(a.empId);return e&&(tf==="all"||e.team===tf)});
                    return<td key={`a-${day}`} style={{padding:4,borderLeft:"1px solid var(--brd)"}}>{da.map(a=>{const e=ge(a.empId);const at=ABS.find(t=>t.id===a.type);return e&&<div key={a.empId} style={{display:"flex",alignItems:"center",gap:4,padding:"5px 8px",marginBottom:2,border:`1px solid ${at?.color}`,fontSize:13,minHeight:36,background:"var(--bg3)"}}><span>{at?.icon}</span><span style={{fontWeight:500}}>{e.name?.split(" ").pop()}</span></div>})}</td>})}</tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>}

      {/* SWAPS */}
      {view==="swaps"&&<div>
        <div style={{fontSize:20,fontWeight:600,color:"var(--w)",fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase",letterSpacing:2,marginBottom:20,borderBottom:"1px solid var(--brd)",paddingBottom:12}}>Výměny směn</div>
        {!isA&&<Card className="card-i" style={{marginBottom:20}}><p style={{fontSize:15,color:"var(--tx2)",marginBottom:12}}>Požádej o výměnu — kdokoliv může přijmout.</p><Btn warm onClick={()=>setModal({type:"swap",day:DAYS[0],shift:SHIFTS[0]})}>+ Nová žádost</Btn></Card>}
        {openSw.map((sw,i)=>{const re=ge(sw.rid);const me=profile.id===sw.rid;const can=!isA&&!me;return<Card key={sw.id} className="card-i" style={{padding:16,marginBottom:8,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}><div><div style={{fontWeight:600,fontSize:17,color:"var(--w)"}}>{re?.name||"?"}</div><Badge small color="var(--acc2)">{sw.day} {sw.sh}</Badge></div>{can&&<Btn warm small onClick={()=>doSwap(sw.id,profile.id)}>Přijmout</Btn>}{me&&<Badge color="var(--amb)">Tvoje</Badge>}</Card>})}
      </div>}

      {/* PEOPLE */}
      {view==="people"&&<div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20,borderBottom:"1px solid var(--brd)",paddingBottom:12}}>
          <div style={{fontSize:20,fontWeight:600,color:"var(--w)",fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase",letterSpacing:2}}>Tým</div>
          {isA&&<Btn warm onClick={()=>setModal("addMember")}>+ Přidat</Btn>}
        </div>
        {["L1","SD"].map(team=><div key={team} style={{marginBottom:28}}>
          <div style={{fontSize:16,fontWeight:600,color:team==="L1"?"var(--l1)":"var(--sd)",marginBottom:12,fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase",letterSpacing:1.5}}>{TEAMS[team]}</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:12}}>
            {employees.filter(e=>e.team===team&&e.role!=="admin").map((emp,i)=><Card key={emp.id} className="card-i">
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"start"}}>
                <div><div style={{fontWeight:600,fontSize:17,color:"var(--w)"}}>{emp.name}</div><div style={{display:"flex",gap:6,marginTop:6}}><Badge small color={team==="L1"?"var(--l1)":"var(--sd)"}>{team}</Badge>{emp.notify&&<Badge small color="var(--grn)">📧</Badge>}</div></div>
                <div style={{display:"flex",gap:4}}>
                  {(emp.id===profile.id||isA)&&<button onClick={()=>setModal({type:"editDays",emp})} style={{background:"none",border:"1px solid var(--brd2)",color:"var(--tx3)",cursor:"pointer",width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>✏️</button>}
                  {isA&&<button onClick={()=>delUser(emp.id)} style={{background:"none",border:"1px solid rgba(192,48,48,.3)",color:"var(--red)",cursor:"pointer",width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>}
                </div>
              </div>
              <div style={{marginTop:14,display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                {[{l:"Dovolená",v:(emp.vacationTotal||20)-(emp.vacationUsed||0),t:emp.vacationTotal||20,c:"var(--sd)"},{l:"Sick",v:(emp.sickTotal||5)-(emp.sickUsed||0),t:emp.sickTotal||5,c:"var(--red)"},{l:"Whatever",v:(emp.whateverTotal||3)-(emp.whateverUsed||0),t:emp.whateverTotal||3,c:"var(--amb)"}].map(b=><div key={b.l} style={{textAlign:"center",padding:10,border:"1px solid var(--brd)",background:"var(--bg3)",backdropFilter:"var(--blur)"}}>
                  <div style={{fontSize:24,fontWeight:600,color:b.c,fontFamily:"'IBM Plex Mono',monospace"}}>{b.v}</div>
                  <div style={{fontSize:11,color:"var(--tx3)",textTransform:"uppercase"}}>{b.l}</div>
                  <div style={{fontSize:10,color:"var(--tx3)"}}>z {b.t}</div>
                </div>)}
              </div>
            </Card>)}
          </div>
        </div>)}
      </div>}

      {/* STATS */}
      {view==="stats"&&<div>
        <div style={{fontSize:20,fontWeight:600,color:"var(--w)",fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase",letterSpacing:2,marginBottom:20,borderBottom:"1px solid var(--brd)",paddingBottom:12}}>Status</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:12,marginBottom:24}}>
          {[{l:"Crew",v:employees.filter(e=>e.role!=="admin").length,c:"var(--l1)"},{l:"Active",v:employees.filter(e=>e.setupDone).length,c:"var(--sd)"},{l:"HO",v:Object.values(cs).flatMap(d=>Object.values(d).flat()).filter(e=>e.ho).length,c:"var(--grn)"},{l:"Swaps",v:openSw.length,c:"var(--amb)"},{l:"Alerts",v:aw.length,c:aw.length?"var(--red)":"var(--grn)"}].map((s,i)=><Card key={s.l} className="card-i"><div style={{fontSize:32,fontWeight:600,color:s.c,fontFamily:"'IBM Plex Mono',monospace"}}>{s.v}</div><div style={{fontSize:12,color:"var(--tx3)",textTransform:"uppercase",letterSpacing:1,marginTop:4}}>{s.l}</div></Card>)}
        </div>
      </div>}

      {/* LOG */}
      {view==="log"&&<div><div style={{fontSize:20,fontWeight:600,color:"var(--w)",fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase",letterSpacing:2,marginBottom:20,borderBottom:"1px solid var(--brd)",paddingBottom:12}}>Log</div>{logs.map(h=><div key={h.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderBottom:"1px solid var(--brd)",fontSize:14}}><span style={{fontSize:12,color:"var(--tx3)",fontFamily:"'IBM Plex Mono',monospace",minWidth:130}}>{h.time?new Date(h.time).toLocaleString("cs"):""}</span><span style={{flex:1}}>{h.msg}</span></div>)}</div>}

      {view==="defaults"&&isA&&<div><div style={{fontSize:20,fontWeight:600,color:"var(--w)",fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase",letterSpacing:2,marginBottom:20,borderBottom:"1px solid var(--brd)",paddingBottom:12}}>Stálý rozvrh</div><DefEditor employees={employees}/></div>}

      {view==="settings"&&isA&&<div style={{maxWidth:560}}>
        <div style={{fontSize:20,fontWeight:600,color:"var(--w)",fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase",letterSpacing:2,marginBottom:20,borderBottom:"1px solid var(--brd)",paddingBottom:12}}>Konfigurace</div>
        <Card style={{marginBottom:16}}><Input label="L1 Max/směna" type="number" value={rules.L1_max} onChange={e=>setRules(r=>({...r,L1_max:+e.target.value}))}/><Input label="SD Max na 8:00" type="number" value={rules.SD_max8} onChange={e=>setRules(r=>({...r,SD_max8:+e.target.value}))}/><Input label="SD Max HO/den" type="number" value={rules.SD_maxHO} onChange={e=>setRules(r=>({...r,SD_maxHO:+e.target.value}))}/><Toggle checked={rules.SD_noHO8} onChange={v=>setRules(r=>({...r,SD_noHO8:v}))} label="Zákaz HO 08:00"/><Toggle checked={rules.SD_noHO10} onChange={v=>setRules(r=>({...r,SD_noHO10:v}))} label="Zákaz HO 10:00"/><Btn warm onClick={async()=>{await setDoc(doc(db,"rules","global"),rules);notify("Uloženo")}}>Uložit</Btn></Card>
        <Card><div style={{display:"flex",gap:8}}><Btn danger onClick={async()=>{await deleteDoc(doc(db,"schedules",wk));notify("Reset")}}>Reset týden</Btn><Btn ghost onClick={exportCSV}>Export CSV</Btn></div></Card>
      </div>}
      </div>
    </main>

    {/* BOTTOM NAV */}
    <nav style={{position:"fixed",bottom:0,left:0,right:0,display:"flex",background:"var(--panel)",backdropFilter:"var(--blur)",borderTop:"1px solid var(--brd)",zIndex:100,overflowX:"auto"}}>
      {NAV.map(t=><button key={t.id} onClick={()=>switchView(t.id)} style={{flex:"1 0 auto",padding:"8px 6px",border:"none",borderTop:view===t.id?`2px solid var(--acc2)`:"2px solid transparent",background:"transparent",color:view===t.id?"var(--acc2)":"var(--tx3)",fontSize:11,fontWeight:500,fontFamily:"'Barlow Condensed',sans-serif",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2,minWidth:52,textTransform:"uppercase",transition:"all .2s",position:"relative"}}>
        <span style={{fontSize:20}}>{t.i}</span>{t.l}
        {t.b>0&&<span style={{position:"absolute",top:2,right:"50%",marginRight:-14,background:"var(--acc3)",color:"#fff",padding:"0 5px",fontSize:10}}>{t.b}</span>}
      </button>)}
    </nav>

    {/* MODALS */}
    <Modal open={!!selCell} onClose={()=>setSelCell(null)} title="Akce">{selCell&&(()=>{const emp=ge(selCell.empId);if(!emp)return null;return<div>
      <div style={{padding:14,background:"var(--bg3)",marginBottom:16,display:"flex",alignItems:"center",gap:12}}><div style={{width:40,height:40,background:emp.team==="L1"?"var(--l1)":"var(--sd)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,fontWeight:600,color:"#fff"}}>{(emp.name||"?").charAt(0)}</div><div><div style={{fontWeight:600,fontSize:17,color:"var(--w)"}}>{emp.name}</div><div style={{fontSize:14,color:"var(--tx2)"}}>{selCell.day} · {selCell.shift}</div></div></div>
      <Btn onClick={()=>{togHO(selCell.day,selCell.shift,selCell.empId);setSelCell(null)}} style={{width:"100%",marginBottom:8}}>Toggle HO</Btn>
      <div style={{fontSize:12,color:"var(--tx3)",margin:"14px 0 6px",textTransform:"uppercase",letterSpacing:1}}>Přesunout</div>
      <div style={{display:"flex",gap:8}}>{SHIFTS.filter(s=>s!==selCell.shift).map(s=><Btn key={s} small style={{flex:1}} onClick={()=>{moveE(selCell.empId,selCell.day,selCell.shift,selCell.day,s);setSelCell(null)}}>→ {s}</Btn>)}</div>
      <div style={{fontSize:12,color:"var(--tx3)",margin:"14px 0 6px",textTransform:"uppercase",letterSpacing:1}}>Nepřítomnost</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>{ABS.map(a=><Btn key={a.id} small onClick={()=>{addAbs(selCell.empId,selCell.day,a.id);setSelCell(null)}}>{a.icon} {a.label}</Btn>)}</div>
    </div>})()}</Modal>

    <Modal open={modal==="absence"} onClose={()=>setModal(null)} title="Nepřítomnost"><AbsF emps={employees.filter(e=>e.role!=="admin"&&(tf==="all"||e.team===tf))} onSubmit={(e,d,t)=>{addAbs(e,d,t);setModal(null)}}/></Modal>
    <Modal open={modal==="event"} onClose={()=>setModal(null)} title="Událost"><EvF onSubmit={(d,t,n)=>{addEv(d,t,n);setModal(null)}}/></Modal>
    <Modal open={modal?.type==="swap"} onClose={()=>setModal(null)} title="Výměna"><SwF dDay={modal?.day} dShift={modal?.shift} onSubmit={(d,s)=>{mkSwap(profile.id,d,s);setModal(null)}}/></Modal>
    <Modal open={modal?.type==="myshift"} onClose={()=>setModal(null)} title="Moje směna"><div>
      <p style={{fontSize:15,color:"var(--tx2)",marginBottom:16}}>{modal?.day} · {modal?.shift}</p>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>{ABS.map(a=><Btn key={a.id} onClick={()=>{addAbs(profile.id,modal.day,a.id);setModal(null)}}>{a.icon} {a.label}</Btn>)}</div>
      <Btn warm onClick={()=>setModal({type:"swap",day:modal?.day,shift:modal?.shift})} style={{width:"100%"}}>Požádat o výměnu</Btn>
    </div></Modal>
    <Modal open={modal==="myabsence"} onClose={()=>setModal(null)} title="Moje nepřítomnost"><MyAbsF profile={profile} onSubmit={(d,t)=>{addAbs(profile.id,d,t);setModal(null)}}/></Modal>
    <Modal open={modal==="addMember"} onClose={()=>setModal(null)} title="Nový člen"><AddF onDone={m=>{notify(m);log(m);setModal(null)}}/></Modal>
    <Modal open={modal?.type==="editDays"} onClose={()=>setModal(null)} title="Upravit dny"><EditDF emp={modal?.emp} onDone={()=>{notify("Uloženo");setModal(null)}}/></Modal>
  </div>;
}

// FORMS
function AbsF({emps,onSubmit}){const[eid,setEid]=useState(emps[0]?.id||"");const[day,setDay]=useState(DAYS[0]);const[t,setT]=useState(ABS[0].id);return<div><Select label="Zaměstnanec" value={eid} onChange={e=>setEid(e.target.value)} options={emps.map(e=>({value:e.id,label:e.name}))}/><Select label="Den" value={day} onChange={e=>setDay(e.target.value)} options={DAYS.map((d,i)=>({value:d,label:DAYS_F[i]}))}/><Select label="Typ" value={t} onChange={e=>setT(e.target.value)} options={ABS.map(a=>({value:a.id,label:`${a.icon} ${a.label}`}))}/><Btn warm onClick={()=>onSubmit(eid,day,t)} style={{width:"100%",marginTop:8}}>Přidat</Btn></div>}
function EvF({onSubmit}){const[day,setDay]=useState(DAYS[0]);const[t,setT]=useState(EVTS[0].id);const[n,setN]=useState("");return<div><Select label="Den" value={day} onChange={e=>setDay(e.target.value)} options={DAYS.map((d,i)=>({value:d,label:DAYS_F[i]}))}/><Select label="Typ" value={t} onChange={e=>setT(e.target.value)} options={EVTS.map(e=>({value:e.id,label:`${e.icon} ${e.label}`}))}/><Input label="Poznámka" value={n} onChange={e=>setN(e.target.value)}/><Btn warm onClick={()=>onSubmit(day,t,n)} style={{width:"100%",marginTop:8}}>Přidat</Btn></div>}
function SwF({dDay,dShift,onSubmit}){const[day,setDay]=useState(dDay||DAYS[0]);const[sh,setSh]=useState(dShift||SHIFTS[0]);return<div><p style={{fontSize:14,color:"var(--tx2)",margin:"0 0 14px"}}>Kdokoliv může přijmout — směny se prohodí.</p><Select label="Den" value={day} onChange={e=>setDay(e.target.value)} options={DAYS.map((d,i)=>({value:d,label:DAYS_F[i]}))}/><Select label="Směna" value={sh} onChange={e=>setSh(e.target.value)} options={SHIFTS.map(s=>({value:s,label:s}))}/><Btn warm onClick={()=>onSubmit(day,sh)} style={{width:"100%",marginTop:8}}>Odeslat</Btn></div>}
function MyAbsF({profile,onSubmit}){const[day,setDay]=useState(DAYS[0]);const[t,setT]=useState(ABS[0].id);const r={sick:(profile.sickTotal||5)-(profile.sickUsed||0),vacation:(profile.vacationTotal||20)-(profile.vacationUsed||0),whatever:(profile.whateverTotal||3)-(profile.whateverUsed||0)};return<div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:20}}>{[{l:"Dovolená",v:r.vacation,c:"var(--sd)"},{l:"Sick",v:r.sick,c:"var(--red)"},{l:"Whatever",v:r.whatever,c:"var(--amb)"}].map(b=><div key={b.l} style={{textAlign:"center",padding:12,border:"1px solid var(--brd)",background:"var(--bg3)"}}><div style={{fontSize:28,fontWeight:600,color:b.c,fontFamily:"'IBM Plex Mono',monospace"}}>{b.v}</div><div style={{fontSize:11,color:"var(--tx3)",textTransform:"uppercase"}}>{b.l}</div></div>)}</div><Select label="Den" value={day} onChange={e=>setDay(e.target.value)} options={DAYS.map((d,i)=>({value:d,label:DAYS_F[i]}))}/><Select label="Typ" value={t} onChange={e=>setT(e.target.value)} options={ABS.map(a=>({value:a.id,label:`${a.icon} ${a.label}`}))}/><Btn warm onClick={()=>onSubmit(day,t)} style={{width:"100%",marginTop:8}}>Zadat</Btn></div>}
function EditDF({emp,onDone}){const[vac,setVac]=useState(emp?.vacationTotal||20);const[sick,setSick]=useState(emp?.sickTotal||5);const[what,setWhat]=useState(emp?.whateverTotal||3);const[l,setL]=useState(false);if(!emp)return null;return<div><p style={{fontSize:14,color:"var(--tx2)",marginBottom:16}}>{emp.name}</p><Input label="Dovolená" type="number" value={vac} onChange={e=>setVac(+e.target.value)}/><Input label="Sick Days" type="number" value={sick} onChange={e=>setSick(+e.target.value)}/><Input label="Whatever Days" type="number" value={what} onChange={e=>setWhat(+e.target.value)}/><Btn warm disabled={l} onClick={async()=>{setL(true);await updateDoc(doc(db,"users",emp.id),{vacationTotal:vac,sickTotal:sick,whateverTotal:what});setL(false);onDone()}} style={{width:"100%",marginTop:8}}>Uložit</Btn></div>}
function AddF({onDone}){const[name,setName]=useState("");const[email,setEmail]=useState("");const[pass,setPass]=useState("");const[team,setTeam]=useState("L1");const[l,setL]=useState(false);const[err,setErr]=useState("");return<div><Input label="Jméno" value={name} onChange={e=>setName(e.target.value)}/><Input label="Email" value={email} onChange={e=>setEmail(e.target.value)}/><Input label="Heslo (min. 6)" type="password" value={pass} onChange={e=>setPass(e.target.value)}/><Select label="Tým" value={team} onChange={e=>setTeam(e.target.value)} options={[{value:"L1",label:"L1 Support"},{value:"SD",label:"Service Desk"}]}/>{err&&<p style={{color:"var(--red)",fontSize:14,marginBottom:8,padding:"10px 12px",border:"1px solid var(--red)"}}>{err}</p>}<Btn warm disabled={l} onClick={async()=>{setErr("");if(!name.trim()||!email||!pass)return setErr("Vyplňte vše");if(pass.length<6)return setErr("Min. 6 znaků");setL(true);try{const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${import.meta.env.VITE_FIREBASE_API_KEY}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password:pass,displayName:name.trim(),returnSecureToken:false})});const d=await r.json();if(d.error){setErr(d.error.message);setL(false);return}await setDoc(doc(db,"users",d.localId),{name:name.trim(),email,team,role:"employee",notify:false,notifyEmail:"",fcmToken:null,defaultSchedule:null,setupDone:false,vacationTotal:20,sickTotal:5,whateverTotal:3,vacationUsed:0,sickUsed:0,whateverUsed:0,createdAt:new Date().toISOString()});onDone(`Přidán: ${name.trim()}`)}catch(e){setErr(e.message)}setL(false)}} style={{width:"100%"}}>Přidat</Btn></div>}
