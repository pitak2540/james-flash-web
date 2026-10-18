// ===== Charts: 2D line curves, 3D surface (rotatable), diff bars — pure canvas, no deps =====
(function () {
  const C = { bg: '#0a0c10', grid: '#1c2230', axis: '#8b94a5', text: '#c0c7d0', sel: '#e5322d', blue: '#1e90ff' };
  const palette = (i, n) => `hsl(${200 + (i / Math.max(1, n)) * 150}, 85%, ${55 + (i % 2) * 8}%)`;
  const heat = (t) => { t = Math.max(0, Math.min(1, t)); const h = 230 - 230 * t; return `hsl(${h},85%,55%)`; };

  function clear(ctx, w, h) { ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h); }

  /** data: number[rows][cols]; xAxis/yAxis: labels; sel: {r,c} set; mode: 'rows'|'cols' */
  function draw2D(canvas, data, { xAxis = [], yAxis = [], selected = new Set(), unit = '', original = null } = {}) {
    const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height; clear(ctx, w, h);
    const rows = data.length, cols = rows ? data[0].length : 0; if (!cols) return;
    const L = 56, R = 16, T = 18, B = 36, pw = w - L - R, ph = h - T - B;
    let mn = Infinity, mx = -Infinity; for (const r of data) for (const v of r) { if (v < mn) mn = v; if (v > mx) mx = v; }
    if (original) for (const r of original) for (const v of r) { if (v < mn) mn = v; if (v > mx) mx = v; }
    if (mn === mx) { mn -= 1; mx += 1; } const pad = (mx - mn) * 0.08; mn -= pad; mx += pad;
    const X = (c) => L + (cols === 1 ? pw / 2 : (c / (cols - 1)) * pw), Y = (v) => T + ph - ((v - mn) / (mx - mn)) * ph;
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.fillStyle = C.text; ctx.font = '11px Consolas,monospace';
    for (let i = 0; i <= 5; i++) { const y = T + (ph * i) / 5, v = mx - ((mx - mn) * i) / 5; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke(); ctx.textAlign = 'right'; ctx.fillText(fmt(v), L - 6, y + 4); }
    const stepX = Math.ceil(cols / 16);
    for (let c = 0; c < cols; c += stepX) { const x = X(c); ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke(); ctx.textAlign = 'center'; ctx.fillText(xAxis[c] ?? c, x, h - 18); }
    if (unit) { ctx.textAlign = 'left'; ctx.fillText(unit, 4, 12); }
    const selRows = new Set([...selected].map((k) => +k.split(',')[0]));
    const drawRow = (r, arr, color, width, dash) => { ctx.setLineDash(dash || []); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); arr.forEach((v, c) => (c ? ctx.lineTo(X(c), Y(v)) : ctx.moveTo(X(c), Y(v)))); ctx.stroke(); ctx.setLineDash([]); };
    if (original) data.forEach((_, r) => (selRows.size === 0 || selRows.has(r)) && drawRow(r, original[r], 'rgba(192,199,208,.35)', 1, [4, 4]));
    data.forEach((arr, r) => { const on = selRows.size === 0 || selRows.has(r); drawRow(r, arr, on ? palette(r, rows) : 'rgba(120,130,150,.18)', on && selRows.size ? 2.5 : 1.5); });
    for (const k of selected) { const [r, c] = k.split(',').map(Number); if (!data[r]) continue; ctx.fillStyle = C.sel; ctx.beginPath(); ctx.arc(X(c), Y(data[r][c]), 4.5, 0, 7); ctx.fill(); }
    if (rows > 1) { ctx.font = '10px Consolas,monospace'; ctx.textAlign = 'left'; data.forEach((arr, r) => { if (selRows.size && !selRows.has(r)) return; ctx.fillStyle = palette(r, rows); ctx.fillText(String(yAxis[r] ?? r), X(cols - 1) + 3, Y(arr[cols - 1]) + 3); }); }
  }

  const view3 = { rx: 0.95, rz: 0.75, zoom: 1 };
  function draw3D(canvas, data, { xAxis = [], yAxis = [], selected = new Set() } = {}) {
    const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height; clear(ctx, w, h);
    const rows = data.length, cols = rows ? data[0].length : 0; if (!cols) return;
    let mn = Infinity, mx = -Infinity; for (const r of data) for (const v of r) { if (v < mn) mn = v; if (v > mx) mx = v; } if (mn === mx) mx = mn + 1;
    const sx = Math.min(w, h) * 0.55 * view3.zoom, cx = w / 2, cy = h / 2 + 20;
    const cosX = Math.cos(view3.rx), sinX = Math.sin(view3.rx), cosZ = Math.cos(view3.rz), sinZ = Math.sin(view3.rz);
    const P = (c, r, v) => { // normalize to [-0.5,0.5]
      const x = (cols === 1 ? 0 : c / (cols - 1) - 0.5), y = (rows === 1 ? 0 : r / (rows - 1) - 0.5), z = ((v - mn) / (mx - mn) - 0.5) * 0.6;
      const x1 = x * cosZ - y * sinZ, y1 = x * sinZ + y * cosZ; const y2 = y1 * cosX - z * sinX, z2 = y1 * sinX + z * cosX;
      return { x: cx + x1 * sx, y: cy + y2 * sx, d: z2 };
    };
    const quads = [];
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const p = [P(c, r, data[r][c]), P(c + 1, r, data[r][c + 1]), P(c + 1, r + 1, data[r + 1][c + 1]), P(c, r + 1, data[r + 1][c])];
      const avg = (data[r][c] + data[r][c + 1] + data[r + 1][c + 1] + data[r + 1][c]) / 4;
      quads.push({ p, t: (avg - mn) / (mx - mn), d: (p[0].d + p[1].d + p[2].d + p[3].d) / 4, r, c });
    }
    quads.sort((a, b) => a.d - b.d);
    // floor grid
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    for (let c = 0; c < cols; c++) { const a = P(c, 0, mn), b = P(c, rows - 1, mn); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    for (let r = 0; r < rows; r++) { const a = P(0, r, mn), b = P(cols - 1, r, mn); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    for (const q of quads) {
      const selQ = selected.has(`${q.r},${q.c}`) || selected.has(`${q.r + 1},${q.c}`) || selected.has(`${q.r},${q.c + 1}`) || selected.has(`${q.r + 1},${q.c + 1}`);
      ctx.beginPath(); ctx.moveTo(q.p[0].x, q.p[0].y); for (let i = 1; i < 4; i++) ctx.lineTo(q.p[i].x, q.p[i].y); ctx.closePath();
      ctx.fillStyle = heat(q.t); ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = selQ ? C.sel : 'rgba(10,12,16,.7)'; ctx.lineWidth = selQ ? 2 : 1; ctx.stroke();
    }
    if (rows === 1 || cols === 1) { // single curve as a wall
      ctx.strokeStyle = C.blue; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i < Math.max(rows, cols); i++) { const p = rows === 1 ? P(i, 0, data[0][i]) : P(0, i, data[i][0]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); } ctx.stroke();
    }
    ctx.fillStyle = C.text; ctx.font = '11px Consolas,monospace'; ctx.textAlign = 'center';
    const stepX = Math.ceil(cols / 12), stepY = Math.ceil(rows / 12);
    for (let c = 0; c < cols; c += stepX) { const p = P(c, rows - 1, mn); ctx.fillText(xAxis[c] ?? c, p.x, p.y + 14); }
    for (let r = 0; r < rows; r += stepY) { const p = P(cols - 1, r, mn); ctx.fillText(yAxis[r] ?? r, p.x + 22, p.y + 4); }
    ctx.textAlign = 'left'; ctx.fillText(`min ${fmt(mn)}  max ${fmt(mx)}`, 8, 14);
  }

  function drawDiff(canvas, data, original, { xAxis = [] } = {}) {
    const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height; clear(ctx, w, h);
    if (!original) { ctx.fillStyle = C.text; ctx.font = '13px sans-serif'; ctx.fillText('ไม่มีไฟล์เทียบ — กด "เทียบไฟล์" หรือแก้ค่าแล้วดูส่วนต่างจากต้นฉบับ', 20, 40); return; }
    const rows = data.length, cols = rows ? data[0].length : 0; if (!cols) return;
    const L = 56, R = 16, T = 18, B = 36, pw = w - L - R, ph = h - T - B;
    const cw = pw / cols, ch = ph / rows; let mx = 0;
    const d = data.map((r, i) => r.map((v, j) => { const x = v - (original[i]?.[j] ?? v); mx = Math.max(mx, Math.abs(x)); return x; }));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = d[r][c], t = mx ? x / mx : 0;
      ctx.fillStyle = t > 0 ? `rgba(229,50,45,${0.15 + 0.85 * t})` : t < 0 ? `rgba(30,144,255,${0.15 + 0.85 * -t})` : '#12161e';
      ctx.fillRect(L + c * cw, T + r * ch, cw - 1, ch - 1);
      if (cw > 30 && ch > 14 && x) { ctx.fillStyle = '#fff'; ctx.font = '10px Consolas,monospace'; ctx.textAlign = 'center'; ctx.fillText(fmt(x), L + c * cw + cw / 2, T + r * ch + ch / 2 + 3); }
    }
    ctx.fillStyle = C.text; ctx.font = '11px Consolas,monospace'; ctx.textAlign = 'center';
    const stepX = Math.ceil(cols / 16); for (let c = 0; c < cols; c += stepX) ctx.fillText(xAxis[c] ?? c, L + c * cw + cw / 2, h - 18);
    ctx.textAlign = 'left'; ctx.fillText(`แดง = เพิ่ม, น้ำเงิน = ลด, สูงสุด ±${fmt(mx)}`, 8, 12);
  }

  function fmt(v) { return Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2).replace(/\.?0+$/, ''); }

  window.Charts = { draw2D, draw3D, drawDiff, view3 };
})();
