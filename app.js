'use strict';

/* =====================================================================
   الإعدادات
   ===================================================================== */
const CONFIG = {
  maxPhotos: 10,
  jpegQuality: 0.92,
  thumbWidth: 770,
  telegram: {
    botToken: '8320697814:AAGq5UTVDyzTWnL1FmiKHomrgKst7ddVsFM',
    chatId: '-1003557221315',     // قسم الإنتاج: الصور بالحجم الكامل
    thumbChatId: '-5300103442',   // النسخ المصغرة بعرض 770
  },
};

// قوالب الصور العادية
const FORMATS = {
  landscape: { w: 1500, h: 1000, overlay: 'templates/landscape.png', label: 'أفقي' },
  portrait:  { w: 1080, h: 1440, overlay: 'templates/portrait.png',  label: 'طولي' },
};

// قياس الغلاف
const COVER_FORMATS = {
  landscape: { w: 1920, h: 1080 },
  portrait:  { w: 1080, h: 1440 },
};

// قياس النسخة المصغرة (تُصغَّر لاحقًا إلى عرض 770 عند الإرسال لتلغرام):
// الأفقي كما هو، والطولي بطول إنستغرام الكامل 9:16
const THUMB_FORMATS = {
  landscape: { w: 1500, h: 1000, asset: 'landscape' },
  portrait:  { w: 1080, h: 1920, asset: 'portrait916', overlay: 'templates/portrait-916.png' },
};
const THUMB_COVER_FORMATS = {
  landscape: { w: 1920, h: 1080 },
  portrait:  { w: 1080, h: 1920 },
};

const SAMPLE_TITLE = {
  kicker: 'انطلاق فعاليات',
  main: 'المؤتمر العلمي الدولي الثالث والعشرين',
  sub: 'لنقابة أطباء الأسنان (SIDC 2026) بدمشق.',
};

const PREVIEW_MAX_SIDE = 1800;   // دقة نسخة المعاينة (التصدير دائمًا من الأصل)
const PORTRAIT_RATIO = 1.06;     // أقل من هيك العرض/الارتفاع ← قالب طولي

/* =====================================================================
   الحالة
   ===================================================================== */
const state = {
  items: [],
  globalOrient: 'auto',
  coverId: null,
  title: { kicker: '', main: '', sub: '' },
  style: storageGet('mohe_style', 'classic'),
  textScale: parseFloat(storageGet('mohe_text_scale', '1')) || 1,
  textPos: {},          // إزاحة العنوان لكل (اتجاه:شكل) بوحدات الغلاف: { 'portrait:card': {x, y} }
  editText: false,      // وضع تحريك النص بالماوس
  coverRender: null,    // آخر رسم لمعاينة الغلاف (حدود النص والإزاحة الفعلية)
  busy: false,
};
const ASSETS = {};
let assetsReady = null;
let uid = 0;

/* =====================================================================
   أدوات عامة
   ===================================================================== */
const $ = (sel) => document.querySelector(sel);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad2 = (n) => String(n).padStart(2, '0');

function storageGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch { return fallback; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* التخزين غير متاح */ }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image_load_error'));
    img.src = src;
  });
}

function canvasToBlob(canvas, quality = CONFIG.jpegQuality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('تعذّر تصدير الصورة'))), 'image/jpeg', quality);
  });
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

let toastTimer;
function toast(message, kind = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = 'toast' + (kind ? ` is-${kind}` : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'error' ? 6000 : 3500);
}

const ICONS = {
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor"/></svg>',
  reset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  grip: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></g></svg>',
  chevRight: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevLeft: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

/* =====================================================================
   القص والتموضع
   crop = { zoom, cx, cy } ← (cx, cy) نقطة من الصورة (0..1) تقع في منتصف الإطار
   ===================================================================== */
function newCrop() { return { zoom: 1, cx: 0.5, cy: 0.5 }; }

function photoLayout(iw, ih, W, H, crop) {
  const s = Math.max(W / iw, H / ih) * crop.zoom;
  const dw = iw * s;
  const dh = ih * s;
  let x = W / 2 - crop.cx * dw;
  let y = H / 2 - crop.cy * dh;
  x = dw >= W ? clamp(x, W - dw, 0) : (W - dw) / 2;
  y = dh >= H ? clamp(y, H - dh, 0) : (H - dh) / 2;
  return { x, y, dw, dh };
}

function normalizeCrop(item, crop, W, H) {
  const L = photoLayout(item.iw, item.ih, W, H, crop);
  crop.cx = (W / 2 - L.x) / L.dw;
  crop.cy = (H / 2 - L.y) / L.dh;
}

function drawPhoto(ctx, item, W, H, crop, s, src) {
  const L = photoLayout(item.iw, item.ih, W, H, crop);
  if (L.dw < W - 0.5 || L.dh < H - 0.5) {
    // الصورة أصغر من الإطار: خلفية ضبابية من نفس الصورة
    const base = Math.max(W / item.iw, H / item.ih);
    const bw = item.iw * base;
    const bh = item.ih * base;
    const over = 60;
    ctx.save();
    ctx.filter = `blur(${Math.max(1, Math.round(40 * s))}px)`;
    ctx.drawImage(src, (W - bw) / 2 - over, (H - bh) / 2 - over, bw + over * 2, bh + over * 2);
    ctx.restore();
    ctx.fillStyle = 'rgba(6, 48, 42, 0.35)';
    ctx.fillRect(0, 0, W, H);
  }
  ctx.drawImage(src, L.x, L.y, L.dw, L.dh);
}

function effectiveOrient(item) {
  if (item.orient !== 'auto') return item.orient;
  if (state.globalOrient !== 'auto') return state.globalOrient;
  return item.iw / item.ih < PORTRAIT_RATIO ? 'portrait' : 'landscape';
}

/* =====================================================================
   رسم الصورة العادية (صورة + قالب)
   ===================================================================== */
function renderRegular(ctx, item, orient, s, src, thumb = false) {
  const F = thumb ? THUMB_FORMATS[orient] : FORMATS[orient];
  const overlay = ASSETS[thumb ? F.asset : orient];
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.clearRect(0, 0, F.w, F.h);
  drawPhoto(ctx, item, F.w, F.h, item.crop[orient], s, src);
  ctx.drawImage(overlay, 0, 0, F.w, F.h);
}

/* =====================================================================
   أدوات النص
   ===================================================================== */
const FONT_FAMILY = 'Qomra, Tahoma, Arial, sans-serif';
const DEEP = '6, 48, 42';
const TEXT_SHIFT = 0.04; // تصحيح بسيط لتوسيط الحروف العربية عموديًا

function fontStr(weight, size) { return `${weight} ${size}px ${FONT_FAMILY}`; }
function rgba(rgb, a) { return `rgba(${rgb}, ${a})`; }

function wrapText(ctx, text, maxW) {
  const out = [];
  for (const para of text.split('\n')) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(test).width > maxW) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

// توزيع متوازن للأسطر: أقصر عرض يعطي نفس عدد الأسطر
function balanceLines(ctx, text, maxW, count) {
  let lo = maxW * 0.35;
  let hi = maxW;
  let best = wrapText(ctx, text, maxW);
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const lines = wrapText(ctx, text, mid);
    if (lines.length <= count) { best = lines; hi = mid; } else { lo = mid; }
  }
  return best;
}

// يصغّر الخط حتى يدخل النص بعدد الأسطر المسموح؛ النص الطويل يأخذ أسطرًا إضافية (extra) قبل ما يصغر كثير
function fitText(ctx, text, weight, size, maxW, maxLines, extra = 0) {
  const attempt = (limit, minSize) => {
    let s = size;
    for (;;) {
      ctx.font = fontStr(weight, s);
      const lines = wrapText(ctx, text, maxW);
      const widest = Math.max(0, ...lines.map((l) => ctx.measureText(l).width));
      if (lines.length <= limit && widest <= maxW + 0.5) return { lines, size: s };
      if (s <= minSize) return null;
      s = Math.max(minSize, s * 0.95);
    }
  };
  let r = null;
  for (let add = 0; add <= extra && !r; add++) r = attempt(maxLines + add, size * 0.72);
  if (!r) r = attempt(maxLines + extra, size * 0.4);
  if (!r) {
    ctx.font = fontStr(weight, size * 0.4);
    r = { lines: wrapText(ctx, text, maxW), size: size * 0.4 };
  }
  ctx.font = fontStr(weight, r.size);
  let { lines } = r;
  if (lines.length > 1 && !text.includes('\n')) lines = balanceLines(ctx, text, maxW, lines.length);
  return { lines, size: r.size, widths: lines.map((l) => ctx.measureText(l).width) };
}

