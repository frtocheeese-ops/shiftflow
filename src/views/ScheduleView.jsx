/* Obrazovka Rozvrh — navigace týdnů, porušení pravidel, denní a týdenní pohled.
   Nic nezapisuje: všechny změny (přesun, absence, Nástupy…) volají funkce z App.jsx. */
import { DAYS, DAYS_F, SHIFTS, ABS, fmtW, fmtDate, getMon, fsKey, isTd } from "../schedule";
import { Badge, Btn, HALF_LBL, HalfTag, RankBadge } from "../ui";
import ShiftCard from "./ShiftCard";

export default function ScheduleView(props) {
  // Data a akce z App.jsx — stejná jména jako dřív, takže JSX níže zůstalo beze změny
  const {
    analysis, cs, cw, dayHol, intake, intakeAllow, isA, isMobile, notes, profile, rules, schedMeta, schedView, selDay, slideDir, wd, wh, wo,
    allowIntakeException, canDrag, exportCSV, ge, getDayAbs, getEntries, goDay, handleDrop, removeAbs, setModal, setNoteView, setSchedView, setSelCell, setShowCompare, setShowPerma, setWo, switchV, toggleIntake,
  } = props;
  return (
    <div>
          {/* Week nav */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <button onClick={() => setWo(w => w - 1)} aria-label="Předchozí týden" style={{ width: 44, height: 44, border: "1px solid var(--brd2)", background: "transparent", color: "var(--tx)", cursor: "pointer", fontSize: 22, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>‹</button>
            <div style={{ textAlign: "center", minWidth: 190 }}>
              <div style={{ fontSize: 18, fontWeight: 500, color: "var(--w)", fontFamily: "'IBM Plex Mono',monospace" }}>{fmtW(cw)}</div>
              <div style={{ fontSize: 12, color: wo === 0 ? "var(--acc2)" : "var(--tx3)", textTransform: "uppercase", letterSpacing: 1 }}>{wo === 0 ? "Aktuální týden" : `${wo > 0 ? "+" : ""}${wo} týd.`}</div>
            </div>
            <button onClick={() => setWo(w => w + 1)} aria-label="Další týden" style={{ width: 44, height: 44, border: "1px solid var(--brd2)", background: "transparent", color: "var(--tx)", cursor: "pointer", fontSize: 22, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>›</button>
            <label style={{ position: "relative", width: 44, height: 44, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--brd2)", cursor: "pointer", color: "var(--tx)" }} title="Přejít na datum">
              <span style={{ fontSize: 18, pointerEvents: "none" }}>📅</span>
              <input type="date" aria-label="Přejít na datum" onChange={e => {
                if (!e.target.value) return;
                const picked = new Date(e.target.value + "T00:00:00");
                const today = new Date(); today.setHours(0, 0, 0, 0);
                const pickedMon = getMon(picked); const todayMon = getMon(today);
                const diffDays = Math.round((pickedMon - todayMon) / (1000 * 60 * 60 * 24));
                setWo(Math.round(diffDays / 7));
                const dow = picked.getDay();
                if (dow >= 1 && dow <= 5) goDay(dow - 1);
              }} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }} />
            </label>
            {wo !== 0 && <Btn small ghost onClick={() => setWo(0)}>Dnes</Btn>}
          </div>
    
          {/* Porušení pravidel nového modelu */}
          {analysis.violations.length > 0 && <div className="gl" style={{ padding: "10px 14px", marginBottom: 12, borderLeft: "3px solid var(--red)" }}>
            {analysis.violations.map((v, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: v.sev === "crit" ? "var(--red)" : "var(--amb)", padding: "2px 0", fontWeight: v.sev === "crit" ? 600 : 400 }}>
              <span style={{ flex: 1 }}>{v.sev === "crit" ? "⛔" : "⚠️"} {v.empId && !v.intake ? `${ge(v.empId)?.name}: ` : ""}{v.msg}</span>
              {isA && v.intake && v.empId && !(intakeAllow[v.day] || []).includes(v.empId) && <Btn small onClick={() => allowIntakeException(v.day, v.empId)}>Povolit výjimku</Btn>}
            </div>)}
            {isA && analysis.problems.length > 0 && <Btn small warm onClick={() => switchV("proposals")} style={{ marginTop: 8 }}>⚑ Zobrazit návrhy řešení ({analysis.problems.length})</Btn>}
          </div>}
    
          {/* Freshness — kdo a kdy naposledy upravil (real-time) */}
          {schedMeta.at && <div style={{ fontSize: 11, color: "var(--tx3)", fontFamily: "'IBM Plex Mono',monospace", marginBottom: 10 }}>
            aktualizováno {new Date(schedMeta.at).toLocaleTimeString("cs", { hour: "2-digit", minute: "2-digit" })}{schedMeta.by && ge(schedMeta.by) ? ` · ${ge(schedMeta.by).name}` : ""}
          </div>}
    
          {/* View toggle: Den / Týden */}
          <div style={{ display: "flex", gap: 2, marginBottom: 14, border: "1px solid var(--brd)", width: "fit-content" }}>
            {[{ k: "day", l: "Den" }, { k: "week", l: "Týden" }].map(v => <button key={v.k} onClick={() => setSchedView(v.k)} style={{ padding: "8px 18px", border: "none", background: schedView === v.k ? "var(--sel)" : "transparent", color: schedView === v.k ? "var(--stx)" : "var(--tx3)", cursor: "pointer", fontSize: 13, fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 1, minHeight: 38 }}>{v.l}</button>)}
          </div>
    
          {/* D&D global flag indicator */}
          {!isA && rules?.allowAllDnD === true && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", border: "1px solid var(--abrd)", background: "var(--adim)", marginBottom: 12, fontSize: 12, color: "var(--acc2)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 1 }}>
            ⤧ D&D povoleno pro všechny - můžeš přesouvat kohokoliv
          </div>}
    
          {/* Filters + actions */}
          <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
            <Btn small ghost onClick={() => setShowPerma(true)}>Zobrazit stálý</Btn>
            <Btn small ghost onClick={() => setShowCompare(true)}>Porovnat se stálým</Btn>
            {isA && <Btn small onClick={() => setModal("applydefault")}>Aplikovat stálý</Btn>}
            <div style={{ flex: 1 }} />
            {isA && <Btn small onClick={() => setModal("absence")}>+ Nepřít.</Btn>}
            {!isA && <Btn small warm onClick={() => setModal("myabsence")}>+ Nepřítomnost</Btn>}
            <Btn small ghost onClick={exportCSV}>CSV</Btn>
          </div>
          {isMobile && <div style={{ fontSize: 11.5, color: "var(--tx3)", marginBottom: 10, lineHeight: 1.4 }}>Na mobilu se nepřetahuje — klepnutím na jméno otevřeš akce{isA ? " včetně přesunu na jinou směnu nebo den" : ""}. Ikona „i" zobrazí poznámku.</div>}
    
          {/* ── DAY VIEW ── */}
          {schedView === "day" && <>
            {/* Day pills */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 3, marginBottom: 16 }}>
              {DAYS.map((d, i) => { const it = isTd(i, wo); const hol = !!wh[i]; return <button key={d} className={it && selDay === i ? 'atp' : ''} onClick={() => goDay(i)} style={{ padding: "8px 4px", border: `1px solid ${selDay === i ? "var(--abrd)" : "var(--brd)"}`, background: selDay === i ? "var(--adim)" : "transparent", color: selDay === i ? "var(--acc2)" : "var(--tx3)", cursor: "pointer", fontFamily: "'Barlow Condensed',sans-serif", fontSize: 14, fontWeight: 600, textTransform: "uppercase", textAlign: "center", minHeight: 52, opacity: hol ? .6 : 1 }}>
                <div>{d}</div>
                <div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", marginTop: 2 }}>{fmtDate(wd[i])}</div>
                {it && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--acc2)", display: "block", margin: "2px auto 0" }} />}
                {hol && <div style={{ fontSize: 7, color: "var(--acc2)" }}>svátek</div>}
                {!hol && intake[d] && <div style={{ fontSize: 7, color: "var(--amb)" }}>🎓 nástupy</div>}
              </button>; })}
            </div>
    
            {/* Banners */}
            {isTd(selDay, wo) && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", border: "1px solid var(--abrd)", background: "var(--adim)", marginBottom: 12 }}><div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--acc2)" }} /><span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 12, color: "var(--acc2)", textTransform: "uppercase", letterSpacing: 1.5 }}>Dnes</span></div>}
            {dayHol && <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", border: "1px solid var(--abrd)", background: "var(--adim)", marginBottom: 12 }}><span>🎉</span><span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, color: "var(--acc2)", textTransform: "uppercase", letterSpacing: 1, fontSize: 14 }}>{dayHol} — volno</span></div>}
    
            {/* Nástupy: indikátor + admin přepínač */}
            {!dayHol && (intake[DAYS[selDay]] || isA) && <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", border: `1px solid ${intake[DAYS[selDay]] ? "var(--amb)" : "var(--brd)"}`, background: intake[DAYS[selDay]] ? "rgba(200,112,32,.08)" : "transparent", marginBottom: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 16 }}>🎓</span>
              <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 13, letterSpacing: 1, textTransform: "uppercase", color: intake[DAYS[selDay]] ? "var(--amb)" : "var(--tx3)", flex: 1 }}>
                {intake[DAYS[selDay]] ? "Den nástupů — HO jen s výjimkou" : "Běžný den"}
              </span>
              {isA && <Btn small warm={!intake[DAYS[selDay]]} danger={intake[DAYS[selDay]]} onClick={() => toggleIntake(DAYS[selDay])}>{intake[DAYS[selDay]] ? "Zrušit Nástupy" : "Označit jako Nástupy"}</Btn>}
            </div>}
    
            {/* Shifts */}
            <div key={`${selDay}-${wo}`} className={slideDir === 'right' ? 'asr' : 'asl'}>
              {!dayHol && SHIFTS.map(shift => <div key={shift} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", color: "var(--acc2)", fontSize: 16, fontWeight: 500 }}>{shift}</span>
                  <div style={{ flex: 1, height: 1, background: "var(--brd)" }} />
                  <span style={{ fontSize: 12, color: "var(--tx3)" }}>{getEntries(DAYS[selDay], shift).length} os.</span>
                </div>
                <ShiftCard day={DAYS[selDay]} shift={shift} entries={getEntries(DAYS[selDay], shift)} ge={ge} notes={notes} meId={profile.id} isA={isA}
                  canDrag={canDrag} onDrop={handleDrop} onAdminClick={setSelCell} onMyShift={setModal} onDirectSwap={setModal} onNote={setNoteView} />
              </div>)}
              {/* Day absences */}
              {(() => { const da = getDayAbs(DAYS[selDay]); if (!da.length) return null; return <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, color: "var(--tx3)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8, fontFamily: "'Barlow Condensed',sans-serif" }}>Nepřítomnost</div>
                {da.map(a => { const e = ge(a.empId); const at = ABS.find(t => t.id === a.type); return e && <div key={a.empId} className="gl" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", marginBottom: 6, minHeight: 48 }}><span>{at?.icon}</span><span style={{ fontWeight: 500, color: "var(--w)", flex: 1 }}>{e.name}</span><Badge small color={at?.color}>{at?.label}{String(a.type).startsWith("half_") ? (() => { let p = "first"; SHIFTS.forEach(sh => (cs[DAYS[selDay]]?.[sh] || []).forEach(x => { if (x.empId === a.empId && x.halfPart) p = x.halfPart; })); return ` · ${HALF_LBL[p]}`; })() : ""}</Badge>{(isA || a.empId === profile.id) && <button onClick={() => removeAbs(a.empId, DAYS[selDay])} style={{ background: "none", border: "1px solid var(--red)", color: "var(--red)", width: 28, height: 28, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>✕</button>}</div>; })}
              </div>; })()}
            </div>
          </>}
    
          {/* ── WEEK VIEW (table) ── */}
          {schedView === "week" && <div id="week-grid" className="gl" style={{ overflow: "hidden", padding: 0 }}>
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <table style={{ width: "100%", minWidth: 700, borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={{ position: "sticky", left: 0, zIndex: 10, background: "var(--panel)", backdropFilter: "var(--blur)", padding: "10px 8px", borderBottom: "2px solid var(--bt)", borderRight: "2px solid var(--bt)", width: 64, fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: "var(--tx3)" }}>⏱</th>
                  {DAYS.map((d, i) => { const hol = wh[i]; const td = isTd(i, wo); return <th key={d} style={{ padding: "8px 6px", borderBottom: td ? "3px solid var(--acc2)" : "2px solid var(--bt)", borderLeft: "2px solid var(--bt)", background: td ? "var(--adim)" : hol ? "rgba(48,128,96,.06)" : "var(--bg3)", textAlign: "center", minWidth: 115, opacity: hol ? .6 : 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: td ? "var(--acc2)" : "var(--w)", fontFamily: "'Barlow Condensed',sans-serif" }}>{DAYS_F[i]}</div>
                    <div style={{ fontSize: 11, color: "var(--tx3)", fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDate(wd[i])}</div>
                    {hol && <Badge small color="var(--grn)">{hol}</Badge>}
                    {!hol && intake[d] && <div style={{ fontSize: 9, color: "var(--amb)", fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: 1 }}>🎓 NÁSTUPY</div>}
                    {isA && !hol && <button onClick={() => toggleIntake(d)} title={intake[d] ? "Zrušit Nástupy" : "Označit jako Nástupy"} style={{ marginTop: 3, fontSize: 9, fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: .5, textTransform: "uppercase", cursor: "pointer", background: "transparent", border: `1px solid ${intake[d] ? "var(--amb)" : "var(--brd)"}`, color: intake[d] ? "var(--amb)" : "var(--tx3)", padding: "1px 6px" }}>{intake[d] ? "✕ nástupy" : "+ nástupy"}</button>}
                  </th>; })}
                </tr></thead>
                <tbody>{SHIFTS.map(shift => <tr key={shift}>
                  <td style={{ position: "sticky", left: 0, zIndex: 10, background: "var(--panel)", padding: "8px 6px", borderBottom: "2px solid var(--bt)", borderRight: "2px solid var(--bt)", textAlign: "center", fontFamily: "'IBM Plex Mono',monospace", fontSize: 17, fontWeight: 500, color: "var(--acc2)" }}>{shift}</td>
                  {DAYS.map((day, di) => { const entries = getEntries(day, shift); const td = isTd(di, wo); const hol = !!wh[di];
                    return <td key={`${day}-${shift}`} className="dz" style={{ padding: 4, borderBottom: "2px solid var(--bt)", borderLeft: "2px solid var(--bt)", verticalAlign: "top", background: td ? "var(--adim)" : hol ? "rgba(48,128,96,.04)" : "var(--bg3)", opacity: hol ? .5 : 1 }}
                      onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("over"); }}
                      onDragLeave={e => e.currentTarget.classList.remove("over")}
                      onDrop={e => handleDrop(day, shift, e)}>
                      {entries.map(en => { const emp = ge(en.empId); if (!emp) return null; const isMe = en.empId === profile.id;
                        const wNote = notes[fsKey(en.empId, day, shift.replace(":", ""))];
                        return <div key={en.empId} className="ent" draggable={canDrag(en.empId)} onDragStart={e => e.dataTransfer.setData("text/plain", JSON.stringify({ empId: en.empId, day, shift }))} onClick={() => isA ? setSelCell({ day, shift, empId: en.empId }) : isMe && setModal({ type: "myshift", day, shift })} style={{ gap: 4, padding: "6px 8px", marginBottom: 2, background: "var(--bg3)", border: "1px solid var(--brd)", fontSize: 14 }}>
                          {wNote && <button aria-label="Zobrazit poznámku" onClick={e => { e.stopPropagation(); setNoteView({ name: ge(en.empId)?.name, day, shift, text: wNote }); }} style={{ background: "none", border: "1px solid var(--acc2)", color: "var(--acc2)", width: 20, height: 20, fontSize: 11, fontWeight: 700, cursor: "pointer", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: "'IBM Plex Mono',monospace", order: 9 }}>i</button>}
                          <span style={{ width: 8, height: 3, background: en.ho ? "var(--grn)" : "var(--acc2)" }} /><span style={{ fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--w)" }}>{emp.name?.split(" ").pop()}</span><RankBadge fixes={emp.fixCount} size={15} /><HalfTag en={en} compact />
                          {!isA && !isMe && <button title={`Výměna s ${emp.name}`} onClick={e => { e.stopPropagation(); setModal({ type: "directSwap", targetEmp: emp, targetDay: day, targetShift: shift }); }} style={{ background: "none", border: "1px solid var(--acc2)", color: "var(--acc2)", width: 20, height: 20, cursor: "pointer", fontSize: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 0 }}>⇄</button>}
                          {en.ho && <Badge small color="var(--grn)">HO</Badge>}
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
    </div>
  );
}
