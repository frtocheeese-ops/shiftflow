// ═══════════════════════════════════════════════════════════════════════════
// ShiftFlow Backend – Google Apps Script (e-mailový relay)
// ═══════════════════════════════════════════════════════════════════════════
// Nasazení: Deploy → Manage deployments → ✎ u STÁVAJÍCÍHO nasazení → Version: New version
//           → Deploy. (NEzakládat nové nasazení — změnila by se adresa a appka by ji neznala.)
//
// ZABEZPEČENÍ: adresa skriptu je veřejná (je v kódu appky), proto skript:
//   1) přijme požadavek JEN s platným přihlášením schváleného člena týmu
//      (Firebase ID token — ověří ho sama databáze Firestore podle svých pravidel),
//   2) pošle e-mail JEN na adresu člena týmu (e-mail nebo notifikační e-mail z profilu),
//   3) veškerý text do e-mailu vkládá ošetřený (nelze do něj podstrčit vlastní HTML).
// Dřívější funkce sendPush / exportToSheets / aiOptimize odstraněny — appka je nepoužívala.

const FIREBASE_PROJECT_ID = 'shifts-79d6c';
const FS = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID + '/databases/(default)/documents';

// ─── API Handler ─────────────────────
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const caller = verifyMember(payload.idToken);
    if (!caller.ok) return json({ success: false, error: 'unauthorized', detail: caller.error });
    switch (payload.action) {
      case 'sendEmail': return json(sendEmail(payload.data || {}, payload.idToken));
      default: return json({ success: false, error: 'Unknown action' });
    }
  } catch (err) {
    return json({ success: false, error: 'bad request' });
  }
}

function doGet() {
  return json({ status: 'ok', service: 'ShiftFlow API' });
}

function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// ─── Ověření volajícího ──────────────
// Přečte vlastní profil volajícího z Firestore S JEHO tokenem. Databáze sama ověří,
// že je token pravý a platný, a podle pravidel dovolí číst jen přihlášenému.
// Pak zkontrolujeme roli: projde jen schválený člen (employee / admin).
function verifyMember(idToken) {
  if (!idToken || typeof idToken !== 'string') return { ok: false, error: 'missing token' };
  let uid;
  try {
    let part = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    while (part.length % 4) part += '=';
    uid = JSON.parse(Utilities.newBlob(Utilities.base64Decode(part)).getDataAsString()).user_id;
  } catch (err) { return { ok: false, error: 'malformed token' }; }
  if (!uid) return { ok: false, error: 'no uid' };
  const r = UrlFetchApp.fetch(FS + '/users/' + encodeURIComponent(uid), {
    headers: { Authorization: 'Bearer ' + idToken }, muteHttpExceptions: true,
  });
  if (r.getResponseCode() !== 200) return { ok: false, error: 'token rejected (' + r.getResponseCode() + ')' };
  const role = ((JSON.parse(r.getContentText()).fields || {}).role || {}).stringValue;
  if (role !== 'employee' && role !== 'admin') return { ok: false, error: 'not a member' };
  return { ok: true, uid: uid, role: role };
}