// يجهّز الأسطر الثلاثة حسب مواصفات كل شكل
function prepareText(ctx, title, spec, k) {
  const out = {};
  for (const key of ['kicker', 'main', 'sub']) {
    const text = (title[key] || '').trim();
    const sp = spec[key];
    if (!text || !sp) { out[key] = null; continue; }
    const extra = sp.extra !== undefined ? sp.extra : { kicker: 0, main: 2, sub: 1 }[key];
    const r = fitText(ctx, text, sp.weight, sp.size * k, sp.maxW, sp.maxLines || 2, extra);
    const lineH = r.size * (sp.lh || 1.3);
    out[key] = { ...sp, text, lines: r.lines, widths: r.widths, size: r.size, lineH, height: r.lines.length * lineH };
    out[key].widest = Math.max(...r.widths);
  }
  return out;
}

/* سياق رسم الغلاف الحالي: إزاحة كتلة العنوان وحدودها (قبل الإزاحة) */
let CUR = null;

function trackBounds(x0, y0, x1, y1) {
  if (!CUR) return;
  const ax0 = Math.min(x0, x1);
  const ax1 = Math.max(x0, x1);
  const ay0 = Math.min(y0, y1);
  const ay1 = Math.max(y0, y1);
  const b = CUR.bounds;
  if (!b) { CUR.bounds = { x0: ax0, y0: ay0, x1: ax1, y1: ay1 }; return; }
  b.x0 = Math.min(b.x0, ax0);
  b.y0 = Math.min(b.y0, ay0);
  b.x1 = Math.max(b.x1, ax1);
  b.y1 = Math.max(b.y1, ay1);
}

// يرسم كل ما بداخله مُزاحًا بإزاحة النص (مرة واحدة فقط حتى لو تداخل الاستدعاء)
function withTextShift(fn) {
  const c = CUR;
  if (!c || c.shifted) { fn(); return; }
  c.shifted = true;
  c.ctx.save();
  c.ctx.translate(c.dx, c.dy);
  try { fn(); } finally { c.ctx.restore(); c.shifted = false; }
}

// المجال المسموح لإزاحة الكتلة بحيث تبقى داخل الغلاف (والصفر مسموح دائمًا)
function textRange(b, W, H, margin = 24) {
  const axis = (lo, hi) => {
    if (lo > hi) { lo = (lo + hi) / 2; hi = lo; }
    return [Math.min(lo, 0), Math.max(hi, 0)];
  };
  return { x: axis(margin - b.x0, W - margin - b.x1), y: axis(margin - b.y0, H - margin - b.y1) };
}
function fitTextOffset(off, b, W, H) {
  if (!b || (!off.x && !off.y)) return off;
  const r = textRange(b, W, H);
  return { x: clamp(off.x, r.x[0], r.x[1]), y: clamp(off.y, r.y[0], r.y[1]) };
}
function textPosKey(orient, styleId) { return `${orient}:${styleId}`; }
function getTextOffset(orient, styleId) {
  return state.textPos[textPosKey(orient, styleId)] || { x: 0, y: 0 };
}

function drawLines(ctx, part, x, top, align, fill) {
  ctx.font = fontStr(part.weight, part.size);
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  part.lines.forEach((line, i) => {
    const cy = top + part.lineH * (i + 0.5) + part.size * TEXT_SHIFT;
    ctx.fillStyle = typeof fill === 'function' ? fill(cy - part.size * 0.6, cy + part.size * 0.45) : fill;
    ctx.fillText(line, x, cy);
    const w = part.widths[i];
    const [x0, x1] = align === 'right' ? [x - w, x] : align === 'center' ? [x - w / 2, x + w / 2] : [x, x + w];
    trackBounds(x0, top + part.lineH * i, x1, top + part.lineH * (i + 1));
  });
}

// عناصر فوق بعض مع مسافات
function stackHeight(els) {
  return els.reduce((sum, el, i) => sum + el.h + (i < els.length - 1 ? el.gap : 0), 0);
}
function runStack(els, top) {
  withTextShift(() => {
    let y = top;
    els.forEach((el, i) => {
      el.draw(y);
      y += el.h + (i < els.length - 1 ? el.gap : 0);
    });
  });
}

function goldV(ctx, y0, y1) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, '#eadcb3');
  g.addColorStop(1, '#b39a63');
  return g;
}
function goldH(ctx, x0, x1) {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, '#b39a63');
  g.addColorStop(0.5, '#e3d4a8');
  g.addColorStop(1, '#b8a678');
  return g;
}

function shadowOn(env, blur, alpha = 0.35, offsetY = 0) {
  env.ctx.shadowColor = `rgba(0, 0, 0, ${alpha})`;
  env.ctx.shadowBlur = blur * env.s;
  env.ctx.shadowOffsetY = offsetY * env.s;
}
function shadowOff(env) {
  env.ctx.shadowColor = 'transparent';
  env.ctx.shadowBlur = 0;
  env.ctx.shadowOffsetY = 0;
}

