// ═══════════════════════════════════════
// ShiftFlow Backend – Google Apps Script
// ═══════════════════════════════════════
// Deploy: Deploy → New deployment → Web app → Anyone

const FIREBASE_PROJECT_ID = 'YOUR_PROJECT_ID'; // Změňte na váš

// ─── API Handler ─────────────────────
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    switch (payload.action) {
      case 'sendEmail': return json(sendEmail(payload.data));
      case 'sendPush': return json(sendPush(payload.data));
      case 'exportToSheets': return json(exportToSheets(payload.data));
      case 'aiOptimize': return json(aiOptimize(payload.data));
      default: return json({ error: 'Unknown action' });
    }
  } catch (err) {
    return json({ error: err.message });
  }
}

function doGet(e) {
  return json({ status: 'ok', service: 'ShiftFlow API', time: new Date().toISOString() });
}

function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// ─── Email ───────────────────────────
function sendEmail(data) {
  const { to, employeeName, changeDescription, weekLabel } = data;
  if (!to) return { success: false, error: 'No email' };

  const html = `
    <div style="font-family:'Segoe UI',sans-serif;max-width:500px;margin:0 auto;background:#0f0f1e;color:#e2e8f0;border-radius:16px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#6366f1,#06b6d4);padding:24px;text-align:center;">
        <h1 style="margin:0;font-size:24px;color:white;">📅 ShiftFlow</h1>
      </div>
      <div style="padding:24px;">
        <p>Ahoj <strong>${employeeName}</strong>,</p>
        <p>ve tvém rozvrhu došlo ke změně:</p>
        <div style="background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);border-radius:12px;padding:16px;margin:16px 0;">
          <p style="margin:0;font-size:15px;">${changeDescription}</p>
        </div>
        <p style="color:#94a3b8;font-size:13px;">Týden: ${weekLabel}</p>
        <p style="color:#64748b;font-size:12px;margin-top:24px;">Notifikace z ShiftFlow.</p>
      </div>
    </div>`;

  try {
    GmailApp.sendEmail(to, `ShiftFlow: Změna – ${weekLabel}`, '', { htmlBody: html, name: 'ShiftFlow' });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Push přes FCM ───────────────────
function sendPush(data) {
  const { tokens, title, body } = data;
  if (!tokens || !tokens.length) return { success: false };

  const results = tokens.map(token => {
    try {
      const r = UrlFetchApp.fetch(
        `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`,
        {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(), 'Content-Type': 'application/json' },
          payload: JSON.stringify({ message: { token, notification: { title, body } } }),
          muteHttpExceptions: true,
        }
      );
      return { ok: r.getResponseCode() === 200 };
    } catch (err) {
      return { error: err.message };
    }
  });

  return { success: true, results };
}

// ─── Export do Google Sheets ─────────
function exportToSheets(data) {
  const { schedule, weekLabel, employees } = data;
  let ss;
  const files = DriveApp.getFilesByName('ShiftFlow Reporty');
  ss = files.hasNext() ? SpreadsheetApp.open(files.next()) : SpreadsheetApp.create('ShiftFlow Reporty');

  let sheet = ss.getSheetByName(weekLabel);
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet(weekLabel);

  sheet.getRange(1,1,1,6).setValues([['Směna','Po','Út','St','Čt','Pá']]).setBackground('#6366f1').setFontColor('white').setFontWeight('bold');

  const shifts = ['08:00','09:00','10:00'];
  const days = ['Po','Út','St','Čt','Pá'];
  let row = 2;

  shifts.forEach(shift => {
    const rowData = [shift];
    days.forEach(day => {
      const entries = schedule[day]?.[shift] || [];
      rowData.push(entries.map(e => {
        const emp = employees.find(x => x.id === e.empId);
        return (emp?.name || '?') + (e.ho ? ' (HO)' : '');
      }).join('\n'));
    });
    sheet.getRange(row,1,1,6).setValues([rowData]);
    row++;
  });

  return { success: true, url: ss.getUrl() };
}

// ─── Claude AI optimalizace ──────────
function aiOptimize(data) {
  const key = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!key) return { success: false, error: 'CLAUDE_API_KEY not set in Script Properties' };

  const { employees, schedule, rules } = data;
  const prompt = `Jsi expert na plánování směn. Optimalizuj tento rozvrh.
PRAVIDLA: ${JSON.stringify(rules)}
ZAMĚSTNANCI: ${JSON.stringify(employees.map(e=>({name:e.name,team:e.team})))}
ROZVRH: ${JSON.stringify(schedule)}
Navrhni optimalizovaný rozvrh. Odpověz POUZE JSON.`;

  try {
    const r = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      payload: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4096, messages: [{ role: 'user', content: prompt }] }),
      muteHttpExceptions: true,
    });
    const result = JSON.parse(r.getContentText());
    return { success: true, response: result.content?.[0]?.text || '' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Cron: Novoroční reset ───────────
// Nastavte trigger: Triggers → Add → checkYearlyReset → Day timer
function checkYearlyReset() {
  const d = new Date();
  if (d.getMonth() === 0 && d.getDate() === 1) {
    Logger.log('Yearly reset triggered');
    // Reset by se provedl přes Firestore REST API
    // nebo přímým voláním z frontendu adminem
  }
}