// E-mailové adresy členů týmu (jen schválení: employee / admin)
function teamEmails(idToken) {
  const r = UrlFetchApp.fetch(FS + '/users?pageSize=300', {
    headers: { Authorization: 'Bearer ' + idToken }, muteHttpExceptions: true,
  });
  if (r.getResponseCode() !== 200) return [];
  const docs = JSON.parse(r.getContentText()).documents || [];
  const out = [];
  docs.forEach(function (d) {
    const f = d.fields || {};
    const role = (f.role || {}).stringValue;
    if (role !== 'employee' && role !== 'admin') return;
    ['email', 'notifyEmail'].forEach(function (k) {
      const v = ((f[k] || {}).stringValue || '').trim().toLowerCase();
      if (v) out.push(v);
    });
  });
  return out;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// Odkazy v textu změny udělá klikatelnými — ale jen na adresu appky
function linkify(safeText) {
  return safeText.replace(/https:\/\/smenyjt\.netlify\.app\/[A-Za-z0-9\/._-]*/g, function (u) {
    return '<a href="' + u + '" style="color:#93c5fd;">' + u + '</a>';
  });
}

// ─── Email ───────────────────────────
function sendEmail(data, idToken) {
  const to = String(data.to || '').trim().toLowerCase();
  if (!to) return { success: false, error: 'No email' };
  if (teamEmails(idToken).indexOf(to) === -1) return { success: false, error: 'recipient not in team' };

  const name = esc(data.employeeName).slice(0, 80);
  const change = linkify(esc(data.changeDescription).slice(0, 1000));
  const week = esc(data.weekLabel).slice(0, 60);
  const html = `
    <div style="font-family:'Segoe UI',sans-serif;max-width:500px;margin:0 auto;background:#0f0f1e;color:#e2e8f0;border-radius:16px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#6366f1,#06b6d4);padding:24px;text-align:center;">
        <h1 style="margin:0;font-size:24px;color:white;">📅 ShiftFlow</h1>
      </div>
      <div style="padding:24px;">
        <p>Ahoj <strong>${name}</strong>,</p>
        <p>ve tvém rozvrhu došlo ke změně:</p>
        <div style="background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);border-radius:12px;padding:16px;margin:16px 0;">
          <p style="margin:0;font-size:15px;">${change}</p>
        </div>
        <p style="color:#94a3b8;font-size:13px;">Týden: ${week}</p>
        <p style="color:#64748b;font-size:12px;margin-top:24px;">Notifikace z ShiftFlow.</p>
      </div>
    </div>`;

  try {
    GmailApp.sendEmail(to, 'ShiftFlow: Změna – ' + String(data.weekLabel || '').slice(0, 60), '', { htmlBody: html, name: 'ShiftFlow' });
    return { success: true };
  } catch (err) {
    return { success: false, error: 'send failed' };
  }
}

// ─── Cron: ponecháno kvůli případnému časovači ───
// Funkce nic nedělá. Pokud je na ni ve skriptu nastavený časovač (Triggers), její
// odstranění by způsobilo denní chybové e-maily od Googlu. Časovač lze bezpečně smazat.
function checkYearlyReset() {}

// ═══ Páteční snímek: spolehlivé spuštění ═══
// Plánovač GitHubu běhy zpožďuje o hodiny nebo je úplně zahazuje (2. 10. 2026 nespustil
// ani jeden ze 17 pokusů). Časovač Apps Scriptu je spolehlivý → v pátek spustí workflow
// přes GitHub API s příznakem „plánovaný" (chová se jako pravidelný běh včetně e-mailu).
// Nastavení (jednou):
//   1. Script Properties → GH_DISPATCH_TOKEN = fine-grained token jen pro repo shiftflow,
//      oprávnění „Actions: Read and write" (nic jiného).
//   2. Ručně spustit nastavitCasovacNahledu() a povolit přístup.
// Časové pásmo projektu musí být Europe/Prague (Nastavení projektu).
var GH_REPO = 'frtocheeese-ops/shiftflow';

function spustitPatecniNahled() {
  var token = PropertiesService.getScriptProperties().getProperty('GH_DISPATCH_TOKEN');
  if (!token) { console.warn('GH_DISPATCH_TOKEN chybí — páteční snímek nespuštěn'); return false; }
  var r = UrlFetchApp.fetch('https://api.github.com/repos/' + GH_REPO + '/actions/workflows/nahled.yml/dispatches', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    payload: JSON.stringify({ ref: 'main', inputs: { planovany: 'true' } })
  });
  var ok = r.getResponseCode() === 204;
  if (!ok) console.error('GitHub spuštění odmítl: ' + r.getResponseCode() + ' ' + r.getContentText());
  return ok;
}

// Pátek 9:00 + pojistka 11:00 (skript sám pozná, jestli už dnes snímek vznikl, a e-mail pošle jen jednou)
function nastavitCasovacNahledu() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'spustitPatecniNahled') ScriptApp.deleteTrigger(t);
  });
  [9, 11].forEach(function (h) {
    ScriptApp.newTrigger('spustitPatecniNahled').timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(h).everyWeeks(1).create();
  });
  return 'Časovač nastaven: pátek 9:00 a 11:00';
}
