// ===== JAMES Flash renderer =====
const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
const hex = (n, w = 2) => n.toString(16).toUpperCase().padStart(w, '0');
const state = { bin: null, binName: '', binInfo: null, connected: false, rom: null, gate: null, ecm: null,
  map: { bytes: null, orig: null, cmp: null, name: '', defs: [], cur: -1, sel: new Set(), undo: [], view: '2d', anchor: null } };

// ---------- tabs ----------
$$('.tabs button').forEach((b) => b.onclick = () => { $$('.tabs button').forEach((x) => x.classList.toggle('active', x === b)); $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab)); if (b.dataset.tab === 'map') renderMap(); if (b.dataset.tab === 'hex') renderHex(); });

// ---------- log / events ----------
const logEl = $('#log');
function log(m, cls = '') { for (const el of [logEl, $('#log2'), $('#log3')]) { if (!el) continue; const d = document.createElement('div'); d.className = cls; d.textContent = `[${new Date().toLocaleTimeString()}] ${m}`; el.appendChild(d); if (el.children.length > 400) el.removeChild(el.firstChild); el.scrollTop = el.scrollHeight; } }
james.onStatus((s) => { $('#statusText').textContent = s; log(s); });
james.onLog((s) => log(s));
james.onError((s) => { log(s, 'err'); $('#statusText').textContent = '⚠ ' + s; });
james.onProgress((p) => {
  if (p.phase === 'pre-write') { $('#flashPct').textContent = p.countdown ? `เตรียม ECU… ${p.countdown}s` : 'เริ่มเขียน'; $('#flashRecover').textContent = ''; return; }
  if (p.phase === 'baud') { const b = $('#flashBaud'); b.style.display = ''; b.textContent = p.baud + ' bps'; b.className = 'badge ' + (p.baud > 10400 ? 'ok' : ''); return; }
  if (p.phase === 'reconnect') { $('#flashRecover').textContent = `⟳ กู้คืนบล็อก ${p.chunk} … ${(p.elapsedMs / 1000).toFixed(1)} วิ (ห้ามปิดกุญแจ)`; return; }
  if (p.phase === 'failed') { $('#flashRecover').textContent = `✘ หยุดที่บล็อก ${p.chunk}`; return; }
  if (p.phase === 'writing') { $('#flashBar').style.width = (p.percentage * 100).toFixed(1) + '%'; $('#flashPct').textContent = (p.percentage * 100).toFixed(1) + '%  ' + p.bytesSent + '/' + p.totalBytes; $('#flashSpeed').textContent = p.speedKbs.toFixed(2) + ' KB/s'; $('#flashEta').textContent = 'เหลือ ~' + Math.round(p.etaSeconds) + 's'; $('#flashRecover').textContent = p.recovered ? `กู้คืนแล้ว ${p.recovered} บล็อก` : ''; return; }
  if (p.phase === 'read' || p.phase === 'verify') { $('#romBar').style.width = (p.percentage * 100).toFixed(1) + '%'; $('#romPct').textContent = (p.phase === 'verify' ? 'ตรวจซ้ำ ' : 'อ่าน ') + (p.percentage * 100).toFixed(1) + '%  ' + p.bytes + '/' + p.total; $('#romSpeed').textContent = p.speedBps ? (p.speedBps / 1024).toFixed(2) + ' KB/s' : ''; $('#romEta').textContent = p.etaSeconds ? 'เหลือ ~' + fmtTime(p.etaSeconds) : ''; return; }
  if ((p.phase || '').startsWith('eeprom')) { $('#eepBar').style.width = (p.percentage * 100).toFixed(1) + '%'; $('#eepPct').textContent = ({ 'eeprom-read': 'อ่าน', 'eeprom-verify': 'ตรวจสอบ', 'eeprom-write': 'เขียน' })[p.phase] + ' ' + (p.percentage * 100).toFixed(0) + '%  ' + p.bytes + '/' + p.total; }
});
const fmtTime = (s) => s >= 60 ? Math.floor(s / 60) + ' นาที ' + Math.round(s % 60) + ' วิ' : Math.round(s) + ' วิ';

// ================= LICENSE + FEATURE GATING =================
const LIC = { status: null, labels: {}, plans: {} };
const canUse = (f) => !!(LIC.status && LIC.status.features.includes(f));
const planFor = () => 'license ถาวร (FULL)';
function applyGates() {
  // lock markers next to gated controls
  $$('.lock[data-feature]').forEach((el) => { el.textContent = canUse(el.dataset.feature) ? '' : '🔒 FULL'; });
  const gate = (sel, f) => $$(sel).forEach((b) => { b.classList.toggle('locked', !canUse(f)); b.title = canUse(f) ? '' : 'ต้องมี license ถาวร (FULL) — ดูแท็บ License'; });
  gate('#btnRomRead', 'rom-read'); gate('#btnEepRead,#btnEepWrite,#btnEepFormat00,#btnEepFormatFF', 'eeprom'); gate('#rnConnect,#rnErase', 'renesas');
  gate('#btnXdf,#btnSetImport,#btnSetExport', 'maplib-import'); gate('#btnCanConnect', 'can'); gate('#fastWrite', 'fast-write'); gate('#btnSkDecode,#btnSkBuildVirgin,#btnSkBuildClone,#btnSkAnalyze', 'smartkey');
  $('#fastWrite').disabled = !canUse('fast-write');
  const b = $('#planBadge'); b.textContent = LIC.status ? LIC.status.plan : 'FREE'; b.className = 'badge plan ' + (LIC.status ? LIC.status.plan.toLowerCase() : '');
  updateFlashBtn();
}
function renderLicense(st) {
  LIC.status = st; LIC.plans = st.plans || LIC.plans; LIC.labels = st.labels || LIC.labels;
  $('#licHwid').textContent = st.hwid || '-';
  $('#licState').textContent = st.installed ? (st.valid ? '✔ ใช้งานได้' : '✘ ' + st.reason) : (st.hasPublicKey ? 'ยังไม่ได้ติดตั้ง license (โหมด FREE)' : 'โปรแกรมยังไม่มีกุญแจสาธารณะ — รัน tools/license-admin.js keygen');
  $('#licState').className = st.valid ? 'ok' : st.installed ? 'err' : 'muted';
  $('#licPlan').textContent = st.plan + (st.payload && st.payload.plan && st.payload.plan !== st.plan ? ` (ไฟล์ระบุ ${st.payload.plan})` : '');
  $('#licName').textContent = st.name || (st.payload && st.payload.name) || '-';
  $('#licExp').textContent = st.valid ? (st.expires ? `${st.expires.slice(0, 10)} (อีก ${st.daysLeft} วัน)` : 'ถาวร — ไม่มีวันหมดอายุ') : '-';
  const feats = Object.keys(LIC.labels); const plans = Object.keys(LIC.plans);
  $('#planTable').innerHTML = `<tr><th>ฟีเจอร์</th>${plans.map((p) => `<th>${p}${p === st.plan ? ' ◀' : ''}</th>`).join('')}</tr>` +
    feats.map((f) => `<tr class="${canUse(f) ? 'cur' : ''}"><th>${LIC.labels[f]}</th>${plans.map((p) => `<td class="${LIC.plans[p].features.includes(f) ? 'y' : 'n'}">${LIC.plans[p].features.includes(f) ? '✔' : '—'}</td>`).join('')}</tr>`).join('');
  applyGates();
}
async function refreshLicense() { try { renderLicense(await james.license.status()); } catch (e) { log('license: ' + e.message, 'err'); } }
$('#btnHwidCopy').onclick = () => { navigator.clipboard.writeText($('#licHwid').textContent).then(() => { $('#licMsg').textContent = 'คัดลอก HWID แล้ว'; }); };
$('#btnLicFile').onclick = async () => { const r = await james.license.installFile(); if (r.cancelled) return; if (r.ok === false) { $('#licMsg').textContent = '✘ ' + r.error; $('#licMsg').className = 'small err'; return; } renderLicense(r); $('#licMsg').textContent = '✔ ติดตั้ง license แล้ว'; $('#licMsg').className = 'small ok'; log('ติดตั้ง license: ' + r.plan, 'ok'); };
$('#btnLicPaste').onclick = async () => { const t = $('#licText').value.trim(); if (!t) return; const r = await james.license.install(t); if (r.ok === false) { $('#licMsg').textContent = '✘ ' + r.error; $('#licMsg').className = 'small err'; return; } renderLicense(r); $('#licText').value = ''; $('#licMsg').textContent = '✔ ติดตั้ง license แล้ว'; $('#licMsg').className = 'small ok'; };
$('#btnLicRemove').onclick = async () => { if (!confirm('ลบ license ออกจากเครื่องนี้? (กลับเป็น FREE)')) return; renderLicense(await james.license.remove()); $('#licMsg').textContent = 'ลบ license แล้ว'; $('#licMsg').className = 'small muted'; };
refreshLicense();

// ---------- ports ----------
async function refreshPorts() {
  const ports = await james.listPorts();
  for (const sel of [$('#portSel'), $('#secPort')]) {
    sel.innerHTML = '';
    for (const p of ports) { const o = document.createElement('option'); o.value = p.path; o.textContent = `${p.path} — ${p.friendlyName}${p.isFTDI ? ' ★FTDI' : ''}`; if (p.isFTDI) o.selected = true; sel.appendChild(o); }
    if (!ports.length) sel.innerHTML = '<option value="">ไม่พบพอร์ต</option>';
  }
}
$('#btnRefresh').onclick = refreshPorts; $('#btnSecRefresh').onclick = refreshPorts; refreshPorts();

