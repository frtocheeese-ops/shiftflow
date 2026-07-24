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
await grid.screenshot({ path: "public/nahled/rozvrh.png" });
await browser.close();
console.log("Screenshot mřížky uložen: public/nahled/rozvrh.png");
