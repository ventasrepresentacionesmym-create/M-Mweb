/* ============================================================
   M&M MEDICAL — Versión Cloud (GitHub + Supabase + Vercel)
   ============================================================ */

const SUPABASE_URL = "https://ehmbqzhcxnlalvpyfngv.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_9XnSPw4kRu6FdPwt4_SrRA_kp3YW7mK";

var sbClient = null;
function getSb() {
  if (!sbClient && window.supabase && window.supabase.createClient) {
    try {
      sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch (e) {
      console.warn("Error inicializando cliente de Supabase:", e);
    }
  }
  return sbClient;
}

/* ============================================================
   IDB — Handles de carpeta (sincronización de Excel)
   ============================================================ */
const FolderSaver = {
  DB_NAME: "CotizadorFS",
  DB_STORE: "handles",

  _openIDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore(this.DB_STORE);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  },

  async _getGenericHandle(key) {
    try {
      const db = await this._openIDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.DB_STORE, "readonly");
        const req = tx.objectStore(this.DB_STORE).get(key);
        req.onsuccess = e => resolve(e.target.result || null);
        req.onerror = e => reject(e.target.error);
      });
    } catch { return null; }
  },

  async _saveGenericHandle(key, handle) {
    try {
      const db = await this._openIDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.DB_STORE, "readwrite");
        const req = tx.objectStore(this.DB_STORE).put(handle, key);
        req.onsuccess = () => resolve();
        req.onerror = e => reject(e.target.error);
      });
    } catch { /* silencioso */ }
  },

  async _verifyPermission(handle, mode = "readwrite") {
    try {
      const opts = { mode };
      if ((await handle.queryPermission(opts)) === "granted") return true;
      if ((await handle.requestPermission(opts)) === "granted") return true;
      return false;
    } catch {
      return false;
    }
  }
};
window.FolderSaver = FolderSaver;

/* ============================================================
   DATA SYNC — Sincronización desde carpeta o archivos locales
   ============================================================ */