// ---------- connect ----------
function showEcm(e) {
  state.ecm = e;
  $('#ecmId').textContent = e.ecmId || '-'; $('#ecmBrand').textContent = e.brand || '-'; $('#flashCount').textContent = e.flashCount ?? '-';
  $('#recovery').textContent = e.isRecovery ? 'RECOVERY' : 'ปกติ'; $('#wakeMode').textContent = e.wakeMode || '-';
  $('#ecmBatt').textContent = e.battery ? e.battery.toFixed(1) + ' V' : 'อ่านไม่ได้';
  $('#ecmBatt').className = e.battery ? (e.battery < 11.8 ? 'err' : e.battery < 12.4 ? 'warn' : 'ok') : 'muted';
}
$('#btnConnect').onclick = async () => {
  $('#btnConnect').disabled = true;
  const r = await james.connect($('#portSel').value || null);
  $('#btnConnect').disabled = false;
  if (!r.ok) { log(r.error, 'err'); return; }
  state.connected = true; setLink('up', r.port + ' · ' + r.ecmId);
  showEcm(r); log('เชื่อมต่อสำเร็จ ECM ID ' + r.ecmId + ' (' + r.brand + ', wake ' + r.wakeMode + ')', 'ok');
  liveUi(false); runGate(false);
};
$('#btnDisconnect').onclick = async () => { await james.disconnect(); state.connected = false; setLink('down'); liveUi(false); runGate(false); };
$('#btnBatt').onclick = async () => { const r = await james.battery(); if (r.ok && state.ecm) { state.ecm.battery = r.battery; showEcm(state.ecm); runGate(false); } };
function setLink(st, text) {
  const b = $('#connBadge'); b.classList.remove('on', 'lost', 'reconnecting'); if (st === 'up') b.classList.add('on'); else if (st === 'lost') b.classList.add('lost'); else if (st === 'reconnecting') b.classList.add('reconnecting');
  $('#connText').textContent = text || ({ up: 'เชื่อมต่อแล้ว', lost: 'สายหลุด — รอสายกลับมา', reconnecting: 'กำลังเชื่อมต่อ ECM ใหม่…', down: 'ยังไม่เชื่อมต่อ' })[st];
}
james.onLink((d) => {
  state.connected = d.state === 'up';
  setLink(d.state, d.state === 'up' ? (d.port || '') + ' · ' + (d.ecmId || '') : d.state === 'down' && d.reason ? 'หลุด: ' + d.reason : undefined);
  if (d.state === 'up') { liveUi(L.running); james.ecmState().then((e) => { showEcm(e); runGate(false); }); } else { liveUi(false); updateFlashBtn(); }
});

// ---------- pre-flash gate ----------
function updateFlashBtn() {
  const g = state.gate;
  const ok = state.connected && state.bin && $('#confirmFlash').checked && g && g.canFlash && (!g.needsOverride || $('#gateOverride').checked);
  const licOk = canUse('flash-kline');
  $('#btnFlash').disabled = !ok || !licOk; $('#btnFlash').classList.toggle('locked', !licOk); $('#btnFlash').title = licOk ? '' : 'เขียน ROM ต้องมี license ถาวร (FULL) — ดูแท็บ License';
}
$('#confirmFlash').onchange = updateFlashBtn; $('#gateOverride').onchange = updateFlashBtn;
function renderGate(g) {
  state.gate = g; const ul = $('#gateList'); ul.innerHTML = '';
  for (const it of g.items) { const li = document.createElement('li'); li.className = it.level; li.innerHTML = `<div>${it.text}${it.detail ? `<small>${it.detail}</small>` : ''}</div>`; ul.appendChild(li); }
  const badge = $('#gateBadge'), card = $('#gateCard'); card.classList.remove('blocked', 'warned');
  if (g.blocks) { badge.textContent = `ไม่ผ่าน (${g.blocks})`; badge.className = 'badge block'; card.classList.add('blocked'); }
  else if (g.warns) { badge.textContent = `ผ่านแบบมีคำเตือน (${g.warns})`; badge.className = 'badge warn'; card.classList.add('warned'); }
  else { badge.textContent = 'ผ่าน'; badge.className = 'badge ok'; }
  $('#overrideWrap').style.display = g.needsOverride ? '' : 'none'; if (!g.needsOverride) $('#gateOverride').checked = false;
  updateFlashBtn();
}
let gateBusy = false;
async function runGate(refreshBattery = true) {
  if (gateBusy) return; gateBusy = true;
  try {
    const r = await james.preflight(state.bin, { startOffsetHex: $('#startOff').value, checksumOffsetHex: $('#csOff').value, refreshBattery }, state.binName);
    if (r.ok) { renderGate(r.gate); if (state.ecm && refreshBattery) { const e = await james.ecmState(); showEcm(e); } }
    else log('ตรวจก่อนแฟลชไม่สำเร็จ: ' + r.error, 'err');
  } finally { gateBusy = false; }
}
$('#btnGate').onclick = () => runGate(true);
$('#startOff').onchange = $('#csOff').onchange = () => runGate(false);

// ---------- bin ----------
async function setBin(bytes, name) {
  state.bin = bytes; state.binName = name;
  try { if (typeof M !== 'undefined' && !M.bytes) loadMap(new Uint8Array(bytes), name); } catch {}   // share the ROM with the Map Editor
  const info = await james.analyzeBin(bytes); state.binInfo = info;
  $('#binName').textContent = name; $('#binSize').textContent = `${bytes.length} ไบต์ (0x${hex(bytes.length, 5)})`;
  $('#binFamily').textContent = `${info.family} (type ${info.ecuType})`; $('#startOff').value = info.startOffset; $('#csOff').value = info.checksumOffset;
  $('#csState').textContent = info.checksumChanged ? 'จะถูกแก้ให้ถูกต้องตอนเขียน' : 'ถูกต้องแล้ว';
  await runGate(false);
}
$('#btnOpenBin').onclick = async () => { const r = await james.openBin(); if (r) await setBin(r.bytes, r.name); };

// ---------- flash ----------
$('#btnFlash').onclick = async () => {
  await runGate(true);
  if (!state.gate || !state.gate.canFlash) { log('ด่านตรวจไม่ผ่าน — แก้รายการสีแดงก่อน', 'err'); return; }
  if (state.gate.needsOverride && !$('#gateOverride').checked) { log('ติ๊ก "รับทราบคำเตือน" ก่อนเขียน', 'err'); return; }
  const fast = $('#fastWrite').checked;
  if (!confirm(`ยืนยันเขียน "${state.binName}" (${state.bin.length} ไบต์) ลง ECM ${$('#ecmId').textContent} (${$('#ecmBrand').textContent})?${fast ? '\nโหมดเขียนเร็ว (ทดลอง) เปิดอยู่' : ''}\nห้ามปิดกุญแจหรือถอดสายจนกว่าจะเสร็จ`)) return;
  $('#btnFlash').disabled = true; $('#flashBar').style.width = '0%'; $('#flashBaud').style.display = 'none'; $('#flashRecover').textContent = '';
  const r = await james.flash(state.bin, { startOffsetHex: $('#startOff').value, checksumOffsetHex: $('#csOff').value, fastWrite: fast, override: $('#gateOverride').checked, name: state.binName });
  if (r.ok && r.done) { log('✔ FLASH สำเร็จ', 'ok'); $('#flashBar').style.width = '100%'; } else log('✘ FLASH ล้มเหลว ' + (r.error || ''), 'err');
  runGate(false);
};
$('#btnAbort').onclick = () => james.abort();

// ================= LIVE DATA / DTC =================
const L = { gauges: [], running: false, last: 0, frames: 0, rateT: Date.now() };
(async () => {
  L.gauges = await james.live.gauges(); const host = $('#gauges'); host.innerHTML = '';
  for (const g of L.gauges) { const d = document.createElement('div'); d.className = 'gauge stale'; d.id = 'g-' + g.id; d.innerHTML = `<div class="lbl">${g.label}</div><div class="val">—<span class="unit">${g.unit}</span></div><div class="bar"><div></div></div>`; host.appendChild(d); }
})();
setTimeout(() => liveUi(false), 0);
function liveUi(running) { L.running = running; $('#btnLiveStop').disabled = !running; if (!running) { $('#liveRate').textContent = ''; $$('.gauge').forEach((g) => g.classList.add('stale')); } if (typeof busUi === 'function') busUi(); else $('#btnLiveStart').disabled = running || !state.connected; }
$('#btnLiveStart').onclick = async () => { const r = await james.live.start(bus()); if (!r.ok) log(r.error, 'err'); };
$('#btnLiveStop').onclick = () => james.live.stop(bus());
james.onLiveState((d) => liveUi(d.running));
james.onLive((d) => {
  L.frames++; const now = Date.now(); if (now - L.rateT >= 1000) { $('#liveRate').textContent = `${L.frames} เฟรม/วิ · ${d.bus === 'can' ? 'CAN (OBD PIDs)' : 'ตาราง 0x' + (d.table || 0).toString(16).toUpperCase()}`; L.frames = 0; L.rateT = now; }
  for (const g of L.gauges) {
    const el = $('#g-' + g.id); if (!el) continue; const v = d.values[g.id];
    if (v === undefined || v === null || Number.isNaN(v)) { el.classList.add('stale'); continue; }
    el.classList.remove('stale'); el.querySelector('.val').firstChild.textContent = Number(v).toFixed(g.dec);
    el.querySelector('.bar div').style.width = Math.max(0, Math.min(100, ((v - g.min) / (g.max - g.min)) * 100)) + '%';
    el.classList.toggle('hot', g.warnHigh !== undefined && v > g.warnHigh); el.classList.toggle('cold', g.warnLow !== undefined && v < g.warnLow);
  }
  if (d.values.batt && state.ecm) { state.ecm.battery = d.values.batt; $('#ecmBatt').textContent = d.values.batt.toFixed(1) + ' V'; }
  const f = d.flags; const fl = $('#liveFlags');
  if (f) fl.innerHTML = [['sideStand', 'ขาตั้งข้าง'], ['neutralClutch', 'เกียร์ว่าง/คลัตช์'], ['startSwitch', 'สวิตช์สตาร์ท'], ['fuelPump', 'ปั๊มน้ำมัน'], ['fan', 'พัดลม'], ['tilted', 'รถเอียง/ล้ม'], ['eopSwitch', 'สวิตช์แรงดันน้ำมันเครื่อง'], ['scsDiag', 'SCS (โหมดช่าง)']].map(([k, t]) => `<span class="${f[k] ? 'on' : ''}">${t}</span>`).join('');
});
function renderDtc(list, el) { el.innerHTML = list.length ? list.map((c) => `<li class="${c.found ? '' : 'unknown'}"><b>${c.code}</b><span>${c.description}</span></li>`).join('') : '<li class="muted">ไม่พบรหัส</li>'; }
$('#btnDtcRead').onclick = async () => {
  $('#btnDtcRead').disabled = true; const r = await james.live.readDtc(bus()); $('#btnDtcRead').disabled = false;
  if (!r.ok) { log(r.error, 'err'); return; }
  renderDtc(r.current, $('#dtcCurrent')); renderDtc([...r.past, ...((r.permanent || []).map((c) => ({ ...c, description: c.description + ' (permanent)' })))], $('#dtcPast'));
  $('#dtcSummary').textContent = !r.anyReply ? '⚠ ECM ไม่ตอบคำสั่งอ่านรหัส (เปิดกุญแจ ON แล้วลองใหม่)' : `พบรหัสปัจจุบัน ${r.current.length} · เคยเกิด ${r.past.length}${r.permanent && r.permanent.length ? ' · permanent ' + r.permanent.length : ''}`;
  log(`DTC: current ${r.current.map((c) => c.code).join(',') || '-'} | past ${r.past.map((c) => c.code).join(',') || '-'}`);
};
$('#btnDtcClear').onclick = async () => {
  if (!confirm('ล้างรหัสความผิดปกติทั้งหมดในกล่อง? (ควรอ่านและบันทึกไว้ก่อน)')) return;
  $('#btnDtcClear').disabled = true; const r = await james.live.clearDtc(bus()); $('#btnDtcClear').disabled = false;
  if (!r.ok) { log(r.error, 'err'); return; }
  renderDtc(r.current, $('#dtcCurrent')); renderDtc(r.past, $('#dtcPast'));
  const left = r.current.length + r.past.length;
  $('#dtcSummary').textContent = !r.cleared ? 'ล้างรหัสไม่สำเร็จ — ECM ไม่ยืนยัน' : left ? `ล้างแล้ว — ยังเหลือ ${left} รายการ (รหัสที่ยังเกิดอยู่จะกลับมา)` : 'ล้างรหัสแล้ว ✔';
  log($('#dtcSummary').textContent, left ? '' : 'ok');
};

