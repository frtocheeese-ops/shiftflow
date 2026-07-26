// Páteční náhled rozvrhu — běží v GitHub Actions (viz .github/workflows/nahled.yml)
// 1) config (Firebase apiKey, GAS URL) si vytáhne z živého bundlu na Netlify → nikdy nezastará
// 2) při prvním běhu si sám založí účet bota (setupDone:true, defaultSchedule:null → nikdy není v rozvrhu)
// 3) příjemce čte z Firestore: všichni s notify=true (notifyEmail || email)
// 4) Puppeteer: login → pohled Týden → další týden → screenshot POUZE mřížky (#week-grid)
import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "fs";

const SITE = "https://smenyjt.netlify.app";
const { BOT_EMAIL, BOT_PASSWORD, FORCE } = process.env;
if (!BOT_EMAIL || !BOT_PASSWORD) { console.error("Chybí BOT_EMAIL / BOT_PASSWORD"); process.exit(1); }

// ── Guard na pražský čas (cron běží v UTC dvakrát kvůli DST — projít smí jen běh v 18:00) ──
const praha = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Prague" }));
if (FORCE !== "1" && praha.getHours() !== 12) { console.log(`Pražský čas ${praha.getHours()}h ≠ 12h — druhá DST větev, končím.`); process.exit(0); }

// ── Config z živého bundlu ──
const html = await (await fetch(SITE + "/?v=" + Date.now())).text();
const asset = html.match(/\/assets\/index-[\w-]+\.js/)?.[0];
if (!asset) throw new Error("Nenalezen bundle v index.html");
const js = await (await fetch(SITE + asset)).text();
const apiKey = js.match(/apiKey:"([^"]+)"/)?.[1];
const projectId = js.match(/projectId:"([^"]+)"/)?.[1] || "shifts-79d6c";
const gasUrl = js.match(/https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec/)?.[0] || "";
if (!apiKey) throw new Error("Nenalezen Firebase apiKey v bundlu");
writeFileSync("gas_url.txt", gasUrl);
console.log("Config OK — projectId:", projectId, "| GAS:", gasUrl ? "nalezen" : "CHYBÍ");

// ── Účet bota: přihlásit, případně založit ──
const idt = (ep, body) => fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${ep}?key=${apiKey}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
}).then(r => r.json());