const DataSync = {
  DB_KEY: "dataFolder",

  async getSavedFolder() {
    return await FolderSaver._getGenericHandle(this.DB_KEY);
  },

  async setSavedFolder(handle) {
    return await FolderSaver._saveGenericHandle(this.DB_KEY, handle);
  },

  async pickFolder() {
    if (!("showDirectoryPicker" in window)) {
      throw new Error("Tu navegador no soporta seleccionar carpetas directamente. Usa el selector de archivos manual.");
    }
    const handle = await window.showDirectoryPicker({
      id: "inventario-datos",
      mode: "read",
      startIn: "documents"
    });
    await this.setSavedFolder(handle);
    return handle;
  },

  parseHtmlRows(html) {
    const trBlocks = html.split(/<tr[^>]*>/i);
    const result = [];
    for (let b = 1; b < trBlocks.length; b++) {
      const block = trBlocks[b];
      const tdMatches = [...block.matchAll(/<t[dh][^>]*>([\s\S]*?)(?=<\/t[dh]>|<t[dh]|$)/gi)];
      if (!tdMatches.length) continue;
      result.push(tdMatches.map(m => m[1].replace(/<[^>]+>/g, "").trim()));
    }
    return result;
  },

  toFloat(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === "number") return v;
    let s = String(v).trim();
    if (!s) return 0;
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    const f = parseFloat(s);
    return isNaN(f) ? 0 : f;
  },

  colIndex(header, names) {
    const nameList = Array.isArray(names) ? names.map(n => n.toLowerCase().trim()) : [names.toLowerCase().trim()];
    return header.findIndex(h => {
      const normH = h.toLowerCase().trim();
      return nameList.some(n => normH === n || normH.includes(n));
    });
  },

  findHeaderRow(rows, mustHaveAnyOf) {
    const wanted = mustHaveAnyOf.map(w => w.toLowerCase());
    for (let i = 0; i < rows.length; i++) {
      const lc = rows[i].map(c => c.toLowerCase().trim());
      if (wanted.some(w => lc.includes(w))) return i;
    }
    return -1;
  },

  extractTable(html, headerHints) {
    const rows = this.parseHtmlRows(html);
    const idx = this.findHeaderRow(rows, headerHints);
    if (idx === -1) return { header: [], body: rows };
    return { header: rows[idx], body: rows.slice(idx + 1) };
  },

  parseCatalog(htmlArticulos, htmlExistencias) {
    const products = new Map();

    if (htmlArticulos) {
      const art = this.extractTable(htmlArticulos, ["codigo", "id", "articulo"]);
      const aiCodigo = this.colIndex(art.header, "codigo");
      const aiNombre = this.colIndex(art.header, "nombre");
      const aiProv = this.colIndex(art.header, "proveedor");
      const aiIva = this.colIndex(art.header, ["% iva", "iva"]);

      for (const r of art.body) {
        if (r.length <= Math.max(aiCodigo, aiNombre)) continue;
        const codigo = (r[aiCodigo] || "").trim();
        const nombre = (r[aiNombre] || "").trim();
        if (!codigo || !nombre || /^codigo/i.test(codigo) || /registro\(s\)/i.test(codigo) || /^TOTAL/i.test(codigo)) continue;
        const proveedor = aiProv !== -1 ? (r[aiProv] || "").trim() : "";
        let ivaPct = 0;
        if (aiIva !== -1) {
          const ivaVal = (r[aiIva] || "").toUpperCase();
          if (ivaVal.includes("19") || ivaVal.includes("B")) ivaPct = 0.19;
        }
        products.set(codigo, {
          codigo,
          descripcion: nombre,
          iva_pct: ivaPct,
          existencia: 0,
          costo: 0,
          proveedor
        });
      }
    }

    if (htmlExistencias) {
      const exi = this.extractTable(htmlExistencias, ["articulo", "promedio", "costo"]);
      const eiArticulo = this.colIndex(exi.header, "articulo");
      const eiNombre = this.colIndex(exi.header, "nombre");
      const eiProv = this.colIndex(exi.header, "proveedor");
      const eiIva = this.colIndex(exi.header, "iva");
      const eiProm = this.colIndex(exi.header, ["promedio", "costo"]);

      for (const r of exi.body) {
        if (r.length <= Math.max(eiArticulo, 0)) continue;
        const raw = (r[eiArticulo !== -1 ? eiArticulo : 0] || "").trim();
        if (!raw || /registro\(s\)/i.test(raw) || /^TOTAL/i.test(raw)) continue;

        let codigo = raw;
        if (raw.includes("|")) codigo = raw.split("|")[0].trim();
        if (!codigo || /^articulo/i.test(codigo)) continue;

        const nombre = eiNombre !== -1 ? (r[eiNombre] || "").trim() : (r[1] || "").trim();
        const proveedor = eiProv !== -1 ? (r[eiProv] || "").trim() : (r[4] || "").trim();
        let ivaPct = 0;
        if (eiIva !== -1) {
          const rawIva = (r[eiIva] || "").toUpperCase();
          if (rawIva.includes("19") || rawIva.startsWith("B")) ivaPct = 0.19;
        }
        let costo = 0;
        if (eiProm !== -1) {
          costo = this.toFloat(r[eiProm]);
        } else if (r.length >= 13) {
          costo = this.toFloat(r[12]);
        }

        if (!products.has(codigo)) {
          products.set(codigo, {
            codigo,
            descripcion: nombre || codigo,
            iva_pct: ivaPct,
            existencia: 0,
            costo,
            proveedor
          });
        } else {
          const p = products.get(codigo);
          if (costo > p.costo) p.costo = costo;
          if (!p.proveedor && proveedor) p.proveedor = proveedor;
          if (!p.iva_pct && ivaPct) p.iva_pct = ivaPct;
          if (nombre && !p.descripcion) p.descripcion = nombre;
        }
      }
    }

    return Array.from(products.values());
  },

  async readFileFromHandle(fileHandle) {
    const file = await fileHandle.getFile();
    const buffer = await file.arrayBuffer();
    return new TextDecoder("iso-8859-1").decode(buffer);
  },

  async readFileFromInput(file) {
    const buffer = await file.arrayBuffer();
    return new TextDecoder("iso-8859-1").decode(buffer);
  },

  async _findFile(dirHandle, exactName, pattern) {
    try {
      return await dirHandle.getFileHandle(exactName);
    } catch {
      for await (const [name, handle] of dirHandle.entries()) {
        if (handle.kind === "file" && pattern.test(name)) return handle;
      }
    }
    return null;
  },

  async syncFromFolder(onProgress) {
    let dirHandle = await this.getSavedFolder();
    if (!dirHandle || !(await FolderSaver._verifyPermission(dirHandle, "read"))) {
      dirHandle = await this.pickFolder();
    }

    onProgress({ pct: 5, msg: `Buscando archivos en carpeta "${dirHandle.name}"...` });

    const fileHandleArt = await this._findFile(dirHandle, "Listado_de_articulos.xls", /listado.*articulos.*\.xls/i);
    const fileHandleProd = await this._findFile(dirHandle, "Resumen_de_existencias_UC.xls", /resumen.*existencias.*\.xls/i);

    if (!fileHandleArt && !fileHandleProd) {
      throw new Error(`No se encontró ni "Listado_de_articulos.xls" ni "Resumen_de_existencias_UC.xls" en la carpeta "${dirHandle.name}".`);
    }

    onProgress({ pct: 15, msg: "Leyendo archivos de Excel..." });
    const htmlArt = fileHandleArt ? await this.readFileFromHandle(fileHandleArt) : null;
    const htmlProd = fileHandleProd ? await this.readFileFromHandle(fileHandleProd) : null;

    return await this.uploadToSupabase(htmlArt, htmlProd, onProgress);
  },

  async syncFromFiles(files, onProgress) {
    onProgress({ pct: 10, msg: "Analizando archivos seleccionados..." });
    const fileList = Array.from(files || []);

    const fileArt = fileList.find(f => /listado.*articulos/i.test(f.name) || /articulos/i.test(f.name));
    const fileProd = fileList.find(f => /resumen.*existencias/i.test(f.name) || /existencias/i.test(f.name));

    if (!fileArt && !fileProd) {
      throw new Error("Debes incluir al menos 'Listado_de_articulos.xls' o 'Resumen_de_existencias_UC.xls'");
    }

    onProgress({ pct: 15, msg: "Leyendo contenido de los archivos..." });
    const htmlArt = fileArt ? await this.readFileFromInput(fileArt) : null;
    const htmlProd = fileProd ? await this.readFileFromInput(fileProd) : null;

    return await this.uploadToSupabase(htmlArt, htmlProd, onProgress);
  },

  async _fetchTable(table) {
    const sb = getSb();
    const rows = [];
    let from = 0;
    const step = 1000;
    for (;;) {
      const { data, error } = await sb.from(table).select("*").order("codigo").range(from, from + step - 1);
      if (error) throw new Error(`No se pudo leer la tabla ${table}: ${error.message}`);
      if (!data || !data.length) break;
      rows.push(...data);
      if (data.length < step) break;
      from += step;
    }
    return rows;
  },

  async _clearTable(table) {
    const sb = getSb();
    const { error } = await sb.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) throw new Error(`No se pudo vaciar la tabla ${table}: ${error.message}`);
  },

  async _insertChunks(table, rows, onRow) {
    const sb = getSb();
    const chunk = 500;
    for (let i = 0; i < rows.length; i += chunk) {
      const slice = rows.slice(i, i + chunk);
      const { error } = await sb.from(table).insert(slice);
      if (error) throw new Error(`Error subiendo ${table} a Supabase: ${error.message}`);
      if (onRow) onRow(Math.min(i + chunk, rows.length));
    }
  },

  async _restoreBackup(backupProd) {
    try {
      await this._clearTable("productos");
      if (backupProd.length) await this._insertChunks("productos", backupProd);
    } catch (e) {
      console.error("Error restaurando respaldo:", e);
    }
  },

  async uploadToSupabase(htmlArt, htmlProd, onProgress) {
    const sb = getSb();
    if (!sb) throw new Error("No hay conexión con Supabase.");

    onProgress({ pct: 20, msg: "Procesando productos..." });
    const productos = this.parseCatalog(htmlArt, htmlProd);

    if (!productos.length) throw new Error("No se encontraron productos válidos en los archivos de catálogo.");

    onProgress({ pct: 26, msg: "Respaldando información actual..." });
    let backupProd = [];
    try {
      backupProd = await this._fetchTable("productos");
    } catch (e) {
      throw new Error("Se abortó por seguridad para no perder datos: " + e.message);
    }

    try {
      onProgress({ pct: 30, msg: "Preparando base de datos en la nube..." });
      await this._clearTable("productos");

      await this._insertChunks("productos", productos, done => {
        const pct = 30 + Math.round((done / productos.length) * 60);
        onProgress({
          pct,
          msg: `Subiendo catálogo de productos (${done.toLocaleString("es-CO")}/${productos.length.toLocaleString("es-CO")})...`
        });
      });
    } catch (e) {
      onProgress({ pct: 60, msg: "Ocurrió un error, restaurando el respaldo anterior..." });
      await this._restoreBackup(backupProd);
      throw new Error(e.message + " Se restauró la información anterior.");
    }

    onProgress({ pct: 95, msg: "Recargando catálogo actualizado..." });
    await AppInit.bootCatalog();
    onProgress({ pct: 100, msg: "✅ ¡Base de datos actualizada con éxito!" });

    return { productos: productos.length };
  }
};
window.DataSync = DataSync;

