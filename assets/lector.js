'use strict';

((global) => {
  const MESES = {
    ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6,
    JUL: 7, AGO: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DIC: 12
  };

  const COLUMNAS = [
    { tipo: 'NUM', re: /^(NO|NUM|ITEM|#)\.?$/ },
    { tipo: 'ART', re: /^(REFEREN|CODIGO|SKU|REF\b)/ },
    { tipo: 'CANT', re: /^(CANT|CANTIDAD)/ },
    { tipo: 'UND', re: /^(UND|UNID|U\.?M\b)/ },
    { tipo: 'DESC', re: /^(DESCRIP|DETALLE|PRODUCTO|CONCEPTO)/ },
    { tipo: 'LOTE', re: /^LOTE/ },
    { tipo: 'VENC', re: /^(FECHA|VTO|VENC|F\.?\s*VENC)/ },
    { tipo: 'INVIMA', re: /^(REGISTRO|INVIMA|R\.?\s*SANIT)/ },
    { tipo: 'VU', re: /^(PRECIO|V\.?\s*UNIT|VALOR\s*UNIT|VR\.?\s*UNIT)/ },
    { tipo: 'TOTAL', re: /^(VALOR|VR\.?\s*TOTAL|TOTAL)/ }
  ];

  const RUTAS = {
    worker: 'assets/vendor/tesseract/worker.min.js',
    core: 'assets/vendor/tesseract',
    lang: 'assets/vendor/tesseract/lang'
  };

  const ESTADOS_OCR = {
    'loading tesseract core': 'Cargando lector',
    'initializing tesseract': 'Iniciando lector',
    'loading language traineddata': 'Cargando idioma',
    'initializing api': 'Preparando',
    'recognizing text': 'Leyendo texto'
  };

  function norm(v) {
    return String(v || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function numOcr(v) {
    let s = String(v == null ? '' : v).replace(/[^\d.,-]/g, '');
    if (!s) return null;
    const coma = s.lastIndexOf(',');
    const punto = s.lastIndexOf('.');
    if (coma >= 0 && punto >= 0) {
      const decimal = coma > punto ? ',' : '.';
      const miles = decimal === ',' ? '.' : ',';
      s = s.split(miles).join('');
      if (decimal === ',') s = s.replace(',', '.');
    } else if (coma >= 0) {
      const partes = s.split(',');
      s = partes.length === 2 && partes[1].length !== 3 ? partes.join('.') : partes.join('');
    } else if (punto >= 0) {
      const partes = s.split('.');
      if (partes.length === 2 && partes[1].length === 3) s = partes.join('');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function clasificar(texto) {
    const t = norm(texto);
    if (!t) return null;
    for (const c of COLUMNAS) if (c.re.test(t)) return c.tipo;
    return null;
  }

  function agruparLineas(items) {
    const orden = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
    const alturas = orden.map((i) => i.h).filter((h) => h > 0).sort((a, b) => a - b);
    const media = alturas.length ? alturas[Math.floor(alturas.length / 2)] : 8;
    const tolerancia = Math.max(3, media * 0.6);
    const lineas = [];
    for (const it of orden) {
      const ultima = lineas[lineas.length - 1];
      if (!ultima || it.y - ultima.base > tolerancia) {
        lineas.push({ base: it.y, items: [it] });
      } else {
        ultima.items.push(it);
      }
    }
    return lineas.map((l) => {
      const its = l.items.sort((a, b) => a.x - b.x);
      return {
        y: its.reduce((s, i) => s + i.y, 0) / its.length,
        items: its,
        texto: its.map((i) => i.s).join(' ').replace(/\s+/g, ' ').trim()
      };
    });
  }

  function columnasDeLinea(linea) {
    const cols = {};
    let ultimo = null;
    for (const it of linea.items) {
      const tipo = clasificar(it.s);
      if (tipo && !cols[tipo]) {
        cols[tipo] = { x: it.x, x1: it.x + (it.w || 0) };
        ultimo = tipo;
      } else if (ultimo && !tipo) {
        const col = cols[ultimo];
        if (it.x - col.x1 < 3 * (it.h || 10)) {
          col.x1 = Math.max(col.x1, it.x + (it.w || 0));
        }
      }
    }
    const hay = (t) => cols[t] != null;
    if (hay('CANT') && hay('DESC') && (hay('VU') || hay('TOTAL')) && (hay('ART') || hay('LOTE') || hay('INVIMA'))) {
      return cols;
    }
    return null;
  }

  function columnasOrdenadas(cols) {
    return Object.keys(cols)
      .map((tipo) => ({ tipo, x: cols[tipo].x, x1: cols[tipo].x1 }))
      .sort((a, b) => a.x - b.x);
  }

  function limiteEntre(a, b, tolerancia) {
    if (a.tipo === 'DESC') return b.x - tolerancia;
    const medio = (a.x1 + b.x) / 2;
    if (medio <= a.x || medio >= b.x) return (a.x + b.x) / 2;
    return medio;
  }

  function asignarColumnas(items, cols, tolerancia) {
    const orden = columnasOrdenadas(cols);
    const celdas = {};
    for (const it of items) {
      const bordeIzq = orden.length ? orden[0].x - tolerancia * 2 : Infinity;
      if (it.x < bordeIzq) continue;
      let elegido = null;
      for (let i = 0; i < orden.length; i++) {
        if (i === 0) {
          elegido = orden[0].tipo;
          continue;
        }
        if (it.x < limiteEntre(orden[i - 1], orden[i], tolerancia)) {
          elegido = orden[i - 1].tipo;
          break;
        }
        elegido = orden[i].tipo;
      }
      if (!elegido) continue;
      (celdas[elegido] = celdas[elegido] || []).push(it);
    }
    return celdas;
  }

  function textoCelda(celda) {
    if (!celda || !celda.length) return '';
    return celda
      .slice()
      .sort((a, b) => a.x - b.x)
      .map((i) => i.s)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function esFinTabla(linea) {
    const t = norm(linea.texto);
    if (/^(SUB\s*TOTAL|TOTAL|DESCUENTO|IVA|IMPUESTO|RETE|RTE|FLETE|ANTICIPO|ABONO)\b/.test(t)) return true;
    return /(ESTA FACTURA|MERITO EJECUTIVO|AUTORIZACION NUMERACION|ELABORADO E IMPRESO|ACEPTADO DE CONFORMIDAD|NO SOMOS|RESOLUCION|HABILITA PREFIJO|CUFE)/.test(t);
  }

  function fechaDeTexto(texto) {
    let m = texto.match(
      /\b(\d{1,2})\s*[-\/.]?\s*(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|SET|OCT|NOV|DIC)[A-Z]*\.?\s*[-\/.]?\s*(\d{2,4})\b/i
    );
    if (m) {
      let anio = Number(m[3]);
      if (anio < 100) anio += 2000;
      const mes = MESES[m[2].toUpperCase()];
      const dia = Number(m[1]);
      if (mes && dia >= 1 && dia <= 31) return `${anio}-${pad2(mes)}-${pad2(dia)}`;
    }
    m = texto.match(/\b(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);
    if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
    m = texto.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})\b/);
    if (m) return `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`;
    return '';
  }

  function nombreProveedor(lineas, limite) {
    const ruido = /(FACTURA|P[ÁA]GINA|^N\.?\s*[IL1]\.?\s*T|TEL[EÉ]FONO|E-?MAIL|DIRECCI|CIUDAD|FECHA|HORA|RESOLUCI|AUTORIZACI|PROFORMA|VENCIMIENTO|R[EÉ]GIMEN|RESPONSABLE|DATOS DEL|REFERENCIA)/i;
    let mejor = null;
    for (const linea of lineas) {
      if (linea.y > limite) continue;
      const items = linea.items
        .filter((i) => /[\p{L}\p{N}]/u.test(i.s))
        .sort((a, b) => a.x - b.x);
      if (!items.length || ruido.test(items[0].s)) continue;
      const alto = Math.max(...items.map((i) => i.h || 0));
      const run = [items[0]];
      for (let i = 1; i < items.length; i++) {
        const previo = run[run.length - 1];
        const brecha = items[i].x - (previo.x + (previo.w || 0));
        if (brecha > Math.max(18, alto * 2.2) || ruido.test(items[i].s)) break;
        run.push(items[i]);
      }
      const texto = run.map((i) => i.s).join(' ').replace(/\s+/g, ' ').trim();
      if (texto.length < 4 || !/\p{L}{3}/u.test(texto)) continue;
      const sufijo = /\b(LTDA|LIMITADA|S\.?A\.?S\.?|S\.?A\.?|E\.?U\.?|SAS)\b/i.test(texto);
      const palabras = texto.split(' ').length;
      const score = (sufijo ? 100 : 0) + alto * 2 + palabras - linea.y * 0.2;
      if (!mejor || score > mejor.score) mejor = { texto, score };
    }
    return mejor ? mejor.texto : '';
  }

  function extraerCabecera(itemos, lineas) {
    const cabecera = { proveedor: '', factura: '', fecha: '', nit: '' };

    for (const l of lineas) {
      const dv = l.texto.match(/\b(\d{9})\s*-\s*(\d)\b/);
      if (dv) {
        cabecera.nit = `${dv[1]}-${dv[2]}`;
        break;
      }
    }
    if (!cabecera.nit) {
      for (const l of lineas) {
        if (!/N\.?\s*[I1L]\.?\s*T\.?/i.test(l.texto)) continue;
        const solo = l.texto.match(/\b(\d{6,12})\b/);
        if (solo) {
          cabecera.nit = solo[1];
          break;
        }
      }
    }

    const maxY = itemos.reduce((m, i) => Math.max(m, i.y), 0);
    cabecera.proveedor = nombreProveedor(lineas, maxY * 0.2);

    for (const l of lineas) {
      const m = l.texto.match(/\bNro\.?\s*[:#.\-–—]*\s*([A-Z0-9][A-Z0-9-]*(?:\s+[A-Z0-9][A-Z0-9-]*)?)/i);
      if (m) {
        cabecera.factura = m[1];
        break;
      }
    }
    if (!cabecera.factura) {
      for (const l of lineas) {
        const m = l.texto.match(/\b(?:FACTURA|FV|FE)[\s.:#-]*([A-Z]{2,8}[\s-]*\d{3,})/i);
        if (m) {
          cabecera.factura = m[1];
          break;
        }
      }
    }

    for (const l of lineas) {
      const f = fechaDeTexto(l.texto);
      if (f) {
        cabecera.fecha = f;
        break;
      }
    }

    return cabecera;
  }

  function fichaProducto(celdas) {
    const numeros = (celda) =>
      (celda || [])
        .slice()
        .sort((a, b) => a.x - b.x)
        .map((i) => numOcr(i.s))
        .filter((n) => n != null);
    const articulo = textoCelda(celdas.ART)
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .replace(/\s+/g, '');
    const nombre = textoCelda(celdas.DESC).replace(/^[^\p{L}\p{N}]+/u, '');
    const lote = textoCelda(celdas.LOTE).replace(/[^A-Za-z0-9]/g, '');
    const vencCelda = textoCelda(celdas.VENC);
    const fechaVenc = vencCelda.match(/\d{4}\s*[-\/.]\s*\d{1,2}(?:\s*[-\/.]\s*\d{1,2})?/);
    const vencimiento = fechaVenc
      ? fechaVenc[0].replace(/\s+/g, '').replace(/\//g, '-')
      : vencCelda.replace(/\s+/g, '');
    const invima = textoCelda(celdas.INVIMA).replace(/\s+/g, ' ').trim();
    const cantidades = numeros(celdas.CANT);
    const unitarios = numeros(celdas.VU);
    const totales = numeros(celdas.TOTAL);
    let cantidad = cantidades.length ? cantidades[0] : null;
    let vu = unitarios.length ? unitarios[0] : null;
    const total = totales.length ? totales[totales.length - 1] : null;
    if (vu == null && total != null && cantidad) vu = Math.round((total / cantidad) * 100) / 100;
    if (cantidad == null && total != null && vu) cantidad = Math.round(total / vu);
    return { articulo, nombre, invima, lote, vencimiento, cantidad, vu, total };
  }

  function productoValido(p) {
    return p.cantidad != null || p.vu != null || p.total != null;
  }

  function parsearItems(items, columnasPrevias) {
    const limpios = (items || [])
      .filter((it) => it && it.s && /[\p{L}\p{N}]/u.test(String(it.s)))
      .map((it) => ({
        s: String(it.s).trim(),
        x: Number(it.x) || 0,
        y: Number(it.y) || 0,
        w: Number(it.w) || 0,
        h: Number(it.h) || 0
      }));
    if (!limpios.length) return { proveedor: '', factura: '', fecha: '', nit: '', productos: [], columnas: null };

    const lineas = agruparLineas(limpios);
    let columnas = columnasPrevias || null;
    let indiceCabecera = -1;
    let toleranciaCol = 6;
    for (let i = 0; i < lineas.length; i++) {
      const cols = columnasDeLinea(lineas[i]);
      if (cols) {
        columnas = cols;
        indiceCabecera = i;
        const alturas = lineas[i].items.map((it) => it.h).filter((h) => h > 0);
        const media = alturas.length ? alturas.reduce((a, b) => a + b, 0) / alturas.length : 10;
        toleranciaCol = Math.min(18, Math.max(4, media * 0.6));
        break;
      }
    }
    if (!columnas) {
      const cab = extraerCabecera(limpios, lineas);
      return { ...cab, productos: [], columnas: null };
    }

    const cabecera = extraerCabecera(limpios, lineas);
    const productos = [];
    const inicio = indiceCabecera >= 0 ? indiceCabecera + 1 : 0;

    for (let i = inicio; i < lineas.length; i++) {
      const linea = lineas[i];
      if (indiceCabecera >= 0 && esFinTabla(linea)) break;
      if (indiceCabecera < 0 && i > 0 && esFinTabla(linea)) break;
      const celdas = asignarColumnas(linea.items, columnas, toleranciaCol);
      const p = fichaProducto(celdas);
      if (!p.articulo && !p.nombre) continue;
      if (!productoValido(p)) {
        const ultimo = productos[productos.length - 1];
        if (ultimo && p.nombre && p.nombre.length > 1) {
          ultimo.nombre = `${ultimo.nombre} ${p.nombre}`.replace(/\s+/g, ' ').trim();
        }
        continue;
      }
      productos.push(p);
    }

    return { ...cabecera, productos, columnas };
  }

  function parsearPaginas(paginas) {
    let columnas = null;
    let resultado = null;
    const productos = [];
    for (const pagina of paginas) {
      const r = parsearItems(pagina.items, columnas);
      if (r.columnas) columnas = r.columnas;
      if (!resultado) {
        resultado = { ...r };
      } else {
        for (const k of ['proveedor', 'factura', 'fecha', 'nit']) {
          if (!resultado[k] && r[k]) resultado[k] = r[k];
        }
      }
      productos.push(...r.productos);
    }
    if (!resultado) return { proveedor: '', factura: '', fecha: '', nit: '', productos: [] };
    resultado.productos = productos;
    return resultado;
  }

  async function extraerTextoPdf(buffer) {
    const pdf = await global.pdfjsLib.getDocument({ data: buffer }).promise;
    const paginas = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const contenido = await page.getTextContent();
      const items = [];
      for (const it of contenido.items) {
        if (!it.str || !it.str.trim()) continue;
        items.push({
          s: it.str,
          x: it.transform[4],
          y: viewport.height - it.transform[5],
          w: it.width || 0,
          h: it.height || 0
        });
      }
      paginas.push({ page, viewport, items });
    }
    return { pdf, paginas };
  }

  function conLimite(promesa, ms, mensaje) {
    return Promise.race([
      promesa,
      new Promise((_, rechazar) => setTimeout(() => rechazar(new Error(mensaje)), ms))
    ]);
  }

  function urlVendor(rel) {
    return new URL(rel, document.baseURI).href;
  }

  function canvasAJpeg(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Imagen no válida.'))), 'image/jpeg', 0.9);
    });
  }

  async function imagenNormalizada(file) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      throw new Error('Imagen no compatible.');
    }
    const max = Math.max(bitmap.width, bitmap.height);
    const escala = Math.min(2, Math.max(0.2, 2000 / max));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * escala));
    canvas.height = Math.max(1, Math.round(bitmap.height * escala));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();
    return canvasAJpeg(canvas);
  }

  async function renderizarPagina(page, viewport) {
    const escala = Math.min(3, Math.max(1.5, 2000 / viewport.width));
    const vp = page.getViewport({ scale: escala });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    await conLimite(
      page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise,
      45000,
      'El navegador se demoró dibujando la página del PDF.'
    );
    return canvasAJpeg(canvas);
  }

  async function crearOcr(onProgress) {
    const Tesseract = global.Tesseract;
    if (!Tesseract) throw new Error('Lector no disponible.');
    return Tesseract.createWorker('spa', 1, {
      workerPath: urlVendor(RUTAS.worker),
      corePath: urlVendor(RUTAS.core),
      langPath: urlVendor(RUTAS.lang),
      logger: (m) => {
        if (!onProgress) return;
        onProgress({
          status: ESTADOS_OCR[m.status] || 'Leyendo imagen',
          progress: typeof m.progress === 'number' ? 0.15 + m.progress * 0.8 : 0.15
        });
      },
      errorHandler: (e) => console.warn('OCR:', e)
    });
  }

  function palabrasDeResultado(data) {
    const items = [];
    const bloques = (data && data.blocks) || [];
    for (const b of bloques) {
      for (const p of b.paragraphs || []) {
        for (const l of p.lines || []) {
          for (const w of l.words || []) {
            if (!w.text || !w.text.trim() || !w.bbox) continue;
            const bb = w.bbox;
            items.push({
              s: w.text.trim(),
              x: bb.x0,
              y: (bb.y0 + bb.y1) / 2,
              w: bb.x1 - bb.x0,
              h: bb.y1 - bb.y0
            });
          }
        }
      }
    }
    return items;
  }

  async function ocrImagenes(imagenes, onProgress) {
    const worker = await crearOcr(onProgress);
    const items = [];
    try {
      let n = 0;
      for (const img of imagenes) {
        n++;
        if (onProgress) {
          onProgress({ status: imagenes.length > 1 ? `Página ${n} de ${imagenes.length}` : 'Leyendo imagen', progress: 0.15 });
        }
        const { data } = await worker.recognize(img, {}, { text: true, blocks: true });
        const palabras = palabrasDeResultado(data);
        if (!palabras.length) {
          const texto = String((data && data.text) || '').trim();
          if (texto) throw new Error('Imagen no legible.');
          throw new Error('No se encontró texto.');
        }
        items.push(...palabras);
      }
    } finally {
      await worker.terminate().catch(() => {});
    }
    return items;
  }

  async function leerFactura(file, onProgress) {
    const aviso = (status, progress) => {
      if (onProgress) onProgress({ status, progress });
    };
    const esPdf = /pdf/i.test(file.type || '') || /\.pdf$/i.test(file.name || '');

    if (esPdf) {
      aviso('Abriendo PDF', 0.05);
      const buffer = await file.arrayBuffer();
      let extraido;
      try {
        extraido = await extraerTextoPdf(buffer);
      } catch (err) {
        throw new Error('PDF no válido.');
      }
      const caracteres = extraido.paginas.reduce(
        (total, p) => total + p.items.reduce((s, it) => s + it.s.length, 0),
        0
      );
      if (caracteres >= 120) {
        aviso('Leyendo PDF', 0.9);
        const datos = parsearPaginas(extraido.paginas);
        return { ...datos, origen: 'pdf' };
      }
      aviso('Preparando OCR', 0.1);
      const imagenes = [];
      const maxPaginas = Math.min(extraido.paginas.length, 5);
      for (let i = 0; i < maxPaginas; i++) {
        aviso(`Página ${i + 1} de ${maxPaginas}`, 0.12);
        imagenes.push(await renderizarPagina(extraido.paginas[i].page, extraido.paginas[i].viewport));
      }
      const items = await ocrImagenes(imagenes, onProgress);
      return { ...parsearItems(items, null), origen: 'pdf-ocr' };
    }

    aviso('Preparando imagen', 0.08);
    const imagen = await imagenNormalizada(file);
    const items = await ocrImagenes([imagen], onProgress);
    return { ...parsearItems(items, null), origen: 'foto' };
  }

  global.LectorFactura = {
    leerFactura,
    parsear: (items) => parsearItems(items, null),
    numOcr
  };
})(typeof window !== 'undefined' ? window : globalThis);
