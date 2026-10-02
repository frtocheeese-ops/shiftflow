// Testy e-mailového relay (gas/Code.gs) — skript běží v Node s napodobeninami služeb Google.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync(new URL("./Code.gs", import.meta.url), "utf8");
const tok = uid => "hdr." + Buffer.from(JSON.stringify({ user_id: uid, sub: uid })).toString("base64url") + ".sig";

// Stav „databáze": profily a které tokeny Firestore uzná za platné
function setup({ users, validTokens }) {
  const sent = [];
  const res = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });
  const fields = u => Object.fromEntries(Object.entries(u).map(([k, v]) => [k, { stringValue: v }]));
  const ctx = {
    UrlFetchApp: { fetch: (url, opt) => {
      const t = (opt.headers.Authorization || "").replace("Bearer ", "");
      if (!validTokens.includes(t)) return res(401, {});
      const m = url.match(/\/users\/([^?]+)$/);
      if (m) { const u = users[decodeURIComponent(m[1])]; return u ? res(200, { fields: fields(u) }) : res(404, {}); }
      if (/\/users\?/.test(url)) return res(200, { documents: Object.values(users).map(u => ({ fields: fields(u) })) });
      return res(404, {});
    } },
    Utilities: {
      base64Decode: s => { if (s.length % 4) throw new Error("bad padding"); return [...Buffer.from(s, "base64")]; },
      newBlob: bytes => ({ getDataAsString: () => Buffer.from(bytes).toString("utf8") }),
    },
    GmailApp: { sendEmail: (to, subj, body, opt) => sent.push({ to, subj, html: opt.htmlBody }) },
    ContentService: { createTextOutput: s => ({ setMimeType: () => JSON.parse(s) }), MimeType: { JSON: "json" } },
  };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  const post = body => ctx.doPost({ postData: { contents: JSON.stringify(body) } });
  return { post, sent };
}

const team = {
  andy: { name: "Andy", email: "andy@firma.cz", role: "employee", notifyEmail: "andy.soukromy@gmail.com" },
  adm: { name: "Admin", email: "admin@shiftflow.app", role: "admin" },
  novy: { name: "Nový", email: "novy@x.cz", role: "pending" },
};
const T = { andy: tok("andy"), adm: tok("adm"), novy: tok("novy"), cizi: tok("cizi") };
const env = () => setup({ users: team, validTokens: Object.values(T) });
const mail = (to, extra = {}) => ({ action: "sendEmail", data: { to, employeeName: "Andy", changeDescription: "Změna směny", weekLabel: "28.9.", ...extra } });

