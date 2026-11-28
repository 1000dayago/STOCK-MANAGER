/* charts.js - 의존성 없는 간단 캔버스 차트 */
(function (root) {
  'use strict';
  const SM = (root.SM = root.SM || {});

  function theme() {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue(n).trim();
    return { text: g('--muted'), grid: g('--line'), up: g('--up'), down: g('--down'), fg: g('--fg'), accent: g('--accent'), bg: g('--card') };
  }
  function setup(canvas, h) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || canvas.parentElement.clientWidth || 300;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }
  const fmt = (v) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('ko-KR') : (+v.toFixed(2)).toString());
  function niceRange(min, max) {
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.05;
    return [min - pad, max + pad];
  }

  /* 막대 차트 (손익) */
  function drawBars(canvas, labels, values, h = 220) {
    const T = theme();
    const { ctx, w } = setup(canvas, h);
    const L = 56, R = 8, Tp = 10, B = 28;
    if (!values.length) { ctx.fillStyle = T.text; ctx.font = '13px sans-serif'; ctx.fillText('표시할 데이터가 없습니다', 12, 30); return; }
    let mn = Math.min(0, ...values), mx = Math.max(0, ...values);
    if (mn === mx) mx = mn + 1;
    const y = (v) => Tp + ((mx - v) / (mx - mn)) * (h - Tp - B);
    ctx.font = '11px sans-serif'; ctx.strokeStyle = T.grid; ctx.fillStyle = T.text; ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
      const v = mn + ((mx - mn) * k) / 4, yy = y(v);
      ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(w - R, yy); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText(fmt(v), L - 4, yy + 4);
    }
    const bw = (w - L - R) / values.length;
    values.forEach((v, i) => {
      const x = L + i * bw + bw * 0.15, ww = bw * 0.7;
      ctx.fillStyle = v >= 0 ? T.up : T.down;
      ctx.fillRect(x, Math.min(y(v), y(0)), ww, Math.max(1, Math.abs(y(v) - y(0))));
      if (values.length <= 14 || i % Math.ceil(values.length / 10) === 0) {
        ctx.fillStyle = T.text; ctx.textAlign = 'center';
        ctx.fillText(String(labels[i]).slice(-7), x + ww / 2, h - 10);
      }
    });
  }

  /* 선 차트 (자산 곡선) */
  function drawLine(canvas, xs, ys, h = 160, opt = {}) {
    const T = theme();
    const { ctx, w } = setup(canvas, h);
    const L = 56, R = 8, Tp = 8, B = 22;
    if (!ys.length) return;
    let [mn, mx] = niceRange(Math.min(0, ...ys), Math.max(0, ...ys));
    const x = (i) => L + (i / Math.max(1, ys.length - 1)) * (w - L - R);
    const y = (v) => Tp + ((mx - v) / (mx - mn)) * (h - Tp - B);
    ctx.font = '11px sans-serif'; ctx.strokeStyle = T.grid; ctx.fillStyle = T.text; ctx.lineWidth = 1;
    for (let k = 0; k <= 3; k++) {
      const v = mn + ((mx - mn) * k) / 3, yy = y(v);
      ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(w - R, yy); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText(fmt(v), L - 4, yy + 4);
    }
    ctx.strokeStyle = T.text; ctx.beginPath(); ctx.moveTo(L, y(0)); ctx.lineTo(w - R, y(0)); ctx.stroke();
    ctx.strokeStyle = T.accent; ctx.lineWidth = 1.6; ctx.beginPath();
    ys.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.stroke();
    ctx.fillStyle = T.text; ctx.textAlign = 'left'; ctx.fillText(xs[0], L, h - 6);
    ctx.textAlign = 'right'; ctx.fillText(xs[xs.length - 1], w - R, h - 6);
    if (opt.mark != null && opt.mark >= 0 && opt.mark < ys.length) { // 고른 위치: 세로선 + 점 + 날짜
      const mx = x(opt.mark), my = y(ys[opt.mark]);
      ctx.strokeStyle = T.accent; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(mx, Tp); ctx.lineTo(mx, h - B); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = T.accent; ctx.beginPath(); ctx.arc(mx, my, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = T.text; ctx.textAlign = mx > w / 2 ? 'right' : 'left'; ctx.fillText(`${xs[opt.mark]} · ${fmt(ys[opt.mark])}`, mx > w / 2 ? mx - 6 : mx + 6, Tp + 10);
    }
  }
  // 캔버스의 x 좌표(가로 위치)가 몇 번째 점인지(drawLine과 같은 여백 기준)
  function lineIndexAt(canvas, clientX, count) { const r = canvas.getBoundingClientRect(), L = 56, R = 8, w = r.width; return Math.max(0, Math.min(count - 1, Math.round(((clientX - r.left - L) / Math.max(1, w - L - R)) * Math.max(1, count - 1)))); }

  /* 캔들 차트 + 오버레이 + 매수/매도 마커 */
  function drawCandles(canvas, data, opt) {
    const T = theme();
    const a = opt.from, b = opt.to; // 인덱스 범위
    const n = b - a + 1;
    const volH = data.hasVol ? 54 : 0;
    const h = opt.height || 340;
    const { ctx, w } = setup(canvas, h);
    const L = 58, R = 8, Tp = 8, B = 20;
    const priceH = h - Tp - B - volH - (volH ? 8 : 0);
    let mn = Infinity, mx = -Infinity;
    const lines = opt.lines || [];
    for (let i = a; i <= b; i++) {
      mn = Math.min(mn, data.l[i]); mx = Math.max(mx, data.h[i]);
      for (const ln of lines) if (ln.arr[i] != null) { mn = Math.min(mn, ln.arr[i]); mx = Math.max(mx, ln.arr[i]); }
    }
    [mn, mx] = niceRange(mn, mx);
    const bw = (w - L - R) / n;
    const x = (i) => L + (i - a + 0.5) * bw;
    const y = (v) => Tp + ((mx - v) / (mx - mn)) * priceH;
    ctx.font = '11px sans-serif'; ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
      const v = mn + ((mx - mn) * k) / 4, yy = y(v);
      ctx.strokeStyle = T.grid; ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(w - R, yy); ctx.stroke();
      ctx.fillStyle = T.text; ctx.textAlign = 'right'; ctx.fillText(fmt(v), L - 4, yy + 4);
    }
    const cw = Math.max(1, Math.min(10, bw * 0.7));
    for (let i = a; i <= b; i++) {
      const up = data.c[i] >= data.o[i];
      ctx.strokeStyle = ctx.fillStyle = up ? T.up : T.down;
      ctx.beginPath(); ctx.moveTo(x(i), y(data.h[i])); ctx.lineTo(x(i), y(data.l[i])); ctx.stroke();
      const yo = y(data.o[i]), yc = y(data.c[i]);
      ctx.fillRect(x(i) - cw / 2, Math.min(yo, yc), cw, Math.max(1, Math.abs(yo - yc)));
    }
    for (const ln of lines) {
      ctx.strokeStyle = ln.color; ctx.lineWidth = ln.w || 1.2; ctx.setLineDash(ln.dash || []);
      ctx.beginPath(); let started = false;
      for (let i = a; i <= b; i++) {
        if (ln.arr[i] == null) continue;
        if (!started) { ctx.moveTo(x(i), y(ln.arr[i])); started = true; } else ctx.lineTo(x(i), y(ln.arr[i]));
      }
      ctx.stroke(); ctx.setLineDash([]);
    }
    // 거래량
    if (volH) {
      let vm = 0; for (let i = a; i <= b; i++) vm = Math.max(vm, data.v[i]);
      const vy0 = Tp + priceH + 8;
      for (let i = a; i <= b; i++) {
        const hh = vm ? (data.v[i] / vm) * volH : 0;
        ctx.fillStyle = data.c[i] >= data.o[i] ? T.up : T.down; ctx.globalAlpha = 0.45;
        ctx.fillRect(x(i) - cw / 2, vy0 + volH - hh, cw, hh);
      }
      ctx.globalAlpha = 1;
      if (opt.volLine) {
        const yy = vy0 + volH - (opt.volLine / vm) * volH;
        if (yy >= vy0) { ctx.strokeStyle = T.accent; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(w - R, yy); ctx.stroke(); ctx.setLineDash([]); }
      }
      ctx.fillStyle = T.text; ctx.textAlign = 'right'; ctx.fillText('거래량', L - 4, vy0 + 10);
    }
    // 마커
    const mark = (list, color, up) => {
      ctx.fillStyle = color;
      for (const m of list) {
        if (m.i < a || m.i > b) continue;
        const px = x(m.i), py = y(m.price);
        ctx.beginPath();
        if (up) { ctx.moveTo(px, py + 2); ctx.lineTo(px - 5, py + 11); ctx.lineTo(px + 5, py + 11); }
        else { ctx.moveTo(px, py - 2); ctx.lineTo(px - 5, py - 11); ctx.lineTo(px + 5, py - 11); }
        ctx.closePath(); ctx.fill();
      }
    };
    mark(opt.buys || [], '#16a34a', true);
    mark(opt.sells || [], '#f59e0b', false);
    ctx.fillStyle = T.text; ctx.textAlign = 'left'; ctx.fillText(data.d[a], L, h - 5);
    ctx.textAlign = 'right'; ctx.fillText(data.d[b], w - R, h - 5);
    // 범례
    let lx = L + 4; ctx.textAlign = 'left';
    for (const ln of lines) { if (!ln.name) continue; ctx.fillStyle = ln.color; ctx.fillText('— ' + ln.name, lx, Tp + 10); lx += ctx.measureText('— ' + ln.name).width + 10; }
    const tri = (x, y, up, color) => { ctx.fillStyle = color; ctx.beginPath(); if (up) { ctx.moveTo(x, y - 8); ctx.lineTo(x - 4, y); ctx.lineTo(x + 4, y); } else { ctx.moveTo(x, y); ctx.lineTo(x - 4, y - 8); ctx.lineTo(x + 4, y - 8); } ctx.closePath(); ctx.fill(); };
    tri(lx + 4, Tp + 10, true, '#16a34a'); ctx.fillStyle = T.text; ctx.fillText('매수', lx + 12, Tp + 10); lx += 46;
    tri(lx + 4, Tp + 10, false, '#f59e0b'); ctx.fillStyle = T.text; ctx.fillText('매도', lx + 12, Tp + 10);
    // 툴팁
    canvas.onpointermove = (e) => {
      const r = canvas.getBoundingClientRect();
      const i = Math.min(b, Math.max(a, Math.floor(((e.clientX - r.left - L) / bw)) + a));
      const el = opt.tip;
      if (el) el.textContent = `${data.d[i]}  시 ${fmt(data.o[i])}  고 ${fmt(data.h[i])}  저 ${fmt(data.l[i])}  종 ${fmt(data.c[i])}  거래량 ${fmt(data.v[i])}`;
    };
  }

  /* 렌코 차트 */
  function drawRenko(canvas, renko, markers, h = 240) {
    const T = theme();
    const { ctx, w } = setup(canvas, h);
    const L = 58, R = 8, Tp = 8, B = 18;
    const bricks = renko.bricks;
    if (!bricks.length) { ctx.fillStyle = T.text; ctx.font = '13px sans-serif'; ctx.fillText('벽돌이 없습니다 (벽돌 크기를 줄여보세요)', 12, 30); return; }
    let mn = Infinity, mx = -Infinity;
    for (const b of bricks) { mn = Math.min(mn, b.o, b.c); mx = Math.max(mx, b.o, b.c); }
    [mn, mx] = niceRange(mn, mx);
    const bw = Math.min(24, (w - L - R) / bricks.length);
    const y = (v) => Tp + ((mx - v) / (mx - mn)) * (h - Tp - B);
    ctx.font = '11px sans-serif'; ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
      const v = mn + ((mx - mn) * k) / 4, yy = y(v);
      ctx.strokeStyle = T.grid; ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(w - R, yy); ctx.stroke();
      ctx.fillStyle = T.text; ctx.textAlign = 'right'; ctx.fillText(fmt(v), L - 4, yy + 4);
    }
    const first = Math.max(0, bricks.length - Math.floor((w - L - R) / bw));
    bricks.forEach((b, k) => {
      if (k < first) return;
      const x = L + (k - first) * bw;
      ctx.fillStyle = b.dir > 0 ? T.up : T.down;
      ctx.fillRect(x + 1, Math.min(y(b.o), y(b.c)), bw - 2, Math.abs(y(b.o) - y(b.c)));
    });
    ctx.fillStyle = T.text; ctx.textAlign = 'left';
    ctx.fillText(`벽돌 ${bricks.length}개 · 크기 ${fmt(renko.size)}` + (first ? ' (최근만 표시)' : ''), L + 4, h - 4);
  }

  Object.assign(SM, { drawBars, lineIndexAt, drawLine, drawCandles, drawRenko });
})(typeof globalThis !== 'undefined' ? globalThis : this);
