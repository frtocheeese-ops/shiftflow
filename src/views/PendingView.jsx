/* Obrazovka pro účet, který čeká na schválení adminem (role „pending").
   Nevidí žádná data. Jakmile admin účet schválí, appka se sama odemkne (App sleduje vlastní profil). */
import { Btn, Card } from "../ui";

export default function PendingView({ profile, onRequest, onSignOut }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "var(--bg)" }}>
      <Card style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>⏳</div>
        {profile?.noDoc ? <>
          <div style={{ fontSize: 18, fontWeight: 600, color: "var(--w)", marginBottom: 8 }}>Účet nemá přístup</div>
          <p style={{ fontSize: 14, color: "var(--tx2)", marginBottom: 16 }}>Žádost o přístup neexistuje nebo byla zamítnuta. Můžeš požádat znovu — admin ji uvidí v sekci Tým.</p>
          <Btn warm onClick={onRequest} style={{ width: "100%", marginBottom: 8 }}>Požádat o přístup</Btn>
        </> : <>
          <div style={{ fontSize: 18, fontWeight: 600, color: "var(--w)", marginBottom: 8 }}>Čekáš na schválení</div>
          <p style={{ fontSize: 14, color: "var(--tx2)", marginBottom: 6 }}>Ahoj {profile?.name || ""}, tvůj účet je založený. Než uvidíš rozvrh, musí ho schválit admin.</p>
          <p style={{ fontSize: 12, color: "var(--tx3)", marginBottom: 16 }}>Tuhle stránku nemusíš obnovovat — po schválení se appka otevře sama.</p>
        </>}
        <Btn ghost onClick={onSignOut} style={{ width: "100%" }}>Odhlásit</Btn>
      </Card>
    </div>
  );
}