let STATE = {
  datos: [],
  lastUpdate: null
};

function persistStateLocal() {
  try {
    localStorage.setItem("app_state_cache", JSON.stringify(STATE));
  } catch (e) {
    console.warn("⚠️ No se pudo guardar la caché local:", e);
  }
}

function loadStateLocal() {
  try {
    const raw = localStorage.getItem("app_state_cache") || localStorage.getItem("cotizador_state_cache");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        STATE.datos = parsed.datos || [];
        STATE.lastUpdate = parsed.lastUpdate || null;
      }
    }
  } catch (e) {}
}

const DB = {
  getDatos() { return STATE.datos || []; }
};

function toast(msg, isError) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = "toast show" + (isError ? " error" : "");
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.remove("show"), 3500);
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escapeHtml(s) { return esc(s); }

function norm(s) {
  return String(s == null ? "" : s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function formatFechaHora(isoStr) {
  if (!isoStr) return "Sin registros previos";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return "Sin registros previos";
    return d.toLocaleString("es-CO", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });
  } catch (e) {
    return "Sin registros previos";
  }
}

async function fetchAllProducts(sb) {
  let products = [];
  let from = 0;
  const step = 1000;
  let latestUpdated = null;
  for (;;) {
    const { data: dbProd, error } = await sb.from("productos")
      .select("codigo, descripcion, iva_pct, existencia, costo, proveedor, updated_at")
      .order("codigo", { ascending: true })
      .range(from, from + step - 1);
    if (error || !dbProd || !dbProd.length) break;
    products.push(...dbProd);
    dbProd.forEach(p => {
      if (p && p.updated_at && (!latestUpdated || String(p.updated_at) > String(latestUpdated))) {
        latestUpdated = p.updated_at;
      }
    });
    if (dbProd.length < step) break;
    from += step;
  }
  return { products, latestUpdated };
}

