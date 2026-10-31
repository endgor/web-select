// Web Select – markera ett område på sidan och kopiera innehållet med formatering.
// Injiceras av background.js. Injiceras skriptet igen medan det är aktivt växlar det av.
(() => {
  'use strict';

  if (window.__webSelect) {
    window.__webSelect.toggle();
    return;
  }

  const Z = '2147483647';
  const ACCENT = '#0a84ff';
  const MIN_DRAG = 5;         // px – kortare drag räknas som klick och avbryter
  const CELL_OVERLAP = 0.4;   // hur stor del av en tabellcell markeringen måste täcka
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'SELECT']);

  // Texter från _locales (följer webbläsarens språk). Utan chrome.i18n, t.ex. i test, visas nyckeln.
  const t = (key, subs) =>
    (globalThis.chrome && chrome.i18n && chrome.i18n.getMessage(key, subs && subs.map(String))) || key;

  const MAX_HIGHLIGHTS = 3000;
  const HIGHLIGHT_CSS = 'background:rgba(10,132,255,.28);box-shadow:inset 0 0 0 1px rgba(10,132,255,.8);border-radius:2px;';

  const state = {
    overlay: null, box: null, layer: null, hint: null, start: null, lastResult: null,
    lastPoint: null, raf: 0, previewAt: 0, previewCost: 0,
  };

  // ---------------------------------------------------------------- UI

  function el(tag, css, text) {
    const e = document.createElement(tag);
    e.style.cssText = 'all:initial;' + css;
    if (text) e.textContent = text;
    return e;
  }

  function startSelecting() {
    if (state.overlay) return;
    const overlay = el('div', `display:block;position:fixed;inset:0;z-index:${Z};cursor:crosshair;background:rgba(0,0,0,.25);`);
    const box = el('div', `display:none;position:fixed;z-index:${Z};pointer-events:none;box-sizing:border-box;` +
      `border:2px solid ${ACCENT};box-shadow:0 0 0 100vmax rgba(0,0,0,.35);`);
    // Visar live vad som kommer att kopieras.
    const layer = el('div', `display:block;position:fixed;inset:0;z-index:${Z};pointer-events:none;`);
    const hint = el('div', `display:block;position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:${Z};` +
      'pointer-events:none;background:#1f1f1f;color:#fff;font:13px/1.4 system-ui,sans-serif;padding:8px 14px;' +
      'border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3);white-space:nowrap;',
      t('hint'));

    overlay.addEventListener('pointerdown', onDown);
    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('pointerup', onUp);
    overlay.addEventListener('wheel', (e) => { if (state.start) e.preventDefault(); }, { passive: false });
    overlay.addEventListener('contextmenu', (e) => { e.preventDefault(); stopSelecting(); });
    window.addEventListener('keydown', onKey, true);

    document.documentElement.append(overlay, box, layer, hint);
    Object.assign(state, { overlay, box, layer, hint, start: null, previewAt: 0, previewCost: 0 });
  }

  function stopSelecting() {
    if (!state.overlay) return;
    state.overlay.remove();
    state.box.remove();
    state.layer.remove();
    state.hint.remove();
    cancelAnimationFrame(state.raf);
    window.removeEventListener('keydown', onKey, true);
    Object.assign(state, { overlay: null, box: null, layer: null, hint: null, start: null, raf: 0 });
  }

  function toggle() {
    if (state.overlay) stopSelecting();
    else startSelecting();
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    stopSelecting();
  }

  function onDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    try { state.overlay.setPointerCapture(e.pointerId); } catch (err) { /* t.ex. syntetiska events */ }
    state.start = { x: e.clientX, y: e.clientY };
    state.overlay.style.background = 'transparent';
    state.box.style.display = 'block';
    state.hint.style.display = 'none';
    drawBox(e);
  }

  function onMove(e) {
    if (!state.start) return;
    state.lastPoint = { clientX: e.clientX, clientY: e.clientY };
    if (!state.raf) state.raf = requestAnimationFrame(tick);
  }

  // Ritar om rutan varje bildruta, men förhandsvisningen glesas ut på tunga sidor.
  function tick() {
    state.raf = 0;
    if (!state.start) return;
    drawBox(state.lastPoint);
    if (performance.now() - state.previewAt < state.previewCost * 3) {
      state.raf = requestAnimationFrame(tick);
      return;
    }
    const sel = rectFrom(state.lastPoint);
    if (sel.width < MIN_DRAG || sel.height < MIN_DRAG) {
      state.layer.replaceChildren();
      return;
    }
    const t0 = performance.now();
    try {
      drawHighlights(state.layer, extract(sel).rects);
    } catch (err) {
      console.warn('[Web Select] Förhandsvisningen misslyckades:', err);
      state.layer.replaceChildren();
    }
    state.previewAt = performance.now();
    state.previewCost = state.previewAt - t0;
  }

  function drawHighlights(layer, rects) {
    layer.replaceChildren(...rects.slice(0, MAX_HIGHLIGHTS).map((r) => el('div',
      `display:block;position:fixed;left:${r.left}px;top:${r.top}px;` +
      `width:${r.right - r.left}px;height:${r.bottom - r.top}px;` + HIGHLIGHT_CSS)));
  }

  function onUp(e) {
    if (!state.start) return;
    const sel = rectFrom(e);
    stopSelecting();
    if (sel.width < MIN_DRAG || sel.height < MIN_DRAG) return;
    // Måste köras synkront i pointerup så att urklippet räknas som en användarhandling.
    finish(sel);
  }

  function rectFrom(e) {
    const { x, y } = state.start;
    const left = Math.min(x, e.clientX), top = Math.min(y, e.clientY);
    const right = Math.max(x, e.clientX), bottom = Math.max(y, e.clientY);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function drawBox(e) {
    const r = rectFrom(e);
    Object.assign(state.box.style, {
      left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px',
    });
  }

  // Låter det kopierade innehållet lysa kvar en stund och tona ut.
  function flash(rects) {
    const f = el('div', `display:block;position:fixed;inset:0;z-index:${Z};pointer-events:none;` +
      'transition:opacity .5s ease .4s;opacity:1;');
    drawHighlights(f, rects);
    document.documentElement.append(f);
    requestAnimationFrame(() => requestAnimationFrame(() => { f.style.opacity = '0'; }));
    setTimeout(() => f.remove(), 1000);
  }

  function toast(msg, isError) {
    const t = el('div', `display:block;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:${Z};` +
      `pointer-events:none;background:${isError ? '#d93025' : '#1f1f1f'};color:#fff;` +
      'font:13px/1.4 system-ui,sans-serif;padding:8px 14px;border-radius:8px;' +
      'box-shadow:0 4px 16px rgba(0,0,0,.3);transition:opacity .3s ease;opacity:1;', msg);
    document.documentElement.append(t);
    setTimeout(() => { t.style.opacity = '0'; }, 1900);
    setTimeout(() => t.remove(), 2300);
  }

  // ---------------------------------------------------------------- Kopiering

  function finish(sel) {
    let result;
    try {
      result = extract(sel);
    } catch (err) {
      console.error('[Web Select]', err);
      toast(t('errorGeneric'), true);
      return;
    }
    state.lastResult = result;
    if (!result.text.trim()) {
      toast(t('errorNoText'), true);
      return;
    }
    const copied = copyToClipboard(result.html, result.text);
    // Highlighten är bara kosmetisk och får aldrig stoppa kopieringen.
    try {
      flash(result.rects);
    } catch (err) {
      console.warn('[Web Select] Kunde inte visa highlight:', err);
    }
    copied.then((ok) => {
      toast(ok ? result.summary : t('errorClipboard'), !ok);
    });
  }

  function copyToClipboard(html, text) {
    const fullHtml = '<meta charset="utf-8">' + html;
    let ok = false;
    const onCopy = (e) => {
      e.clipboardData.setData('text/html', fullHtml);
      e.clipboardData.setData('text/plain', text);
      e.preventDefault();
      ok = true;
    };
    document.addEventListener('copy', onCopy, true);
    try {
      document.execCommand('copy');
    } finally {
      document.removeEventListener('copy', onCopy, true);
    }
    if (ok) return Promise.resolve(true);

    // Reserv om sidan själv stoppar copy-eventet.
    return navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([fullHtml], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    })]).then(() => true, () => false);
  }

  // ---------------------------------------------------------------- Extrahering

  function extract(sel) {
    const tables = findTables(sel);
    const parts = [];
    const rects = [];   // det som tas med, för highlight
    const range = document.createRange();
    const blockCache = new Map();
    let block = null;
    let pendingBreak = false;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (n.nodeType === Node.ELEMENT_NODE) {
          return SKIP_TAGS.has(n.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
        return n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });

    let n = walker.nextNode();
    while (n) {
      if (n.nodeType === Node.ELEMENT_NODE) {
        if (tables.has(n)) {
          const data = tables.get(n);
          parts.push({ type: 'table', ...data });
          rects.push(...data.rects);
          block = null;
          n = nextOutside(walker, n);
          continue;
        }
        if (n.tagName === 'BR') pendingBreak = true;
        n = walker.nextNode();
        continue;
      }

      const run = textRun(n, sel, range);
      if (run) {
        const b = blockOf(n.parentElement, blockCache);
        if (!block || block.el !== b) {
          block = { type: 'block', el: b, tag: blockTag(b), runs: [] };
          parts.push(block);
        } else {
          const prev = block.runs[block.runs.length - 1];
          run.sep = pendingBreak ? '\n' : needsSpace(prev, run) ? ' ' : '';
        }
        pendingBreak = false;
        block.runs.push(run);
        rects.push(...run.rects);
      }
      n = walker.nextNode();
    }

    return { ...render(parts), rects };
  }

  // Nästa nod efter hela delträdet under `node`.
  function nextOutside(walker, node) {
    let cur = node;
    walker.currentNode = cur;
    let next = walker.nextSibling();
    while (!next) {
      cur = cur.parentNode;
      if (!cur || cur === document.body) return null;
      walker.currentNode = cur;
      next = walker.nextSibling();
    }
    return next;
  }

  // De ord i textnoden vars mittpunkt ligger inom markeringen.
  function textRun(node, sel, range) {
    const parent = node.parentElement;
    if (!parent) return null;
    range.selectNodeContents(node);
    const nr = range.getBoundingClientRect();
    if (!intersects(nr, sel)) return null;

    const style = getComputedStyle(parent);
    if (style.visibility === 'hidden' || isTiny(parent, style)) return null;

    const text = node.nodeValue;
    let words, rects;
    if (nr.left >= sel.left && nr.right <= sel.right && nr.top >= sel.top && nr.bottom <= sel.bottom) {
      words = [{ text: text.trim().replace(/\s+/g, ' '), rect: nr, lead: /^\s/.test(text), trail: /\s$/.test(text) }];
      rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
    } else {
      words = [];
      const re = /\S+/g;
      let m;
      while ((m = re.exec(text))) {
        const end = m.index + m[0].length;
        range.setStart(node, m.index);
        range.setEnd(node, end);
        const r = range.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        if (r.width && cx >= sel.left && cx <= sel.right && cy >= sel.top && cy <= sel.bottom) {
          words.push({ text: m[0], rect: r, lead: m.index > 0, trail: end < text.length });
        }
      }
      if (!words.length) return null;
      rects = lineRects(words);
    }

    const first = words[0], last = words[words.length - 1];
    const link = parent.closest('a[href]');
    return {
      text: words.map((w) => w.text).join(' '),
      first: first.rect,
      last: last.rect,
      lead: first.lead,
      trail: last.trail,
      bold: parseInt(style.fontWeight, 10) >= 600,
      italic: style.fontStyle === 'italic',
      href: link ? link.href : null,
      sep: '',
      rects,
    };
  }

  // Slår ihop intilliggande ord på samma rad till en rektangel.
  function lineRects(words) {
    const out = [];
    for (const { rect: r } of words) {
      const last = out[out.length - 1];
      if (last && Math.abs(last.top - r.top) < 2 && r.left - last.right < r.height) {
        last.right = Math.max(last.right, r.right);
        last.bottom = Math.max(last.bottom, r.bottom);
      } else {
        out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      }
    }
    return out;
  }

  function needsSpace(prev, run) {
    if (prev.trail || run.lead) return true;
    const a = prev.last, b = run.first;
    const otherLine = Math.abs(a.top - b.top) > Math.min(a.height, b.height) / 2;
    return otherLine || b.left - a.right > 1;
  }

  function blockOf(elm, cache) {
    for (let e = elm; e && e !== document.body; e = e.parentElement) {
      let isBlock = cache.get(e);
      if (isBlock === undefined) {
        const d = getComputedStyle(e).display;
        isBlock = !(d.startsWith('inline') || d === 'contents');
        cache.set(e, isBlock);
      }
      if (isBlock) return e;
    }
    return document.body;
  }

  function blockTag(b) {
    const t = b.tagName;
    if (/^H[1-6]$/.test(t)) return t.toLowerCase();
    if (t === 'LI') return 'li';
    return 'p';
  }

  // ---------------------------------------------------------------- Tabeller

  function findTables(sel) {
    const map = new Map();
    for (const table of document.querySelectorAll('table')) {
      if (!intersects(table.getBoundingClientRect(), sel)) continue;
      const data = extractTable(table, sel);
      if (data) map.set(table, data);
    }
    // Är både en tabell och en omslutande tabell markerade gäller den yttre.
    for (const t of [...map.keys()]) {
      for (let p = t.parentElement && t.parentElement.closest('table'); p; p = p.parentElement && p.parentElement.closest('table')) {
        if (map.has(p)) { map.delete(t); break; }
      }
    }
    return map;
  }

  function extractTable(table, sel) {
    const rows = Array.from(table.rows);
    const grid = rows.map(() => []);

    // Bygg ett rutnät där varje position pekar på cellen som täcker den (rowspan/colspan).
    rows.forEach((row, r) => {
      let c = 0;
      for (const cell of row.cells) {
        while (grid[r][c]) c++;
        const rs = cell.rowSpan === 0 ? rows.length - r : Math.max(1, cell.rowSpan);
        const cs = Math.max(1, cell.colSpan);
        for (let i = 0; i < rs && r + i < rows.length; i++) {
          for (let j = 0; j < cs; j++) grid[r + i][c + j] = cell;
        }
        c += cs;
      }
    });

    const picked = new Map();
    const isPicked = (cell) => {
      if (!cell) return false;
      if (!picked.has(cell)) picked.set(cell, cellSelected(cell.getBoundingClientRect(), sel));
      return picked.get(cell);
    };

    const rowsOut = [];
    const colSet = new Set();
    grid.forEach((cols, r) => {
      let any = false;
      cols.forEach((cell, c) => {
        if (isPicked(cell)) { any = true; colSet.add(c); }
      });
      if (any) rowsOut.push(r);
    });
    if (!rowsOut.length) return null;

    // En enda cell behandlas som vanlig text (vanligt med layouttabeller).
    const uniqueCells = new Set([...picked].filter(([, v]) => v).map(([k]) => k));
    if (uniqueCells.size === 1) return null;

    const colsOut = [...colSet].sort((a, b) => a - b);
    const seen = new Set();
    const cellRects = [];
    let html = '<table>';
    const lines = [];

    for (const r of rowsOut) {
      html += '<tr>';
      const line = [];
      for (const c of colsOut) {
        const cell = grid[r][c];
        if (!cell) {
          html += '<td></td>';
          line.push('');
          continue;
        }
        if (seen.has(cell)) {
          line.push('');
          continue;
        }
        seen.add(cell);
        cellRects.push(cell.getBoundingClientRect());
        let rs = 0, cs = 0;
        for (const r2 of rowsOut) if (r2 >= r && grid[r2][c] === cell) rs++;
        for (const c2 of colsOut) if (c2 >= c && grid[r][c2] === cell) cs++;
        const text = cellText(cell);
        const tag = cell.tagName === 'TH' ? 'th' : 'td';
        const span = (rs > 1 ? ` rowspan="${rs}"` : '') + (cs > 1 ? ` colspan="${cs}"` : '');
        // mso-data-placement håller radbrytningar i samma cell i Excel.
        const body = esc(text).replace(/\n/g, '<br style="mso-data-placement:same-cell">');
        html += `<${tag}${span}>${body}</${tag}>`;
        line.push(tsvField(text));
      }
      html += '</tr>';
      lines.push(line.join('\t'));
    }
    html += '</table>';

    return { html, text: lines.join('\n'), rows: rowsOut.length, cols: colsOut.length, rects: cellRects };
  }

  function cellSelected(r, sel) {
    const area = r.width * r.height;
    if (!area) return false;
    const w = Math.min(r.right, sel.right) - Math.max(r.left, sel.left);
    const h = Math.min(r.bottom, sel.bottom) - Math.max(r.top, sel.top);
    if (w <= 0 || h <= 0) return false;
    // Jämför mot den minsta ytan så att en liten markering inuti en stor cell också räknas.
    return (w * h) / Math.min(area, sel.width * sel.height) >= CELL_OVERLAP;
  }

  // Synlig text i cellen. innerText går inte att använda eftersom den tar med
  // visuellt dold text (t.ex. "sr-only").
  function cellText(cell) {
    let out = '';
    const walk = (node) => {
      for (const n of node.childNodes) {
        if (n.nodeType === Node.TEXT_NODE) {
          out += n.nodeValue;
          continue;
        }
        if (n.nodeType !== Node.ELEMENT_NODE || SKIP_TAGS.has(n.tagName)) continue;
        if (n.tagName === 'BR') {
          out += '\n';
          continue;
        }
        const st = getComputedStyle(n);
        if (st.display === 'none' || st.visibility === 'hidden' || isTiny(n, st)) continue;
        const block = !(st.display.startsWith('inline') || st.display === 'contents');
        if (block) out += '\n';
        walk(n);
        if (block) out += '\n';
      }
    };
    walk(cell);
    return out
      .split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
  }

  // Element som bara finns för skärmläsare (1×1 px).
  function isTiny(e, style) {
    if (style.display === 'contents') return false;
    const r = e.getBoundingClientRect();
    return r.width <= 1 && r.height <= 1;
  }

  function tsvField(text) {
    return /[\n"]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  // ---------------------------------------------------------------- Utdata

  function render(parts) {
    const html = [];
    const text = [];
    let inList = false;

    for (const p of parts) {
      const isLi = p.type === 'block' && p.tag === 'li';
      if (isLi && !inList) { html.push('<ul>'); inList = true; }
      if (!isLi && inList) { html.push('</ul>'); inList = false; }

      if (p.type === 'table') {
        html.push(p.html);
        text.push(p.text);
        continue;
      }
      let h = '', t = '';
      for (const r of p.runs) {
        t += r.sep + r.text;
        h += (r.sep === '\n' ? '<br>' : r.sep) + runHtml(r, p.tag);
      }
      html.push(`<${p.tag}>${h}</${p.tag}>`);
      text.push(t);
    }
    if (inList) html.push('</ul>');

    return { html: html.join(''), text: text.join('\n'), summary: summarize(parts) };
  }

  function runHtml(r, tag) {
    let s = esc(r.text);
    if (r.bold && tag[0] !== 'h') s = `<b>${s}</b>`;
    if (r.italic) s = `<i>${s}</i>`;
    if (r.href) s = `<a href="${esc(r.href)}">${s}</a>`;
    return s;
  }

  function summarize(parts) {
    const tables = parts.filter((p) => p.type === 'table');
    const hasText = parts.some((p) => p.type === 'block');
    if (tables.length === 1 && !hasText) {
      return t('copiedTableSize', [tables[0].rows, tables[0].cols]);
    }
    if (tables.length === 1) return t('copiedOneTableAndText');
    if (tables.length) return t(hasText ? 'copiedTablesAndText' : 'copiedTables', [tables.length]);
    return t('copiedText');
  }

  function intersects(a, b) {
    return (a.width > 0 || a.height > 0) &&
      a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
  }

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  window.__webSelect = { toggle, get lastResult() { return state.lastResult; } };
  startSelecting();
})();