// ---------- Security session: ROM / EEPROM / Smart Key ----------
const S = { state: 'idle', rom: null, romMeta: null, ref: null, refName: '', eepEcu: null, eepFile: null, eepFileName: '', layouts: {} };
const secBtns = () => {
  const un = S.state === 'unlocked';
  for (const id of ['#btnRomRead', '#btnEepRead', '#btnEepFormat00', '#btnEepFormatFF']) $(id).disabled = !un;
  $('#btnEepWrite').disabled = !(un && S.eepFile);
  $('#btnSecConnect').disabled = !(S.state === 'idle' || S.state === 'lost');
  const b = $('#secState'); b.textContent = ({ idle: 'ยังไม่เชื่อมต่อ', 'wait-off': 'รอ OFF', 'wait-on': 'รอ ON', unlocked: 'ปลดล็อกแล้ว', busy: 'กำลังทำงาน', lost: 'หลุดการเชื่อมต่อ' })[S.state] || S.state;
  b.className = 'badge ' + (S.state === 'unlocked' ? 'unlocked' : S.state === 'busy' ? 'busy' : S.state === 'lost' ? 'lost' : S.state.startsWith('wait') ? 'wait' : '');
};
james.onSecState((d) => { S.state = d.state; $('#secEcm').textContent = d.ecmId && d.ecmId !== '-' ? 'ECM ID ' + d.ecmId : ''; secBtns(); });
james.onStep((n) => { [1, 2, 3].forEach((i) => { const e = $('#s' + i); e.classList.toggle('on', i === n); e.classList.toggle('done', i < n || (n === 3 && i === 3)); }); });

(async () => {
  S.layouts = await james.sec.layouts();
  const sel = $('#romSize'); sel.innerHTML = '';
  for (const [k, L] of Object.entries(S.layouts)) { const o = document.createElement('option'); o.value = k; o.textContent = `${k.toUpperCase()} (${L.bytes / 1024} KB)${L.tested ? '' : ' *ยังไม่ทดสอบกับกล่องจริง'}`; sel.appendChild(o); }
  sel.value = '64k'; romNote();
  await loadPw();
})();
function romNote() { const L = S.layouts[$('#romSize').value]; if (L) $('#romNote').textContent = L.note + (L.tested ? '' : ' — ครั้งแรกควรเทียบกับไฟล์ที่รู้ว่าถูกต้องก่อนนำไปใช้'); }
$('#romSize').onchange = romNote;

