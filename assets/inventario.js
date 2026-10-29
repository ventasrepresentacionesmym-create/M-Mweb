window.Inventario = (() => {
  const FILE_NAMES = {
    articulos: ['Listado_de_articulos.xls', 'Listado_de_articulos.xlsx'],
    existencias: ['Resumen_de_existencias_UC.xls', 'Resumen_de_existencias_UC.xlsx']
  };
  const ROW_H = 40;
  const BUFFER = 8;
  const IDB_NAME = 'inventario-uc';
  const IDB_STORE = 'handles';

  let PRODUCTS = [];
  let dirHandle = null;
  let pendingHandle = null;
  let ALL = [];
  let view = [];
  let sortKey = null;
  let sortDir = 1;
  let iniciado = false;
  let reconectado = false;

  const $ = (id) => document.getElementById(id);

  function mostrar(el, visible) {
    if (el) el.hidden = !visible;
  }

  function toFloat(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return v;
    let s = String(v).trim();
    if (!s) return 0;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const f = parseFloat(s);
    return isNaN(f) ? 0 : f;
  }

  function fmtNum(v) {
    const f = toFloat(v);
    let s = f.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (s.endsWith(',00')) s = s.slice(0, -3);
    return s;
  }

  function fmtPct(v) {
    const f = toFloat(v);
    return f + '%';
  }

  function cleanLoteFecha(v) {
    const s = (v || '').trim();
    if (!s || /^\|+$/.test(s)) return '—';
    return s;
  }

  function normalize(str) {
    return (str || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s === null || s === undefined ? '' : String(s);
    return d.innerHTML;
  }

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsArrayBuffer(file);
    });
  }

  function bytesToText(buf) {
    try { return new TextDecoder('windows-1252').decode(buf); }
    catch (e) { return new TextDecoder('utf-8').decode(buf); }
  }

  function loadSheetJS() {
    return new Promise((resolve, reject) => {
      if (window.XLSX) return resolve();
      const s = document.createElement('script');
      s.src = 'assets/vendor/xlsx/xlsx.full.min.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Falta el lector de Excel.'));
      document.head.appendChild(s);
    });
  }

  function htmlTableToRows(tableEl) {
    const rows = [];
    for (const tr of tableEl.querySelectorAll('tr')) {
      const cells = tr.querySelectorAll('td,th');
      if (!cells.length) continue;
      rows.push(Array.from(cells).map((c) => c.textContent.replace(/\s+/g, ' ').trim()));
    }
    return rows;
  }

  function findHeaderRow(rows, mustHaveAnyOf) {
    const wanted = mustHaveAnyOf.map((w) => w.toLowerCase());
    for (let i = 0; i < rows.length; i++) {
      const lc = rows[i].map((c) => c.toLowerCase().trim());
      if (wanted.some((w) => lc.includes(w))) return i;
    }
    return -1;
  }

  function extractFromHtml(text, headerHints) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const tables = Array.from(doc.querySelectorAll('table'));
    if (!tables.length) throw new Error('El archivo no tiene tabla.');
    let best = null;
    for (const t of tables) {
      const rows = htmlTableToRows(t);
      const idx = findHeaderRow(rows, headerHints);
      if (idx !== -1) { best = { rows, headerIdx: idx }; break; }
    }
    if (!best) throw new Error('No se reconoce el archivo.');
    return { header: best.rows[best.headerIdx], body: best.rows.slice(best.headerIdx + 1) };
  }

  async function extractFromBinary(arrayBuffer, headerHints) {
    await loadSheetJS();
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }).map((r) => r.map((c) => String(c)));
      const idx = findHeaderRow(rows, headerHints);
      if (idx !== -1) return { header: rows[idx], body: rows.slice(idx + 1) };
    }
    throw new Error('No se reconoce el archivo.');
  }

  async function parseWorkbookFile(file, headerHints) {
    const buf = await readFileAsArrayBuffer(file);
    const bytes = new Uint8Array(buf.slice(0, 8));
    if (bytes[0] === 0x50 && bytes[1] === 0x4B) return extractFromBinary(buf, headerHints);
    if (bytes[0] === 0xD0 && bytes[1] === 0xCF) return extractFromBinary(buf, headerHints);
    return extractFromHtml(bytesToText(buf), headerHints);
  }

  function colIndex(header, name) {
    const target = name.toLowerCase().trim();
    return header.findIndex((h) => h.toLowerCase().trim() === target);
  }

  function buildInventario(articulosData, existenciasData) {
    const ah = articulosData.header;
    const ab = articulosData.body;
    const eh = existenciasData.header;
    const eb = existenciasData.body;

    const aiCodigo = colIndex(ah, 'codigo');
    const aiNombre = colIndex(ah, 'nombre');
    const aiProv = colIndex(ah, 'proveedor');
    const aiIva = colIndex(ah, '% iva');

    const eiArticulo = colIndex(eh, 'articulo');
    const eiNombre = colIndex(eh, 'nombre');
    const eiExi = eh.findIndex((h) => h.toLowerCase().trim().startsWith('exi'));
    const eiProm = colIndex(eh, 'promedio');

    if (aiCodigo === -1 || aiNombre === -1) throw new Error('Faltan columnas en artículos.');
    if (eiArticulo === -1) throw new Error('Falta la columna Artículo.');

    const products = new Map();
    const order = [];

    for (const r of ab) {
      if (r.length <= Math.max(aiCodigo, aiNombre)) continue;
      const codigo = (r[aiCodigo] || '').trim();
      const nombre = (r[aiNombre] || '').trim();
      if (!codigo || !nombre) continue;
      if (/registro\(s\)/i.test(codigo)) continue;
      const proveedor = aiProv !== -1 ? (r[aiProv] || '').trim() : '';
      const iva = aiIva !== -1 && r[aiIva] !== '' ? fmtPct(r[aiIva]) : '';
      if (!products.has(codigo)) {
        products.set(codigo, { codigo, nombre, proveedor, iva, exi: 0, costo: 0, lotes: [] });
        order.push(codigo);
      }
    }

    for (const r of eb) {
      if (r.length <= eiArticulo) continue;
      const raw = (r[eiArticulo] || '').trim();
      const nombreExi = eiNombre !== -1 ? (r[eiNombre] || '').trim() : '';
      if (!raw || !nombreExi) continue;
      if (/registro\(s\)/i.test(raw)) continue;

      let codigo;
      let resto;
      if (raw.includes('|')) {
        const i = raw.indexOf('|');
        codigo = raw.slice(0, i).trim();
        resto = raw.slice(i + 1).trim();
      } else { codigo = raw; resto = ''; }

      let lote;
      let fecha;
      if (resto.includes(':')) {
        const i = resto.indexOf(':');
        lote = resto.slice(0, i).trim();
        fecha = resto.slice(i + 1).trim();
      } else { lote = resto; fecha = ''; }

      const cantidad = eiExi !== -1 ? toFloat(r[eiExi]) : 0;
      const costo = eiProm !== -1 ? toFloat(r[eiProm]) : 0;

      if (!products.has(codigo)) {
        products.set(codigo, { codigo, nombre: nombreExi, proveedor: '', iva: '', exi: 0, costo: 0, lotes: [] });
        order.push(codigo);
      }
      const p = products.get(codigo);
      p.exi += cantidad;
      if (costo > p.costo) p.costo = costo;
      p.lotes.push({ lote: cleanLoteFecha(lote), fecha: cleanLoteFecha(fecha), cantidad: fmtNum(cantidad), costo: fmtNum(costo) });
    }

    return order.map((k) => {
      const p = products.get(k);
      return {
        codigo: p.codigo, nombre: p.nombre, proveedor: p.proveedor, iva: p.iva,
        exiFmt: fmtNum(p.exi), costoFmt: fmtNum(p.costo), lotes: p.lotes
      };
    });
  }

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSet(key, val) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function findFileInDir(dir, candidateNames) {
    for (const name of candidateNames) {
      try {
        const fh = await dir.getFileHandle(name);
        return await fh.getFile();
      } catch (e) { /* prueba el siguiente nombre */ }
    }
    return null;
  }

  async function loadFromDirectory(dir, statusEl) {
    statusEl.textContent = 'Buscando archivos.';
    const [fArt, fExi] = await Promise.all([
      findFileInDir(dir, FILE_NAMES.articulos),
      findFileInDir(dir, FILE_NAMES.existencias)
    ]);
    const faltantes = [];
    if (!fArt) faltantes.push(FILE_NAMES.articulos[0]);
    if (!fExi) faltantes.push(FILE_NAMES.existencias[0]);
    if (faltantes.length) throw new Error('Faltan: ' + faltantes.join(', '));

    statusEl.textContent = 'Leyendo archivos.';
    const [artData, exiData] = await Promise.all([
      parseWorkbookFile(fArt, ['codigo']),
      parseWorkbookFile(fExi, ['articulo'])
    ]);
    return buildInventario(artData, exiData);
  }

  async function connectFolder() {
    const statusEl = $('invMsg');
    statusEl.className = 'msg';
    if (!window.showDirectoryPicker) {
      statusEl.className = 'msg err';
      statusEl.textContent = 'Usa los dos archivos.';
      return;
    }
    try {
      const handle = await window.showDirectoryPicker();
      dirHandle = handle;
      pendingHandle = null;
      await idbSet('inventario-dir', handle);
      resetConnectBtn();
      const products = await loadFromDirectory(handle, statusEl);
      finishLoad(products);
    } catch (err) {
      if (err.name === 'AbortError') { statusEl.textContent = ''; return; }
      statusEl.className = 'msg err';
      statusEl.textContent = err.message;
    }
  }

  async function reconnectPermission() {
    const statusEl = $('invMsg');
    statusEl.className = 'msg';
    if (!pendingHandle) { connectFolder(); return; }
    try {
      const perm = await pendingHandle.requestPermission({ mode: 'read' });
      if (perm !== 'granted') {
        statusEl.className = 'msg err';
        statusEl.textContent = 'Permiso denegado.';
        return;
      }
      dirHandle = pendingHandle;
      pendingHandle = null;
      resetConnectBtn();
      statusEl.textContent = 'Leyendo archivos.';
      const products = await loadFromDirectory(dirHandle, statusEl);
      finishLoad(products);
    } catch (err) {
      statusEl.className = 'msg err';
      statusEl.textContent = err.message;
    }
  }

  function resetConnectBtn() {
    $('invConectar').textContent = 'Conectar carpeta';
  }

  async function tryAutoReconnect() {
    if (reconectado) return;
    reconectado = true;
    if (!window.showDirectoryPicker) return;
    try {
      const handle = await idbGet('inventario-dir');
      if (!handle) return;
      const perm = await handle.queryPermission({ mode: 'read' });
      if (perm === 'granted') {
        dirHandle = handle;
        $('invMsg').textContent = 'Carpeta conectada, leyendo archivos.';
        try {
          const products = await loadFromDirectory(handle, $('invMsg'));
          finishLoad(products);
        } catch (err) {
          $('invMsg').className = 'msg err';
          $('invMsg').textContent = err.message;
        }
      } else {
        pendingHandle = handle;
        $('invConectar').textContent = 'Reconectar carpeta';
      }
    } catch (e) { /* sin carpeta guardada */ }
  }

  async function handleFiles(files) {
    const statusEl = $('invMsg');
    statusEl.className = 'msg';
    const list = Array.from(files);
    const fArt = list.find((f) => /listado.*articulo|articulo.*listado/i.test(f.name)) || list.find((f) => !/existenc/i.test(f.name));
    const fExi = list.find((f) => /existenc/i.test(f.name)) || list.find((f) => f !== fArt);

    $('invArchivosNombre').textContent = list.map((f) => f.name).join(' · ') || 'Arrastra o selecciona los dos archivos.';

    if (!fArt || !fExi || fArt === fExi) {
      statusEl.className = 'msg err';
      statusEl.textContent = 'Faltan los dos archivos.';
      return;
    }

    try {
      statusEl.textContent = 'Leyendo archivos.';
      const [artData, exiData] = await Promise.all([
        parseWorkbookFile(fArt, ['codigo']),
        parseWorkbookFile(fExi, ['articulo'])
      ]);
      finishLoad(buildInventario(artData, exiData));
    } catch (err) {
      statusEl.className = 'msg err';
      statusEl.textContent = err.message;
    }
  }

  function finishLoad(products) {
    if (!products.length) {
      $('invMsg').className = 'msg err';
      $('invMsg').textContent = 'Sin productos.';
      return;
    }
    PRODUCTS = products;
    $('invMsg').className = 'msg';
    $('invMsg').textContent = '';
    $('invAviso').className = 'msg';
    $('invAviso').textContent = '';
    $('invSub').textContent = products.length + ' artículos · ' + products.filter((p) => p.lotes.length).length + ' con existencia';
    mostrar($('invCarga'), false);
    mostrar($('invTabla'), true);
    renderAll(products);
  }

  function renderAll(products) {
    ALL = products.map((p) => ({
      ...p,
      _codigo_n: normalize(p.codigo),
      _nombre_n: normalize(p.nombre),
      _proveedor_n: normalize(p.proveedor),
      _iva_n: normalize(p.iva),
      _exi_n: normalize(p.exiFmt),
      _costo_n: normalize(p.costoFmt)
    }));
    ALL.forEach((p) => { p._full_n = [p._codigo_n, p._nombre_n, p._proveedor_n].join(' '); });
    view = ALL.slice();
    sortKey = null;
    sortDir = 1;

    const provSelect = document.querySelector('[data-colfilter="proveedor"]');
    const ivaSelect = document.querySelector('[data-colfilter="iva"]');
    const provs = [...new Set(ALL.map((p) => p.proveedor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    const ivas = [...new Set(ALL.map((p) => p.iva).filter(Boolean))].sort();
    provSelect.innerHTML = '<option value="">Todos</option>' + provs.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
    ivaSelect.innerHTML = '<option value="">Todos</option>' + ivas.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
    $('invBusqueda').value = '';
    document.querySelectorAll('[data-colfilter]').forEach((el) => {
      if (el !== provSelect && el !== ivaSelect) el.value = '';
    });
    $('invAviso').textContent = '';
    document.querySelectorAll('.inv-cabecera .arrow').forEach((a) => a.remove());
    refresh(true);
  }

  function renderVisible() {
    const viewport = $('invViewport');
    const scrollTop = viewport.scrollTop;
    const viewportH = viewport.clientHeight;
    const start = Math.max(0, Math.floor(scrollTop / ROW_H) - BUFFER);
    const end = Math.min(view.length, Math.ceil((scrollTop + viewportH) / ROW_H) + BUFFER);
    $('invVentana').style.transform = `translateY(${start * ROW_H}px)`;
    const html = [];
    for (let i = start; i < end; i++) {
      const p = view[i];
      html.push(
        '<div class="inv-fila dato">' +
        '<div class="c-detalle"><button type="button" class="inv-ver" data-codigo="' + esc(p.codigo) + '">Ver</button></div>' +
        '<div class="c-codigo">' + esc(p.codigo) + '</div>' +
        '<div class="c-nombre">' + esc(p.nombre) + '</div>' +
        '<div class="c-proveedor">' + esc(p.proveedor) + '</div>' +
        '<div class="c-iva">' + esc(p.iva) + '</div>' +
        '<div class="c-exi">' + esc(p.exiFmt) + '</div>' +
        '<div class="c-costo">' + esc(p.costoFmt) + '</div>' +
        '</div>'
      );
    }
    $('invVentana').innerHTML = html.join('');
  }

  function refresh(resetScroll) {
    const viewport = $('invViewport');
    $('invScroller').style.height = (view.length * ROW_H) + 'px';
    if (resetScroll) viewport.scrollTop = 0;
    renderVisible();
    $('invCuenta').textContent = view.length === ALL.length ? `${ALL.length} artículos` : `${view.length} de ${ALL.length}`;
    mostrar($('invVacio'), view.length === 0);
  }

  function applyFilters() {
    const query = normalize($('invBusqueda').value.trim());
    const tokens = query.split(/\s+/).filter(Boolean);
    const vals = {};
    document.querySelectorAll('[data-colfilter]').forEach((el) => {
      vals[el.dataset.colfilter] = normalize(el.value.trim());
    });

    let out = ALL.filter((p) => {
      if (tokens.length && !tokens.every((t) => p._full_n.includes(t))) return false;
      if (vals.codigo && !p._codigo_n.includes(vals.codigo)) return false;
      if (vals.nombre && !p._nombre_n.includes(vals.nombre)) return false;
      if (vals.proveedor && p._proveedor_n !== vals.proveedor) return false;
      if (vals.iva && p._iva_n !== vals.iva) return false;
      if (vals.exi && !p._exi_n.includes(vals.exi)) return false;
      if (vals.costo && !p._costo_n.includes(vals.costo)) return false;
      return true;
    });

    if (sortKey) {
      out.sort((a, b) => {
        const nk = '_' + sortKey + '_n';
        return a[nk].localeCompare(b[nk], 'es', { sensitivity: 'base', numeric: true }) * sortDir;
      });
    }
    view = out;
    refresh(true);
  }

  function openModal(codigo) {
    const p = PRODUCTS.find((x) => x.codigo === codigo);
    if (!p) return;
    $('invModalCodigo').textContent = p.codigo;
    $('invModalNombre').textContent = p.nombre;
    $('invModalSub').textContent = 'Proveedor: ' + (p.proveedor || '—') + ' · Iva: ' + (p.iva || '—');
    const body = $('invModalBody');
    if (!p.lotes.length) {
      body.innerHTML = '<p class="empty">Sin existencia registrada.</p>';
    } else {
      body.innerHTML = '<table><thead><tr><th>Lote</th><th>Vencimiento</th><th class="inv-num">Cantidad</th><th class="inv-num">Costo</th></tr></thead><tbody>' +
        p.lotes.map((l) => `<tr><td>${esc(l.lote)}</td><td>${esc(l.fecha)}</td><td class="inv-num">${esc(l.cantidad)}</td><td class="inv-num">${esc(l.costo)}</td></tr>`).join('') +
        '</tbody></table>';
    }
    mostrar($('invModal'), true);
  }

  function closeModal() {
    mostrar($('invModal'), false);
  }

  function movDecode(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { return new TextDecoder('windows-1252').decode(buf); }
  }

  function movNum(s) {
    if (typeof s === 'number') return s;
    s = String(s == null ? '' : s).trim();
    if (!s || s === '_') return null;
    const neg = /^\(.*\)$/.test(s) || s.charAt(0) === '-';
    const v = parseFloat(s.replace(/[(),\s-]/g, ''));
    return isNaN(v) ? null : (neg ? -v : v);
  }

  function movQf(x) { return x.toLocaleString('es-CO', { maximumFractionDigits: 2 }); }
  function movPf(x) { return x == null ? '—' : x.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function movRev(s) { return s ? s.split('-').reverse().join('-') : '—'; }

  function rowsFromMovHtml(text) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    return Array.from(doc.querySelectorAll('tr')).map((tr) =>
      Array.from(tr.children).map((c) => c.textContent.replace(/\u00a0/g, ' ').trim())
    );
  }

  function rowsFromMovBook(buf) {
    const wb = XLSX.read(buf, { type: 'array' });
    let all = [];
    wb.SheetNames.forEach((n) => { all = all.concat(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' })); });
    return all.map((r) => r.map((c) => String(c).trim()));
  }

  function parseMovimientos(rows) {
    const out = [];
    let cur = null;
    rows.forEach((r, i) => {
      const c0 = (r[0] || '').trim();
      let m;

      if ((m = c0.match(/^Articulo:\s*\(([^)]*)\)\s*(.*)$/i))) {
        const inner = m[1].trim();
        const nom = m[2] || '';
        const parts = inner.split(/\s+/);
        const cod = (parts[0] || '').trim();
        const rest = parts.slice(1).join(' ').trim();
        let lot = '—';
        let ven = '';
        if (rest) {
          const lm = rest.match(/^([^:]*):(.*)$/);
          if (lm) {
            lot = lm[1].replace(/\|/g, '').trim() || '—';
            ven = lm[2].replace(/\|/g, '').trim();
          } else {
            lot = rest.replace(/\|/g, '').trim() || '—';
          }
        }
        cur = { cod, lot, ven, nom };
        return;
      }
      if (!cur) return;

      let y;
      let mn;
      let dd;
      let d;
      if ((d = c0.match(/^(\d{4})-(\d{2})-(\d{2})/))) { y = d[1]; mn = d[2]; dd = d[3]; }
      else if ((d = c0.match(/^(\d{2})-(\d{2})-(\d{2,4})/))) { dd = d[1]; mn = d[2]; y = d[3].length === 2 ? '20' + d[3] : d[3]; }
      else return;

      const qi = movNum(r[4]);
      const vi = movNum(r[5]);
      const pi = movNum(r[6]);
      const qo = movNum(r[7]);
      const vo = movNum(r[8]);
      const po = movNum(r[9]);
      const sal = qo != null || vo != null;
      const ini = /INICIO/i.test((r[1] || '') + ' ' + (r[2] || ''));
      let q = sal ? qo : qi;
      if (q == null) q = 0;
      let p = sal ? po : pi;
      if (p == null) {
        const v = sal ? vo : vi;
        if (v != null && q) p = v / q;
      }
      out.push({
        cod: cur.cod,
        nom: cur.nom,
        tipo: ini ? 'Saldo inicial' : (sal ? 'Salida' : 'Entrada'),
        sal,
        q,
        precio: sal ? p : null,
        costo: sal ? null : p,
        f: y + '-' + mn + '-' + dd,
        lot: cur.lot,
        ven: cur.ven,
        o: i,
        doc: (r[1] || '').trim(),
        tercero: (r[3] || '').trim()
      });
    });
    out.sort((a, b) => (a.f < b.f ? -1 : a.f > b.f ? 1 : a.o - b.o));
    return out;
  }

  function renderMovimientos(list) {
    const arts = {};
    let h = '';
    list.forEach((m) => { (arts[m.cod] = arts[m.cod] || []).push(m); });
    Object.keys(arts).forEach((cod) => {
      let rs = arts[cod];
      const used = {};
      rs.forEach((m) => { if (m.q !== 0) used[m.lot] = 1; });
      rs = rs.filter((m) => used[m.lot]);
      const st = {};
      rs.forEach((m) => {
        const s = st[m.lot] = st[m.lot] || { lot: m.lot, ven: m.ven, q: 0 };
        s.q += m.sal ? -m.q : m.q;
      });
      const sl = Object.keys(st).map((k) => st[k]).filter((s) => s.q !== 0)
        .sort((a, b) => (a.ven < b.ven ? -1 : a.ven > b.ven ? 1 : 0));
      const tt = sl.reduce((a, s) => a + s.q, 0);

      h += '<div class="inv-mov-cab"><div><strong>' + esc(cod) + '</strong><p class="sub">' + esc(rs.length ? rs[0].nom : arts[cod][0].nom) + '</p></div>' +
        '<div class="inv-mov-total"><span>Total actual</span><b>' + movQf(tt) + '</b></div></div>';

      h += '<h3 class="inv-mov-sec">Existencias por lote</h3><div class="card"><table><thead><tr><th>Lote</th><th>Vencimiento</th><th class="inv-num">Cantidad</th></tr></thead><tbody>';
      h += sl.length
        ? sl.map((s) => '<tr><td>' + esc(s.lot) + '</td><td>' + movRev(s.ven) + '</td><td class="inv-num">' + movQf(s.q) + '</td></tr>').join('')
        : '<tr><td colspan="3">Sin existencias.</td></tr>';
      h += '</tbody></table></div>';

      h += '<h3 class="inv-mov-sec">Movimientos</h3><div class="card"><table><thead><tr>' +
        '<th>Tipo</th><th>Documento</th><th>Tercero</th><th class="inv-num">Cantidad</th>' +
        '<th class="inv-num">Precio (salidas)</th><th class="inv-num">Costo (entradas)</th><th>Fecha</th>' +
        '<th>Lote</th><th>Vencimiento</th>' +
        '</tr></thead><tbody>';
      h += rs.map((m) =>
        '<tr>' +
        '<td>' + esc(m.tipo) + '</td>' +
        '<td class="inv-doc">' + esc(m.doc || '—') + '</td>' +
        '<td class="inv-doc">' + esc(m.tercero || '—') + '</td>' +
        '<td class="inv-num">' + (m.sal ? '-' : '') + movQf(m.q) + '</td>' +
        '<td class="inv-num">' + movPf(m.precio) + '</td>' +
        '<td class="inv-num">' + movPf(m.costo) + '</td>' +
        '<td>' + movRev(m.f) + '</td>' +
        '<td>' + esc(m.lot) + '</td>' +
        '<td>' + movRev(m.ven) + '</td>' +
        '</tr>'
      ).join('');
      h += '</tbody></table></div>';
    });
    $('invMovSalida').innerHTML = h;
  }

  async function loadMovimientosFile(file) {
    const msgEl = $('invMovMsg');
    msgEl.className = 'msg';
    msgEl.textContent = '';
    if (!file) return;
    try {
      const buf = await readFileAsArrayBuffer(file);
      const head = movDecode(buf.slice(0, 4000));
      let rows;
      if (/<\s*(html|table|tr|body)/i.test(head)) {
        rows = rowsFromMovHtml(movDecode(buf));
      } else {
        await loadSheetJS();
        rows = rowsFromMovBook(buf);
      }
      const list = parseMovimientos(rows);
      if (!list.length) {
        msgEl.className = 'msg err';
        msgEl.textContent = 'Sin movimientos.';
        return;
      }
      renderMovimientos(list);
      mostrar($('invMovCarga'), false);
      mostrar($('invMovOtro'), true);
      $('invMovSub').textContent = file.name;
      window.scrollTo({ top: 0, behavior: 'auto' });
    } catch (err) {
      msgEl.className = 'msg err';
      msgEl.textContent = 'No se pudo leer el archivo.';
    }
  }

  function abrirMovimientos(mostrarPantalla) {
    mostrar($('invHead'), !mostrarPantalla);
    mostrar($('invTabla'), !mostrarPantalla);
    mostrar($('invMov'), mostrarPantalla);
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (!mostrarPantalla) requestAnimationFrame(renderVisible);
  }

  function init() {
    if (iniciado) return;
    iniciado = true;

    const viewport = $('invViewport');
    let ticking = false;
    viewport.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { renderVisible(); ticking = false; });
    });
    window.addEventListener('resize', () => {
      if (!$('pantallaInventario').hidden) renderVisible();
    });

    $('invBusqueda').addEventListener('input', applyFilters);
    document.querySelectorAll('[data-colfilter]').forEach((el) => {
      el.addEventListener('input', applyFilters);
      el.addEventListener('change', applyFilters);
    });
    $('invLimpiar').addEventListener('click', () => {
      $('invBusqueda').value = '';
      document.querySelectorAll('[data-colfilter]').forEach((el) => { el.value = ''; });
      applyFilters();
    });

    $('invCabecera').querySelectorAll('[data-key]').forEach((div) => {
      div.addEventListener('click', () => {
        const key = div.dataset.key;
        sortDir = sortKey === key ? -sortDir : 1;
        sortKey = key;
        document.querySelectorAll('.inv-cabecera .arrow').forEach((a) => a.remove());
        const arrow = document.createElement('span');
        arrow.className = 'arrow';
        arrow.textContent = sortDir === 1 ? '↑' : '↓';
        div.appendChild(arrow);
        applyFilters();
      });
    });

    $('invVentana').addEventListener('click', (e) => {
      const btn = e.target.closest('.inv-ver');
      if (btn) openModal(btn.dataset.codigo);
    });
    $('invModalCerrar').addEventListener('click', closeModal);
    $('invModal').addEventListener('click', (e) => { if (e.target === $('invModal')) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

    $('invConectar').addEventListener('click', () => {
      if (pendingHandle) reconnectPermission();
      else connectFolder();
    });

    const drop = $('invArchivos').closest('.filebox');
    $('invArchivos').addEventListener('change', (e) => {
      if (e.target.files.length) handleFiles(e.target.files);
      e.target.value = '';
    });
    ['dragenter', 'dragover'].forEach((evt) => drop.addEventListener(evt, (e) => { e.preventDefault(); drop.classList.add('sobre'); }));
    ['dragleave', 'drop'].forEach((evt) => drop.addEventListener(evt, (e) => { e.preventDefault(); drop.classList.remove('sobre'); }));
    drop.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });

    $('invCambiar').addEventListener('click', () => {
      mostrar($('invTabla'), false);
      mostrar($('invCarga'), true);
      $('invMsg').textContent = '';
    });
    $('invActualizar').addEventListener('click', async () => {
      const aviso = $('invAviso');
      aviso.className = 'msg';
      aviso.textContent = '';
      if (!dirHandle) {
        aviso.className = 'msg err';
        aviso.textContent = 'Conecta la carpeta o carga los archivos.';
        return;
      }
      try {
        const perm = await dirHandle.requestPermission({ mode: 'read' });
        if (perm !== 'granted') throw new Error('Permiso denegado.');
        const products = await loadFromDirectory(dirHandle, aviso);
        finishLoad(products);
      } catch (err) {
        aviso.className = 'msg err';
        aviso.textContent = err.message;
      }
    });

    $('invBtnMov').addEventListener('click', () => abrirMovimientos(true));
    $('invMovVolver').addEventListener('click', () => abrirMovimientos(false));
    $('invMovOtro').addEventListener('click', () => {
      mostrar($('invMovCarga'), true);
      mostrar($('invMovOtro'), false);
      $('invMovArchivo').value = '';
      $('invMovMsg').textContent = '';
      $('invMovArchivo').click();
    });
    $('invMovArchivo').addEventListener('change', (e) => {
      loadMovimientosFile(e.target.files[0]);
      e.target.value = '';
    });
    const movDrop = $('invMovArchivo').closest('.filebox');
    ['dragenter', 'dragover'].forEach((evt) => movDrop.addEventListener(evt, (e) => { e.preventDefault(); movDrop.classList.add('sobre'); }));
    ['dragleave', 'drop'].forEach((evt) => movDrop.addEventListener(evt, (e) => { e.preventDefault(); movDrop.classList.remove('sobre'); }));
    movDrop.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) loadMovimientosFile(e.dataTransfer.files[0]); });
  }

  function abrir() {
    init();
    tryAutoReconnect();
  }

  return { abrir };
})();