test("bez tokenu nic neodejde", () => {
  const { post, sent } = env();
  assert.equal(post(mail("andy@firma.cz")).error, "unauthorized"); assert.equal(sent.length, 0);
});
test("podvržený / neplatný token nic nepošle", () => {
  const { post, sent } = env();
  assert.equal(post({ ...mail("andy@firma.cz"), idToken: tok("andy").replace("sig", "xx") }).error, "unauthorized");
  assert.equal(post({ ...mail("andy@firma.cz"), idToken: "nesmysl" }).error, "unauthorized");
  assert.equal(sent.length, 0);
});
test("čekající účet ani cizí registrace nic nepošlou", () => {
  const { post, sent } = env();
  assert.equal(post({ ...mail("andy@firma.cz"), idToken: T.novy }).detail, "not a member");
  assert.equal(post({ ...mail("andy@firma.cz"), idToken: T.cizi }).error, "unauthorized");
  assert.equal(sent.length, 0);
});
test("člen pošle e-mail kolegovi (i na jeho notifikační adresu)", () => {
  const { post, sent } = env();
  assert.equal(post({ ...mail("admin@shiftflow.app"), idToken: T.andy }).success, true);
  assert.equal(post({ ...mail("Andy.Soukromy@gmail.com"), idToken: T.adm }).success, true);
  assert.equal(sent.length, 2);
});
test("na adresu mimo tým nic neodejde (ani adminovi)", () => {
  const { post, sent } = env();
  const r = post({ ...mail("obet@nekde.com"), idToken: T.adm });
  assert.equal(r.success, false); assert.equal(r.error, "recipient not in team"); assert.equal(sent.length, 0);
});
test("e-mail na čekající účet neodejde", () => {
  const { post, sent } = env();
  assert.equal(post({ ...mail("novy@x.cz"), idToken: T.adm }).success, false); assert.equal(sent.length, 0);
});
test("do e-mailu nejde podstrčit HTML; klikatelný je jen odkaz na appku", () => {
  const { post, sent } = env();
  post({ ...mail("andy@firma.cz", { employeeName: "<b>X</b>", changeDescription: 'Klikni <a href="https://zlo.cz">zde</a> https://zlo.cz/login a https://smenyjt.netlify.app/nahled/' }), idToken: T.adm });
  const h = sent[0].html;
  assert.doesNotMatch(h, /<a href="https:\/\/zlo/); assert.doesNotMatch(h, /<b>X<\/b>/);
  assert.match(h, /&lt;a href=/); assert.match(h, /<a href="https:\/\/smenyjt\.netlify\.app\/nahled\/"/);
});
test("odstraněné funkce už nejdou volat", () => {
  const { post } = env();
  for (const action of ["aiOptimize", "sendPush", "exportToSheets"]) assert.equal(post({ action, data: {}, idToken: T.adm }).error, "Unknown action");
});

// ── Páteční snímek: spouštění workflow z časovače Apps Scriptu ──
function setupDispatch({ token, status = 204 }) {
  const calls = [], triggers = [], logs = [];
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k === "GH_DISPATCH_TOKEN" ? token : null) }) },
    UrlFetchApp: { fetch: (url, opt) => { calls.push({ url, opt }); return { getResponseCode: () => status, getContentText: () => "x" }; } },
    ScriptApp: {
      WeekDay: { FRIDAY: "FRIDAY" },
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1),
      newTrigger: fn => { const t = { fn, getHandlerFunction: () => fn }; const b = { timeBased: () => b, onWeekDay: d => (t.day = d, b), atHour: h => (t.hour = h, b), everyWeeks: () => b, create: () => (triggers.push(t), t) }; return b; },
    },
    console: { warn: m => logs.push(m), error: m => logs.push(m), log: () => {} },
    Utilities: {}, GmailApp: {}, ContentService: {},
  };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  return { ctx, calls, triggers, logs };
}

test("páteční snímek: spuštění workflow s příznakem plánovaný a tokenem z vlastností skriptu", () => {
  const { ctx, calls } = setupDispatch({ token: "gh_tajny" });
  assert.equal(ctx.spustitPatecniNahled(), true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/repos\/frtocheeese-ops\/shiftflow\/actions\/workflows\/nahled\.yml\/dispatches$/);
  assert.equal(calls[0].opt.headers.Authorization, "Bearer gh_tajny");
  assert.deepEqual(JSON.parse(calls[0].opt.payload), { ref: "main", inputs: { planovany: "true" } });
});

test("páteční snímek: bez tokenu nic neodejde, odmítnutí GitHubem se zaloguje", () => {
  const a = setupDispatch({ token: null });
  assert.equal(a.ctx.spustitPatecniNahled(), false); assert.equal(a.calls.length, 0);
  const b = setupDispatch({ token: "t", status: 403 });
  assert.equal(b.ctx.spustitPatecniNahled(), false); assert.match(b.logs.join(" "), /403/);
});

test("páteční snímek: časovač pátek 9:00 a 11:00, opakované nastavení nevytvoří duplicity", () => {
  const { ctx, triggers } = setupDispatch({ token: "t" });
  ctx.nastavitCasovacNahledu(); ctx.nastavitCasovacNahledu();
  assert.deepEqual(triggers.map(t => [t.fn, t.day, t.hour]), [["spustitPatecniNahled", "FRIDAY", 9], ["spustitPatecniNahled", "FRIDAY", 11]]);
});