function fillLinear(ctx, x0, y0, x1, y1, stops, W, H) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// ظل أخضر خفيف أعلى اليمين ليبين الشعار
function topShade(env, strength = 0.65) {
  const { ctx, W, H, L } = env;
  const r = L ? 950 : 820;
  const g = ctx.createRadialGradient(W, 0, 0, W, 0, r);
  g.addColorStop(0, rgba(DEEP, strength));
  g.addColorStop(0.5, rgba(DEEP, strength * 0.45));
  g.addColorStop(1, rgba(DEEP, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function logoBox(env) {
  const img = ASSETS.logoWhite;
  const w = env.L ? 290 : 250;
  const h = (w * img.height) / img.width;
  return { x: env.W - (env.L ? 66 : 56) - w, y: env.L ? 66 : 56, w, h };
}
function drawLogo(env) {
  const b = logoBox(env);
  env.ctx.drawImage(ASSETS.logoWhite, b.x, b.y, b.w, b.h);
  return b;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

// صناديق خلف كل سطر (لشكل الإبراز والشريط)
function drawBoxedLines(env, part, xRight, top, boxFill, textFill, padX, boxH, gap) {
  const { ctx } = env;
  ctx.font = fontStr(part.weight, part.size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  part.lines.forEach((line, i) => {
    const w = part.widths[i] + padX * 2;
    const y = top + i * (boxH + gap);
    ctx.fillStyle = typeof boxFill === 'function' ? boxFill(xRight - w, xRight) : boxFill;
    ctx.fillRect(xRight - w, y, w, boxH);
    trackBounds(xRight - w, y, xRight, y + boxH);
    ctx.fillStyle = textFill;
    ctx.fillText(line, xRight - w / 2, y + boxH / 2 + part.size * TEXT_SHIFT);
  });
}
function boxedHeight(part, boxH, gap) {
  return part.lines.length * boxH + (part.lines.length - 1) * gap;
}

/* =====================================================================
   أشكال العنوان
   ===================================================================== */

// ١) كلاسيكي — مثل التصميم المرفق
function styleClassic(env) {
  const { ctx, W, H, L } = env;
  if (L) {
    fillLinear(ctx, W, 0, 0, 0, [[0, rgba(DEEP, 0.94)], [0.3, rgba(DEEP, 0.86)], [0.6, rgba(DEEP, 0.4)], [0.85, rgba(DEEP, 0)]], W, H);
    fillLinear(ctx, 0, H, 0, H * 0.5, [[0, rgba(DEEP, 0.6)], [1, rgba(DEEP, 0)]], W, H);
  } else {
    fillLinear(ctx, 0, H, 0, H * 0.3, [[0, rgba(DEEP, 0.96)], [0.45, rgba(DEEP, 0.8)], [1, rgba(DEEP, 0)]], W, H);
    topShade(env, 0.6);
  }
  const logo = drawLogo(env);
  const maxW = L ? 1300 : 930;
  const t = env.text({
    kicker: { weight: 400, size: L ? 64 : 58, maxW, maxLines: 1, lh: 1.3 },
    main:   { weight: 700, size: L ? 80 : 76, maxW, maxLines: L ? 2 : 3, lh: 1.35 },
    sub:    { weight: 400, size: L ? 46 : 42, maxW, maxLines: 2, lh: 1.45 },
  });
  const x = W - (L ? 120 : 76);
  const els = [];
  if (t.kicker) els.push({ h: t.kicker.height, gap: 6, draw: (y) => drawLines(ctx, t.kicker, x, y, 'right', '#fff') });
  if (t.main) els.push({ h: t.main.height, gap: 24, draw: (y) => drawLines(ctx, t.main, x, y, 'right', (a, b) => goldV(ctx, a, b)) });
  if (t.sub) els.push({ h: t.sub.height, gap: 0, draw: (y) => drawLines(ctx, t.sub, x, y, 'right', '#fff') });
  const total = stackHeight(els);
  const top = L ? H * 0.655 - total / 2 : H - 118 - total;
  shadowOn(env, 26, 0.3);
  runStack(els, clamp(top, logo.y + logo.h + 50, H - 60 - total));
  shadowOff(env);
}

// ٢) شريط سفلي — وسم ذهبي وعنوان عريض
function styleBand(env) {
  const { ctx, W, H, L } = env;
  topShade(env, 0.65);
  fillLinear(ctx, 0, H, 0, H * (L ? 0.36 : 0.32), [[0, rgba(DEEP, 0.97)], [0.45, rgba(DEEP, 0.82)], [1, rgba(DEEP, 0)]], W, H);
  drawLogo(env);
  const mx = L ? 110 : 64;
  const x = W - mx;
  const maxW = L ? 1480 : W - mx * 2;
  const lineW = L ? 90 : 64;
  const lineGap = L ? 26 : 20;
  const t = env.text({
    kicker: { weight: 700, size: L ? 44 : 38, maxW: maxW * 0.8, maxLines: 1, lh: 1 },
    main:   { weight: 900, size: L ? 104 : 84, maxW, maxLines: L ? 2 : 3, lh: 1.24 },
    sub:    { weight: 400, size: L ? 48 : 40, maxW: maxW - lineW - lineGap, maxLines: 2, lh: 1.4 },
  });
  const els = [];
  if (t.kicker) {
    const bh = t.kicker.size * 1.75;
    els.push({ h: bh, gap: L ? 26 : 22, draw: (y) => {
      const bw = t.kicker.widths[0] + t.kicker.size * 1.4;
      ctx.fillStyle = goldH(ctx, x - bw, x);
      roundRect(ctx, x - bw, y, bw, bh, 6);
      ctx.fill();
      trackBounds(x - bw, y, x, y + bh);
      ctx.font = fontStr(t.kicker.weight, t.kicker.size);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#073a32';
      ctx.fillText(t.kicker.lines[0], x - bw / 2, y + bh / 2 + t.kicker.size * TEXT_SHIFT);
    } });
  }
  if (t.main) els.push({ h: t.main.height, gap: L ? 14 : 12, draw: (y) => {
    shadowOn(env, 24, 0.35);
    drawLines(ctx, t.main, x, y, 'right', '#fff');
    shadowOff(env);
  } });
  if (t.sub) els.push({ h: t.sub.height, gap: 0, draw: (y) => {
    ctx.fillStyle = goldH(ctx, x - lineW, x);
    ctx.fillRect(x - lineW, y + t.sub.lineH / 2 - 3, lineW, 6);
    trackBounds(x - lineW, y, x, y + t.sub.lineH);
    drawLines(ctx, t.sub, x - lineW - lineGap, y, 'right', '#eadfbf');
  } });
  runStack(els, H - (L ? 96 : 100) - stackHeight(els));
}

// ٣) بطاقة — صندوق زجاجي مع شريط ذهبي
function styleCard(env) {
  const { ctx, W, H, L } = env;
  topShade(env, 0.6);
  fillLinear(ctx, 0, H, 0, H * 0.5, [[0, 'rgba(0, 0, 0, 0.35)'], [1, 'rgba(0, 0, 0, 0)']], W, H);
  drawLogo(env);
  const padX = L ? 60 : 46;
  const padY = L ? 50 : 42;
  const bar = L ? 10 : 8;
  const margin = L ? 96 : 56;
  const maxInner = L ? 1040 : W - margin * 2 - padX * 2 - bar;
  const t = env.text({
    kicker: { weight: 500, size: L ? 46 : 40, maxW: maxInner, maxLines: 1, lh: 1.3 },
    main:   { weight: 700, size: L ? 82 : 72, maxW: maxInner, maxLines: 3, lh: 1.3 },
    sub:    { weight: 300, size: L ? 44 : 38, maxW: maxInner, maxLines: 2, lh: 1.45 },
  });
  const parts = [t.kicker, t.main, t.sub].filter(Boolean);
  const inner = L ? Math.max(560, ...parts.map((p) => p.widest)) : maxInner;
  const els = [];
  const cRight = W - margin;
  const x = cRight - bar - padX;
  if (t.kicker) els.push({ h: t.kicker.height, gap: 8, draw: (y) => drawLines(ctx, t.kicker, x, y, 'right', '#dccb9c') });
  if (t.main) els.push({ h: t.main.height, gap: 16, draw: (y) => drawLines(ctx, t.main, x, y, 'right', '#fff') });
  if (t.sub) els.push({ h: t.sub.height, gap: 0, draw: (y) => drawLines(ctx, t.sub, x, y, 'right', 'rgba(255,255,255,0.88)') });
  const total = stackHeight(els);
  const cw = inner + padX * 2 + bar;
  const ch = total + padY * 2;
  const cBottom = H - (L ? 100 : 100);
  const cTop = cBottom - ch;
  const cLeft = cRight - cw;

  withTextShift(() => {
    // زجاج: نفس الصورة مضببة داخل البطاقة (تُرسم في مكانها الأصلي لا مع إزاحة البطاقة)
    ctx.save();
    ctx.beginPath();
    ctx.rect(cLeft, cTop, cw, ch);
    ctx.clip();
    if (CUR) ctx.translate(-CUR.dx, -CUR.dy);
    ctx.filter = `blur(${Math.max(1, Math.round(26 * env.s))}px)`;
    env.photo();
    ctx.restore();
    shadowOn(env, 40, 0.3, 10);
    ctx.fillStyle = rgba(DEEP, 0.8);
    ctx.fillRect(cLeft, cTop, cw, ch);
    shadowOff(env);
    ctx.strokeStyle = 'rgba(234, 220, 178, 0.22)';
    ctx.lineWidth = 2;
    ctx.strokeRect(cLeft + 1, cTop + 1, cw - 2, ch - 2);
    ctx.fillStyle = goldV(ctx, cTop, cBottom);
    ctx.fillRect(cRight - bar, cTop, bar, ch);
    trackBounds(cLeft, cTop, cRight, cBottom);

    runStack(els, cTop + padY);
  });
}

// ٤) وسط — عنوان في المنتصف مع زخرفة ذهبية
function styleCenter(env) {
  const { ctx, W, H, L } = env;
  ctx.fillStyle = 'rgba(4, 30, 26, 0.15)';
  ctx.fillRect(0, 0, W, H);
  fillLinear(ctx, 0, H, 0, H * 0.28, [[0, rgba(DEEP, 0.96)], [0.5, rgba(DEEP, 0.72)], [1, rgba(DEEP, 0)]], W, H);
  topShade(env, 0.5);
  drawLogo(env);
  const cx = W / 2;
  const maxW = L ? 1500 : 940;
  const t = env.text({
    kicker: { weight: 500, size: L ? 50 : 42, maxW: maxW * 0.7, maxLines: 1, lh: 1.4 },
    main:   { weight: 900, size: L ? 100 : 84, maxW, maxLines: L ? 2 : 3, lh: 1.25 },
    sub:    { weight: 400, size: L ? 48 : 40, maxW, maxLines: 2, lh: 1.45 },
  });
  const els = [];
  if (t.kicker) els.push({ h: t.kicker.height, gap: L ? 14 : 12, draw: (y) => {
    drawLines(ctx, t.kicker, cx, y, 'center', (a, b) => goldV(ctx, a, b));
    const mid = y + t.kicker.lineH / 2;
    const half = t.kicker.widths[0] / 2;
    const len = L ? 120 : 80;
    const d = L ? 10 : 8;
    ctx.fillStyle = goldH(ctx, cx - half - 200, cx + half + 200);
    for (const side of [-1, 1]) {
      const inner = cx + side * (half + (L ? 30 : 24));
      ctx.fillRect(Math.min(inner + side * d * 1.6, inner + side * (d * 1.6 + len)), mid - 1.5, len, 3);
      trackBounds(inner - d, mid - d, inner + side * (d * 1.6 + len), mid + d);
      ctx.beginPath();
      ctx.moveTo(inner, mid - d);
      ctx.lineTo(inner + d, mid);
      ctx.lineTo(inner, mid + d);
      ctx.lineTo(inner - d, mid);
      ctx.closePath();
      ctx.fill();
    }
  } });
  if (t.main) els.push({ h: t.main.height, gap: L ? 18 : 14, draw: (y) => {
    shadowOn(env, 30, 0.35);
    drawLines(ctx, t.main, cx, y, 'center', '#fff');
    shadowOff(env);
  } });
  if (t.sub) els.push({ h: t.sub.height, gap: 0, draw: (y) => drawLines(ctx, t.sub, cx, y, 'center', 'rgba(255,255,255,0.88)') });
  runStack(els, H - (L ? 92 : 100) - stackHeight(els));
}

// ٥) زخرفة — لوح أخضر مائل بنقشة إسلامية
function stylePanel(env) {
  const { ctx, W, H, L } = env;
  let poly;
  let edge;
  if (L) {
    const xt = W * 0.55;
    const xb = W * 0.46;
    poly = [[xt, 0], [W, 0], [W, H], [xb, H]];
    edge = [[xt, 0], [xb, H]];
  } else {
    topShade(env, 0.6);
    const yl = H * 0.6;
    const yr = H * 0.535;
    poly = [[0, yl], [W, yr], [W, H], [0, H]];
    edge = [[0, yl], [W, yr]];
  }
  const tracePoly = () => {
    ctx.beginPath();
    poly.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
  };

  shadowOn(env, 50, 0.35);
  ctx.fillStyle = '#073a32';
  tracePoly();
  ctx.fill();
  shadowOff(env);

  ctx.save();
  tracePoly();
  ctx.clip();
  const g = L ? ctx.createLinearGradient(poly[3][0], 0, W, 0) : ctx.createLinearGradient(0, poly[1][1], 0, H);
  g.addColorStop(0, '#0b4d42');
  g.addColorStop(1, '#052a24');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const pat = ASSETS.pattern;
  const ps = L ? 0.8 : 0.7;
  const pw = pat.width * ps;
  const ph = pat.height * ps;
  ctx.globalAlpha = 0.1;
  for (let py = L ? 0 : poly[1][1] - 20; py < H; py += ph) {
    for (let px = 0; px < W; px += pw) ctx.drawImage(pat, px, py, pw, ph);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // خط ذهبي على الحافة المائلة
  ctx.strokeStyle = L ? goldV(ctx, 0, H) : goldH(ctx, 0, W);
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(...edge[0]);
  ctx.lineTo(...edge[1]);
  ctx.stroke();
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (L) { ctx.moveTo(edge[0][0] + 22, 0); ctx.lineTo(edge[1][0] + 22, H); }
  else { ctx.moveTo(0, edge[0][1] + 22); ctx.lineTo(W, edge[1][1] + 22); }
  ctx.stroke();
  ctx.globalAlpha = 1;

  const logo = drawLogo(env);
  const x = W - (L ? 100 : 72);
  const maxW = L ? 760 : W - 144;
  const t = env.text({
    kicker: { weight: 300, size: L ? 58 : 52, maxW, maxLines: 1, lh: 1.3 },
    main:   { weight: 700, size: L ? 80 : 76, maxW, maxLines: 3, lh: 1.3 },
    sub:    { weight: 400, size: L ? 42 : 40, maxW, maxLines: 3, lh: 1.45 },
  });
  const els = [];
  if (t.kicker) els.push({ h: t.kicker.height, gap: 6, draw: (y) => drawLines(ctx, t.kicker, x, y, 'right', '#fff') });
  if (t.main) els.push({ h: t.main.height, gap: 22, draw: (y) => drawLines(ctx, t.main, x, y, 'right', (a, b) => goldV(ctx, a, b)) });
  if (t.sub) els.push({ h: t.sub.height, gap: 0, draw: (y) => drawLines(ctx, t.sub, x, y, 'right', 'rgba(255,255,255,0.9)') });
  const total = stackHeight(els);
  let top;
  if (L) top = clamp(H * 0.6 - total / 2, logo.y + logo.h + 60, H - 70 - total);
  else top = clamp((poly[1][1] + H) / 2 + 10 - total / 2, poly[0][1] + 50, H - 70 - total);
  runStack(els, top);
}

// ٦) إبراز — كل سطر على خلفية خاصة
function styleHighlight(env) {
  const { ctx, W, H, L } = env;
  topShade(env, 0.6);
  fillLinear(ctx, 0, H, 0, H * 0.45, [[0, 'rgba(0, 0, 0, 0.5)'], [1, 'rgba(0, 0, 0, 0)']], W, H);
  drawLogo(env);
  const x = W - (L ? 110 : 64);
  const maxBox = L ? 1400 : W - 128;
  const kS = L ? 44 : 38;
  const mS = L ? 84 : 70;
  const sS = L ? 42 : 36;
  const t = env.text({
    kicker: { weight: 700, size: kS, maxW: maxBox - kS * 1.2, maxLines: 1, lh: 1 },
    main:   { weight: 900, size: mS, maxW: maxBox - mS * 0.9, maxLines: 3, lh: 1 },
    sub:    { weight: 500, size: sS, maxW: maxBox - sS * 1.2, maxLines: 2, lh: 1 },
  });
  const els = [];
  if (t.kicker) {
    const bh = t.kicker.size * 1.7;
    els.push({ h: boxedHeight(t.kicker, bh, 0), gap: 12, draw: (y) =>
      drawBoxedLines(env, t.kicker, x, y, (a, b) => goldH(ctx, a, b), '#073a32', t.kicker.size * 0.6, bh, 0) });
  }
  if (t.main) {
    const bh = t.main.size * 1.55;
    const gap = t.main.size * 0.12;
    els.push({ h: boxedHeight(t.main, bh, gap), gap: 12, draw: (y) => {
      shadowOn(env, 30, 0.25, 6);
      drawBoxedLines(env, t.main, x, y, 'rgba(9, 66, 57, 0.95)', '#fff', t.main.size * 0.45, bh, gap);
      shadowOff(env);
    } });
  }
  if (t.sub) {
    const bh = t.sub.size * 1.7;
    const gap = t.sub.size * 0.15;
    els.push({ h: boxedHeight(t.sub, bh, gap), gap: 0, draw: (y) =>
      drawBoxedLines(env, t.sub, x, y, 'rgba(255, 255, 255, 0.95)', '#094239', t.sub.size * 0.6, bh, gap) });
  }
  runStack(els, H - (L ? 100 : 104) - stackHeight(els));
}

const STYLES = [
  { id: 'classic',   name: 'كلاسيكي',   draw: styleClassic },
  { id: 'band',      name: 'شريط سفلي', draw: styleBand },
  { id: 'card',      name: 'بطاقة',     draw: styleCard },
  { id: 'center',    name: 'وسط',       draw: styleCenter },
  { id: 'panel',     name: 'زخرفة',     draw: stylePanel },
  { id: 'highlight', name: 'إبراز',     draw: styleHighlight },
];
if (!STYLES.some((st) => st.id === state.style)) state.style = 'classic';

function hasTitle() {
  const t = state.title;
  return Boolean(t.kicker.trim() || t.main.trim() || t.sub.trim());
}

// يرسم الغلاف ويرجع { bounds, offset, W, H }: حدود كتلة العنوان (قبل الإزاحة) والإزاحة المطبّقة فعلًا
function renderCover(ctx, item, orient, styleId, s, src, thumb = false) {
  const F = (thumb ? THUMB_COVER_FORMATS : COVER_FORMATS)[orient];
  const W = F.w;
  const H = F.h;
  const crop = item.coverCrop[orient];
  const title = hasTitle() ? state.title : SAMPLE_TITLE;
  const style = STYLES.find((st) => st.id === styleId) || STYLES[0];
  let off = getTextOffset(orient, styleId);
  let bounds = null;

  // الدورة الثانية فقط إذا اضطررنا لتقليص الإزاحة كي يبقى النص داخل الغلاف (مثلًا بعد تكبير العنوان)
  for (let pass = 0; pass < 2; pass++) {
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.direction = 'rtl';
    const photo = () => drawPhoto(ctx, item, W, H, crop, s, src);
    photo();
    const env = {
      ctx, W, H, s, L: orient === 'landscape', photo,
      text: (spec) => prepareText(ctx, title, spec, state.textScale),
    };
    CUR = { ctx, dx: off.x, dy: off.y, shifted: false, bounds: null };
    ctx.save();
    try {
      style.draw(env);
    } finally {
      ctx.restore();
      bounds = CUR.bounds;
      CUR = null;
    }
    const fit = fitTextOffset(off, bounds, W, H);
    if (fit.x === off.x && fit.y === off.y) break;
    off = fit;
  }
  return { bounds, offset: off, W, H };
}

/* =====================================================================
   إضافة الصور
   ===================================================================== */
function makePreviewSource(img) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const k = Math.min(1, PREVIEW_MAX_SIDE / Math.max(iw, ih));
  if (k === 1) return img;
  const c = document.createElement('canvas');
  c.width = Math.round(iw * k);
  c.height = Math.round(ih * k);
  const cx = c.getContext('2d');
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

async function addFiles(fileList) {
  // نأخذ نسخة فورًا: قائمة الملفات تنمسح بعد ما نفرّغ حقل الاختيار أو ينتهي حدث السحب
  const picked = [...fileList];
  try { await assetsReady; } catch { return; }
  const files = picked
    .filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!files.length) { toast('اختر ملفات صور', 'error'); return; }
  const room = CONFIG.maxPhotos - state.items.length;
  if (room <= 0) { toast(`الحد الأقصى ${CONFIG.maxPhotos} صور`, 'error'); return; }
  if (files.length > room) toast(`تمت إضافة ${room} صور فقط — الحد الأقصى ${CONFIG.maxPhotos}`, 'error');

  for (const file of files.slice(0, room)) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const item = {
        id: ++uid,
        name: file.name,
        url,
        img,
        iw: img.naturalWidth,
        ih: img.naturalHeight,
        orient: 'auto',
        crop: { landscape: newCrop(), portrait: newCrop() },
        coverCrop: { landscape: newCrop(), portrait: newCrop() },
      };
      item.preview = makePreviewSource(img);
      state.items.push(item);
      $('#grid').appendChild(buildCard(item));
      drawCard(item);
    } catch {
      URL.revokeObjectURL(url);
      toast(`تعذّر فتح الصورة: ${file.name} (جرّب JPG أو PNG)`, 'error');
    }
  }
  refreshUI();
}

function removeItem(item) {
  state.items = state.items.filter((i) => i !== item);
  item.el.remove();
  URL.revokeObjectURL(item.url);
  if (state.coverId === item.id) state.coverId = null;
  refreshUI();
}

/* =====================================================================
   بطاقات الصور
   ===================================================================== */
function buildCard(item) {
  const el = document.createElement('article');
  el.className = 'card';
  el.innerHTML = `
    <div class="card-media">
      <canvas aria-label="معاينة الصورة — اسحب لتحريك الكادر"></canvas>
      <span class="badge-num"></span>
      <span class="badge-cover">غلاف</span>
    </div>
    <div class="card-body">
      <div class="card-head">
        <button type="button" class="grip" title="اسحب لتغيير الترتيب" aria-label="اسحب لتغيير الترتيب">${ICONS.grip}</button>
        <div class="card-name"></div>
        <button type="button" class="icon-btn icon-sm move-prev" title="تقديم" aria-label="تقديم الصورة">${ICONS.chevRight}</button>
        <button type="button" class="icon-btn icon-sm move-next" title="تأخير" aria-label="تأخير الصورة">${ICONS.chevLeft}</button>
      </div>
      <div class="card-row">
        <div class="seg" role="group" aria-label="نوع القالب">
          <button type="button" data-o="landscape">أفقي</button>
          <button type="button" data-o="portrait">طولي</button>
        </div>
        <span class="auto-tag">تلقائي</span>
      </div>
      <div class="zoom">
        <span aria-hidden="true">−</span>
        <input type="range" min="0.5" max="3" step="0.01" value="1" aria-label="تكبير">
        <span aria-hidden="true">+</span>
      </div>
      <div class="card-row">
        <button type="button" class="btn-cover">${ICONS.star}<span>اجعلها غلاف</span></button>
        <button type="button" class="icon-btn reset" title="إعادة الكادر" aria-label="إعادة الكادر">${ICONS.reset}</button>
        <button type="button" class="icon-btn remove" title="حذف الصورة" aria-label="حذف الصورة">${ICONS.trash}</button>
      </div>
    </div>`;
  el.querySelector('.card-name').textContent = item.name;
  item.el = el;
  item.canvas = el.querySelector('canvas');
  item.zoomInput = el.querySelector('.zoom input');

  el.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
    item.orient = b.dataset.o;
    drawCard(item);
    if (state.coverId === item.id) coverChanged();
  }));
  item.zoomInput.addEventListener('input', () => {
    const o = effectiveOrient(item);
    const F = FORMATS[o];
    item.crop[o].zoom = parseFloat(item.zoomInput.value);
    normalizeCrop(item, item.crop[o], F.w, F.h);
    drawCard(item);
  });
  el.querySelector('.reset').addEventListener('click', () => {
    item.crop[effectiveOrient(item)] = newCrop();
    drawCard(item);
  });
  el.querySelector('.remove').addEventListener('click', () => removeItem(item));
  el.querySelector('.move-prev').addEventListener('click', () => moveItem(item, -1));
  el.querySelector('.move-next').addEventListener('click', () => moveItem(item, 1));
  attachReorder(el.querySelector('.grip'), item);
  el.querySelector('.btn-cover').addEventListener('click', () => {
    state.coverId = state.coverId === item.id ? null : item.id;
    refreshUI();
    if (state.coverId) {
      $('#stepCover').scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => $('#tMain').focus({ preventScroll: true }), 400);
    }
  });

  attachPan(item.canvas, () => {
    const o = effectiveOrient(item);
    return { item, crop: item.crop[o], W: FORMATS[o].w, H: FORMATS[o].h, redraw: () => drawCard(item) };
  });
  return el;
}