// saved passwords
async function loadPw(list) {
  list = list || (await james.pw.list());
  const sel = $('#pwSaved'); sel.innerHTML = '<option value="">— รหัสที่บันทึกไว้ —</option>'; $('#pwList').innerHTML = '';
  for (const p of list) { const o = document.createElement('option'); o.value = p.label; o.textContent = p.label + (p.ecmId ? ' · ' + p.ecmId : ''); sel.appendChild(o); const d = document.createElement('option'); d.value = p.hex; d.label = p.label; $('#pwList').appendChild(d); }
  S.pwList = list;
}
$('#pwSaved').onchange = () => { const p = (S.pwList || []).find((x) => x.label === $('#pwSaved').value); if (p) { $('#secPw').value = p.hex; $('#pwLabel').value = p.label; } };
$('#btnPwSave').onclick = async () => { const hex = cleanHex($('#secPw').value); const label = $('#pwLabel').value.trim(); if (hex.length !== 28 || !label) return alert('ใส่รหัส 28 hex และชื่อรุ่นก่อน'); await loadPw(await james.pw.save({ label, hex: hex.replace(/(..)/g, '$1 ').trim(), ecmId: ($('#secEcm').textContent || '').replace('ECM ID ', '') })); $('#pwSaved').value = label; };
$('#btnPwDel').onclick = async () => { const label = $('#pwSaved').value; if (label && confirm('ลบรหัส "' + label + '"?')) await loadPw(await james.pw.delete(label)); };
const cleanHex = (v) => (v || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();

// connect / disconnect
$('#btnSecConnect').onclick = async () => {
  const pw = cleanHex($('#secPw').value); if (pw.length !== 28) return alert('รหัสผ่านต้องเป็น hex 28 ตัว (14 ไบต์)');
  const r = await james.sec.connect($('#secPort').value, pw, { keyless: $('#secKeyless').checked });
  if (!r.ok) log(r.error, 'err');
};
$('#btnSecDisconnect').onclick = () => james.sec.disconnect();
$('#btnSecAbort').onclick = () => james.sec.abort();

// reference file
$('#btnRefOpen').onclick = async () => { const f = await james.sec.openRef(); if (f) { S.ref = f.bytes; S.refName = f.name; $('#refName').textContent = `${f.name} (${f.bytes.length} ไบต์)`; $('#btnRefClear').style.display = ''; } };
$('#btnRefClear').onclick = () => { S.ref = null; $('#refName').textContent = 'ไม่ใช้'; $('#btnRefClear').style.display = 'none'; };

// ROM read
$('#btnRomRead').onclick = async () => {
  $('#btnRomRead').disabled = true; $('#romBar').style.width = '0%'; $('#romResult').textContent = '';
  const size = $('#romSize').value, L = S.layouts[size];
  if (S.ref && S.ref.length < L.bytes) { alert(`ไฟล์อ้างอิงเล็กกว่า ${L.bytes} ไบต์ ใช้เติมไม่ได้`); secBtns(); return; }
  const r = await james.sec.readRom({ size, verify: $('#romVerify').value, reference: S.ref });
  secBtns();
  if (!r.ok) { log('✘ ' + r.error, 'err'); $('#romResult').textContent = '✘ ' + r.error; return; }
  S.rom = r.rom; S.romMeta = r; $('#btnRomSave').disabled = $('#btnRomToMap').disabled = $('#btnRomToFlash').disabled = false; $('#romBar').style.width = '100%';
  const v = r.verified; const lines = [`✔ อ่าน ${r.total} ไบต์ ใน ${fmtTime(r.seconds)} (อ่านซ้ำเพราะพลาด ${r.retries} ครั้ง)`];
  if (r.filled) lines.push(`⚠ กล่องไม่ให้อ่านตั้งแต่ offset 0x${r.filled.from.toString(16).toUpperCase()} → เติมจากไฟล์อ้างอิง ${S.refName} ถึงท้ายไฟล์ (ส่วนนี้ไม่ใช่ข้อมูลจริงจากกล่อง)`);
  if (v.mode !== 'none') lines.push(`ตรวจซ้ำ ${v.checked} ชิ้น: ต่าง ${v.mismatched}, แก้ด้วยรอบสาม ${v.fixed}${v.mismatched && v.mismatched !== v.fixed ? ' — มีชิ้นที่ยังไม่แน่ใจ แนะนำอ่านใหม่' : v.mismatched ? '' : ' ✔'}`);
  lines.push(`สำรองอัตโนมัติ: ${r.backup}`);
  $('#romResult').innerHTML = lines.map((x) => `<div>${x}</div>`).join('');
  log(lines.join(' | '), r.filled ? '' : 'ok');
};
$('#btnRomSave').onclick = () => james.saveBin(S.rom, `ROM_${(S.romMeta.size || '').toUpperCase()}_${($('#secEcm').textContent || '').replace('ECM ID ', '') || 'ECU'}.bin`);
$('#btnRomToMap').onclick = () => { loadMap(S.rom, 'ROM จาก ECU'); $$('.tabs button')[2].click(); };
$('#btnRomToFlash').onclick = async () => { await setBin(new Uint8Array(S.rom), 'ROM จาก ECU (' + S.romMeta.size + ')'); $$('.tabs button')[0].click(); };

// EEPROM
function hexDump(a, b) {  // a = bytes to show, b = other side for diff highlighting
  if (!a) return '—'; const out = [];
  for (let o = 0; o < a.length; o += 16) {
    let h = '', t = '';
    for (let i = 0; i < 16; i++) { const v = a[o + i]; if (v === undefined) { h += '   '; continue; } const d = b && b[o + i] !== v; h += (d ? '<span class="d">' : '') + hex(v) + (d ? '</span>' : '') + ' '; t += v >= 32 && v < 127 ? String.fromCharCode(v).replace('<', '&lt;') : '.'; }
    out.push(hex(o, 3) + '  ' + h + ' ' + t);
  }
  return out.join('\n');
}
function renderEep() {
  $('#eepHexEcu').innerHTML = hexDump(S.eepEcu, S.eepFile); $('#eepHexFile').innerHTML = hexDump(S.eepFile, S.eepEcu);
  if (S.eepEcu && S.eepFile) { const m = Math.min(S.eepEcu.length, S.eepFile.length); let n = 0; for (let i = 0; i < m; i++) if (S.eepEcu[i] !== S.eepFile[i]) n++; const extra = S.eepEcu.length !== S.eepFile.length ? ` (เทียบ ${m} ไบต์แรก · ขนาดไฟล์ต่างกัน)` : ''; $('#eepDiffCount').textContent = `— ต่างจากใน ECU ${n} ไบต์${extra}`; } else $('#eepDiffCount').textContent = '';
  $('#btnEepSave').disabled = !S.eepEcu; secBtns();
}
$('#btnEepRead').onclick = async () => {
  $('#btnEepRead').disabled = true; $('#eepBar').style.width = '0%';
  const r = await james.sec.readEeprom({ verify: true }); secBtns();
  if (!r.ok) { log('✘ ' + r.error, 'err'); $('#eepSummary').textContent = '✘ ' + r.error; return; }
  S.eepEcu = r.eeprom; renderEep(); $('#eepSummary').textContent = `✔ อ่านครบ 512 ไบต์${r.mismatches ? ` (ตรวจซ้ำพบต่าง ${r.mismatches} word → ใช้ค่า 2 ใน 3)` : ' ตรวจซ้ำตรงกัน'} · สำรองที่ ${r.backup}`; log('EEPROM backup: ' + r.backup, 'ok');
};
$('#btnEepOpen').onclick = async () => { const f = await james.sec.openEeprom(); if (!f) return; S.eepFile = f.bytes; S.eepFileName = f.name; $('#eepFileName').textContent = `${f.name} (${f.bytes.length} ไบต์)`; renderEep(); if (S.eepEcu && f.bytes.length !== S.eepEcu.length) log(`เปิดไฟล์ขนาด ${f.bytes.length} ไบต์ (กล่องอ่านได้ ${S.eepEcu.length} ไบต์) — เปิดดู/เทียบได้ แต่ถ้าจะเขียนกลับ ขนาดต้องตรงกับกล่อง`, ''); };
$('#btnEepSave').onclick = () => james.saveBin(S.eepEcu, `EEPROM_${($('#secEcm').textContent || '').replace('ECM ID ', '') || 'ECU'}.bin`);
$('#btnEepWrite').onclick = async () => {
  if (!S.eepFile) return;
  if (S.eepEcu && S.eepFile.length !== S.eepEcu.length) { alert(`เขียนกลับไม่ได้: ไฟล์ ${S.eepFile.length} ไบต์ ไม่เท่ากับ EEPROM ของกล่อง ${S.eepEcu.length} ไบต์\nเปิดเพื่อดู/เทียบได้ แต่ตอนเขียนต้องขนาดตรงกัน`); return; }
  if (!S.eepEcu && S.eepFile.length !== 512) { if (!confirm(`ยังไม่ได้อ่าน EEPROM จากกล่อง และไฟล์มีขนาด ${S.eepFile.length} ไบต์ (ไม่ใช่ 512)\nยืนยันจะเขียนไฟล์นี้ลง EEPROM จริงหรือไม่?`)) return; }
  if (!confirm(`เขียน "${S.eepFileName}" ทับ EEPROM ของ ECU ${($('#secEcm').textContent || '').replace('ECM ID ', '')}?\nโปรแกรมจะสำรองของเดิมก่อน และอ่านกลับตรวจสอบหลังเขียน\nห้ามปิดกุญแจ/ถอดสายระหว่างทำ`)) return;
  $('#btnEepWrite').disabled = true; $('#eepBar').style.width = '0%';
  const r = await james.sec.writeEeprom(S.eepFile); secBtns();
  if (!r.ok) { log('✘ ' + r.error, 'err'); $('#eepSummary').textContent = '✘ ' + r.error + (r.backup ? ` · สำรองของเดิม: ${r.backup}` : ''); return; }
  S.eepEcu = new Uint8Array(S.eepFile); renderEep(); $('#eepSummary').textContent = `✔ เขียนและตรวจสอบแล้ว · สำรองของเดิม: ${r.backup}`; log('EEPROM write verified ✔', 'ok');
};
async function doFormat(fill) {
  const word = fill === 'ff' ? 'FF' : '00';
  const typed = await askTyped(`Format EEPROM ทั้งหมดเป็น 0x${word} จะล้างข้อมูลจับคู่ Smart Key/กุญแจและค่าปรับตั้ง\nโปรแกรมจะสำรองของเดิมก่อน\n\nพิมพ์ FORMAT เพื่อยืนยัน`);
  if (typed !== 'FORMAT') return;
  $('#btnEepFormat00').disabled = $('#btnEepFormatFF').disabled = true; $('#eepBar').style.width = '0%';
  const r = await james.sec.formatEeprom(fill); secBtns();
  if (!r.ok) { log('✘ ' + r.error, 'err'); $('#eepSummary').textContent = '✘ ' + r.error + (r.backup ? ` · สำรองของเดิม: ${r.backup}` : ''); return; }
  S.eepEcu = r.eeprom; renderEep(); $('#eepSummary').textContent = (r.ok && r.other === 0 ? `✔ Format เป็น 0x${word} ทั้งหมดแล้ว` : `⚠ Format แล้วแต่ยังมี ${r.other} ไบต์ไม่ใช่ 0x${word}`) + ` · สำรองของเดิม: ${r.backup}`;
}
function askTyped(msg) { return new Promise((res) => { const d = $('#askDlg'); $('#askMsg').textContent = msg; const inp = $('#askInput'); inp.value = ''; d.onclose = () => res(d.returnValue === 'ok' ? inp.value.trim() : null); d.showModal(); inp.focus(); }); }
$('#btnEepFormat00').onclick = () => doFormat('zero'); $('#btnEepFormatFF').onclick = () => doFormat('ff');
$('#btnBackups').onclick = () => james.sec.openBackups();
secBtns();

// ================= MAP EDITOR (library of per-model table sets) =================
const M = state.map;
M.lib = { version: 2, sets: [] }; M.setIdx = -1; M.filter = ''; M.eqCache = new Map();
const DEFAULT_TABLE = { name: 'ตารางใหม่', category: '', off: '0x8000', rows: 16, cols: 16, size: '8', signed: 0, equation: 'X', decimals: 2, unit: '', xAxis: '', yAxis: '', flipY: 0, scale: 1, add: 0 };
const curSet = () => M.lib.sets[M.setIdx] || null;
const eqOf = (d) => { const src = d.equation || MathExpr.fromScaleAdd(d.scale, d.add); let c = M.eqCache.get(src); if (!c) { try { c = MathExpr.compile(src); } catch { c = MathExpr.compile('X'); } M.eqCache.set(src, c); } return c; };
let saveTimer = null;
function saveLib() { clearTimeout(saveTimer); saveTimer = setTimeout(() => james.maplib.save(M.lib).catch(() => {}), 400); }

(async () => {
  M.lib = await james.maplib.load();
  if (!M.lib.sets.length) { const s = { id: 'default', name: 'ชุดตารางเริ่มต้น', romSize: 0, ecmIds: [], family: '', source: 'manual', tables: [{ ...DEFAULT_TABLE, name: 'Fuel Map (ตัวอย่าง) 16×16' }, { ...DEFAULT_TABLE, name: 'Ignition Map (ตัวอย่าง) 16×16', off: '0x8100', equation: 'X*0.5-10', unit: '°BTDC' }] }; M.lib.sets.push(s); }
  M.setIdx = 0; fillSetList(); fillDefList();
})();

// ----- sets -----
function fillSetList() {
  const sel = $('#setSel'); sel.innerHTML = '';
  M.lib.sets.forEach((s, i) => { const o = document.createElement('option'); o.value = i; o.textContent = `${s.name}${s.romSize ? ' · ' + (s.romSize / 1024) + 'K' : ''}${s.ecmIds.length ? ' · ' + s.ecmIds.length + ' ECM' : ''} (${s.tables.length})`; sel.appendChild(o); });
  sel.value = M.setIdx; const s = curSet(); $('#setName').value = s ? s.name : '';
  $('#setInfo').textContent = s ? `${s.source || ''}${s.romSize ? ' · ROM ' + s.romSize + ' ไบต์' : ''}${s.ecmIds.length ? ' · ECM: ' + s.ecmIds.join(', ') : ' · ยังไม่ผูก ECM ID'}` : '';
}
function autoPickSet(bytes) {
  const id = state.ecm && state.ecm.ecmId && state.ecm.ecmId !== '-' ? state.ecm.ecmId.toUpperCase() : '';
  let i = id ? M.lib.sets.findIndex((s) => s.ecmIds.includes(id)) : -1;
  if (i < 0 && bytes) i = M.lib.sets.findIndex((s) => s.romSize === bytes.length);
  if (i >= 0 && i !== M.setIdx) { M.setIdx = i; M.cur = -1; M.sel.clear(); fillSetList(); fillDefList(); log(`เลือกชุดตาราง "${M.lib.sets[i].name}" อัตโนมัติ (${id && M.lib.sets[i].ecmIds.includes(id) ? 'ตรง ECM ID' : 'ตรงขนาด ROM'})`); }
}
$('#setSel').onchange = () => { M.setIdx = +$('#setSel').value; M.cur = -1; M.sel.clear(); fillSetList(); fillDefList(); renderMap(); };
$('#setName').onchange = () => { const s = curSet(); if (s) { s.name = $('#setName').value.trim() || s.name; fillSetList(); saveLib(); } };
$('#btnSetNew').onclick = () => { M.lib.sets.push({ id: String(Date.now()), name: 'ชุดใหม่ ' + (M.lib.sets.length + 1), romSize: M.bytes ? M.bytes.length : 0, ecmIds: [], family: '', source: 'manual', tables: [{ ...DEFAULT_TABLE }] }); M.setIdx = M.lib.sets.length - 1; M.cur = 0; fillSetList(); fillDefList(); renderMap(); saveLib(); };
$('#btnSetDel').onclick = () => { const s = curSet(); if (!s || M.lib.sets.length <= 1 || !confirm(`ลบชุด "${s.name}" (${s.tables.length} ตาราง)?`)) return; M.lib.sets.splice(M.setIdx, 1); M.setIdx = Math.max(0, M.setIdx - 1); M.cur = -1; fillSetList(); fillDefList(); renderMap(); saveLib(); };
$('#btnSetBind').onclick = () => { const s = curSet(); const id = state.ecm && state.ecm.ecmId && state.ecm.ecmId !== '-' ? state.ecm.ecmId.toUpperCase() : prompt('ใส่ ECM ID ที่จะผูกกับชุดนี้ (เช่น 38770A1122)'); if (!s || !id) return; if (!s.ecmIds.includes(id)) s.ecmIds.push(id); if (M.bytes && !s.romSize) s.romSize = M.bytes.length; fillSetList(); saveLib(); log(`ผูก ECM ID ${id} กับชุด "${s.name}"`, 'ok'); };
$('#btnXdf').onclick = async () => {
  const r = await james.maplib.importXdf(); if (!r || r.cancelled) return;
  if (r.ok === false) { log('นำเข้า XDF ไม่สำเร็จ: ' + r.error, 'err'); alert(r.error); return; }
  const set = r.set;
  if (!set.tables.length) { const w = r.warnings && r.warnings.length ? r.warnings[0] : 'ไม่พบตารางที่นำเข้าได้'; log('นำเข้า XDF "' + set.name + '": ' + w, 'err'); alert(w); return; }
  if (M.bytes && !set.romSize) set.romSize = M.bytes.length;
  M.lib.sets.push(set); M.setIdx = M.lib.sets.length - 1; M.cur = 0; M.sel.clear(); fillSetList(); fillDefList(); renderMap(); saveLib();
  log(`นำเข้า XDF "${set.name}": ${r.counts.tables} ตาราง${r.warnings.length ? ` · คำเตือน ${r.warnings.length}: ${r.warnings.slice(0, 3).join(' | ')}` : ''}`, r.warnings.length ? '' : 'ok');
};
$('#btnSetImport').onclick = async () => { const r = await james.maplib.importSet(); if (!r || r.cancelled) return; if (r.ok === false) { log(r.error, 'err'); return; } M.lib.sets.push(r.set); M.setIdx = M.lib.sets.length - 1; M.cur = 0; fillSetList(); fillDefList(); renderMap(); saveLib(); log(`นำเข้าชุด "${r.set.name}" (${r.set.tables.length} ตาราง)`, 'ok'); };
$('#btnSetExport').onclick = async () => { const s = curSet(); if (!s) return; const r = await james.maplib.exportSet(s); if (r && r.ok === false) log(r.error, 'err'); else if (r && r.path) log('ส่งออกชุดตารางแล้ว: ' + r.path, 'ok'); };

// ----- tables in the current set -----
function visibleDefs() { const s = curSet(); if (!s) return []; const f = M.filter.toLowerCase(); return s.tables.map((d, i) => ({ d, i })).filter(({ d }) => !f || `${d.category} ${d.name}`.toLowerCase().includes(f)); }
function fillDefList() {
  const s = curSet(); const sel = $('#defSel'); sel.innerHTML = ''; if (!s) return;
  if (M.cur < 0 && s.tables.length) M.cur = 0; if (M.cur >= s.tables.length) M.cur = s.tables.length - 1;
  for (const { d, i } of visibleDefs()) { const o = document.createElement('option'); o.value = i; o.textContent = (d.category ? d.category + ' · ' : '') + d.name; sel.appendChild(o); }
  sel.value = M.cur; loadDefForm();
}
$('#defFilter').oninput = () => { M.filter = $('#defFilter').value; fillDefList(); };
function loadDefForm() { const d = curSet()?.tables[M.cur]; if (!d) return; $('#dName').value = d.name; $('#dOff').value = d.off; $('#dRows').value = d.rows; $('#dCols').value = d.cols; $('#dSize').value = d.size; $('#dSigned').value = d.signed; $('#dEq').value = d.equation || MathExpr.fromScaleAdd(d.scale, d.add); $('#dDec').value = d.decimals ?? 2; $('#dUnit').value = d.unit || ''; $('#dCat').value = d.category || ''; $('#dXAxis').value = d.xAxis || ''; $('#dYAxis').value = d.yAxis || ''; $('#dFlipY').value = d.flipY || 0; }
$('#defSel').onchange = () => { M.cur = +$('#defSel').value; M.sel.clear(); loadDefForm(); renderMap(); };
$('#btnDefApply').onclick = () => {
  const s = curSet(); if (!s || M.cur < 0) return; let eq = $('#dEq').value.trim() || 'X'; try { MathExpr.compile(eq); } catch (e) { alert('สูตรไม่ถูกต้อง: ' + e.message); return; }
  const prev = s.tables[M.cur]; const c = MathExpr.compile(eq);
  s.tables[M.cur] = { ...prev, name: $('#dName').value, off: $('#dOff').value, rows: +$('#dRows').value, cols: +$('#dCols').value, size: $('#dSize').value, signed: +$('#dSigned').value, equation: eq, scale: c.linear ? c.linear.b : 1, add: c.linear ? c.linear.a : 0, decimals: +$('#dDec').value, unit: $('#dUnit').value, category: $('#dCat').value, xAxis: $('#dXAxis').value, yAxis: $('#dYAxis').value, flipY: +$('#dFlipY').value };
  if (prev.rows !== s.tables[M.cur].rows || prev.cols !== s.tables[M.cur].cols || prev.size !== s.tables[M.cur].size) { delete s.tables[M.cur].rowStride; delete s.tables[M.cur].colStride; }
  M.sel.clear(); fillDefList(); renderMap(); saveLib();
};
$('#btnDefNew').onclick = () => { const s = curSet(); if (!s) return; s.tables.push({ ...DEFAULT_TABLE, name: 'ตารางใหม่ ' + (s.tables.length + 1), id: String(Date.now()) }); M.cur = s.tables.length - 1; fillDefList(); renderMap(); saveLib(); };
$('#btnDefDel').onclick = () => { const s = curSet(); if (!s || s.tables.length <= 1) return; s.tables.splice(M.cur, 1); M.cur = Math.max(0, M.cur - 1); fillDefList(); renderMap(); saveLib(); };
$('#btnDefSave').onclick = async () => { await james.maplib.save(M.lib); $('#statusText').textContent = 'บันทึกคลังตารางแล้ว'; };

function loadMap(bytes, name) { M.bytes = new Uint8Array(bytes); M.orig = new Uint8Array(bytes); M.name = name; M.undo = []; M.sel.clear(); $('#mapFile').textContent = `${name} — ${M.bytes.length} ไบต์`; autoPickSet(M.bytes); renderMap(); renderHex(); }
$('#btnMapOpen').onclick = async () => { const r = await james.openBin(); if (r) loadMap(r.bytes, r.name); };
$('#btnMapCompare').onclick = async () => { const r = await james.openBin(); if (r) { M.cmp = new Uint8Array(r.bytes); M.view = 'diff'; $$('.charttabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === 'diff')); renderMap(); } };

// ----- cell codec (supports 8/16/32-bit, strides, equations, embedded axes) -----
function cellSpec(d) { const bytes = d.size === '8' ? 1 : d.size.startsWith('16') ? 2 : 4; return { bytes, off: parseInt(d.off, 16) || 0, rowStride: d.rowStride || d.cols * bytes, colStride: d.colStride || bytes, le: d.size.endsWith('le') }; }
function addrOf(d, r, c) { const s = cellSpec(d); const rr = d.flipY ? d.rows - 1 - r : r; return s.off + rr * s.rowStride + c * s.colStride; }
function rawAtAddr(d, p, src) { const { bytes, le } = cellSpec(d), b = src || M.bytes; if (!b || p + bytes > b.length) return 0;
  let v = bytes === 1 ? b[p] : bytes === 2 ? (le ? b[p] | (b[p + 1] << 8) : (b[p] << 8) | b[p + 1]) : (le ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0 : ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0);
  if (d.signed) { const bits = bytes * 8; if (bits < 32 && v >= 2 ** (bits - 1)) v -= 2 ** bits; else if (bits === 32) v |= 0; } return v; }
function setRawAddr(d, p, v) { const { bytes, le } = cellSpec(d), b = M.bytes; if (!b || p + bytes > b.length) return;
  const bits = bytes * 8, max = d.signed ? 2 ** (bits - 1) - 1 : 2 ** bits - 1, min = d.signed ? -(2 ** (bits - 1)) : 0; v = Math.round(Math.max(min, Math.min(max, v))); if (v < 0) v += 2 ** bits;
  if (bytes === 1) b[p] = v; else if (bytes === 2) { if (le) { b[p] = v & 255; b[p + 1] = (v >>> 8) & 255; } else { b[p] = (v >>> 8) & 255; b[p + 1] = v & 255; } }
  else if (le) { b[p] = v & 255; b[p + 1] = (v >>> 8) & 255; b[p + 2] = (v >>> 16) & 255; b[p + 3] = (v >>> 24) & 255; } else { b[p] = (v >>> 24) & 255; b[p + 1] = (v >>> 16) & 255; b[p + 2] = (v >>> 8) & 255; b[p + 3] = v & 255; } }
const toVal = (d, raw) => MathExpr.apply(eqOf(d), raw), toRaw = (d, val) => MathExpr.invert(eqOf(d), val);
const cellVal = (d, r, c, src) => toVal(d, rawAtAddr(d, addrOf(d, r, c), src));
function matrix(d, src) { const m = []; for (let r = 0; r < d.rows; r++) { const row = []; for (let c = 0; c < d.cols; c++) row.push(cellVal(d, r, c, src)); m.push(row); } return m; }
function embeddedAxis(emb) {
  if (!emb || !M.bytes) return []; let c; try { c = MathExpr.compile(emb.equation || 'X'); } catch { c = MathExpr.compile('X'); } const out = [];
  for (let i = 0; i < emb.count; i++) { const p = emb.off + i * (emb.stride || emb.bytes); if (p + emb.bytes > M.bytes.length) break; const b = M.bytes; let raw = emb.bytes === 1 ? b[p] : emb.bytes === 2 ? (emb.lsbFirst ? b[p] | (b[p + 1] << 8) : (b[p] << 8) | b[p + 1]) : (emb.lsbFirst ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0 : ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0);
    if (emb.signed) { const bits = emb.bytes * 8; if (bits < 32 && raw >= 2 ** (bits - 1)) raw -= 2 ** bits; } out.push(MathExpr.apply(c, raw)); }
  return out;
}
const fmtAxis = (v) => typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) < 10 ? 2 : 1)) : String(v);
const axis = (s, n, emb) => { if (emb) { const a = embeddedAxis(emb).map(fmtAxis); if (a.length) return a; } const a = (s || '').split(',').map((x) => x.trim()).filter(Boolean); return a.length ? a : [...Array(n)].map((_, i) => i); };

function renderMap() {
  const d = curSet()?.tables[M.cur]; const host = $('#gridHost'); if (!d || !M.bytes) { host.innerHTML = '<div class="muted" style="padding:20px">เปิดไฟล์ .bin แล้วเลือกชุดตาราง/ตารางทางซ้าย</div>'; return; }
  const data = matrix(d), orig = matrix(d, M.orig), xA = axis(d.xAxis, d.cols, d.xAxisEmbedded), yA = axis(d.yAxis, d.rows, d.yAxisEmbedded);
  const dec = Math.max(0, Math.min(6, d.decimals ?? ((d.scale % 1 || d.add % 1) ? 2 : 0)));
  let html = '<table><tr><th class="rowh"></th>' + xA.slice(0, d.cols).map((x) => `<th>${x}</th>`).join('') + '</tr>';
  for (let r = 0; r < d.rows; r++) { html += `<tr><th class="rowh">${yA[r] ?? r}</th>`; for (let c = 0; c < d.cols; c++) { const k = `${r},${c}`; const chg = data[r][c] !== orig[r][c]; html += `<td data-k="${k}" class="${M.sel.has(k) ? 'sel' : ''}${chg ? ' chg' : ''}" style="background:${heatBg(data, r, c)}">${data[r][c].toFixed(dec)}</td>`; } html += '</tr>'; }
  host.innerHTML = html + '</table>';
  drawChart(data, orig, d, xA, yA);
}
function heatBg(data, r, c) { let mn = Infinity, mx = -Infinity; for (const row of data) for (const v of row) { if (v < mn) mn = v; if (v > mx) mx = v; } const t = mx > mn ? (data[r][c] - mn) / (mx - mn) : 0; return `hsla(${230 - 230 * t},70%,45%,.35)`; }
function drawChart(data, orig, d, xA, yA) {
  const cv = $('#chart'); const changed = JSON.stringify(data) !== JSON.stringify(orig);
  if (M.view === '2d') Charts.draw2D(cv, data, { xAxis: xA, yAxis: yA, selected: M.sel, unit: d.unit, original: changed ? orig : null });
  else if (M.view === '3d') Charts.draw3D(cv, data, { xAxis: xA, yAxis: yA, selected: M.sel });
  else Charts.drawDiff(cv, data, M.cmp ? matrix(d, M.cmp) : changed ? orig : null, { xAxis: xA });
}
$$('.charttabs button').forEach((b) => b.onclick = () => { M.view = b.dataset.view; $$('.charttabs button').forEach((x) => x.classList.toggle('active', x === b)); renderMap(); });

// selection (click / shift / drag)
let dragging = false;
$('#gridHost').addEventListener('mousedown', (e) => { const td = e.target.closest('td'); if (!td) return; dragging = true; const k = td.dataset.k; if (e.ctrlKey) { M.sel.has(k) ? M.sel.delete(k) : M.sel.add(k); } else if (e.shiftKey && M.anchor) selectRect(M.anchor, k); else { M.sel.clear(); M.sel.add(k); M.anchor = k; } renderMap(); });
$('#gridHost').addEventListener('mouseover', (e) => { if (!dragging) return; const td = e.target.closest('td'); if (!td) return; selectRect(M.anchor, td.dataset.k); renderMap(); });
window.addEventListener('mouseup', () => (dragging = false));
function selectRect(a, b) { const [r1, c1] = a.split(',').map(Number), [r2, c2] = b.split(',').map(Number); M.sel.clear(); for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) M.sel.add(`${r},${c}`); }
$('#gridHost').addEventListener('dblclick', (e) => { const td = e.target.closest('td'); if (!td) return; const k = td.dataset.k, old = td.textContent; td.contentEditable = 'true'; td.focus(); document.getSelection().selectAllChildren(td);
  const done = (commit) => { td.contentEditable = 'false'; const v = parseFloat(td.textContent); if (commit && !isNaN(v)) applyOp('set', v, new Set([k])); else { td.textContent = old; } };
  td.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); done(true); } else if (ev.key === 'Escape') done(false); ev.stopPropagation(); };
  td.onblur = () => { if (td.isContentEditable) done(true); }; });

