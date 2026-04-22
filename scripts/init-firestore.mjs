/**
 * ShiftFlow – Firestore Initialization Script
 * 
 * Spusťte jednou po vytvoření Firebase projektu:
 *   1. Vyplňte Firebase config níže
 *   2. node scripts/init-firestore.mjs
 * 
 * Co skript udělá:
 *   - Vytvoří admin účet (admin@shiftflow.app)
 *   - Nastaví výchozí pravidla
 *   - (volitelně) Vytvoří testovací zaměstnance
 */

import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';

// ══════════════════════════════════════
// VYPLŇTE SVÉ FIREBASE HODNOTY:
// ══════════════════════════════════════
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const ADMIN_EMAIL = "admin@shiftflow.app";
const ADMIN_PASSWORD = "ShiftFlowAdmin2026!";

// Testovací zaměstnanci (smaž pokud nechceš seed data)
const SEED_EMPLOYEES = [
  { email: "jan.novak@test.cz", name: "Jan Novák", team: "L1", password: "Test1234!" },
  { email: "petr.svoboda@test.cz", name: "Petr Svoboda", team: "L1", password: "Test1234!" },
  { email: "eva.kralova@test.cz", name: "Eva Králová", team: "L1", password: "Test1234!" },
  { email: "tomas.horak@test.cz", name: "Tomáš Horák", team: "L1", password: "Test1234!" },
  { email: "marie.dvorakova@test.cz", name: "Marie Dvořáková", team: "SD", password: "Test1234!" },
  { email: "lukas.cerny@test.cz", name: "Lukáš Černý", team: "SD", password: "Test1234!" },
  { email: "anna.prochazkova@test.cz", name: "Anna Procházková", team: "SD", password: "Test1234!" },
  { email: "jakub.vesely@test.cz", name: "Jakub Veselý", team: "SD", password: "Test1234!" },
];

// ══════════════════════════════════════

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

async function createUser(email, password, name, role, team, extra = {}) {
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
    await setDoc(doc(db, "users", cred.user.uid), {
      name,
      email,
      team,
      role,
      notify: false,
      notifyEmail: "",
      fcmToken: null,
      vacationTotal: 20,
      sickTotal: 5,
      whateverTotal: 3,
      vacationUsed: 0,
      sickUsed: 0,
      whateverUsed: 0,
      createdAt: new Date().toISOString(),
      ...extra,
    });
    console.log(`  ✓ ${name} (${email}) – ${role}`);
    return cred.user.uid;
  } catch (e) {
    if (e.code === 'auth/email-already-in-use') {
      console.log(`  → ${email} již existuje, přeskakuji`);
      return null;
    }
    throw e;
  }
}

async function main() {
  console.log("\n📅 ShiftFlow – Inicializace Firestore\n");

  // 1. Admin účet
  console.log("1. Vytvářím admin účet...");
  await createUser(ADMIN_EMAIL, ADMIN_PASSWORD, "Administrátor", "admin", "L1");

  // 2. Výchozí pravidla
  console.log("\n2. Nastavuji výchozí pravidla...");
  await setDoc(doc(db, "rules", "global"), {
    L1_max: 2,
    SD_max8: 2,
    SD_maxHO: 2,
    SD_noHO8: true,
    SD_noHO10: true,
  });
  console.log("  ✓ Pravidla uložena");

  // 3. Seed zaměstnanci (volitelné)
  console.log("\n3. Vytvářím testovací zaměstnance...");
  for (const emp of SEED_EMPLOYEES) {
    // Po každém createUser je nutné se znovu přihlásit jako admin
    // protože createUserWithEmailAndPassword změní current user
    await createUser(emp.email, emp.password, emp.name, "employee", emp.team);
  }

  // Přihlásit se zpět jako admin
  await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);

  // 4. Výchozí rozvrh pro aktuální týden
  console.log("\n4. Generuji výchozí rozvrh...");
  // Rozvrh se generuje automaticky na frontendu z registrovaných zaměstnanců
  console.log("  → Rozvrh se vygeneruje automaticky po přihlášení");

  console.log("\n════════════════════════════════════");
  console.log("✅ Inicializace dokončena!");
  console.log("");
  console.log("Admin login:  Admin / 0000");
  console.log("Test heslo:   Test1234!");
  console.log("════════════════════════════════════\n");

  process.exit(0);
}

main().catch(e => { console.error("❌ Chyba:", e.message); process.exit(1); });