/* تغيير الترتيب */
function moveItem(item, delta) {
  const i = state.items.indexOf(item);
  const j = i + delta;
  if (j < 0 || j >= state.items.length) return;
  state.items.splice(i, 1);
  state.items.splice(j, 0, item);
  const grid = $('#grid');
  state.items.forEach((it) => grid.appendChild(it.el));
  refreshUI();
  item.el.querySelector(delta < 0 ? '.move-prev' : '.move-next').focus();
}

function renumberCards() {
  [...$('#grid').children].forEach((el, i) => { el.querySelector('.badge-num').textContent = i + 1; });
}

// سحب البطاقة من المقبض ⠿ وإفلاتها مكان بطاقة ثانية
function attachReorder(handle, item) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try { handle.setPointerCapture(e.pointerId); } catch { /* تجاهل */ }
    const grid = $('#grid');
    const card = item.el;
    card.classList.add('is-moving');
    document.body.classList.add('is-reordering');
    let pos = { x: e.clientX, y: e.clientY };

    const place = () => {
      const hit = document.elementFromPoint(pos.x, pos.y);
      const target = hit && hit.closest('.card');
      if (!target || target === card || target.parentNode !== grid) return;
      const r = target.getBoundingClientRect();
      const beforeTarget = pos.x > r.left + r.width / 2; // الصفحة من اليمين لليسار
      grid.insertBefore(card, beforeTarget ? target : target.nextSibling);
      renumberCards();
    };
    // تمرير الصفحة تلقائيًا إذا وصل المؤشر لأعلى أو أسفل الشاشة
    let raf = 0;
    const autoScroll = () => {
      const dy = pos.y < 80 ? -14 : pos.y > window.innerHeight - 160 ? 14 : 0;
      if (dy) { window.scrollBy(0, dy); place(); }
      raf = requestAnimationFrame(autoScroll);
    };
    raf = requestAnimationFrame(autoScroll);

    const move = (ev) => {
      pos = { x: ev.clientX, y: ev.clientY };
      place();
    };
    const end = () => {
      cancelAnimationFrame(raf);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      card.classList.remove('is-moving');
      document.body.classList.remove('is-reordering');
      const order = [...grid.children];
      state.items.sort((a, b) => order.indexOf(a.el) - order.indexOf(b.el));
      refreshUI();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });
}