// edit ops
function snapshot() { M.undo.push(new Uint8Array(M.bytes)); if (M.undo.length > 50) M.undo.shift(); }
function applyOp(op, val, sel = M.sel) {
  const d = curSet()?.tables[M.cur]; if (!d || !M.bytes || !sel.size) return; snapshot();
  const cells = [...sel].map((k) => k.split(',').map(Number));
  const put = (r, c, v) => setRawAddr(d, addrOf(d, r, c), toRaw(d, v));
  if (op === 'interp') { const rs = cells.map((x) => x[0]), cs = cells.map((x) => x[1]); const r1 = Math.min(...rs), r2 = Math.max(...rs), c1 = Math.min(...cs), c2 = Math.max(...cs);
    const g = (r, c) => cellVal(d, r, c); const v00 = g(r1, c1), v01 = g(r1, c2), v10 = g(r2, c1), v11 = g(r2, c2);
    for (const [r, c] of cells) { const tr = r2 > r1 ? (r - r1) / (r2 - r1) : 0, tc = c2 > c1 ? (c - c1) / (c2 - c1) : 0; put(r, c, (v00 * (1 - tc) + v01 * tc) * (1 - tr) + (v10 * (1 - tc) + v11 * tc) * tr); } }
  else if (op === 'smooth') { const cur = matrix(d); for (const [r, c] of cells) { let s = 0, n = 0; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc; if (cur[rr]?.[cc] !== undefined) { s += cur[rr][cc]; n++; } } put(r, c, s / n); } }
  else { const step = eqOf(d).linear ? Math.abs(eqOf(d).linear.b) || 1 : 1;
    for (const [r, c] of cells) { const v = cellVal(d, r, c); let nv = v;
      if (op === '+1') nv = v + step; else if (op === '-1') nv = v - step; else if (op === '+5%') nv = v * 1.05; else if (op === '-5%') nv = v * 0.95; else if (op === 'set') nv = val;
      put(r, c, nv); } }
  renderMap();
}
$$('.toolbar [data-op]').forEach((b) => b.onclick = () => applyOp(b.dataset.op, parseFloat($('#opVal').value)));
$('#btnUndo').onclick = () => { if (M.undo.length) { M.bytes = M.undo.pop(); renderMap(); } };
window.addEventListener('keydown', (e) => { if (!$('#tab-map').classList.contains('active')) return; if (e.ctrlKey && e.key === 'z') $('#btnUndo').click(); if (e.key === '+' || e.key === '=') applyOp('+1'); if (e.key === '-') applyOp('-1'); });