let r = await idt("signInWithPassword", { email: BOT_EMAIL, password: BOT_PASSWORD, returnSecureToken: true });
if (r.error && /EMAIL_NOT_FOUND|INVALID_LOGIN_CREDENTIALS|INVALID_EMAIL/.test(r.error.message)) {
  console.log("Bot neexistuje — zakládám…");
  r = await idt("signUp", { email: BOT_EMAIL, password: BOT_PASSWORD, displayName: "📸 Bot", returnSecureToken: true });
  if (r.error) throw new Error("signUp: " + r.error.message);
  const fields = {
    name: { stringValue: "📸 Bot" }, email: { stringValue: BOT_EMAIL }, role: { stringValue: "employee" },
    notify: { booleanValue: false }, notifyEmail: { stringValue: "" }, fcmToken: { nullValue: null },
    defaultSchedule: { nullValue: null }, setupDone: { booleanValue: true },
    vacationTotal: { integerValue: "0" }, sickTotal: { integerValue: "0" }, whateverTotal: { integerValue: "0" },
    vacationUsed: { integerValue: "0" }, sickUsed: { integerValue: "0" }, whateverUsed: { integerValue: "0" },
    createdAt: { stringValue: new Date().toISOString() }
  };
  const fs = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${r.localId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${r.idToken}` },
    body: JSON.stringify({ fields })
  });
  if (!fs.ok) throw new Error("Firestore users doc: " + await fs.text());
  console.log("Bot založen:", r.localId);
} else if (r.error) throw new Error("signIn: " + r.error.message);
const idToken = r.idToken;

// ── Příjemci: všichni s notify=true (jako u běžných e-mail notifikací appky) ──
const ur = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users?pageSize=300`, {
  headers: { Authorization: `Bearer ${idToken}` }
}).then(x => x.json());
const recipients = [...new Set((ur.documents || [])
  .map(d => d.fields || {})
  .filter(f => f.notify?.booleanValue === true)
  .map(f => f.notifyEmail?.stringValue || f.email?.stringValue)
  .filter(e => e && e !== BOT_EMAIL))];
writeFileSync("recipients.txt", recipients.join("\n"));
console.log(`Příjemci s notify=true: ${recipients.length}`);

// ── Screenshot ──
const browser = await puppeteer.launch({ args: ["--no-sandbox", "--font-render-hinting=none"] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1100, deviceScaleFactor: 2 });
await page.goto(SITE + "/?v=" + Date.now(), { waitUntil: "networkidle2", timeout: 60000 });

await page.waitForSelector("input[type=password]", { timeout: 30000 });
await page.type("input:not([type=password])", BOT_EMAIL, { delay: 10 });
await page.type("input[type=password]", BOT_PASSWORD, { delay: 10 });
await page.keyboard.press("Enter");

await page.waitForSelector('[aria-label="Další týden"]', { timeout: 45000 });
// přepnout na pohled Týden (výchozí je Den)
await page.evaluate(() => { [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Týden")?.click(); });
await page.waitForSelector("#week-grid", { timeout: 15000 });
await new Promise(s => setTimeout(s, 2000));
await page.click('[aria-label="Další týden"]');
await new Promise(s => setTimeout(s, 3500)); // onSnapshot příštího týdne

mkdirSync("public/nahled", { recursive: true });
const grid = await page.$("#week-grid");
if (!grid) throw new Error("#week-grid nenalezen");
const box = await grid.boundingBox();
await grid.screenshot({ path: "public/nahled/rozvrh.png" });
await browser.close();
console.log("Screenshot mřížky uložen: public/nahled/rozvrh.png");

// ── OG stránka: ve WhatsAppu se u odkazu ukáže rovnou náhled rozvrhu ──
const nm = new Date(praha); nm.setDate(nm.getDate() + ((8 - nm.getDay()) % 7 || 7));
const dd = String(nm.getDate()).padStart(2, "0"), mm = String(nm.getMonth() + 1).padStart(2, "0");
const monday = `${dd}.${mm}.${nm.getFullYear()}`;
const stamp = Date.now();
const img = `${SITE}/nahled/rozvrh.png?v=${stamp}`;
const W = Math.round((box?.width || 968) * 2), H = Math.round((box?.height || 477) * 2);
writeFileSync("public/nahled/index.html", `<!DOCTYPE html>
<html lang="cs"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ShiftFlow — rozvrh na týden od ${monday}</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="ShiftFlow">
<meta property="og:title" content="Rozvrh na týden od ${monday}">
<meta property="og:description" content="Aktuální rozpis směn pro příští týden. Klepnutím otevřeš plnou velikost.">
<meta property="og:image" content="${img}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="${W}">
<meta property="og:image:height" content="${H}">
<meta property="og:url" content="${SITE}/nahled/">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${img}">
<style>
 body{margin:0;background:#0c0c12;color:#e8e8f0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;
      display:flex;flex-direction:column;align-items:center;gap:14px;padding:16px}
 h1{font-size:17px;font-weight:600;margin:4px 0 0;text-align:center;letter-spacing:.4px}
 p{margin:0;font-size:12px;color:#8a8a9a}
 img{max-width:100%;height:auto;border:1px solid #2a2a3a;border-radius:4px}
 a{color:#6aa8d8;font-size:13px;text-decoration:none;margin-top:6px}
</style></head>
<body>
 <h1>Rozvrh na týden od ${monday}</h1>
 <img src="rozvrh.png?v=${stamp}" alt="Rozvrh směn na týden od ${monday}">
 <p>Aktualizováno ${praha.toLocaleString("cs-CZ")}</p>
 <a href="${SITE}">Otevřít ShiftFlow →</a>
</body></html>
`);
console.log("OG stránka uložena: public/nahled/index.html |", W + "×" + H);