function drawCard(item) {
  const o = effectiveOrient(item);
  const F = FORMATS[o];
  const s = 600 / Math.max(F.w, F.h);
  const c = item.canvas;
  const cw = Math.round(F.w * s);
  const ch = Math.round(F.h * s);
  if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
  renderRegular(c.getContext('2d'), item, o, s, item.preview);

  item.el.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.o === o)));
  item.el.querySelector('.auto-tag').hidden = !(item.orient === 'auto' && state.globalOrient === 'auto');
  item.zoomInput.value = item.crop[o].zoom;
}

/* سحب الصورة داخل الإطار */
function attachPan(canvas, getTarget) {
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* تجاهل */ }
    canvas.classList.add('is-dragging');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const t = getTarget();
    const rect = canvas.getBoundingClientRect();
    const k = t.W / rect.width;
    if (t.drag) {
      // وضع تحريك النص: نمرّر مقدار السحب بوحدات الغلاف
      t.drag((e.clientX - drag.x) * k, (e.clientY - drag.y) * k);
    } else {
      const L = photoLayout(t.item.iw, t.item.ih, t.W, t.H, t.crop);
      t.crop.cx -= ((e.clientX - drag.x) * k) / L.dw;
      t.crop.cy -= ((e.clientY - drag.y) * k) / L.dh;
      normalizeCrop(t.item, t.crop, t.W, t.H);
    }
    drag = { x: e.clientX, y: e.clientY };
    t.redraw();
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    canvas.classList.remove('is-dragging');
    const t = getTarget();
    if (t.done) t.done();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