// save / handoff
$('#btnMapSave').onclick = async () => { if (!M.bytes) return; const a = await james.analyzeBin(M.bytes); const p = await james.saveBin(a.fixed, M.name.replace(/\.bin$/i, '') + '_mod.bin'); if (p) { M.bytes = new Uint8Array(a.fixed); $('#statusText').textContent = 'บันทึกแล้ว (checksum ' + (a.checksumChanged ? 'ถูกแก้' : 'ถูกต้องอยู่แล้ว') + '): ' + p; } };
$('#btnMapToFlash').onclick = async () => { if (!M.bytes) return; await setBin(new Uint8Array(M.bytes), M.name + ' (แก้ไข)'); $$('.tabs button')[0].click(); };

// 3D rotate / zoom
const cv = $('#chart'); let rot = null;
cv.addEventListener('mousedown', (e) => { if (M.view === '3d') rot = { x: e.clientX, y: e.clientY, rx: Charts.view3.rx, rz: Charts.view3.rz }; });
window.addEventListener('mousemove', (e) => { if (!rot) return; Charts.view3.rz = rot.rz + (e.clientX - rot.x) * 0.01; Charts.view3.rx = Math.max(0.1, Math.min(1.5, rot.rx + (e.clientY - rot.y) * 0.01)); renderMap(); });
window.addEventListener('mouseup', () => (rot = null));
cv.addEventListener('wheel', (e) => { if (M.view !== '3d') return; e.preventDefault(); Charts.view3.zoom = Math.max(0.4, Math.min(3, Charts.view3.zoom * (e.deltaY < 0 ? 1.1 : 0.9))); renderMap(); }, { passive: false });

// ---------- hex ----------
function renderHex(start = 0) {
  const b = M.bytes || state.bin; const el = $('#hexView'); if (!b) { el.textContent = 'ยังไม่มีไฟล์'; return; }
  $('#hexInfo').textContent = `${b.length} ไบต์`; const lines = []; const end = Math.min(b.length, start + 0x2000);
  for (let o = start & ~15; o < end; o += 16) { let h = '', a = ''; for (let i = 0; i < 16; i++) { const v = b[o + i]; if (v === undefined) { h += '   '; continue; } h += hex(v) + ' '; a += v >= 32 && v < 127 ? String.fromCharCode(v) : '.'; } lines.push(hex(o, 6) + '  ' + h + ' ' + a); }
  el.textContent = lines.join('\n') + (end < b.length ? '\n... (ใช้ช่อง offset เพื่อดูต่อ)' : '');
}
$('#btnHexGo').onclick = () => renderHex(parseInt($('#hexGoto').value, 16) || 0);
// ---------- Renesas (SH/R8C) ----------
(function () {
  const rlog = (m, c) => { const el = $('#rnLog'); if (!el) return; const d = document.createElement('div'); if (c) d.className = c; d.textContent = m; el.appendChild(d); el.scrollTop = el.scrollHeight; };
  james.onRnStatus((s) => { const e = $('#rnStatus'); if (e) e.textContent = s; rlog(s); });
  james.onRnLog((s) => rlog(s));
  james.onRnError((s) => rlog(s, 'err'));
  james.onRnProgress((p) => { const pct = p.total ? Math.round((p.done / p.total) * 100) : 0; const b = $('#rnBar'); if (b) b.style.width = pct + '%'; const t = $('#rnPct'); if (t) t.textContent = pct + '%'; });
  james.onRnState((d) => { const e = $('#rnState'); if (e) e.textContent = d.state; });
  const rports = async () => { const ps = await james.renesas.ports(); const sel = $('#rnPort'); if (!sel) return; sel.innerHTML = ps.map((p) => `<option value="${p.path}">${p.friendlyName}${p.isFTDI ? ' ★FTDI' : ''}</option>`).join(''); };
  const on = (id, fn) => { const e = $('#' + id); if (e) e.onclick = fn; };
  on('rnRefresh', rports);
  on('rnConnect', async () => { const r = await james.renesas.connect($('#rnPort').value, $('#rnFamily').value, { baud: parseInt($('#rnBaud').value, 10), halfDuplex: $('#rnHalf').checked, arm: $('#rnArm').checked }); if (!r.ok) return rlog(r.error, 'err'); rlog('connected: ' + r.family); });
  on('rnDisconnect', () => james.renesas.disconnect());
  on('rnIdentify', async () => { const r = await james.renesas.identify(); if (!r.ok) return rlog(r.error, 'err'); const i = r.info; $('#rnVer').textContent = i.version || '-'; $('#rnKey').textContent = i.defaultKey === null ? 'ไม่ใช่คีย์ default' : 'default 0x' + i.defaultKey.toString(16); $('#rnUnlock').textContent = ['ไม่มีคีย์', 'คีย์ผิด', '?', 'ปลดล็อกแล้ว'][i.status.unlock] ?? i.status.unlock; });
  let rnRom = null;
  on('rnRead', async () => { const start = parseInt($('#rnStart').value, 16) >>> 0; const len = parseInt($('#rnLen').value, 16) >>> 0; if (!len) return rlog('ใส่ขนาด (hex)', 'err'); const r = await james.renesas.readRom(start, len); if (!r.ok) return rlog(r.error, 'err'); rnRom = r.rom; $('#rnSave').disabled = false; rlog('อ่าน OK ' + len + ' ไบต์ → สำรองที่ ' + r.backup); });
  on('rnSave', () => rnRom && james.renesas.saveBin(rnRom, 'RENESAS_ROM.bin'));
  on('rnErase', async () => { if (!$('#rnArm').checked) return rlog('ต้องติ๊ก ARM แล้วเชื่อมต่อใหม่ก่อน', 'err'); if (!confirm('ลบ flash ทั้งหมด? ทำบนกล่องสำรองเท่านั้น')) return; const r = await james.renesas.eraseAll(); rlog(r.ok ? 'erase done' : r.error, r.ok ? '' : 'err'); });
  setTimeout(rports, 300);
})();

