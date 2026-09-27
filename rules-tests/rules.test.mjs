// Testy pravidel databáze na skutečném emulátoru Firebase.
// Spouští .github/workflows/rules-test.yml (emulátor potřebuje Javu).
// Role: cizi (přihlášený, bez profilu) / pending / clen / clen2 / admin / anonym (nepřihlášený).
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, addDoc } from "firebase/firestore";

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-shiftflow",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
});
after(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/admin"), { name: "Admin", role: "admin" });
    await setDoc(doc(db, "users/clen"), { name: "Člen", role: "employee", vacationUsed: 0 });
    await setDoc(doc(db, "users/clen2"), { name: "Člen 2", role: "employee" });
    await setDoc(doc(db, "users/pending"), { name: "Nový", role: "pending" });
    await setDoc(doc(db, "schedules/2026-09-28"), { entries: {} });
    await setDoc(doc(db, "rules/global"), { officeMin: 4, rotations: [] });
    await setDoc(doc(db, "swapRequests/s1"), { rid: "clen", status: "open" });
    await setDoc(doc(db, "changeProposals/p1"), { affected: ["clen"], status: "open" });
    await setDoc(doc(db, "changeProposals/p2"), { affected: ["clen2"], status: "open" });
    await setDoc(doc(db, "auditLog/l1"), { msg: "x" });
  });
});

const as = uid => uid === "anonym" ? env.unauthenticatedContext().firestore() : env.authenticatedContext(uid).firestore();

// ── Kritické: eskalace role ──
test("člen si NEMŮŽE sám nastavit roli admin", async () => {
  await assertFails(updateDoc(doc(as("clen"), "users/clen"), { role: "admin" }));
});
test("čekající si NEMŮŽE sám schválit roli", async () => {
  await assertFails(updateDoc(doc(as("pending"), "users/pending"), { role: "employee" }));
});
test("registrace: vlastní profil jen jako pending", async () => {
  await assertSucceeds(setDoc(doc(as("cizi"), "users/cizi"), { name: "X", role: "pending" }));
  await assertFails(setDoc(doc(as("cizi"), "users/cizi"), { name: "X", role: "employee" }));
  await assertFails(setDoc(doc(as("cizi"), "users/cizi"), { name: "X", role: "admin" }));
  await assertFails(setDoc(doc(as("cizi"), "users/cizi"), { name: "X" }));   // bez role
});
test("registrace: nelze založit profil za někoho jiného", async () => {
  await assertFails(setDoc(doc(as("cizi"), "users/nekdo"), { name: "X", role: "pending" }));
});

// ── Kritické: cizí člověk (registrovaný, bez profilu) a čekající nevidí data ──
for (const who of ["cizi", "pending", "anonym"]) {
  test(`${who}: nečte rozvrh, tým, pravidla, log, výměny ani návrhy`, async () => {
    const db = as(who);
    await assertFails(getDoc(doc(db, "schedules/2026-09-28")));
    await assertFails(getDocs(collection(db, "users")));
    await assertFails(getDoc(doc(db, "rules/global")));
    await assertFails(getDocs(collection(db, "auditLog")));
    await assertFails(getDocs(collection(db, "swapRequests")));
    await assertFails(getDoc(doc(db, "changeProposals/p1")));
  });
  test(`${who}: nezapíše ani nesmaže rozvrh`, async () => {
    await assertFails(setDoc(doc(as(who), "schedules/2026-09-28"), { entries: { hacked: true } }));
    await assertFails(deleteDoc(doc(as(who), "schedules/2026-09-28")));
  });
}
test("čekající vidí jen svůj vlastní profil", async () => {
  await assertSucceeds(getDoc(doc(as("pending"), "users/pending")));
  await assertFails(getDoc(doc(as("pending"), "users/clen")));
});

// ── Člen: běžný provoz appky musí fungovat ──
test("člen: čte a zapisuje rozvrh, čte tým, pravidla a log", async () => {
  const db = as("clen");
  await assertSucceeds(getDoc(doc(db, "schedules/2026-09-28")));
  await assertSucceeds(setDoc(doc(db, "schedules/2026-09-28"), { entries: { Po: {} } }, { merge: true }));
  await assertSucceeds(getDocs(collection(db, "users")));
  await assertSucceeds(getDoc(doc(db, "rules/global")));
  await assertSucceeds(getDocs(collection(db, "auditLog")));
  await assertSucceeds(addDoc(collection(db, "auditLog"), { msg: "y" }));
});
test("člen: upraví vlastní profil (počítadla, jméno), ale ne cizí", async () => {
  await assertSucceeds(updateDoc(doc(as("clen"), "users/clen"), { vacationUsed: 1, name: "Člen X" }));
  await assertFails(updateDoc(doc(as("clen"), "users/clen2"), { vacationUsed: 5 }));
});
test("člen: nemůže měnit pravidla ani mazat lidi a log", async () => {
  await assertFails(setDoc(doc(as("clen"), "rules/global"), { officeMin: 0 }));
  await assertFails(deleteDoc(doc(as("clen"), "users/clen2")));
  await assertFails(deleteDoc(doc(as("clen"), "auditLog/l1")));
  await assertFails(updateDoc(doc(as("clen"), "auditLog/l1"), { msg: "přepsáno" }));
});
test("výměny: člen vytvoří a upraví, zruší jen vlastní žádost", async () => {
  await assertSucceeds(addDoc(collection(as("clen2"), "swapRequests"), { rid: "clen2", status: "open" }));
  await assertSucceeds(updateDoc(doc(as("clen2"), "swapRequests/s1"), { status: "accepted" }));
  await assertFails(deleteDoc(doc(as("clen2"), "swapRequests/s1")));
  await assertSucceeds(deleteDoc(doc(as("clen"), "swapRequests/s1")));
});
test("návrhy: člen čte jen své (dotazem), cizí ne; celou kolekci ne", async () => {
  const db = as("clen");
  await assertSucceeds(getDocs(query(collection(db, "changeProposals"), where("affected", "array-contains", "clen"))));
  await assertSucceeds(getDoc(doc(db, "changeProposals/p1")));
  await assertFails(getDoc(doc(db, "changeProposals/p2")));
  await assertFails(getDocs(collection(db, "changeProposals")));
  await assertSucceeds(updateDoc(doc(db, "changeProposals/p1"), { consents: { clen: true } }));
  await assertFails(updateDoc(doc(db, "changeProposals/p2"), { consents: { clen: true } }));
});

// ── Admin ──
test("admin: schválí čekajícího, spravuje pravidla, čte všechny návrhy", async () => {
  const db = as("admin");
  await assertSucceeds(updateDoc(doc(db, "users/pending"), { role: "employee" }));
  await assertSucceeds(setDoc(doc(db, "rules/global"), { officeMin: 4, rotations: [] }));
  await assertSucceeds(getDocs(collection(db, "changeProposals")));
  await assertSucceeds(setDoc(doc(db, "users/novy"), { name: "Přidaný adminem", role: "employee" }));
  await assertSucceeds(deleteDoc(doc(db, "users/novy")));
});
test("schválený čekající hned vidí data", async () => {
  await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), "users/pending"), { role: "employee" }));
  await assertSucceeds(getDoc(doc(as("pending"), "schedules/2026-09-28")));
});