/* =====================================================================
   الغلاف
   ===================================================================== */
function coverItem() {
  return state.items.find((i) => i.id === state.coverId) || null;
}

let coverRaf = 0;
function scheduleCover() {
  if (coverRaf) return;
  coverRaf = requestAnimationFrame(() => { coverRaf = 0; drawCoverPreview(); });
}

let galleryTimer = 0;
function scheduleGallery() {
  clearTimeout(galleryTimer);
  galleryTimer = setTimeout(drawGallery, 140);
}

function coverChanged() {
  refreshUI();
}

function drawCoverPreview() {
  const item = coverItem();
  if (!item) return;
  const o = effectiveOrient(item);
  const F = COVER_FORMATS[o];
  const c = $('#coverCanvas');
  const wrap = $('#stageCanvasWrap');
  wrap.classList.toggle('is-portrait', o === 'portrait');
  const cssW = wrap.clientWidth || 900;
  const s = Math.min(1, (Math.min(cssW, 1100) * (window.devicePixelRatio || 1)) / F.w);
  const cw = Math.round(F.w * s);
  const ch = Math.round(F.h * s);
  if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
  const ctx = c.getContext('2d');
  const r = renderCover(ctx, item, o, state.style, s, item.preview);
  state.coverRender = r;
  if (state.editText && r.bounds) drawTextFrame(ctx, r, s);
  $('#coverZoom').value = item.coverCrop[o].zoom;
  $('#sampleFlag').hidden = hasTitle();
  const moved = getTextOffset(o, state.style);
  $('#btnTextReset').hidden = !(moved.x || moved.y);
}

// إطار منقّط حول كتلة العنوان (للمعاينة فقط، لا يدخل في الصورة المصدّرة)
function drawTextFrame(ctx, r, s) {
  const u = window.devicePixelRatio || 1;
  const pad = 14;
  const x = (r.bounds.x0 + r.offset.x - pad) * s;
  const y = (r.bounds.y0 + r.offset.y - pad) * s;
  const w = (r.bounds.x1 - r.bounds.x0 + pad * 2) * s;
  const h = (r.bounds.y1 - r.bounds.y0 + pad * 2) * s;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.lineWidth = 4 * u;
  ctx.strokeRect(x, y, w, h);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2 * u;
  ctx.setLineDash([9 * u, 6 * u]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
  ctx.fillStyle = '#e3d4a8';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.lineWidth = 1.5 * u;
  const q = 5 * u;
  for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
    ctx.fillRect(cx - q, cy - q, q * 2, q * 2);
    ctx.strokeRect(cx - q, cy - q, q * 2, q * 2);
  }
  ctx.restore();
}

// يحرّك كتلة العنوان بمقدار (dx, dy) بوحدات الغلاف مع إبقائها داخل الإطار
function moveText(orient, dx, dy) {
  const R = state.coverRender;
  if (!R || !R.bounds) return;
  const range = textRange(R.bounds, R.W, R.H);
  const next = {
    x: clamp(R.offset.x + dx, range.x[0], range.x[1]),
    y: clamp(R.offset.y + dy, range.y[0], range.y[1]),
  };
  state.textPos[textPosKey(orient, state.style)] = next;
  R.offset = next; // حتى تتراكم الحركات قبل إعادة الرسم
}

function buildGallery() {
  const g = $('#styleGallery');
  g.innerHTML = '';
  for (const st of STYLES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'style-opt';
    b.dataset.id = st.id;
    b.innerHTML = '<canvas></canvas><span></span>';
    b.querySelector('span').textContent = st.name;
    b.addEventListener('click', () => {
      state.style = st.id;
      storageSet('mohe_style', st.id);
      updateGalleryPressed();
      scheduleCover();
    });
    g.appendChild(b);
  }
  updateGalleryPressed();
}

function updateGalleryPressed() {
  document.querySelectorAll('.style-opt').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === state.style)));
}

function drawGallery() {
  const item = coverItem();
  if (!item) return;
  const o = effectiveOrient(item);
  const F = COVER_FORMATS[o];
  $('#styleGallery').classList.toggle('is-portrait', o === 'portrait');
  const s = (o === 'landscape' ? 400 : 260) / F.w;
  document.querySelectorAll('.style-opt').forEach((b) => {
    const c = b.querySelector('canvas');
    const cw = Math.round(F.w * s);
    const ch = Math.round(F.h * s);
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    renderCover(c.getContext('2d'), item, o, b.dataset.id, s, item.preview);
  });
}