// ================= CAN (ELM327 / J2534) =================
const CAN = { connected: false, kind: 'elm327', ecu: null };
const bus = () => (document.querySelector('input[name="bus"]:checked') || {}).value || 'kline';
function busUi() {
  const b = bus(); $('#canCard').style.display = b === 'can' ? '' : 'none'; $('#canEcu').style.display = b === 'can' && CAN.ecu ? '' : 'none';
  const ready = b === 'can' ? CAN.connected : state.connected;
  $('#busState').textContent = b === 'can' ? (CAN.connected ? `CAN เชื่อมต่อแล้ว (${CAN.kind})` : 'ยังไม่ได้เชื่อมต่อ CAN') : (state.connected ? 'ใช้การเชื่อมต่อ K-line ปัจจุบัน' : 'ยังไม่ได้เชื่อมต่อ ECM (หน้า ECU / Flash)');
  $('#btnLiveStart').disabled = L.running || !ready; $('#btnDtcRead').disabled = !ready; $('#btnDtcClear').disabled = !ready;
  $('#btnCanConnect').disabled = CAN.connected; $('#btnCanDisconnect').disabled = !CAN.connected; $('#btnCanSeed').disabled = !CAN.connected;
}
$$('input[name="bus"]').forEach((r) => r.onchange = () => { if (L.running) james.live.stop(bus() === 'can' ? 'kline' : 'can'); busUi(); });
(async () => {
  const profiles = await james.can.profiles(); const sel = $('#canProfile'); sel.innerHTML = profiles.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');
  await canPorts(); busUi();
})();
async function canPorts() {
  const sel = $('#canPort'); sel.innerHTML = '';
  if ($('#canKind').value === 'j2534') { const devs = await james.can.j2534Devices(); sel.innerHTML = devs.length ? devs.map((d) => `<option value="${d.dll}">${d.name} (${d.hive})</option>`).join('') : '<option value="">ไม่พบไดรเวอร์ J2534</option>'; return; }
  const ports = await james.listPorts(); sel.innerHTML = ports.map((p) => `<option value="${p.path}">${p.path} — ${p.friendlyName}</option>`).join('') || '<option value="">ไม่พบพอร์ต</option>';
}
$('#canKind').onchange = canPorts; $('#btnCanRefresh').onclick = canPorts;
function showCanEcu(e) {
  CAN.ecu = e; const rows = [['ECM ID (F181)', e.ecmId], ['VIN', e.vin], ['CAL ID', e.calId], ['Part no.', e.partNo], ['Serial', e.serial], ['HW', e.hardware], ['SW', e.software || e.swVersion], ['PIDs', e.pidCount]];
  $('#canEcu').innerHTML = rows.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('') || '<dt>ECU</dt><dd>ตอบแล้ว (ไม่มีข้อมูลระบุตัวตน)</dd>';
}
$('#btnCanConnect').onclick = async () => {
  if (!canUse('can')) { log('CAN ต้องมี license ถาวร (FULL) — ดูแท็บ License', 'err'); $$('.tabs button').find((b) => b.dataset.tab === 'license').click(); return; }
  $('#btnCanConnect').disabled = true; const kind = $('#canKind').value;
  const r = await james.can.connect(kind === 'j2534' ? { kind, dll: $('#canPort').value, profile: $('#canProfile').value } : { kind, port: $('#canPort').value, profile: $('#canProfile').value });
  if (r.ok === false) { log(r.error, 'err'); busUi(); return; }
  CAN.connected = true; CAN.kind = kind; showCanEcu(r.ecu); $('#canInfo').textContent = r.info ? [r.info.version, r.info.device, r.info.profile].filter(Boolean).join(' · ') : '';
  log('CAN เชื่อมต่อแล้ว' + (r.ecu.ecmId ? ' — ECM ' + r.ecu.ecmId : '') + (r.ecu.vin ? ' · VIN ' + r.ecu.vin : ''), 'ok'); busUi();
};
$('#btnCanDisconnect').onclick = async () => { await james.can.disconnect(); CAN.connected = false; CAN.ecu = null; $('#canInfo').textContent = ''; busUi(); };
$('#btnCanSeed').onclick = async () => { const r = await james.can.seed(1); if (r.ok === false) { log(r.error, 'err'); return; } log(`Security seed (level 1): ${r.seed}${r.unlocked ? ' — ปลดล็อกอยู่แล้ว/สำเร็จ' : ' — ยังไม่มีสูตร key จึงไม่ส่ง key'}`); };
james.onCanState((d) => { CAN.connected = !!d.connected; if (!d.connected) { CAN.ecu = null; } busUi(); });

// ================= CAN FLASH (UDS download · SM2 Pro / J2534) =================
const CF = { bin: null, binName: '', gate: null, profiles: [], busy: false };
function cfUi() {
  $('#canFlashCard').style.display = bus() === 'can' && CAN.connected ? '' : 'none';
  const g = CF.gate;
  $('#btnCfFlash').disabled = CF.busy || !(CAN.connected && CF.bin && g && g.canFlash && (!g.needsOverride || $('#cfOverride').checked) && $('#cfConfirm').checked);
  $('#btnCfCheck').disabled = CF.busy || !(CAN.connected && CF.bin && $('#cfProfile').value);
}
const _busUi = busUi; busUi = function () { _busUi(); cfUi(); };
async function cfLoadProfiles(keep) {
  CF.profiles = await james.can.flashProfiles(); const sel = $('#cfProfile'); const cur = keep || sel.value;
  sel.innerHTML = CF.profiles.map((p) => `<option value="${p.id}">${p.label}${p.builtin ? '' : ' (ผู้ใช้)'}</option>`).join('');
  if (cur && CF.profiles.some((p) => p.id === cur)) sel.value = cur;
  const n = await james.can.node32(); $('#cfNode32').textContent = n.path ? `ตัวช่วย 32-bit สำหรับ DLL ของ SM2: ${n.path}` : `ยังไม่มีตัวช่วย 32-bit — ถ้า DLL ของ SM2 เป็น 32-bit ให้วาง node.exe (Windows x86) ที่ tools\\node32\\node.exe (แอปนี้เป็น ${n.arch})`;
}
cfLoadProfiles();
function cfRenderGate(g) {
  CF.gate = g; const ul = $('#cfGate'); ul.innerHTML = '';
  for (const it of g.items) { const li = document.createElement('li'); li.className = it.level; li.innerHTML = `<div>${it.text}${it.detail ? `<small>${it.detail}</small>` : ''}</div>`; ul.appendChild(li); }
  const b = $('#cfBadge'); if (g.blocks) { b.textContent = `ไม่ผ่าน (${g.blocks})`; b.className = 'badge block'; } else if (g.warns) { b.textContent = `ผ่านแบบมีคำเตือน (${g.warns})`; b.className = 'badge warn'; } else { b.textContent = 'ผ่าน'; b.className = 'badge ok'; }
  $('#cfOverrideWrap').style.display = g.needsOverride ? '' : 'none'; if (!g.needsOverride) $('#cfOverride').checked = false; cfUi();
}
$('#btnCfOpen').onclick = async () => { const r = await james.openBin(); if (!r) return; CF.bin = r.bytes; CF.binName = r.name; $('#cfFile').textContent = `${r.name} (${r.bytes.length} ไบต์)`; CF.gate = null; $('#cfBadge').textContent = 'ยังไม่ได้ตรวจ'; $('#cfBadge').className = 'badge'; cfUi(); };
$('#btnCfCheck').onclick = async () => { CF.busy = true; cfUi(); const r = await james.can.flashPrecheck($('#cfProfile').value, CF.bin); CF.busy = false; if (!r.ok) { log(r.error, 'err'); cfUi(); return; } cfRenderGate(r.gate); };
$('#cfProfile').onchange = () => { CF.gate = null; cfUi(); }; $('#cfOverride').onchange = cfUi; $('#cfConfirm').onchange = cfUi;
$('#btnCfFlash').onclick = async () => {
  const dry = $('#cfDry').checked, prof = CF.profiles.find((p) => p.id === $('#cfProfile').value);
  if (!confirm(`${dry ? 'DRY RUN' : 'เขียนจริง'} ผ่าน CAN ด้วย profile "${prof ? prof.label : ''}"\nไฟล์ ${CF.binName} (${CF.bin.length} ไบต์)\n${dry ? 'จะหยุดก่อน erase' : 'ECU จะถูก ERASE และเขียนใหม่ — ห้ามปิดกุญแจ/ถอดสาย'}\nดำเนินการ?`)) return;
  CF.busy = true; cfUi(); $('#cfBar').style.width = '0%'; $('#cfPct').textContent = ''; $('#cfSpeed').textContent = ''; $('#cfEta').textContent = '';
  const r = await james.can.flash($('#cfProfile').value, CF.bin, { dryRun: dry, override: $('#cfOverride').checked });
  CF.busy = false; cfUi();
  if (r.ok && r.done) { log(dry ? '✔ DRY RUN ผ่านทุกขั้นก่อน erase' : '✔ เขียนผ่าน CAN สำเร็จ', 'ok'); if (!dry) $('#cfBar').style.width = '100%'; } else log('✘ CAN flash: ' + (r.error || ''), 'err');
};
$('#btnCfAbort').onclick = () => james.can.flashAbort();
james.onCanFlashProgress((p) => {
  const names = { session: 'session', security: 'security access', programming: 'programming session', 'dry-run': 'dry run เสร็จ', erase: 'กำลังลบ (erase)…', download: 'RequestDownload', transfer: 'กำลังส่งข้อมูล', exit: 'TransferExit', check: 'ตรวจสอบ', reset: 'รีเซ็ต ECU', done: 'เสร็จ' };
  if (p.phase) $('#cfPhase').textContent = names[p.phase] || p.phase;
  if (p.phase === 'transfer' && p.totalBytes) { $('#cfBar').style.width = (p.percentage * 100).toFixed(1) + '%'; $('#cfPct').textContent = `${(p.percentage * 100).toFixed(1)}%  ${p.bytesSent}/${p.totalBytes}`; $('#cfSpeed').textContent = p.speedKbs.toFixed(2) + ' KB/s'; $('#cfEta').textContent = 'เหลือ ~' + Math.round(p.etaSeconds) + 's'; }
});
james.onCanNeedKey((info) => {
  const d = $('#keyDlg'); $('#keyMsg').textContent = `ECU ส่ง seed (level ${info.level}): ${info.seed}\nกรอก key สำหรับ seed นี้ (hex) แล้วกดส่ง`; const inp = $('#keyInput'); inp.value = '';
  d.onclose = () => { if (d.returnValue === 'ok') james.can.keyAnswer(inp.value.trim()); else james.can.keyCancel(); };
  d.showModal(); inp.focus();
});
$('#btnCfProfileEdit').onclick = async () => {
  const p = CF.profiles.find((x) => x.id === $('#cfProfile').value); if (!p) return;
  const d = $('#profDlg'); const ta = $('#profText'); ta.value = JSON.stringify(p, null, 2);
  d.onclose = async () => {
    if (d.returnValue === 'ok') { let obj; try { obj = JSON.parse(ta.value); } catch (e) { log('JSON ไม่ถูกต้อง: ' + e.message, 'err'); return; } const r = await james.can.flashProfileSave(obj); if (!r.ok) { log(r.error, 'err'); return; } await cfLoadProfiles(r.profile.id); log('บันทึก profile ' + r.profile.id, 'ok'); CF.gate = null; cfUi(); }
    else if (d.returnValue === 'del') { if (p.builtin) { log('ลบ profile ในตัวไม่ได้', 'err'); return; } if (confirm(`ลบ profile "${p.label}"?`)) { await james.can.flashProfileDelete(p.id); await cfLoadProfiles(); CF.gate = null; cfUi(); } }
  };
  d.showModal();
};

