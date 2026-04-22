/**
 * ShiftFlow – Firestore Initialization Script
 * Reads Firebase config from .env.local (not committed to Git)
 * Run: npm run init
 */

import { readFileSync } from 'fs';
import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';

// Read .env.local
const env = {};
try {
  readFileSync('.env.local', 'utf-8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && val.length) env[key.trim()] = val.join('=').trim();
  });
} catch { console.error('❌ Soubor .env.local nenalezen. Vytvořte ho podle .env.example'); process.exit(1); }

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

if (!firebaseConfig.apiKey) { console.error('❌ VITE_FIREBASE_API_KEY chybí v .env.local'); process.exit(1); }

const ADMIN_EMAIL = "admin@shiftflow.app";
const ADMIN_PASSWORD = "ShiftFlowAdmin2026!";

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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

async function main() {
  console.log("\n📅 ShiftFlow – Inicializace Firestore\n");

  console.log("1. Admin účet...");
  try {
    const cred = await createUserWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
    await updateProfile(cred.user, { displayName: "Administrátor" });
    console.log("  ✓ Admin vytvořen");
  } catch (e) {
    if (e.code === 'auth/email-already-in-use') {
      console.log("  → Admin existuje, přihlašuji...");
      await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
      console.log("  ✓ Přihlášen");
    } else throw e;
  }

  const adminUid = auth.currentUser.uid;
  await setDoc(doc(db, "users", adminUid), {
    name: "Administrátor", email: ADMIN_EMAIL, team: "L1", role: "admin",
    notify: false, notifyEmail: "", fcmToken: null,
    vacationTotal: 20, sickTotal: 5, whateverTotal: 3,
    vacationUsed: 0, sickUsed: 0, whateverUsed: 0,
    createdAt: new Date().toISOString(),
  }, { merge: true });
  console.log("  ✓ Admin profil uložen");

  console.log("\n2. Pravidla...");
  await setDoc(doc(db, "rules", "global"), { L1_max:2, SD_max8:2, SD_maxHO:2, SD_noHO8:true, SD_noHO10:true });
  console.log("  ✓ Uložena");

  console.log("\n3. Zaměstnanci...");
  for (const emp of SEED_EMPLOYEES) {
    try {
      const cred = await createUserWithEmailAndPassword(auth, emp.email, emp.password);
      await updateProfile(cred.user, { displayName: emp.name });
      await setDoc(doc(db, "users", cred.user.uid), {
        name: emp.name, email: emp.email, team: emp.team, role: "employee",
        notify: false, notifyEmail: "", fcmToken: null, defaultSchedule: null, setupDone: false,
        vacationTotal: 20, sickTotal: 5, whateverTotal: 3,
        vacationUsed: 0, sickUsed: 0, whateverUsed: 0, createdAt: new Date().toISOString(),
      });
      console.log(`  ✓ ${emp.name}`);
    } catch (e) {
      if (e.code === 'auth/email-already-in-use') console.log(`  → ${emp.name} existuje`);
      else console.log(`  ✗ ${emp.name}: ${e.message}`);
    }
    await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
  }

  console.log("\n════════════════════════════════");
  console.log("✅ Hotovo!");
  console.log("Admin: Admin / 0000");
  console.log("Test heslo: Test1234!");
  console.log("════════════════════════════════\n");
  process.exit(0);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