function applyProducts(productsRes) {
  const allProducts = (productsRes && productsRes.products) || [];
  STATE.datos = allProducts.map(p => {
    const rawIva = Number(p.iva_pct) || 0;
    const ivaPct = rawIva > 1 ? rawIva / 100 : rawIva;
    return [
      p.codigo,
      p.descripcion,
      ivaPct,
      Number(p.existencia) || 0,
      Number(p.costo) || 0,
      p.proveedor || ""
    ];
  });
  if (productsRes && productsRes.latestUpdated) {
    STATE.lastUpdate = productsRes.latestUpdated;
  } else if (allProducts.length === 0) {
    STATE.lastUpdate = null;
  }
  persistStateLocal();
}

const Router = {
  current: "home",
  history: [],
  go(view, opts) {
    if (this.current && this.current !== view) {
      this.history.push(this.current);
    }
    this._navigate(view, opts);
  },
  back() {
    const prev = this.history.length > 0 ? this.history.pop() : "home";
    this._navigate(prev);
  },
  _navigate(view, opts) {
    try {
      document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
      const target = document.getElementById("view-" + view);
      if (target) target.classList.add("active");

      const shell = document.querySelector(".app-shell");
      const wideViews = ["inventario", "movimientos", "catalogo", "ingresos", "actualizar-excel"];
      if (shell) {
        shell.classList.toggle("wide-nueva", wideViews.includes(view));
        shell.classList.toggle("wide-layout", wideViews.includes(view));
      }

      this.current = view;
      if (view === "home") Views.renderHome();
      if (view === "inventario") Views.renderInventario();
      if (view === "movimientos") Views.renderMovimientos();
      if (view === "catalogo") Views.renderCatalogo();
      if (view === "ingresos") Views.renderIngresos();
      if (view === "actualizar-excel") Views.renderActualizarExcel();

      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      console.error(e);
      toast("Error al abrir pantalla: " + e.message, true);
    }
  }
};