// ================= SMART KEY: decode / analyze / renew (works on EEPROM or ROM files) =================
const SK2 = { profiles: [], bin: null, binName: '', donor: null, donorName: '' };
async function skLoadProfiles(keep) {
  SK2.profiles = await james.sec.skProfiles(); const sel = $('#skProfile'); const cur = keep || sel.value;
  sel.innerHTML = SK2.profiles.map((p) => `<option value="${p.id}">${p.label}${p.builtin ? '' : ' (ผู้ใช้)'}</option>`).join('');
  if (cur && SK2.profiles.some((p) => p.id === cur)) sel.value = cur; skUi();
}
function skUi() {
  const has = !!SK2.bin, un = canUse('smartkey');
  $('#btnSkDecode').disabled = !(has && un); $('#btnSkBuildVirgin').disabled = !(has && un); $('#btnSkBuildClone').disabled = !(has && SK2.donor && un);
  const p = SK2.profiles.find((x) => x.id === $('#skProfile').value);
  const b = $('#skProfBadge'); b.textContent = p ? (p.tested ? 'profile พร้อม' : 'profile ร่าง') : '—'; b.className = 'badge ' + (p ? (p.tested ? 'ok' : 'warn') : '');
}
skLoadProfiles();
$('#skProfile').onchange = skUi;
$('#btnSkOpen').onclick = async () => { const r = await james.openBin(); if (!r) return; SK2.bin = r.bytes; SK2.binName = r.name; $('#skFileName').textContent = `${r.name} (${r.bytes.length} ไบต์)`; $('#skDecoded').style.display = 'none'; skUi(); };
$('#btnSkDonor').onclick = async () => { const r = await james.openBin(); if (!r) return; SK2.donor = r.bytes; SK2.donorName = r.name; $('#skDonorName').textContent = `${r.name} (${r.bytes.length} ไบต์)`; skUi(); };
$('#btnSkDecode').onclick = async () => {
  const r = await james.sec.skDecode($('#skProfile').value, SK2.bin); if (!r.ok) { log(r.error, 'err'); return; }
  const d = r.decode, rows = [];
  if (d.keyId !== null) rows.push(['Key ID', d.keyId]);
  if (d.keyCount !== null) rows.push(['จำนวนคีย์/ตัวนับ', d.keyCount]);
  for (const [id, f] of Object.entries(d.fields)) if (id !== 'keyId' && id !== 'keyCount') rows.push([f.label, f.show === 'dec' ? f.num : f.hex]);
  if (d.region) rows.push(['โซนจับคู่ (0x' + d.region.offset.toString(16).toUpperCase() + ', ' + d.region.len + ' ไบต์)', (d.virgin ? 'VIRGIN (ยังไม่จับคู่)' : 'มีการจับคู่') + ' · ' + d.region.hex.slice(0, 48) + (d.region.hex.length > 48 ? '…' : '')]);
  if (!rows.length) rows.push(['—', 'profile ยังไม่ได้ระบุ field/region — ใช้ “วิเคราะห์หลายไฟล์” เพื่อหาตำแหน่งก่อน']);
  $('#skDecoded').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join(''); $('#skDecoded').style.display = '';
  log(`ถอดรหัส ${SK2.binName}: Key ID ${d.keyId ?? '-'} · ${d.virgin === true ? 'virgin' : d.virgin === false ? 'จับคู่แล้ว' : '-'}`, 'ok');
};
$('#btnSkAnalyze').onclick = async () => {
  const r = await james.sec.skAnalyze(); if (r.cancelled) return; if (r.ok === false) { log(r.error, 'err'); return; }
  const a = r.analysis;
  const rows = a.regions.slice().sort((x, y) => y.len - x.len).slice(0, 12).map((rg) => `<tr><td>0x${rg.offset.toString(16).toUpperCase()}</td><td>${rg.len}</td><td>${rg.classGuess}</td><td class="muted">${rg.values.map((v) => v.replace(/ /g, '').slice(0, 12)).join(' / ')}</td></tr>`).join('');
  $('#skAnalysis').innerHTML = `เทียบ ${a.dumps.length} ไฟล์ (${a.dumps.join(', ')}) — ต่างกัน ${a.changedCount} ไบต์ ใน ${a.regions.length} โซน<br><table class="plans"><tr><th>offset</th><th>ไบต์</th><th>น่าจะเป็น</th><th>ค่าแต่ละไฟล์</th></tr>${rows}</table><button id="btnSkUseSuggest" class="ghost" style="margin-top:6px">สร้าง profile ร่างจากผลนี้</button>`;
  $('#btnSkUseSuggest').onclick = async () => {
    const sv = await james.sec.skProfileSave(r.suggested); if (!sv.ok) { log(sv.error, 'err'); return; }
    await skLoadProfiles(sv.profile.id); log('สร้าง profile ร่าง ' + sv.profile.id + ' — เปิด “แก้ไข” เพื่อตั้งชื่อ/ปรับ field', 'ok');
  };
  log(`วิเคราะห์ ${a.dumps.length} ไฟล์: ต่างกัน ${a.changedCount} ไบต์ ${a.regions.length} โซน`, 'ok');
};
async function skBuild(mode) {
  const r = await james.sec.skBuildFile($('#skProfile').value, mode, SK2.bin, mode === 'clone' ? SK2.donor : null);
  if (!r.ok) { log(r.error, 'err'); $('#skRenewMsg').textContent = '✘ ' + r.error; return; }
  const name = SK2.binName.replace(/\.(bin|rom|eep)$/i, '') + (mode === 'virgin' ? '_virgin' : '_cloned') + '.bin';
  const p = await james.saveBin(r.eeprom, name);
  if (p) { $('#skRenewMsg').textContent = `✔ บันทึก ${name} แล้ว — Key ID ใหม่ ${r.decode.keyId ?? '-'}${r.decode.virgin ? ' (virgin)' : ''} · เอาไปเขียนที่หน้า ECU / Flash`; log('สร้างไฟล์ ' + mode + ' แล้ว: ' + p, 'ok'); }
}
$('#btnSkBuildClone').onclick = () => skBuild('clone');
$('#btnSkBuildVirgin').onclick = async () => { if (!confirm('สร้างไฟล์ virgin (ล้างเฉพาะโซนจับคู่กุญแจ) เพื่อให้กล่องเรียนรู้คีย์ใหม่?\nของเดิมในไฟล์ต้นฉบับไม่ถูกแตะ — ได้ไฟล์ใหม่ไว้เอาไปแฟลช')) return; skBuild('virgin'); };
$('#btnSkProfEdit').onclick = async () => {
  const p = SK2.profiles.find((x) => x.id === $('#skProfile').value); if (!p) return;
  const d = $('#profDlg'), ta = $('#profText'); ta.value = JSON.stringify(p, null, 2);
  d.onclose = async () => {
    if (d.returnValue === 'ok') { let o; try { o = JSON.parse(ta.value); } catch (e) { return log('JSON ผิด: ' + e.message, 'err'); } const sv = await james.sec.skProfileSave(o); if (!sv.ok) return log(sv.error, 'err'); await skLoadProfiles(sv.profile.id); log('บันทึก profile ' + sv.profile.id, 'ok'); }
    else if (d.returnValue === 'del') { if (p.builtin) return log('ลบแม่แบบไม่ได้', 'err'); if (confirm('ลบ profile นี้?')) { await james.sec.skProfileDelete(p.id); await skLoadProfiles(); } }
  };
  d.showModal();
};
$('#btnSkProfDel').onclick = async () => { const p = SK2.profiles.find((x) => x.id === $('#skProfile').value); if (!p || p.builtin) return log('เลือก profile ของผู้ใช้ก่อน', 'err'); if (confirm('ลบ profile "' + p.label + '"?')) { await james.sec.skProfileDelete(p.id); await skLoadProfiles(); } };