function initCoverEditor() {
  buildGallery();
  const bind = (id, key) => $(id).addEventListener('input', (e) => {
    state.title[key] = e.target.value;
    scheduleCover();
    scheduleGallery();
  });
  bind('#tKicker', 'kicker');
  bind('#tMain', 'main');
  bind('#tSub', 'sub');

  const size = $('#tSize');
  size.value = state.textScale;
  $('#tSizeOut').textContent = `${Math.round(state.textScale * 100)}%`;
  size.addEventListener('input', () => {
    state.textScale = parseFloat(size.value);
    $('#tSizeOut').textContent = `${Math.round(state.textScale * 100)}%`;
    storageSet('mohe_text_scale', String(state.textScale));
    scheduleCover();
    scheduleGallery();
  });

  $('#coverZoom').addEventListener('input', (e) => {
    const item = coverItem();
    if (!item) return;
    const o = effectiveOrient(item);
    const F = COVER_FORMATS[o];
    item.coverCrop[o].zoom = parseFloat(e.target.value);
    normalizeCrop(item, item.coverCrop[o], F.w, F.h);
    scheduleCover();
    scheduleGallery();
  });
  $('#btnCoverReset').addEventListener('click', () => {
    const item = coverItem();
    if (!item) return;
    item.coverCrop[effectiveOrient(item)] = newCrop();
    scheduleCover();
    scheduleGallery();
  });
  $('#btnUnsetCover').addEventListener('click', () => {
    state.coverId = null;
    refreshUI();
  });

  const canvas = $('#coverCanvas');
  attachPan(canvas, () => {
    const item = coverItem();
    const o = effectiveOrient(item);
    const F = COVER_FORMATS[o];
    if (state.editText) {
      return { item, W: F.w, H: F.h, drag: (dx, dy) => moveText(o, dx, dy), redraw: scheduleCover, done: scheduleGallery };
    }
    return { item, crop: item.coverCrop[o], W: F.w, H: F.h, redraw: scheduleCover, done: scheduleGallery };
  });

  const chk = $('#chkEditText');
  chk.addEventListener('change', () => {
    state.editText = chk.checked;
    $('#stageCanvasWrap').classList.toggle('is-text-mode', state.editText);
    $('#editHint').textContent = state.editText
      ? 'اسحب النص على الصورة لتحريكه (الصورة مثبّتة الآن)'
      : 'فعّلها ثم اسحب النص على الصورة';
    scheduleCover();
  });
  $('#btnTextReset').addEventListener('click', () => {
    const item = coverItem();
    if (!item) return;
    delete state.textPos[textPosKey(effectiveOrient(item), state.style)];
    scheduleCover();
    scheduleGallery();
  });
  // التكبير بالعجلة فقط مع Ctrl (أو قرص لوحة اللمس) حتى لا يتعارض مع تمرير الصفحة
  canvas.addEventListener('wheel', (e) => {
    const item = coverItem();
    if (!item || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const o = effectiveOrient(item);
    const F = COVER_FORMATS[o];
    const crop = item.coverCrop[o];
    crop.zoom = clamp(crop.zoom * Math.exp(-e.deltaY * 0.0015), 0.5, 3);
    normalizeCrop(item, crop, F.w, F.h);
    scheduleCover();
    scheduleGallery();
  }, { passive: false });

  window.addEventListener('resize', () => { if (coverItem()) scheduleCover(); });
}

/* =====================================================================
   تحديث الواجهة
   ===================================================================== */
function refreshUI() {
  const n = state.items.length;
  const cover = coverItem();

  $('#dropzone').classList.toggle('is-compact', n > 0);
  $('#photosToolbar').hidden = n === 0;
  $('#stepCover').hidden = n === 0;
  $('#photoCount').textContent = n ? `${n} من ${CONFIG.maxPhotos}` : '';
  $('#dropzone strong').textContent = n ? 'إضافة صور أخرى' : 'اسحب الصور إلى هنا أو اضغط للاختيار';

  state.items.forEach((item, i) => {
    item.el.querySelector('.badge-num').textContent = i + 1;
    item.el.querySelector('.move-prev').disabled = i === 0;
    item.el.querySelector('.move-next').disabled = i === n - 1;
    const isCover = item.id === state.coverId;
    item.el.classList.toggle('is-cover', isCover);
    item.el.querySelector('.btn-cover span').textContent = isCover ? 'الغلاف' : 'اجعلها غلاف';
  });

  $('#coverEmpty').hidden = Boolean(cover);
  $('#coverEditor').hidden = !cover;
  if (cover) {
    const o = effectiveOrient(cover);
    const F = COVER_FORMATS[o];
    $('#coverInfo').textContent = `الصورة ${state.items.indexOf(cover) + 1} — غلاف ${FORMATS[o].label} ${F.w}×${F.h}`;
    scheduleCover();
    scheduleGallery();
  }

  const bar = $('#actionbar');
  bar.classList.toggle('is-shown', n > 0);
  $('#abSummary').textContent = n
    ? `${n} ${n === 1 ? 'صورة' : 'صور'}${cover ? ' + غلاف' : ''}  •  ${n + (cover ? 1 : 0)} ملفات`
    : '';
  updateButtons();
}

function updateButtons() {
  const disabled = state.busy || state.items.length === 0;
  $('#btnDownload').disabled = disabled;
  $('#btnTelegram').disabled = disabled;
}

function setStatus(text, isError = false) {
  const el = $('#abStatus');
  el.textContent = text;
  el.classList.toggle('is-error', isError);
}
function setProgress(fraction) {
  $('#abProgress').style.width = `${Math.round(clamp(fraction, 0, 1) * 100)}%`;
}

/* =====================================================================
   التصدير
   ===================================================================== */
function buildOutputs() {
  const outs = [];
  const cover = coverItem();
  if (cover) {
    const t = state.title;
    const caption = [t.kicker, t.main, t.sub].map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean).join(' ');
    outs.push({ kind: 'cover', item: cover, file: '00-cover.jpg', label: 'الغلاف', caption: caption ? `الغلاف: ${caption}` : 'الغلاف' });
  }
  state.items.forEach((item, i) => {
    outs.push({ kind: 'photo', item, file: `${pad2(i + 1)}.jpg`, label: `الصورة ${i + 1}`, caption: `الصورة رقم ${i + 1}` });
  });
  return outs;
}

// thumb=true: قياس النسخة المصغرة (الطولي 1080×1920 = 9:16)
function renderOutput(out, thumb = false) {
  const o = effectiveOrient(out.item);
  const F = out.kind === 'cover'
    ? (thumb ? THUMB_COVER_FORMATS : COVER_FORMATS)[o]
    : (thumb ? THUMB_FORMATS : FORMATS)[o];
  const c = document.createElement('canvas');
  c.width = F.w;
  c.height = F.h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  if (out.kind === 'cover') renderCover(ctx, out.item, o, state.style, 1, out.item.img, thumb);
  else renderRegular(ctx, out.item, o, 1, out.item.img, thumb);
  return c;
}

function makeThumb(canvas, width) {
  const k = Math.min(1, width / canvas.width);
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * k);
  c.height = Math.round(canvas.height * k);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}

function validateBeforeExport() {
  if (!state.items.length) { toast('ارفع صورة واحدة على الأقل', 'error'); return false; }
  if (coverItem() && !hasTitle()) {
    toast('اكتب عنوان الغلاف، أو اضغط «إلغاء الغلاف» إذا ما بدك غلاف', 'error');
    $('#stepCover').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#tMain').focus({ preventScroll: true });
    return false;
  }
  return true;
}

function setBusy(busy) {
  state.busy = busy;
  updateButtons();
}

async function downloadAll() {
  if (state.busy || !validateBeforeExport()) return;
  setBusy(true);
  const outs = buildOutputs();
  setProgress(0);
  try {
    for (let i = 0; i < outs.length; i++) {
      setStatus(`جاري تجهيز ${outs[i].label} (${i + 1} من ${outs.length})…`);
      await sleep(20);
      const blob = await canvasToBlob(renderOutput(outs[i]));
      saveBlob(blob, outs[i].file);
      setProgress((i + 1) / outs.length);
      await sleep(300);
    }
    setStatus(`تم تنزيل ${outs.length} ملفات ✓`);
    toast('تم التنزيل ✓ — إذا طلب المتصفح السماح بتنزيل عدة ملفات، اضغط «سماح»', 'ok');
  } catch (err) {
    console.error(err);
    setStatus(exportErrorText(err), true);
  } finally {
    setBusy(false);
  }
}

function exportErrorText(err) {
  if (err && err.name === 'SecurityError') return 'المتصفح منع التصدير: افتح الموقع من الرابط وليس بالنقر المزدوج على الملف';
  return `حدث خطأ: ${err && err.message ? err.message : err}`;
}

/* =====================================================================
   تلغرام
   ===================================================================== */
async function tgCall(method, body) {
  const { botToken } = CONFIG.telegram;
  const isForm = body instanceof FormData;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      headers: isForm ? undefined : { 'Content-Type': 'application/json' },
      body: isForm ? body : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
    if (data.ok) return data.result;
    const wait = data.parameters && data.parameters.retry_after;
    if (res.status === 429 && wait) {
      setStatus(`تلغرام طلب الانتظار ${wait} ثانية…`);
      await sleep((wait + 1) * 1000);
      continue;
    }
    throw new Error(data.description || `HTTP ${res.status}`);
  }
  throw new Error('تعذّر الإرسال بعد عدة محاولات');
}

function sendPhoto(chatId, blob, filename, caption) {
  const fd = new FormData();
  fd.append('chat_id', chatId);
  fd.append('photo', blob, filename);
  if (caption) fd.append('caption', caption.slice(0, 1000));
  return tgCall('sendPhoto', fd);
}

