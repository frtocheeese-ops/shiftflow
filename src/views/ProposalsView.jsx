/* Obrazovka Návrhy — celoroční problémy k vyřešení a čekající návrhy změn.
   Nic nezapisuje: provedení úpravy, souhlas i zamítnutí volá funkce z App.jsx
   (applyProblemFix běží v transakci a hlídá dvojí řešení — viz App.jsx). */
import { altLabel } from "../schedule";
import { Badge, Btn, Card } from "../ui";

export default function ProposalsView({ isA, profile, yearProblems, visibleProps, myPendingProps, ge, onApplyFix, onConsent, onReject }) {
  return (
    <div>
          <div style={{ fontSize: 20, fontWeight: 600, color: "var(--w)", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 2, marginBottom: 20, borderBottom: "1px solid var(--brd)", paddingBottom: 12 }}>Návrhy změn</div>
    
          {/* Plakát „Your colleagues need YOU" — ukáže se, když uživatel může něco udělat: čeká se na jeho souhlas, nebo má u problému tlačítko „Provést úpravu" */}
          {(myPendingProps.length > 0 || yearProblems.some(pr => pr.alts.some(a => isA || a.empId === profile.id))) && <div style={{ textAlign: "center", margin: "0 0 24px" }}>
            <img src="/kolegove-te-potrebuji.webp" alt="Your colleagues need YOU — můžeš pomoct s řešením" loading="lazy"
              style={{ maxWidth: 230, width: "100%", border: "1px solid var(--brd)", display: "inline-block" }} />
            <div style={{ fontSize: 12, color: "var(--tx3)", marginTop: 6, textTransform: "uppercase", letterSpacing: 1, fontFamily: "'Barlow Condensed',sans-serif" }}>Můžeš pomoct ↓</div>
          </div>}
    
          {/* Celoroční detekované problémy — ode dneška dál, přímá aplikace */}
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--tx2)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10, fontFamily: "'Barlow Condensed',sans-serif" }}>Problémy k vyřešení · ode dneška</div>
          {yearProblems.length === 0 && <Card style={{ marginBottom: 24, borderLeft: "3px solid var(--grn)" }}><span style={{ fontSize: 14 }}>✓ Žádné otevřené problémy — všechny dny splňují pravidla.</span></Card>}
          {yearProblems.length > 0 && <div style={{ marginBottom: 24 }}>
            {yearProblems.slice(0, 30).map((pr, pi) => {
              const myAlts = pr.alts.filter(a => isA || a.empId === profile.id);
              return <Card key={pr.weekKey + pr.key + pi} style={{ marginBottom: 10, borderLeft: `3px solid ${pr.alts.length > 0 ? "var(--red)" : "var(--amb)"}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                  <Badge small color="var(--acc2)">{pr.dLabel}</Badge>
                  <span style={{ fontWeight: 600, fontSize: 15, color: "var(--w)" }}>{pr.title}</span>
                </div>
                {pr.alts.length === 0 && <p style={{ fontSize: 13, color: "var(--tx3)", margin: 0 }}>Žádné automatické řešení — vyřešte ručně v rozvrhu daného týdne.</p>}
                {(isA ? pr.alts : myAlts).map((alt, i) => {
                  const canApply = isA || alt.empId === profile.id;
                  return <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "var(--bg3)", border: "1px solid var(--brd)", marginBottom: 4, flexWrap: "wrap" }}>
                    {i === 0 && <Badge small color="var(--grn)">TIP</Badge>}
                    <span style={{ flex: 1, fontSize: 14, minWidth: 160 }}>{altLabel(alt, ge)}</span>
                    {canApply
                      ? <Btn small warm onClick={() => onApplyFix(pr.weekKey, pr.key, alt)}>Provést úpravu</Btn>
                      : <span style={{ fontSize: 11, color: "var(--tx3)" }}>vyřeší {ge(alt.empId)?.name} nebo admin</span>}
                  </div>;
                })}
                {!isA && myAlts.length === 0 && pr.alts.length > 0 && <p style={{ fontSize: 12, color: "var(--tx3)", margin: "4px 0 0" }}>Tenhle problém vyřeší někdo jiný z týmu nebo admin.</p>}
              </Card>;
            })}
            {yearProblems.length > 30 && <p style={{ fontSize: 12, color: "var(--tx3)" }}>…a dalších {yearProblems.length - 30} později v roce. Vyřešením prvních se seznam posune.</p>}
          </div>}
    
          {/* Čekající návrhy — admin vidí vše, člen jen svoje */}
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--tx2)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10, fontFamily: "'Barlow Condensed',sans-serif" }}>Čeká na schválení</div>
          {visibleProps.map(p => {
            const required = ["admin", ...(p.affected || [])];
            const canConsent = (isA && !p.consents?.admin) || (p.affected?.includes(profile.id) && !p.consents?.[profile.id]);
            return <Card key={p.id} style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 16, color: "var(--w)" }}>{p.label}</div>
              {p.why && <div style={{ fontSize: 13, color: "var(--tx2)", marginTop: 2 }}>Důvod: {p.why}</div>}
              <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                <Badge small color="var(--acc2)">týden {p.week}</Badge>
                {required.map(r => <Badge key={r} small color={p.consents?.[r] ? "var(--grn)" : "var(--tx3)"}>{p.consents?.[r] ? "✓ " : "· "}{r === "admin" ? "Admin" : ge(r)?.name || "?"}</Badge>)}
                <div style={{ flex: 1 }} />
                {canConsent && <Btn small warm onClick={() => onConsent(p)}>Souhlasím</Btn>}
                {(isA || p.affected?.includes(profile.id)) && <Btn small danger onClick={() => onReject(p)}>Zamítnout</Btn>}
              </div>
            </Card>;
          })}
          {!visibleProps.length && <p style={{ color: "var(--tx3)" }}>Žádné čekající návrhy.</p>}
    </div>
  );
}