window.addEventListener("error", e => { console.error(e.error || e.message); });
window.addEventListener("unhandledrejection", e => { console.error(e.reason); });

const AppInit = {
  async boot() {
    loadStateLocal();
    const sb = getSb();
    const badge = document.getElementById("cloudStatus");

    if (!sb) {
      console.warn("Supabase no está disponible en este momento, usando caché local.");
      if (badge) {
        badge.innerHTML = '<span class="cloud-dot" style="background:#f59e0b"></span> Sin conexión · Caché local';
        badge.style.color = "#92400e";
        badge.style.background = "#fffbeb";
        badge.style.borderColor = "#fde68a";
      }
      return;
    }

    try {
      const productsRes = await fetchAllProducts(sb);
      applyProducts(productsRes);

      if (typeof updateDbStatsUI === "function") updateDbStatsUI();
      if (window.InventarioUI && window.InventarioUI.loadFromState) InventarioUI.loadFromState();
      console.log(`✅ Conectado a Supabase: ${STATE.datos.length} productos.`);

      if (badge) {
        badge.innerHTML = '<span class="cloud-dot"></span> Supabase · Conectado';
        badge.style.color = "";
        badge.style.background = "";
        badge.style.borderColor = "";
      }
    } catch (e) {
      console.error("Error sincronizando con Supabase:", e);
      if (badge) {
        badge.innerHTML = '<span class="cloud-dot" style="background:#dc2626"></span> Error de conexión';
        badge.style.color = "#991b1b";
        badge.style.background = "#fef2f2";
        badge.style.borderColor = "#fecaca";
      }
    }
  },

  async bootCatalog() {
    const sb = getSb();
    if (!sb) return;
    try {
      applyProducts(await fetchAllProducts(sb));
    } catch (e) {
      console.error("Error recargando catálogo:", e);
    }
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => AppInit.boot());
} else {
  AppInit.boot();
}

const Views = {};

function updateDbStatsUI() {
  const dateStr = formatFechaHora(STATE.lastUpdate);
  const totalProd = (STATE.datos || []).length;
  const invStats = document.getElementById("invHeaderStats");
  if (invStats) {
    invStats.innerHTML = `
      <div>Última actualización: <b>${dateStr}</b></div>
      <div><b>${totalProd.toLocaleString("es-CO")}</b> productos en general</div>
    `;
  }
}

Views.renderHome = function() {
  updateDbStatsUI();
};

Views.renderCatalogo = function() {
  const el = document.getElementById("view-catalogo");
  if (!el) return;
  el.innerHTML = `
    <div class="section-head">
      <div class="section-head-left">
        <button type="button" class="back" onclick="Router.back()">Atrás</button>
        <h2>Catálogo</h2>
      </div>
    </div>
    <div class="card" style="max-width:580px;margin:40px auto;text-align:center;padding:44px 28px;">
      <div style="font-size:42px;margin-bottom:14px;">📑</div>
      <div style="font-size:18px;font-weight:700;color:var(--azul-950);margin-bottom:18px;">Catálogo</div>
      <button type="button" class="btn btn-ghost" onclick="Router.back()">Atrás</button>
    </div>
  `;
};

Views.renderIngresos = function() {
  const el = document.getElementById("view-ingresos");
  if (!el) return;
  el.innerHTML = `
    <div class="section-head">
      <div class="section-head-left">
        <button type="button" class="back" onclick="Router.back()">Atrás</button>
        <h2>Ingresos</h2>
      </div>
    </div>
    <div class="card" style="max-width:580px;margin:40px auto;text-align:center;padding:44px 28px;">
      <div style="font-size:42px;margin-bottom:14px;">📥</div>
      <div style="font-size:18px;font-weight:700;color:var(--azul-950);margin-bottom:18px;">Ingresos</div>
      <button type="button" class="btn btn-ghost" onclick="Router.back()">Atrás</button>
    </div>
  `;
};

window.Router = Router;
window.Views = Views;
window.DB = DB;
window.AppInit = AppInit;
window.updateDbStatsUI = updateDbStatsUI;
window.toast = toast;
window.esc = esc;
window.escapeHtml = escapeHtml;
window.norm = norm;
window.formatFechaHora = formatFechaHora;
window.STATE = STATE;
window.getSb = getSb;
