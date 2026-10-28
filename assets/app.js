'use strict';

(() => {
  const CFG = window.CONFIG || {};
  if (!window.supabase || !CFG.SUPABASE_URL || !CFG.SUPABASE_KEY) {
    document.body.innerHTML =
      '<div class="wrap"><div class="card"><h1>Falta configuración</h1><p>Revisa <code>assets/config.js</code>.</p></div></div>';
    return;
  }

  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);
  const $ = (id) => document.getElementById(id);

  const PANTALLA_IDS = {
    subir: 'pantallaSubir',
    revision: 'pantallaRevision',
    lista: 'pantallaLista',
    factura: 'pantallaFactura'
  };

  const state = {
    pantalla: 'subir',
    soporte: null,
    xml: null,
    xmlTexto: '',
    datos: null,
    txtGenerado: '',
    factura: null,
    lista: [],
    filtro: 'todas',
    busqueda: ''
  };

  // ---------- Utilidades ----------

  function esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function num(v) {
    if (v === null || v === undefined) return null;
    let s = String(v).trim();
    if (!s) return null;
    s = s.replace(/\s/g, '').replace(/[^\d,.\-]/g, '');
    if (!s) return null;
    if (s.includes(',') && s.includes('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.includes(',')) {
      s = s.replace(',', '.');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function round2(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return null;
    return Math.round(v * 100) / 100;
  }

  function cleanFactura(s) {
    return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function normFecha(v) {
    if (!v) return '';
    const s = String(v).trim();
    let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return '';
  }

  function normVencimiento(v) {
    if (!v) return '';
    const s = String(v).trim();
    let m = s.match(/^(\d{4})[-\/.](\d{1,2})(?:[-\/.](\d{1,2}))?/);
    if (m) {
      return m[3]
        ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
        : `${m[1]}-${m[2].padStart(2, '0')}`;
    }
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})[-\/.](\d{4})/);
    if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
    return s;
  }

  function presentacionDe(lote, venc) {
    const l = String(lote || '').replace(/[^A-Za-z0-9]/g, '');
    const v = normVencimiento(venc);
    if (!l && !v) return '||';
    return `${l}:${v || '||'}`;
  }

  function fmtFecha(v) {
    if (!v) return '—';
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    return String(v);
  }

  function fmtFechaHora(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    try {
      return d.toLocaleString('es-CO', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return d.toISOString().slice(0, 16).replace('T', ' ');
    }
  }

  function bytes(n) {
    if (!Number.isFinite(n)) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function nombreCortoProveedor(nombre) {
    let n = String(nombre || '').toUpperCase().replace(/\s+/g, ' ').trim();
    const re = /\s+(LTDA\.?|LIMITADA|S\.?A\.?S\.?|S\.?A\.?|E\.?U\.?|SAS|EU)\.?$/i;
    let prev;
    do {
      prev = n;
      n = n.replace(re, '').trim();
    } while (n !== prev);
    return n;
  }

  function setMsg(id, texto, tipo) {
    const el = $(id);
    if (!el) return;
    el.textContent = texto || '';
    el.className = 'msg' + (tipo ? ' ' + tipo : '');
  }

  function setBusy(btn, busy, texto) {
    if (!btn) return;
    if (busy) {
      if (!btn.disabled) btn.dataset.prev = btn.textContent;
      btn.disabled = true;
      if (texto) btn.textContent = texto;
    } else {
      btn.disabled = false;
      if (btn.dataset.prev != null) {
        btn.textContent = btn.dataset.prev;
        delete btn.dataset.prev;
      }
    }
  }

  function mostrar(el, visible) {
    if (el) el.hidden = !visible;
  }

  function badgeEstado(estado) {
    return estado === 'ingresada'
      ? '<span class="badge badge-ok">Ingresada</span>'
      : '<span class="badge badge-pending">Pendiente</span>';
  }

  // ---------- Navegación ----------

  function nav(nombre) {
    Object.values(PANTALLA_IDS).forEach((id) => {
      $(id).hidden = true;
    });
    $(PANTALLA_IDS[nombre]).hidden = false;
    state.pantalla = nombre;
    $('btnVolver').hidden = nombre === 'subir';
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function volver() {
    if (state.pantalla === 'revision') {
      if (!confirm('¿Descartar los datos sin guardar?')) return;
      limpiarNueva();
      nav('subir');
      return;
    }
    if (state.pantalla === 'lista') {
      nav('subir');
      return;
    }
    if (state.pantalla === 'factura') {
      irLista();
    }
  }

  async function irLista() {
    if (state.pantalla === 'revision' && !confirm('¿Descartar los datos sin guardar?')) return;
    if (state.lista.length) renderLista();
    nav('lista');
    await cargarLista();
  }

  function nuevaFactura() {
    limpiarNueva();
    nav('subir');
  }

  function limpiarNueva() {
    state.soporte = null;
    state.xml = null;
    state.xmlTexto = '';
    state.datos = null;
    state.txtGenerado = '';
    $('soporteFile').value = '';
    $('xmlFile').value = '';
    $('soporteNombre').textContent = 'Ningún archivo';
    $('xmlNombre').textContent = 'Ningún archivo';
    $('revProveedor').value = '';
    $('revFactura').value = '';
    $('revFecha').value = '';
    $('revNit').value = '';
    $('revProductos').innerHTML = '';
    $('revTxt').textContent = '';
    setMsg('msgSubir', '');
    setMsg('msgRevision', '');
  }

  // ---------- Archivos ----------

  function mimeDeArchivo(file) {
    if (file.type) return file.type;
    if (/\.pdf$/i.test(file.name)) return 'application/pdf';
    if (/\.png$/i.test(file.name)) return 'image/png';
    if (/\.webp$/i.test(file.name)) return 'image/webp';
    if (/\.hei[cf]$/i.test(file.name)) return 'image/heic';
    return 'image/jpeg';
  }

  function extDeArchivo(file) {
    const m = String(file.name || '').match(/\.([a-z0-9]+)$/i);
    if (m) return m[1].toLowerCase();
    const tipo = mimeDeArchivo(file);
    if (tipo === 'application/pdf') return 'pdf';
    if (tipo === 'image/png') return 'png';
    if (tipo === 'image/webp') return 'webp';
    if (tipo === 'image/heic') return 'heic';
    return 'jpg';
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      r.readAsDataURL(file);
    });
  }

  async function prepararArchivoIA(file) {
    const esPdf = mimeDeArchivo(file) === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (esPdf) {
      if (file.size > 3 * 1024 * 1024) {
        throw new Error('El PDF pesa más de 3 MB. Comprímelo o sube una foto de la factura.');
      }
      return { base64: await fileToBase64(file), mime: 'application/pdf' };
    }

    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      throw new Error(
        'No se pudo abrir la imagen. Si es una foto de iPhone en formato HEIC, guárdala como JPG o toma la foto de nuevo.'
      );
    }
    const max = 2000;
    const escala = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * escala));
    canvas.height = Math.max(1, Math.round(bitmap.height * escala));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw new Error('No se pudo preparar la imagen.');
    return { base64: await fileToBase64(blob), mime: 'image/jpeg' };
  }

  let lectorLocal = null;

  function cargarScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('No se pudo cargar el lector local.'));
      document.body.appendChild(s);
    });
  }

  function cargarLectorLocal() {
    if (lectorLocal) return lectorLocal;
    lectorLocal = (async () => {
      await cargarScript('assets/vendor/pdfjs/pdf.worker.min.js');
      await cargarScript('assets/vendor/pdfjs/pdf.min.js');
      await cargarScript('assets/vendor/tesseract/tesseract.min.js');
      await cargarScript('assets/lector.js');
      if (!window.LectorFactura) throw new Error('No se pudo iniciar el lector local.');
    })();
    return lectorLocal;
  }

  async function leerConIA(file, xmlTexto) {
    const { base64, mime } = await prepararArchivoIA(file);
    const resp = await fetch('/api/extraer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archivoBase64: base64, archivoMime: mime, xmlTexto: xmlTexto || '' })
    });
    let json;
    try {
      json = await resp.json();
    } catch {
      throw new Error('El servidor devolvió una respuesta inesperada.');
    }
    if (!resp.ok || !json.ok) throw new Error(json.error || 'No se pudo leer la factura.');
    return json.datos || {};
  }

  function wireFileInputs() {
    $('soporteFile').addEventListener('change', (e) => {
      const f = e.target.files[0];
      setMsg('msgSubir', '');
      if (!f) {
        state.soporte = null;
        $('soporteNombre').textContent = 'Ningún archivo';
        return;
      }
      const tipo = mimeDeArchivo(f);
      const esPdf = tipo === 'application/pdf' || /\.pdf$/i.test(f.name);
      const esImagen = tipo.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name);
      if (!esPdf && !esImagen) {
        state.soporte = null;
        e.target.value = '';
        $('soporteNombre').textContent = 'Ningún archivo';
        setMsg('msgSubir', 'El archivo debe ser un PDF o una foto (JPG, PNG).', 'err');
        return;
      }
      state.soporte = f;
      $('soporteNombre').textContent = `${f.name} · ${bytes(f.size)}`;
    });

    $('xmlFile').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      setMsg('msgSubir', '');
      if (!f) {
        state.xml = null;
        state.xmlTexto = '';
        $('xmlNombre').textContent = 'Ningún archivo';
        return;
      }
      try {
        const texto = await f.text();
        if (!texto.includes('<')) throw new Error('El archivo no parece un XML.');
        state.xml = f;
        state.xmlTexto = texto;
        $('xmlNombre').textContent = `${f.name} · ${bytes(f.size)}`;
      } catch (err) {
        state.xml = null;
        state.xmlTexto = '';
        e.target.value = '';
        $('xmlNombre').textContent = 'Ningún archivo';
        setMsg('msgSubir', 'No se pudo leer el XML: ' + err.message, 'err');
      }
    });
  }

  // ---------- XML ----------

  function ns(el, local) {
    if (!el) return '';
    const n = el.getElementsByTagNameNS('*', local)[0];
    return n ? n.textContent.trim() : '';
  }

  function codigoInvima(texto) {
    if (!texto) return '';
    const m =
      String(texto).match(/\b\d{4}\s*DM-?\s*\d+\b/i) ||
      String(texto).match(/\bINVIMA\s*[:#.-]?\s*([A-Z0-9./-]+)/i);
    if (!m) return '';
    return (m[1] || m[0]).replace(/\s+/g, '');
  }

  function extraerInvima(line, item, desc) {
    const props = [
      ...(item ? [...item.getElementsByTagNameNS('*', 'AdditionalItemProperty')] : []),
      ...[...line.getElementsByTagNameNS('*', 'AdditionalItemProperty')]
    ];
    for (const p of props) {
      const nom = ns(p, 'Name').toLowerCase();
      const val = ns(p, 'Value');
      if (!val) continue;
      if (/invima|sanitario|registro|rsanitario|regsan/.test(nom)) return val.trim();
      const cod = codigoInvima(val);
      if (cod) return cod;
    }
    const certs = item ? [...item.getElementsByTagNameNS('*', 'Certificate')] : [];
    for (const c of certs) {
      const id = ns(c, 'ID') || ns(c, 'CertificateType');
      if (id) return id;
    }
    for (const n of line.getElementsByTagNameNS('*', '*')) {
      const loc = (n.localName || '').toLowerCase();
      if (/invima|sanitario/.test(loc)) {
        const t = (n.textContent || '').trim();
        if (t) return t;
      }
    }
    return codigoInvima(desc + ' ' + ns(line, 'Note') + ' ' + (line.textContent || ''));
  }

  function parseXml(text) {
    let doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('XML inválido');
    const cdata = text.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
    if (cdata && /InvoiceLine/.test(cdata[1])) {
      const inner = new DOMParser().parseFromString(cdata[1], 'application/xml');
      if (!inner.querySelector('parsererror')) doc = inner;
    }
    const invoice = doc.getElementsByTagNameNS('*', 'Invoice')[0] || doc.documentElement;
    const supplier = invoice.getElementsByTagNameNS('*', 'AccountingSupplierParty')[0];
    const party = supplier && supplier.getElementsByTagNameNS('*', 'Party')[0];
    const proveedor = ns(party, 'RegistrationName') || ns(party, 'Name');
    const nitEl = party && party.getElementsByTagNameNS('*', 'CompanyID')[0];
    let nit = nitEl ? nitEl.textContent.trim() : '';
    const dv = nitEl && nitEl.getAttribute('schemeID');
    if (nit && dv && !nit.includes('-')) nit = nit + '-' + dv;
    nit = nit.replace(/\s+/g, '');
    const idEl = [...invoice.childNodes].find((n) => n.localName === 'ID');
    const factura = cleanFactura(idEl ? idEl.textContent : ns(invoice, 'ID'));
    const fechaEl = [...invoice.childNodes].find((n) => n.localName === 'IssueDate');
    const fecha = fechaEl ? fechaEl.textContent.trim() : ns(invoice, 'IssueDate');
    const productos = [...invoice.getElementsByTagNameNS('*', 'InvoiceLine')]
      .map((line) => {
        const item = line.getElementsByTagNameNS('*', 'Item')[0];
        const seller = item && item.getElementsByTagNameNS('*', 'SellersItemIdentification')[0];
        const articulo = seller ? ns(seller, 'ID') : ns(item, 'ID');
        const lote = ns(line, 'LotNumberID');
        const venc = ns(line, 'ExpiryDate');
        let presentacion = '||';
        if (lote && venc) presentacion = lote.replace(/[^A-Za-z0-9]/g, '') + ':' + venc;
        else if (lote) presentacion = lote.replace(/[^A-Za-z0-9]/g, '') + ':||';
        let vu = '';
        const props = item ? [...item.getElementsByTagNameNS('*', 'AdditionalItemProperty')] : [];
        props.forEach((p) => {
          if (ns(p, 'Name') === 'ValorUnitarioItem') vu = ns(p, 'Value');
        });
        if (!vu) vu = ns(line, 'PriceAmount');
        const desc = ns(item, 'Description');
        const invima = extraerInvima(line, item, desc);
        return {
          articulo,
          nombre: desc,
          invima,
          presentacion,
          cantidad: ns(line, 'InvoicedQuantity'),
          vu,
          total: ns(line, 'LineExtensionAmount')
        };
      })
      .filter((p) => p.articulo || p.nombre);
    return { proveedor, factura, fecha, nit, productos };
  }

  // ---------- Lectura de la factura ----------

  function normalizarProducto(p) {
    const cantidad = num(p.cantidad);
    const vu = num(p.vu ?? p.valorUnitario ?? p.valor_unitario);
    let total = cantidad != null && vu != null ? round2(cantidad * vu) : num(p.total);
    let precio = vu != null ? round2(vu * 1.25) : num(p.precio);
    let invima = String(p.invima || '').trim();
    if (!invima || /^(n\/?a|no aplica|ninguno)$/i.test(invima)) invima = '0';
    return {
      articulo: String(p.articulo || '').trim(),
      nombre: String(p.nombre || '').trim(),
      invima,
      presentacion:
        String(p.presentacion || '').trim() || presentacionDe(p.lote, p.vencimiento),
      cantidad: cantidad ?? '',
      vu: vu ?? '',
      total: total ?? '',
      precio: precio ?? ''
    };
  }

  function combinarDatos(ia, xml) {
    const header = {
      proveedor: String(xml?.proveedor || ia.proveedor || '').trim(),
      factura: cleanFactura(xml?.factura || ia.factura || ''),
      fecha: normFecha(xml?.fecha || ia.fecha || ''),
      nit: String(xml?.nit || ia.nit || '').trim()
    };
    const productosIA = (Array.isArray(ia.productos) ? ia.productos : [])
      .map(normalizarProducto)
      .filter((p) => p.articulo || p.nombre);
    const productosXml = (Array.isArray(xml?.productos) ? xml.productos : [])
      .map(normalizarProducto)
      .filter((p) => p.articulo || p.nombre);
    return { ...header, productos: productosIA.length ? productosIA : productosXml };
  }

  function generarTxt(datos) {
    const lineas = ['DATOS DE LA FACTURA', ''];
    lineas.push(`Proveedor: ${datos.proveedor || ''}`);
    lineas.push(`Factura: ${datos.factura || ''}`);
    lineas.push(`Fecha: ${datos.fecha || ''}`);
    lineas.push(`Nit: ${datos.nit || ''}`);
    lineas.push('', 'PRODUCTOS', '');
    for (const p of datos.productos || []) {
      lineas.push(`Artículo: ${p.articulo || ''}`);
      lineas.push(`Nombre: ${p.nombre || ''}`);
      lineas.push(`Invima: ${p.invima || '0'}`);
      lineas.push(`Presentación: ${p.presentacion || '||'}`);
      lineas.push(`Cantidad: ${p.cantidad ?? ''}`);
      lineas.push(`V/U: ${p.vu ?? ''}`);
      lineas.push(`Total: ${p.total ?? ''}`);
      lineas.push(`Precio: ${p.precio ?? ''}`);
      lineas.push('');
    }
    return lineas.join('\n').trim();
  }

  function usarDatos(datos) {
    state.datos = datos;
    state.txtGenerado = generarTxt(datos);
    renderRevision();
    nav('revision');
  }

  async function generarIngreso() {
    if (!state.soporte) {
      setMsg('msgSubir', 'Selecciona el PDF o una foto de la factura.', 'err');
      return;
    }
    let xml = null;
    if (state.xmlTexto) {
      try {
        xml = parseXml(state.xmlTexto);
      } catch (err) {
        console.warn('XML no procesado:', err);
      }
    }
    const btn = $('btnGenerar');
    setBusy(btn, true, 'Leyendo factura...');
    setMsg('msgSubir', 'Leyendo la factura con IA...', '');
    try {
      let datos = null;
      let errorIA = '';
      try {
        const ia = await leerConIA(state.soporte, state.xmlTexto);
        datos = combinarDatos(ia, xml);
        if (!datos.productos.length) {
          errorIA = 'la IA no encontró productos';
          datos = null;
        }
      } catch (err) {
        errorIA = err.message || String(err);
      }

      if (datos) {
        usarDatos(datos);
        setMsg('msgSubir', '');
        return;
      }

      setMsg('msgSubir', 'La IA no respondió. Leyendo en este dispositivo...', '');
      await cargarLectorLocal();
      const leido = await window.LectorFactura.leerFactura(state.soporte, (p) => {
        const pct = p && typeof p.progress === 'number' ? ` · ${Math.round(p.progress * 100)}%` : '';
        setMsg('msgSubir', `${(p && p.status) || 'Leyendo factura'}${pct}`, '');
      });
      const local = combinarDatos(leido, xml);
      if (!local.productos.length && !local.proveedor && !local.factura) {
        throw new Error('No se pudo leer la factura. Prueba con una foto más nítida, derecha y completa.');
      }
      usarDatos(local);
      setMsg('msgSubir', '');
      setMsg(
        'msgRevision',
        (errorIA ? `La IA no respondió (${errorIA}). ` : '') +
          'La factura se leyó en este dispositivo; revisa los datos antes de guardar.',
        ''
      );
    } catch (err) {
      if (xml && xml.productos && xml.productos.length) {
        usarDatos(combinarDatos({}, xml));
        setMsg(
          'msgRevision',
          'No se pudo leer el PDF o la foto (' + (err.message || err) + '). Se usaron los datos del XML; revisa todo antes de guardar.',
          'err'
        );
      } else {
        setMsg('msgSubir', err.message || String(err), 'err');
      }
    } finally {
      setBusy(btn, false);
    }
  }

  // ---------- Revisión ----------

  function celdasProductoHTML(p) {
    return `
      <td><input data-k="articulo" value="${esc(p.articulo)}" autocomplete="off"></td>
      <td><input data-k="nombre" value="${esc(p.nombre)}" autocomplete="off"></td>
      <td><input data-k="invima" value="${esc(p.invima || '0')}" autocomplete="off"></td>
      <td><input data-k="presentacion" value="${esc(p.presentacion || '||')}" autocomplete="off"></td>
      <td><input type="number" step="any" data-k="cantidad" value="${esc(p.cantidad)}"></td>
      <td><input type="number" step="any" data-k="vu" value="${esc(p.vu)}"></td>
      <td><input type="number" step="any" data-k="total" value="${esc(p.total)}"></td>
      <td><input type="number" step="any" data-k="precio" value="${esc(p.precio)}"></td>
      <td><button type="button" class="btn-danger btn-icon" data-quitar title="Quitar producto" aria-label="Quitar producto">×</button></td>`;
  }

  function filaProductoHTML(p) {
    return `<tr>${celdasProductoHTML(p)}</tr>`;
  }

  function agregarFila(tbody) {
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.innerHTML = celdasProductoHTML({
      articulo: '',
      nombre: '',
      invima: '0',
      presentacion: '||',
      cantidad: '',
      vu: '',
      total: '',
      precio: ''
    });
    tbody.appendChild(tr);
    const first = tr.querySelector('input');
    if (first) first.focus();
  }

  function wireTablaProductos(tbody) {
    if (!tbody) return;
    tbody.addEventListener('input', (e) => {
      const tr = e.target.closest('tr');
      if (!tr) return;
      const k = e.target.dataset ? e.target.dataset.k : '';
      if (k !== 'vu' && k !== 'cantidad') return;
      const cantidad = num(tr.querySelector('[data-k="cantidad"]').value);
      const vu = num(tr.querySelector('[data-k="vu"]').value);
      if (cantidad != null && vu != null) {
        tr.querySelector('[data-k="total"]').value = String(round2(cantidad * vu));
      }
      if (vu != null) {
        tr.querySelector('[data-k="precio"]').value = String(round2(vu * 1.25));
      }
    });
    tbody.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-quitar]');
      if (!btn) return;
      const tr = btn.closest('tr');
      if (tr) tr.remove();
    });
  }

  function leerProductos(tbody) {
    if (!tbody) return [];
    return [...tbody.querySelectorAll('tr')]
      .map((tr) => {
        const val = (k) => {
          const el = tr.querySelector(`[data-k="${k}"]`);
          return el ? String(el.value).trim() : '';
        };
        const cantidad = num(val('cantidad'));
        const vu = num(val('vu'));
        let total = num(val('total'));
        let precio = num(val('precio'));
        if (total == null && cantidad != null && vu != null) total = round2(cantidad * vu);
        if (precio == null && vu != null) precio = round2(vu * 1.25);
        let invima = val('invima') || '0';
        if (/^(n\/?a|no aplica|ninguno)$/i.test(invima)) invima = '0';
        return {
          articulo: val('articulo'),
          nombre: val('nombre'),
          invima,
          presentacion: val('presentacion') || '||',
          cantidad: cantidad ?? '',
          vu: vu ?? '',
          total: total ?? '',
          precio: precio ?? ''
        };
      })
      .filter((p) => p.articulo || p.nombre);
  }

  function leerCabecera(prefix) {
    return {
      proveedor: ($(prefix + 'Proveedor').value || '').trim(),
      factura: cleanFactura($(prefix + 'Factura').value),
      fecha: normFecha($(prefix + 'Fecha').value),
      nit: ($(prefix + 'Nit').value || '').trim()
    };
  }

  function renderRevision() {
    const d = state.datos;
    if (!d) return;
    $('revProveedor').value = d.proveedor || '';
    $('revFactura').value = d.factura || '';
    $('revFecha').value = d.fecha || '';
    $('revNit').value = d.nit || '';
    $('revProductos').innerHTML = (d.productos || []).map(filaProductoHTML).join('');
    if (!(d.productos || []).length) agregarFila($('revProductos'));
    $('revTxt').textContent = state.txtGenerado || '';
    setMsg('msgRevision', '');
  }

  async function guardarNueva() {
    if (!state.datos) return;
    $('revFactura').value = cleanFactura($('revFactura').value);
    const header = leerCabecera('rev');
    const productos = leerProductos($('revProductos'));
    if (!header.proveedor) {
      setMsg('msgRevision', 'Escribe el proveedor.', 'err');
      return;
    }
    if (!header.factura) {
      setMsg('msgRevision', 'Escribe el número de factura.', 'err');
      return;
    }
    if (!productos.length) {
      setMsg('msgRevision', 'Agrega al menos un producto.', 'err');
      return;
    }
    if (!state.soporte) {
      setMsg('msgRevision', 'No se encontró el archivo original. Vuelve a subirlo.', 'err');
      return;
    }

    const btn = $('btnGuardar');
    setBusy(btn, true, 'Guardando...');
    setMsg('msgRevision', '');

    const id = crypto.randomUUID();
    const soportePath = `${id}/soporte.${extDeArchivo(state.soporte)}`;
    const xmlPath = state.xml ? `${id}/factura.xml` : null;
    const subidos = [];

    try {
      const upSoporte = await sb.storage.from('facturas').upload(soportePath, state.soporte, {
        contentType: mimeDeArchivo(state.soporte),
        upsert: false
      });
      if (upSoporte.error) throw new Error('No se pudo subir el PDF/foto: ' + upSoporte.error.message);
      subidos.push(soportePath);

      if (state.xml) {
        const upXml = await sb.storage.from('facturas').upload(xmlPath, state.xml, {
          contentType: state.xml.type || 'application/xml',
          upsert: false
        });
        if (upXml.error) throw new Error('No se pudo subir el XML: ' + upXml.error.message);
        subidos.push(xmlPath);
      }

      const datos = { ...header, productos };
      const { error } = await sb.from('facturas').insert({
        id,
        proveedor: header.proveedor,
        factura: header.factura,
        fecha: header.fecha || null,
        nit: header.nit,
        productos,
        estado: 'pendiente',
        soporte_path: soportePath,
        soporte_nombre: state.soporte.name,
        soporte_tipo: mimeDeArchivo(state.soporte),
        xml_path: xmlPath,
        xml_nombre: state.xml ? state.xml.name : null,
        txt_generado: generarTxt(datos),
        informe: null
      });
      if (error) throw new Error('No se pudo guardar en la base: ' + error.message);

      limpiarNueva();
      await abrirFactura(id, { recienGuardada: true });
    } catch (err) {
      if (subidos.length) {
        try {
          await sb.storage.from('facturas').remove(subidos);
        } catch {}
      }
      setMsg('msgRevision', err.message || String(err), 'err');
    } finally {
      setBusy(btn, false);
    }
  }

  // ---------- Lista ----------

  async function cargarLista() {
    setMsg('msgLista', 'Cargando facturas...', '');
    const { data, error } = await sb
      .from('facturas')
      .select('id, proveedor, factura, fecha, nit, estado, created_at')
      .order('created_at', { ascending: false });
    if (error) {
      state.lista = [];
      setMsg('msgLista', 'No se pudieron cargar las facturas: ' + error.message, 'err');
    } else {
      state.lista = data || [];
      setMsg('msgLista', '');
    }
    renderLista();
  }

  function renderLista() {
    const q = state.busqueda.trim().toLowerCase();
    const filtradas = state.lista.filter((r) => {
      const coincide =
        !q || [r.proveedor, r.factura, r.nit].join(' ').toLowerCase().includes(q);
      const estadoOk = state.filtro === 'todas' || r.estado === state.filtro;
      return coincide && estadoOk;
    });

    $('countTodas').textContent = state.lista.length;
    $('countPendientes').textContent = state.lista.filter((r) => r.estado !== 'ingresada').length;
    $('countIngresadas').textContent = state.lista.filter((r) => r.estado === 'ingresada').length;
    document.querySelectorAll('#tabsEstado .tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.filtro === state.filtro);
    });

    const tbody = $('listaTbody');
    const vacia = $('listaVacia');
    if (!filtradas.length) {
      tbody.innerHTML = '';
      vacia.hidden = false;
      vacia.textContent = state.lista.length
        ? 'No hay facturas que coincidan con la búsqueda.'
        : 'No hay facturas guardadas.';
      return;
    }

    vacia.hidden = true;
    tbody.innerHTML = filtradas
      .map(
        (r) => `
      <tr data-id="${esc(r.id)}" tabindex="0" role="button" aria-label="Abrir factura ${esc(r.factura)}">
        <td>${esc(r.proveedor)}</td>
        <td><strong>${esc(r.factura)}</strong></td>
        <td>${esc(fmtFecha(r.fecha))}</td>
        <td>${esc(fmtFechaHora(r.created_at))}</td>
        <td>${badgeEstado(r.estado)}</td>
      </tr>`
      )
      .join('');
    tbody.querySelectorAll('tr').forEach((tr) => {
      tr.addEventListener('click', () => abrirFactura(tr.dataset.id));
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') abrirFactura(tr.dataset.id);
      });
    });
  }

  // ---------- Factura guardada ----------

  async function abrirFactura(id, opts = {}) {
    try {
      const { data, error } = await sb.from('facturas').select('*').eq('id', id).single();
      if (error) throw error;
      state.factura = data;
      renderFactura(opts);
      nav('factura');
    } catch (err) {
      setMsg('msgLista', 'No se pudo abrir la factura: ' + (err.message || err), 'err');
      nav('lista');
    }
  }

  function renderFactura(opts = {}) {
    const f = state.factura;
    if (!f) return;

    $('detTitulo').textContent = f.factura || 'Factura';
    $('detProveedorTexto').textContent = f.proveedor || '';
    $('detEstado').innerHTML = badgeEstado(f.estado);
    $('detGuardadaMsg').hidden = !opts.recienGuardada;

    $('detInProveedor').value = f.proveedor || '';
    $('detInFactura').value = f.factura || '';
    $('detInFecha').value = f.fecha || '';
    $('detInNit').value = f.nit || '';
    $('detProductos').innerHTML = (f.productos || []).map(filaProductoHTML).join('');

    mostrar($('btnDescargarSoporte'), !!f.soporte_path);
    mostrar($('btnDescargarXml'), !!f.xml_path);

    const tieneInforme = !!(f.informe && f.informe.trim());
    mostrar($('informeNuevo'), !tieneInforme);
    mostrar($('informeResultadoWrap'), tieneInforme);
    $('informeEntrada').value = '';
    $('informeResultado').textContent = tieneInforme ? f.informe : '';
    mostrar($('btnMarcarIngresada'), tieneInforme && f.estado !== 'ingresada');
    $('informeAyuda').textContent = tieneInforme
      ? 'Informe generado. Puedes copiarlo de nuevo.'
      : 'Pega el texto del sistema contable y genera el informe.';

    setMsg('msgDetalle', '');
    setMsg('msgInforme', '');
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  async function guardarCambios() {
    const f = state.factura;
    if (!f) return;
    $('detInFactura').value = cleanFactura($('detInFactura').value);
    const header = leerCabecera('detIn');
    const productos = leerProductos($('detProductos'));
    if (!header.proveedor) {
      setMsg('msgDetalle', 'Escribe el proveedor.', 'err');
      return;
    }
    if (!header.factura) {
      setMsg('msgDetalle', 'Escribe el número de factura.', 'err');
      return;
    }
    if (!productos.length) {
      setMsg('msgDetalle', 'Agrega al menos un producto.', 'err');
      return;
    }

    const btn = $('btnGuardarCambios');
    setBusy(btn, true, 'Guardando...');
    setMsg('msgDetalle', '');
    try {
      const datos = { ...header, productos };
      const txt = generarTxt(datos);
      const { error } = await sb
        .from('facturas')
        .update({
          proveedor: header.proveedor,
          factura: header.factura,
          fecha: header.fecha || null,
          nit: header.nit,
          productos,
          txt_generado: txt
        })
        .eq('id', f.id);
      if (error) throw error;

      f.proveedor = header.proveedor;
      f.factura = header.factura;
      f.fecha = header.fecha || null;
      f.nit = header.nit;
      f.productos = productos;
      f.txt_generado = txt;

      renderFactura();
      setMsg('msgDetalle', 'Cambios guardados.', 'ok');
    } catch (err) {
      setMsg('msgDetalle', 'No se pudieron guardar los cambios: ' + (err.message || err), 'err');
    } finally {
      setBusy(btn, false);
    }
  }

  async function eliminarFactura() {
    const f = state.factura;
    if (!f) return;
    if (!confirm(`¿Eliminar la factura ${f.factura}? También se borrarán los archivos.`)) return;

    const btn = $('btnEliminar');
    setBusy(btn, true, 'Eliminando...');
    try {
      const { error } = await sb.from('facturas').delete().eq('id', f.id);
      if (error) throw error;
      const paths = [f.soporte_path, f.xml_path].filter(Boolean);
      if (paths.length) {
        try {
          await sb.storage.from('facturas').remove(paths);
        } catch {}
      }
      state.factura = null;
      await irLista();
    } catch (err) {
      setMsg('msgDetalle', 'No se pudo eliminar: ' + (err.message || err), 'err');
    } finally {
      setBusy(btn, false);
    }
  }

  async function descargarArchivo(path, nombre, btn) {
    if (!path) return;
    setBusy(btn, true, 'Preparando...');
    try {
      const { data, error } = await sb.storage
        .from('facturas')
        .createSignedUrl(path, 3600, { download: nombre || true });
      if (error) throw error;
      const a = document.createElement('a');
      a.href = data.signedUrl;
      a.download = nombre || '';
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setMsg('msgDetalle', 'No se pudo descargar: ' + (err.message || err), 'err');
    } finally {
      setBusy(btn, false);
    }
  }

  // ---------- Informe ----------

  function parsearTextoInforme(texto) {
    const t = String(texto || '').replace(/\r\n/g, '\n').trim();
    if (!t) return [];
    const bloques = t
      .split(/\n\s*\n/)
      .map((b) => b.split('\n').map((l) => l.trim()).filter(Boolean))
      .filter((b) => b.length);
    const filas = [];
    for (const lineas of bloques) {
      if (lineas.length < 7) continue;
      if (!/^[\d.,]+$/.test(lineas[2])) continue;
      filas.push({
        codigo: lineas[0],
        presentacion: lineas[1],
        cantidad: lineas[2],
        nombre: lineas.slice(6).join(' ').trim()
      });
    }
    if (!filas.length) {
      const lineas = t.split('\n').map((l) => l.trim()).filter(Boolean);
      for (let i = 0; i + 6 < lineas.length; i += 7) {
        if (/^[\d.,]+$/.test(lineas[i + 2]) && /^[\d.,]+$/.test(lineas[i + 5])) {
          filas.push({
            codigo: lineas[i],
            presentacion: lineas[i + 1],
            cantidad: lineas[i + 2],
            nombre: lineas[i + 6]
          });
        }
      }
    }
    return filas;
  }

  function cantidadInforme(v) {
    const n = num(v);
    if (n == null) return String(v || '').trim();
    return Number.isInteger(n) ? String(n) : String(n).replace('.', ',');
  }

  async function generarInforme() {
    const f = state.factura;
    if (!f) return;
    const filas = parsearTextoInforme($('informeEntrada').value);
    if (!filas.length) {
      setMsg(
        'msgInforme',
        'No se encontraron productos en el texto. Revisa que tenga el formato de 7 líneas por producto.',
        'err'
      );
      return;
    }

    const encabezado = `*${nombreCortoProveedor(f.proveedor)} ${f.factura}*`;
    const informe = [encabezado, ...filas.map((r) => `${r.nombre} (${cantidadInforme(r.cantidad)})`)].join('\n');

    $('informeResultado').textContent = informe;
    mostrar($('informeResultadoWrap'), true);
    mostrar($('btnMarcarIngresada'), f.estado !== 'ingresada');
    setMsg('msgInforme', '');

    try {
      const { error } = await sb.from('facturas').update({ informe }).eq('id', f.id);
      if (error) throw error;
      f.informe = informe;
    } catch (err) {
      setMsg(
        'msgInforme',
        'El informe se generó, pero no se pudo guardar en la base: ' + (err.message || err),
        'err'
      );
    }
  }

  async function copiarInforme() {
    const texto = $('informeResultado').textContent;
    if (!texto) return;
    try {
      await navigator.clipboard.writeText(texto);
      setMsg('msgInforme', 'Informe copiado.', 'ok');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setMsg('msgInforme', 'Informe copiado.', 'ok');
      } catch {
        setMsg('msgInforme', 'No se pudo copiar. Selecciona el texto manualmente.', 'err');
      }
      ta.remove();
    }
  }

  async function marcarIngresada() {
    const f = state.factura;
    if (!f || f.estado === 'ingresada') return;
    const btn = $('btnMarcarIngresada');
    setBusy(btn, true, 'Guardando...');
    try {
      const ahora = new Date().toISOString();
      const { error } = await sb
        .from('facturas')
        .update({ estado: 'ingresada', ingresada_at: ahora })
        .eq('id', f.id);
      if (error) throw error;
      f.estado = 'ingresada';
      f.ingresada_at = ahora;
      $('detEstado').innerHTML = badgeEstado('ingresada');
      mostrar(btn, false);
      setMsg('msgInforme', 'Factura marcada como ingresada.', 'ok');
      const enLista = state.lista.find((r) => r.id === f.id);
      if (enLista) {
        enLista.estado = 'ingresada';
        enLista.ingresada_at = ahora;
      }
    } catch (err) {
      setMsg('msgInforme', 'No se pudo marcar como ingresada: ' + (err.message || err), 'err');
    } finally {
      setBusy(btn, false);
    }
  }

  // ---------- Eventos ----------

  function wireEventos() {
    $('btnGenerar').addEventListener('click', generarIngreso);
    $('btnVolver').addEventListener('click', volver);
    $('btnLista').addEventListener('click', irLista);
    $('btnGuardar').addEventListener('click', guardarNueva);
    $('btnAgregarProducto').addEventListener('click', () => agregarFila($('revProductos')));
    $('btnAgregarProductoDet').addEventListener('click', () => agregarFila($('detProductos')));
    $('btnNuevaDesdeLista').addEventListener('click', nuevaFactura);
    $('busqueda').addEventListener('input', (e) => {
      state.busqueda = e.target.value;
      renderLista();
    });
    $('tabsEstado').addEventListener('click', (e) => {
      const b = e.target.closest('[data-filtro]');
      if (!b) return;
      state.filtro = b.dataset.filtro;
      renderLista();
    });
    $('btnGuardarCambios').addEventListener('click', guardarCambios);
    $('btnEliminar').addEventListener('click', eliminarFactura);
    $('btnDescargarSoporte').addEventListener('click', () =>
      descargarArchivo(state.factura?.soporte_path, state.factura?.soporte_nombre, $('btnDescargarSoporte'))
    );
    $('btnDescargarXml').addEventListener('click', () =>
      descargarArchivo(state.factura?.xml_path, state.factura?.xml_nombre, $('btnDescargarXml'))
    );
    $('btnGenerarInforme').addEventListener('click', generarInforme);
    $('btnCopiarInforme').addEventListener('click', copiarInforme);
    $('btnMarcarIngresada').addEventListener('click', marcarIngresada);

    ['revFactura', 'detInFactura'].forEach((id) => {
      $(id).addEventListener('blur', (e) => {
        e.target.value = cleanFactura(e.target.value);
      });
    });

    wireFileInputs();
    wireTablaProductos($('revProductos'));
    wireTablaProductos($('detProductos'));
  }

  wireEventos();
  nav('subir');
})();