async function sendAllToTelegram() {
  if (state.busy || !validateBeforeExport()) return;
  const { chatId, thumbChatId } = CONFIG.telegram;
  setBusy(true);
  const outs = buildOutputs();
  const batch = { id: Date.now(), ts: Date.now(), entries: [] };
  const failed = [];
  setProgress(0);

  for (let i = 0; i < outs.length; i++) {
    const out = outs[i];
    try {
      setStatus(`جاري إرسال ${out.label} (${i + 1} من ${outs.length})…`);
      await sleep(20);
      const full = renderOutput(out);
      const blob = await canvasToBlob(full);
      // النسخة المصغرة: الأفقي من نفس الصورة، والطولي يُعاد رسمه على قالب 9:16 كامل
      const isPortrait = effectiveOrient(out.item) === 'portrait';
      const thumbSource = isPortrait ? renderOutput(out, true) : full;
      const thumbBlob = await canvasToBlob(makeThumb(thumbSource, CONFIG.thumbWidth), 0.9);
      const entry = { label: out.label, msgs: [] };

      const main = await sendPhoto(chatId, blob, out.file, out.caption);
      entry.msgs.push({ chat: chatId, id: main.message_id });
      const thumb = await sendPhoto(thumbChatId, thumbBlob, out.file.replace('.jpg', '-770.jpg'), `نسخة مصغرة — ${out.label} - 770${isPortrait ? ' (9:16)' : ''}`);
      entry.msgs.push({ chat: thumbChatId, id: thumb.message_id });

      batch.entries.push(entry);
      saveBatch(batch);
    } catch (err) {
      console.error(out.label, err);
      failed.push(`${out.label}: ${err && err.name === 'SecurityError' ? exportErrorText(err) : err.message}`);
    }
    setProgress((i + 1) / outs.length);
  }

  setBusy(false);
  renderLog();
  if (failed.length) {
    setStatus(`أُرسلت ${outs.length - failed.length} من ${outs.length} — فشل: ${failed.join(' | ')}`, true);
    toast(`فشل إرسال ${failed.length} صورة — التفاصيل بالأسفل`, 'error');
  } else {
    setStatus(`تم إرسال ${outs.length} ملفات لتلغرام ✓`);
    toast('تم الإرسال لتلغرام ✓', 'ok');
  }
}

/* سجل الإرسال (للحذف لاحقًا) */
const LOG_KEY = 'mohe_sent_log';

function readLog() {
  let log = [];
  try { log = JSON.parse(storageGet(LOG_KEY, '[]')) || []; } catch { log = []; }
  // نقل السجل القديم من النسخة السابقة من الموقع
  try {
    const old = JSON.parse(storageGet('msg_ids', '[]'));
    if (Array.isArray(old) && old.length) {
      log.push({ id: 1, ts: 0, entries: old.map((id, i) => ({ label: `صورة سابقة ${i + 1}`, msgs: [{ chat: CONFIG.telegram.chatId, id }] })) });
      localStorage.removeItem('msg_ids');
      writeLog(log);
    }
  } catch { /* تجاهل */ }
  return log;
}
function writeLog(log) { storageSet(LOG_KEY, JSON.stringify(log)); }

function saveBatch(batch) {
  const log = readLog().filter((b) => b.id !== batch.id);
  log.push(batch);
  writeLog(log.slice(-20));
}

async function deleteEntry(batchId, index) {
  if (!confirm('حذف هذه الصورة من مجموعتي تلغرام؟')) return;
  const log = readLog();
  const batch = log.find((b) => b.id === batchId);
  if (!batch) return;
  const entry = batch.entries[index];
  try {
    await deleteMessages(entry.msgs);
    batch.entries.splice(index, 1);
    writeLog(log.filter((b) => b.entries.length));
    toast('تم الحذف من تلغرام ✓', 'ok');
  } catch (err) {
    toast(`تعذّر الحذف: ${err.message}`, 'error');
  }
  renderLog();
}

async function deleteBatch(batchId) {
  const log = readLog();
  const batch = log.find((b) => b.id === batchId);
  if (!batch || !confirm(`حذف كل صور هذه الدفعة (${batch.entries.length}) من تلغرام؟`)) return;
  const kept = [];
  for (const entry of batch.entries) {
    try { await deleteMessages(entry.msgs); } catch { kept.push(entry); }
  }
  batch.entries = kept;
  writeLog(log.filter((b) => b.entries.length));
  toast(kept.length ? `تعذّر حذف ${kept.length} صورة (ربما مضى أكثر من 48 ساعة)` : 'تم حذف الدفعة ✓', kept.length ? 'error' : 'ok');
  renderLog();
}

async function deleteMessages(msgs) {
  for (const m of msgs) {
    try {
      await tgCall('deleteMessage', { chat_id: m.chat, message_id: m.id });
    } catch (err) {
      // إذا كانت الرسالة محذوفة أصلًا نعتبرها ناجحة
      if (!/not found/i.test(err.message)) throw err;
    }
  }
}

function renderLog() {
  const log = readLog().slice().reverse();
  const total = log.reduce((n, b) => n + b.entries.length, 0);
  $('#logSection').hidden = total === 0;
  $('#logCount').textContent = total ? `(${total})` : '';
  const list = $('#logList');
  list.innerHTML = '';
  for (const batch of log) {
    const box = document.createElement('div');
    box.className = 'log-batch';
    const head = document.createElement('div');
    head.className = 'log-batch-head';
    const when = batch.ts ? new Date(batch.ts).toLocaleString('ar-SY-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }) : 'إرسالات سابقة';
    head.innerHTML = '<span></span>';
    head.querySelector('span').textContent = `${when} — ${batch.entries.length} صور`;
    const delAll = document.createElement('button');
    delAll.type = 'button';
    delAll.className = 'btn btn-danger btn-sm';
    delAll.textContent = 'حذف الدفعة كاملة';
    delAll.addEventListener('click', () => deleteBatch(batch.id));
    head.appendChild(delAll);
    box.appendChild(head);
    batch.entries.forEach((entry, i) => {
      const row = document.createElement('div');
      row.className = 'log-row';
      const label = document.createElement('span');
      label.textContent = entry.label;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn-ghost btn-sm';
      del.textContent = 'حذف';
      del.addEventListener('click', () => deleteEntry(batch.id, i));
      row.append(label, del);
      box.appendChild(row);
    });
    list.appendChild(box);
  }
}

/* =====================================================================
   التشغيل
   ===================================================================== */
async function loadAssets() {
  const list = {
    landscape: FORMATS.landscape.overlay,
    portrait: FORMATS.portrait.overlay,
    portrait916: THUMB_FORMATS.portrait.overlay,
    logoWhite: 'templates/logo-white.png',
    pattern: 'templates/pattern.png',
  };
  await Promise.all(Object.entries(list).map(async ([key, src]) => {
    try { ASSETS[key] = await loadImage(src); } catch { throw new Error(src); }
  }));
  await Promise.all([300, 400, 500, 700, 900].map((w) => document.fonts.load(`${w} 40px Qomra`, 'عربي')));
}

function initUpload() {
  const input = $('#fileInput');
  input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    if (files.length) addFiles(files);
  });
  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('is-over')));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]);
  });
  // منع فتح الصورة بالمتصفح إذا انرمت خارج المنطقة
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]);
  });

  document.querySelectorAll('#globalOrient button').forEach((b) => b.addEventListener('click', () => {
    state.globalOrient = b.dataset.v;
    document.querySelectorAll('#globalOrient button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    state.items.forEach((item) => { item.orient = 'auto'; drawCard(item); });
    refreshUI();
  }));

  $('#btnClearAll').addEventListener('click', () => {
    if (!confirm('حذف كل الصور من الصفحة؟')) return;
    state.items.forEach((item) => { item.el.remove(); URL.revokeObjectURL(item.url); });
    state.items = [];
    state.coverId = null;
    refreshUI();
  });
}

async function init() {
  initUpload();
  initCoverEditor();
  $('#btnDownload').addEventListener('click', downloadAll);
  $('#btnTelegram').addEventListener('click', sendAllToTelegram);
  $('#btnClearLog').addEventListener('click', () => {
    if (!confirm('مسح السجل من هذا الجهاز؟ (الصور تبقى على تلغرام)')) return;
    writeLog([]);
    renderLog();
  });
  renderLog();
  refreshUI();

  assetsReady = loadAssets();
  try {
    await assetsReady;
  } catch (err) {
    const box = $('#loadError');
    box.textContent = `تعذّر تحميل ملف القالب: ${err.message} — تأكد أن مجلد templates موجود بجانب index.html`;
    box.hidden = false;
    $('#fileInput').disabled = true;
  }
}

init();
