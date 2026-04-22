# ShiftFlow – Nasazení (zkrácený návod)

Všechny soubory jsou hotové. Ty musíš jen nastavit služby a propojit.

---

## 1. Firebase (5 minut)

1. https://console.firebase.google.com → **Add project** → název `shiftflow`
2. **Authentication** → Sign-in method → zapni **Email/Password**
3. **Firestore Database** → Create database → **Start in test mode** → region `eur3`
4. **Project Settings** (ozubené kolo) → **General** → scroll dolů → **Add app** → Web (</>) → nickname `ShiftFlow` → Register
5. Zkopíruj config objekt do `.env.local` (viz `.env.example`)

### Firestore Rules

Firestore → **Rules** → zkopíruj obsah souboru `firestore.rules` → **Publish**

---

## 2. Inicializace databáze (2 minuty)

```bash
cp .env.example .env.local
# Vyplň Firebase hodnoty v .env.local

# Uprav Firebase config v scripts/init-firestore.mjs
# (stejné hodnoty jako v .env.local)

npm install
npm run init
```

Skript automaticky vytvoří:
- Admin účet (`admin@shiftflow.app`)
- Výchozí pravidla směn
- 8 testovacích zaměstnanců (4x L1, 4x SD)

---

## 3. Lokální test

```bash
npm run dev
# Otevři http://localhost:5173
```

Přihlášení: **Admin** / **0000** · Zaměstnanci: **Test1234!**

---

## 4. Netlify deploy (3 minuty)

### Varianta A – přes GitHub (doporučeno)

1. Pushni projekt na GitHub
2. https://app.netlify.com → **Add new site** → **Import from Git** → vyber repo
3. Build command: `npm run build`
4. Publish directory: `dist`
5. **Environment variables** → přidej všechny `VITE_*` z `.env.local`
6. **Deploy site**

### Varianta B – přes CLI

```bash
npm install -g netlify-cli
netlify login
npm run build
netlify deploy --prod --dir=dist
```

---

## 5. Google Apps Script (volitelné – email notifikace)

1. https://script.google.com → **New project** → název "ShiftFlow API"
2. Zkopíruj obsah `gas/Code.gs` do editoru
3. Změň `FIREBASE_PROJECT_ID` na tvůj project ID
4. **Deploy** → **New deployment** → Type: **Web app** → Execute as: **Me** → Who: **Anyone** → **Deploy**
5. Zkopíruj URL do `.env.local` jako `VITE_GAS_URL` + redeploy na Netlify

### Claude API (volitelné)

V Apps Script: **Project Settings** → **Script Properties** → přidej `CLAUDE_API_KEY`

---

## 6. Push notifikace (volitelné)

1. Firebase Console → **Project Settings** → **Cloud Messaging** → **Generate key pair**
2. Zkopíruj klíč do `.env.local` jako `VITE_FIREBASE_VAPID_KEY`
3. Uprav `public/firebase-messaging-sw.js` – nahraď YOUR_ hodnoty za Firebase config
4. Redeploy

---

## Struktura souborů

```
shiftflow/
├── public/
│   ├── manifest.json                  ← PWA manifest
│   ├── firebase-messaging-sw.js       ← push notif. service worker
│   ├── icon-192.png                   ← PWA ikona
│   ├── icon-512.png                   ← PWA ikona
│   └── favicon.png                    ← favicon
├── src/
│   ├── firebase.js                    ← Firebase inicializace
│   ├── main.jsx                       ← React entry point
│   └── App.jsx                        ← CELÁ APLIKACE
├── scripts/
│   └── init-firestore.mjs             ← Seed skript (spusť jednou)
├── gas/
│   └── Code.gs                        ← Google Apps Script backend
├── .env.example                       ← šablona env proměnných
├── .gitignore
├── firebase.json
├── firestore.rules                    ← Firestore security rules
├── firestore.indexes.json
├── netlify.toml                       ← Netlify config
├── vite.config.js
├── index.html
├── DEPLOY.md                          ← tento soubor
└── package.json
```

---

## Debugging

| Problém | Řešení |
|---------|--------|
| `permission-denied` | Firestore → Rules → ověř že jsou publishnuté |
| Prázdný rozvrh | Normální stav před registrací zaměstnanců |
| Admin login nefunguje | Spusť `npm run init` nebo ručně vytvoř admin v Auth |
| GAS CORS error | Posílej `Content-Type: text/plain`, ne `application/json` |
| Push nefungují | Ověř VAPID key + service worker config |
| Build selhává na Netlify | Zkontroluj env proměnné v Site settings |
| Real-time nejde | Firestore musí být v **production mode** s rules, ne test mode po expiraci |
| Ikony se nezobrazují | Manifest.json musí být v /public, ikony taky |
