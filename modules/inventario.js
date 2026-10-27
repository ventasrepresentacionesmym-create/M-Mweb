/* ============================================================
   INVENTARIO + MOVIMIENTOS — Vistas, InventarioUI, MovimientosUI
   Depende de: STATE, Router, DataSync, toast, esc, escapeHtml,
               formatFechaHora, norm
   ============================================================ */

Views.renderInventario = function() {
  const el = document.getElementById("view-inventario");
  if (!el) return;
  const dateStr = formatFechaHora(STATE.lastUpdate);
  const totalProd = (STATE.datos || []).length;


  el.innerHTML = `
    <div class="section-head" style="align-items:center;">
      <div class="section-head-left">
        <button type="button" class="back" onclick="Router.back()">Atrás</button>
        <h2>Inventario de Productos</h2>
      </div>
      <div class="inv-header-stats" id="invHeaderStats">
        <div>Última actualización: <b>${dateStr}</b></div>
        <div><b>${totalProd.toLocaleString("es-CO")}</b> productos en general</div>
      </div>
    </div>

    <div class="card" style="padding:16px 20px;margin-bottom:14px;">
      <div class="inv-toolbar">
        <input type="search" class="inv-search" id="invSearchBox" placeholder="Buscar por código, nombre o proveedor..." autocomplete="off">
        <button type="button" class="btn btn-accent" id="invBtnActualizar" onclick="InventarioUI.actualizarDatos()" title="Actualizar datos del inventario en tiempo real">
          📊 Actualizar Datos
        </button>
        <button type="button" class="btn btn-ghost" id="invBtnFolder" onclick="InventarioUI.connectFolder()" title="Conectar carpeta para consultar lotes y vencimientos">
          📁 Conectar Carpeta
        </button>
        <button type="button" class="btn btn-ghost" onclick="Router.go('movimientos')" title="Consultar movimientos de artículo">
          📈 Movimientos
        </button>
        <button type="button" class="btn btn-ghost" id="invClearFilters" title="Limpiar todos los filtros">
          Limpiar filtros
        </button>
        <div class="count" id="invRowCount" style="margin-left:auto;font-weight:600;font-size:13px;color:var(--azul-950);">Cargando artículos...</div>
      </div>
      <div id="invLoadStatus" style="font-size:12px;color:var(--texto-suave);margin-top:4px;min-height:16px;"></div>
    </div>

    <div class="inv-table-wrap">
      <div class="inv-head-row" id="invHeadRow">
        <div class="inv-col-det">Detalle</div>
        <div class="inv-col-cod inv-head-col" data-sort="codigo">Código <span class="sort-arrow"></span></div>
        <div class="inv-col-nom inv-head-col" data-sort="nombre">Descripción / Nombre <span class="sort-arrow"></span></div>
        <div class="inv-col-prov inv-head-col" data-sort="proveedor">Proveedor <span class="sort-arrow"></span></div>
        <div class="inv-col-iva inv-head-col" data-sort="iva">IVA % <span class="sort-arrow"></span></div>
        <div class="inv-col-exi inv-head-col" data-sort="exi">Existencia <span class="sort-arrow"></span></div>
        <div class="inv-col-costo inv-head-col" data-sort="costo">Costo <span class="sort-arrow"></span></div>
      </div>
      <div class="inv-filter-row">
        <div class="inv-col-det"></div>
        <div class="inv-col-cod"><input id="invFiltCod" placeholder="Filtrar..." autocomplete="off"></div>
        <div class="inv-col-nom"><input id="invFiltNom" placeholder="Filtrar descripción..." autocomplete="off"></div>
        <div class="inv-col-prov"><select id="invFiltProv"><option value="">Todos</option></select></div>
        <div class="inv-col-iva"><select id="invFiltIva"><option value="">Todos</option></select></div>
        <div class="inv-col-exi"><input id="invFiltExi" placeholder="Cant..." autocomplete="off"></div>
        <div class="inv-col-costo"><input id="invFiltCosto" placeholder="Costo..." autocomplete="off"></div>
      </div>
      <div class="inv-viewport" id="invViewport">
        <div class="inv-scroller" id="invScroller">
          <div class="inv-rows-window" id="invRowsWindow"></div>
        </div>
        <div id="invEmptyMsg" style="display:none;text-align:center;padding:40px 20px;color:var(--texto-suave);font-size:14px;">
          🔍 No se encontraron artículos que coincidan con la búsqueda o filtros.
        </div>
      </div>
    </div>

    <!-- Modal Detalle de Lotes -->
    <div class="modal-overlay" id="invLotesModal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.65);z-index:9999;align-items:center;justify-content:center;padding:16px;">
      <div class="modal-card" style="background:#ffffff;border-radius:14px;max-width:680px;width:100%;max-height:85vh;display:flex;flex-direction:column;padding:24px;box-shadow:0 20px 45px rgba(0,0,0,0.25);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;border-bottom:1px solid var(--linea);padding-bottom:14px;margin-bottom:14px;">
          <div>
            <div id="invModalCodigo" style="font-size:20px;font-weight:700;color:var(--teal-700);font-family:var(--mono);"></div>
            <div id="invModalNombre" style="font-size:14.5px;font-weight:600;color:var(--azul-950);margin-top:2px;"></div>
            <div id="invModalSub" style="font-size:12px;color:var(--texto-suave);margin-top:4px;"></div>
          </div>
          <button type="button" class="btn btn-ghost" onclick="InventarioUI.closeDetail()" style="padding:4px 10px;font-size:16px;line-height:1;">✕</button>
        </div>
        <div style="flex:1 1 auto;overflow-y:auto;min-height:120px;" id="invModalBody"></div>
        <div style="text-align:right;margin-top:16px;border-top:1px solid var(--linea);padding-top:12px;">
          <button type="button" class="btn btn-primary" onclick="InventarioUI.closeDetail()">Cerrar</button>
        </div>
      </div>
    </div>
  `;

  InventarioUI.init();
};

/* ---------- 📑 CATÁLOGO ---------- */
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

/* ---------- 📥 INGRESOS ---------- */
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

/* ---------- 📈 MOVIMIENTOS ---------- */
Views.renderMovimientos = function() {
  const el = document.getElementById("view-movimientos");
  if (!el) return;

  el.innerHTML = `
    <div class="section-head">
      <div class="section-head-left">
        <button type="button" class="back" onclick="Router.back()">Atrás</button>
        <h2>Movimientos de Artículo</h2>
      </div>
    </div>

    <div id="movSectionInput">
      <div class="card" style="max-width:580px;margin:30px auto;padding:32px 24px;">
        <div class="mov-dropzone" id="movDropzone">
          <div style="font-size:36px;margin-bottom:10px;">📈</div>
          <div style="font-size:16px;font-weight:700;color:var(--azul-950);margin-bottom:14px;">Cargar reporte de Movimiento del Artículo</div>
          <button type="button" class="btn btn-accent" style="pointer-events:none;">Seleccionar archivo</button>
          <input type="file" id="movFileInput" accept=".xls,.xlsx,.html,.htm" style="display:none;">
        </div>
        <div id="movStatusMsg" style="margin-top:14px;font-size:13px;text-align:center;font-weight:600;"></div>
      </div>
    </div>

    <div id="movSectionResults" style="display:none;">
      <div style="display:flex;justify-content:flex-end;margin-bottom:14px;">
        <button type="button" class="btn btn-ghost" onclick="MovimientosUI.reset()">
          ← Consultar otro artículo
        </button>
      </div>
      <div id="movOutput"></div>
    </div>
  `;

  MovimientosUI.init();
};

/* ============================================================
   INVENTARIO UI — Consulta virtualizada, filtros, lotes y sync
   ============================================================ */
const InventarioUI = {
  rawProducts: [],
  filteredProducts: [],
  ROW_HEIGHT: 42,
  sortCol: "codigo",
  sortAsc: true,

  actualizarDatos() {
    Router.go("actualizar-excel");
  },

  init() {
    this.bindEvents();
    this.loadFromState();
  },

  loadFromState() {
    const list = (STATE.datos || []).map(p => {
      let cod = "", nom = "", prov = "", iva = 0, costo = 0, exi = 0, lotes = [];
      if (Array.isArray(p)) {
        cod = (p[0] || "").toString().trim();
        nom = (p[1] || "").toString().trim();
        const rawIva = p[2] !== undefined ? p[2] : 0;
        iva = (rawIva <= 1 && rawIva > 0) ? Math.round(rawIva * 100) : Math.round(Number(rawIva) || 0);
        exi = Number(p[3]) || 0;
        costo = Number(p[4]) || 0;
        prov = (p[5] || "").toString().trim();
        lotes = p[6] || [];
      } else if (p && typeof p === "object") {
        cod = (p.codigo || "").toString().trim();
        nom = (p.nombre || p.descripcion || "").toString().trim();
        prov = (p.proveedor || "").toString().trim();
        const rawIva = p.iva !== undefined ? p.iva : (p.iva_pct !== undefined ? p.iva_pct : 0);
        iva = (rawIva <= 1 && rawIva > 0) ? Math.round(rawIva * 100) : Math.round(Number(rawIva) || 0);
        costo = Number(p.costo) || 0;
        exi = Number(p.existencia !== undefined ? p.existencia : (p.exi !== undefined ? p.exi : 0));
        lotes = p.lotes || [];
      }
      return {
        codigo: cod,
        nombre: nom,
        proveedor: prov,
        iva: iva,
        costo: costo,
        exi: exi,
        lotes: lotes
      };
    });
    this.rawProducts = list;
    this.populateProviderFilter();
    this.populateIvaFilter();
    this.applyFilters();
  },

  populateProviderFilter() {
    const sel = document.getElementById("invFiltProv");
    if (!sel) return;
    const current = sel.value;
    const provs = Array.from(new Set(this.rawProducts.map(p => p.proveedor).filter(Boolean))).sort();
    sel.innerHTML = '<option value="">Todos los proveedores</option>' +
      provs.map(pr => `<option value="${escapeHtml(pr)}">${escapeHtml(pr)}</option>`).join("");
    if (current) sel.value = current;
  },

  populateIvaFilter() {
    const sel = document.getElementById("invFiltIva");
    if (!sel) return;
    const current = sel.value;
    const ivas = Array.from(new Set(this.rawProducts.map(p => p.iva))).sort((a,b)=>a-b);
    sel.innerHTML = '<option value="">Todos</option>' +
      ivas.map(iv => `<option value="${iv}">${iv}%</option>`).join("");
    if (current) sel.value = current;
  },

  bindEvents() {
    const vport = document.getElementById("invViewport");
    if (vport) {
      vport.addEventListener("scroll", () => this.renderWindow());
    }

    const searchBox = document.getElementById("invSearchBox");
    if (searchBox) {
      let t;
      searchBox.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(() => this.applyFilters(), 150);
      });
    }

    ["invFiltCod", "invFiltNom", "invFiltExi", "invFiltCosto"].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        let t;
        el.addEventListener("input", () => {
          clearTimeout(t);
          t = setTimeout(() => this.applyFilters(), 150);
        });
      }
    });

    ["invFiltProv", "invFiltIva"].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener("change", () => this.applyFilters());
      }
    });

    const clearBtn = document.getElementById("invClearFilters");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        const s = document.getElementById("invSearchBox"); if (s) s.value = "";
        const c = document.getElementById("invFiltCod"); if (c) c.value = "";
        const n = document.getElementById("invFiltNom"); if (n) n.value = "";
        const p = document.getElementById("invFiltProv"); if (p) p.value = "";
        const i = document.getElementById("invFiltIva"); if (i) i.value = "";
        const e = document.getElementById("invFiltExi"); if (e) e.value = "";
        const co = document.getElementById("invFiltCosto"); if (co) co.value = "";
        this.applyFilters();
      });
    }

    // Sort headers
    const headCols = document.querySelectorAll(".inv-head-col");
    headCols.forEach(col => {
      col.addEventListener("click", () => {
        const field = col.dataset.sort;
        if (this.sortCol === field) {
          this.sortAsc = !this.sortAsc;
        } else {
          this.sortCol = field;
          this.sortAsc = true;
        }
        this.applyFilters();
      });
    });

    const fileInp = document.getElementById("invFileInput");
    if (fileInp) {
      fileInp.addEventListener("change", (e) => {
        if (e.target.files && e.target.files.length) {
          this.loadFromFiles(e.target.files);
        }
      });
    }
  },

  async connectFolder() {
    if (!("showDirectoryPicker" in window)) {
      document.getElementById("invFileInput").click();
      return;
    }
    const status = document.getElementById("invLoadStatus");
    try {
      if (status) status.textContent = "Seleccionando carpeta de inventario...";
      const dirHandle = await window.showDirectoryPicker();
      this.dirHandle = dirHandle;
      if (status) status.textContent = `Leyendo carpeta: ${dirHandle.name}...`;
      const files = [];
      for await (const entry of dirHandle.values()) {
        if (entry.kind === "file" && /\.(xls|xlsx)$/i.test(entry.name)) {
          const file = await entry.getFile();
          files.push(file);
        }
      }
      if (!files.length) {
        if (status) status.textContent = "No se encontraron archivos Excel (.xls, .xlsx) en la carpeta.";
        return;
      }
      await this.loadFromFiles(files);
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error(err);
        if (status) status.textContent = "Error al abrir carpeta: " + err.message;
      } else {
        if (status) status.textContent = "";
      }
    }
  },

  async loadFromFiles(fileList) {
    const status = document.getElementById("invLoadStatus");
    if (status) status.textContent = `Procesando ${fileList.length} archivo(s)...`;

    let articulosFile = null;
    let existenciasFile = null;

    for (const f of fileList) {
      const name = f.name.toLowerCase();
      if (name.includes("articul") || name.includes("articulo") || name.includes("listado")) {
        articulosFile = f;
      } else if (name.includes("existencia") || name.includes("resumen") || name.includes("lote")) {
        existenciasFile = f;
      }
    }

    if (!articulosFile && fileList.length > 0) articulosFile = fileList[0];
    if (!existenciasFile && fileList.length > 1) existenciasFile = fileList[1];

    try {
      const lotesMap = new Map();
      if (existenciasFile && typeof XLSX !== "undefined") {
        if (status) status.textContent = `Leyendo existencias y lotes desde ${existenciasFile.name}...`;
        const buf = await existenciasFile.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        
        let colCod = 0, colLote = 2, colVenc = 3, colCant = 4, colUbi = 5;
        let startIdx = 1;
        for (let i = 0; i < Math.min(15, rows.length); i++) {
          const r = rows[i] || [];
          for (let j = 0; j < r.length; j++) {
            const v = String(r[j] || "").toLowerCase();
            if (v.includes("art") || v.includes("cod")) colCod = j;
            if (v.includes("lote")) colLote = j;
            if (v.includes("venc")) colVenc = j;
            if (v.includes("exi") || v.includes("cant") || v.includes("saldo")) colCant = j;
            if (v.includes("ubi") || v.includes("bod")) colUbi = j;
          }
        }

        for (let i = startIdx; i < rows.length; i++) {
          const r = rows[i];
          if (!r || !r[colCod]) continue;
          const cod = String(r[colCod]).trim();
          const lote = r[colLote] ? String(r[colLote]).trim() : "SIN LOTE";
          const venc = r[colVenc] ? String(r[colVenc]).trim() : "";
          const cant = Number(r[colCant]) || 0;
          const ubi = r[colUbi] ? String(r[colUbi]).trim() : "";
          if (!lotesMap.has(cod)) lotesMap.set(cod, []);
          lotesMap.get(cod).push({ lote, venc, cant, ubi });
        }
      }

      // Merge into rawProducts
      for (const prod of this.rawProducts) {
        if (lotesMap.has(prod.codigo)) {
          prod.lotes = lotesMap.get(prod.codigo);
          const sumExi = prod.lotes.reduce((acc, l) => acc + (Number(l.cant) || 0), 0);
          prod.exi = sumExi;
        }
      }

      if (status) status.textContent = `✅ Existencias y lotes sincronizados exitosamente.`;
      this.applyFilters();
    } catch (e) {
      console.error(e);
      if (status) status.textContent = `Error procesando archivos: ${e.message}`;
    }
  },

  applyFilters() {
    const q = (document.getElementById("invSearchBox")?.value || "").toLowerCase().trim();
    const fCod = (document.getElementById("invFiltCod")?.value || "").toLowerCase().trim();
    const fNom = (document.getElementById("invFiltNom")?.value || "").toLowerCase().trim();
    const fProv = (document.getElementById("invFiltProv")?.value || "").trim();
    const fIva = (document.getElementById("invFiltIva")?.value || "").trim();
    const fExi = (document.getElementById("invFiltExi")?.value || "").trim();
    const fCosto = (document.getElementById("invFiltCosto")?.value || "").trim();

    const tokens = q ? q.split(/\s+/).filter(Boolean) : [];

    this.filteredProducts = this.rawProducts.filter(p => {
      if (tokens.length) {
        const text = `${p.codigo} ${p.nombre} ${p.proveedor}`.toLowerCase();
        if (!tokens.every(tk => text.includes(tk))) return false;
      }
      if (fCod && !p.codigo.toLowerCase().includes(fCod)) return false;
      if (fNom && !p.nombre.toLowerCase().includes(fNom)) return false;
      if (fProv && p.proveedor !== fProv) return false;
      if (fIva && String(p.iva) !== fIva) return false;
      if (fExi) {
        if (fExi === ">0" && p.exi <= 0) return false;
        if (fExi === "0" && p.exi !== 0) return false;
        const num = Number(fExi);
        if (!isNaN(num) && p.exi < num) return false;
      }
      if (fCosto) {
        const num = Number(fCosto);
        if (!isNaN(num) && p.costo < num) return false;
      }
      return true;
    });

    // Sort
    const col = this.sortCol;
    const asc = this.sortAsc;
    this.filteredProducts.sort((a, b) => {
      let va = a[col];
      let vb = b[col];
      if (typeof va === "string") va = va.toLowerCase();
      if (typeof vb === "string") vb = vb.toLowerCase();
      if (va < vb) return asc ? -1 : 1;
      if (va > vb) return asc ? 1 : -1;
      return 0;
    });

    // Update row count
    const countEl = document.getElementById("invRowCount");
    if (countEl) {
      countEl.textContent = `${this.filteredProducts.length.toLocaleString("es-CO")} artículo(s)`;
    }

    // Update sort arrows
    document.querySelectorAll(".inv-head-col").forEach(c => {
      const arrow = c.querySelector(".sort-arrow");
      if (arrow) {
        if (c.dataset.sort === this.sortCol) {
          arrow.textContent = this.sortAsc ? " ↑" : " ↓";
        } else {
          arrow.textContent = "";
        }
      }
    });

    // Update scroller height
    const scroller = document.getElementById("invScroller");
    if (scroller) {
      scroller.style.height = `${this.filteredProducts.length * this.ROW_HEIGHT}px`;
    }

    const empty = document.getElementById("invEmptyMsg");
    if (empty) {
      empty.style.display = this.filteredProducts.length === 0 ? "block" : "none";
    }

    this.renderWindow();
  },

  renderWindow() {
    const vport = document.getElementById("invViewport");
    const win = document.getElementById("invRowsWindow");
    if (!vport || !win) return;

    const scrollTop = vport.scrollTop;
    const clientHeight = vport.clientHeight || 600;

    const startIdx = Math.max(0, Math.floor(scrollTop / this.ROW_HEIGHT) - 5);
    const endIdx = Math.min(this.filteredProducts.length, Math.ceil((scrollTop + clientHeight) / this.ROW_HEIGHT) + 5);

    win.style.transform = `translateY(${startIdx * this.ROW_HEIGHT}px)`;

    const slice = this.filteredProducts.slice(startIdx, endIdx);
    win.innerHTML = slice.map((p) => {
      const exiClass = p.exi > 0 ? "pos" : "cero";
      const hasLotes = p.lotes && p.lotes.length > 0;
      const lotesBadge = hasLotes ? `<span class="inv-badge-lotes">${p.lotes.length}</span>` : "";
      return `
        <div class="inv-row">
          <div class="inv-col-det">
            <button type="button" class="inv-btn-lotes" onclick="InventarioUI.openDetail('${escapeHtml(p.codigo)}')">
              Lotes${lotesBadge}
            </button>
          </div>
          <div class="inv-col-cod" title="${escapeHtml(p.codigo)}">${escapeHtml(p.codigo)}</div>
          <div class="inv-col-nom" title="${escapeHtml(p.nombre)}">${escapeHtml(p.nombre)}</div>
          <div class="inv-col-prov" title="${escapeHtml(p.proveedor)}">${escapeHtml(p.proveedor || "-")}</div>
          <div class="inv-col-iva">${p.iva}%</div>
          <div class="inv-col-exi"><span class="inv-badge-exi ${exiClass}">${p.exi.toLocaleString("es-CO")}</span></div>
          <div class="inv-col-costo">$${p.costo.toLocaleString("es-CO")}</div>
        </div>
      `;
    }).join("");
  },

  openDetail(codigo) {
    const prod = this.rawProducts.find(p => p.codigo === codigo);
    if (!prod) return;
    const modal = document.getElementById("invLotesModal");
    const codEl = document.getElementById("invModalCodigo");
    const nomEl = document.getElementById("invModalNombre");
    const subEl = document.getElementById("invModalSub");
    const bodyEl = document.getElementById("invModalBody");
    if (!modal) return;

    if (codEl) codEl.textContent = prod.codigo;
    if (nomEl) nomEl.textContent = prod.nombre;
    if (subEl) subEl.textContent = `Proveedor: ${prod.proveedor || "N/A"} · IVA: ${prod.iva}% · Costo: $${prod.costo.toLocaleString("es-CO")}`;

    if (!prod.lotes || prod.lotes.length === 0) {
      bodyEl.innerHTML = `
        <div style="text-align:center;padding:30px 10px;color:var(--texto-suave);">
          <div style="font-size:32px;margin-bottom:8px;">📦</div>
          <b>No hay información de lotes registrada para este artículo.</b>
          <p style="font-size:12px;margin-top:6px;">Usa el botón "Conectar Carpeta" o "Cargar Archivos" en la parte superior para consultar existencias y lotes actualizados desde el Excel contable.</p>
        </div>
      `;
    } else {
      const rowsHtml = prod.lotes.map(l => `
        <tr>
          <td style="font-family:var(--mono);font-weight:700;color:var(--azul-950);">${escapeHtml(l.lote)}</td>
          <td>${escapeHtml(l.venc || "-")}</td>
          <td style="text-align:right;font-family:var(--mono);font-weight:700;color:var(--teal-700);">${Number(l.cant).toLocaleString("es-CO")}</td>
          <td>${escapeHtml(l.ubi || "Principal")}</td>
        </tr>
      `).join("");

      bodyEl.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px;">
          <thead>
            <tr style="background:#f8fafc;border-bottom:2px solid var(--linea);text-align:left;">
              <th style="padding:8px 10px;font-size:11px;text-transform:uppercase;color:var(--azul-950);">Lote</th>
              <th style="padding:8px 10px;font-size:11px;text-transform:uppercase;color:var(--azul-950);">Vencimiento</th>
              <th style="padding:8px 10px;font-size:11px;text-transform:uppercase;color:var(--azul-950);text-align:right;">Cantidad</th>
              <th style="padding:8px 10px;font-size:11px;text-transform:uppercase;color:var(--azul-950);">Ubicación</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      `;
    }

    modal.style.display = "flex";
  },

  closeDetail() {
    const modal = document.getElementById("invLotesModal");
    if (modal) modal.style.display = "none";
  }
};

/* ============================================================
   MOVIMIENTOS UI — Historial de entradas, salidas y trazabilidad
   ============================================================ */
const MovimientosUI = {
  data: null,

  init() {
    const dropzone = document.getElementById("movDropzone");
    const fileInp = document.getElementById("movFileInput");
    if (dropzone && fileInp) {
      dropzone.onclick = () => fileInp.click();
      dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add("dragover"); };
      dropzone.ondragleave = () => dropzone.classList.remove("dragover");
      dropzone.ondrop = (e) => {
        e.preventDefault();
        dropzone.classList.remove("dragover");
        if (e.dataTransfer.files && e.dataTransfer.files.length) {
          this.loadFile(e.dataTransfer.files[0]);
        }
      };
      fileInp.onchange = (e) => {
        if (e.target.files && e.target.files.length) {
          this.loadFile(e.target.files[0]);
        }
      };
    }
  },

  reset() {
    const sInput = document.getElementById("movSectionInput");
    const sResults = document.getElementById("movSectionResults");
    const out = document.getElementById("movOutput");
    const fileInp = document.getElementById("movFileInput");
    if (fileInp) fileInp.value = "";
    if (sInput) sInput.style.display = "block";
    if (sResults) sResults.style.display = "none";
    if (out) out.innerHTML = "";
  },

  async loadFile(file) {
    const msg = document.getElementById("movStatusMsg");
    if (msg) {
      msg.textContent = `Leyendo ${file.name}...`;
      msg.style.color = "var(--azul-950)";
    }

    try {
      let text = "";
      const buf = await file.arrayBuffer();

      try {
        const dec = new TextDecoder("latin1");
        text = dec.decode(buf);
      } catch (err) {
        text = "";
      }

      if (text.includes("<table") || text.includes("<TABLE")) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, "text/html");
        this.renderParsedHTML(doc, file.name);
      } else if (typeof XLSX !== "undefined") {
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const html = XLSX.utils.sheet_to_html(sheet);
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        this.renderParsedHTML(doc, file.name);
      } else {
        throw new Error("Formato de archivo no soportado. Cargue el reporte en formato Excel o HTML.");
      }

      document.getElementById("movSectionInput").style.display = "none";
      document.getElementById("movSectionResults").style.display = "block";
    } catch (e) {
      console.error(e);
      if (msg) {
        msg.textContent = `Error al procesar: ${e.message}`;
        msg.style.color = "#dc2626";
      }
    }
  },

  renderParsedHTML(doc, filename) {
    const out = document.getElementById("movOutput");
    if (!out) return;

    const fullText = doc.body.innerText || doc.body.textContent || "";
    
    const codMatch = fullText.match(/Art[íi]culo[:\s]+([A-Za-z0-9_\-\.]+)/i);
    const nomMatch = fullText.match(/(?:Descripci[óo]n|Nombre)[:\s]+([^\n\r]+)/i);
    const dateMatch = fullText.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\s*(?:al|a)\s*\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);

    const tables = doc.querySelectorAll("table");
    let mainTable = null;
    let maxRows = 0;
    tables.forEach(t => {
      const rCount = t.querySelectorAll("tr").length;
      if (rCount > maxRows) {
        maxRows = rCount;
        mainTable = t;
      }
    });

    let tableHtml = "";
    if (mainTable) {
      mainTable.classList.add("mov-table");
      tableHtml = `<div style="overflow-x:auto;">${mainTable.outerHTML}</div>`;
    } else {
      tableHtml = `<div class="empty">No se pudo extraer la tabla de movimientos.</div>`;
    }

    out.innerHTML = `
      <div class="card mov-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
          <div>
            <div style="font-size:18px;font-weight:700;color:var(--azul-950);">${nomMatch ? nomMatch[1].trim() : "Reporte de Movimientos"}</div>
            <div style="font-size:12.5px;color:var(--texto-suave);margin-top:2px;">
              ${codMatch ? `<b>Código:</b> ${codMatch[1]} &nbsp;·&nbsp; ` : ""}
              <b>Archivo:</b> ${escapeHtml(filename)}
              ${dateMatch ? ` &nbsp;·&nbsp; <b>Periodo:</b> ${dateMatch[1]}` : ""}
            </div>
          </div>
        </div>
        ${tableHtml}
      </div>
    `;
  }
};


/* ---- Exports del módulo Inventario ---- */
window.InventarioUI = InventarioUI;
window.MovimientosUI = MovimientosUI;

Views.renderActualizarExcel = async function () {
  const el = document.getElementById("view-actualizar-excel");
  if (!el) return;
  const hasFSA = ("showDirectoryPicker" in window);
  let savedFolder = null;
  if (hasFSA) {
    try { savedFolder = await DataSync.getSavedFolder(); } catch {}
  }
  const folderName = savedFolder ? savedFolder.name : null;
  el.innerHTML = `
    <div class="section-head">
      <div class="section-head-left">
        <button type="button" class="back" onclick="Router.back()">Atrás</button>
        <h2>Actualizar Datos</h2>
      </div>
    </div>
    <div class="card sync-card" style="margin-top:0;">
        <div class="sync-title">
          <span>Actualizar desde carpeta local</span>
          ${folderName ? `<span class="sync-folder-info" id="badgeFolderName">📁 Carpeta: ${esc(folderName)}</span>` : `<span class="sync-folder-info" id="badgeFolderName" style="display:none"></span>`}
        </div>
        <div class="sync-desc">
          Coloca los archivos <b>Listado_de_articulos.xls</b> y <b>Resumen_de_existencias_UC.xls</b> en la carpeta y sincroniza.
        </div>
        <div class="sync-progress-wrap" id="syncProgressWrap">
          <div class="sync-progress-bar" id="syncProgressBar"></div>
        </div>
        <div class="sync-status-msg" id="syncStatusMsg"></div>
        <div class="sync-actions">
          ${hasFSA ? `
            <button class="btn btn-accent" id="btnSyncFolder" style="padding:10px 18px;font-size:13.5px">Sincronizar desde carpeta</button>
            <button class="btn btn-ghost" id="btnChangeDataFolder">📁 Cambiar carpeta</button>
          ` : ""}
          <label class="btn btn-ghost" style="cursor:pointer;margin:0">
            📄 Subir archivos Excel
            <input type="file" id="manualFileInput" multiple accept=".xls,.html,.xlsx" style="display:none">
          </label>
          <button class="btn btn-ghost" id="btnReloadSupabase" style="margin-left:auto">🔄 Recargar datos</button>
        </div>
    </div>
  `;
  const progressWrap = document.getElementById("syncProgressWrap");
  const progressBar = document.getElementById("syncProgressBar");
  const statusMsg = document.getElementById("syncStatusMsg");
  const btnSync = document.getElementById("btnSyncFolder");
  const btnChange = document.getElementById("btnChangeDataFolder");
  const btnReload = document.getElementById("btnReloadSupabase");
  const manualInput = document.getElementById("manualFileInput");
  function showProgress(pct, msg) {
    if (progressWrap) progressWrap.style.display = "block";
    if (progressBar) progressBar.style.width = pct + "%";
    if (statusMsg) { statusMsg.style.display = "block"; statusMsg.textContent = msg; }
  }
  function hideProgress() {
    setTimeout(() => {
      if (progressWrap) progressWrap.style.display = "none";
      if (statusMsg) statusMsg.style.display = "none";
    }, 4000);
  }
  if (btnSync) {
    btnSync.addEventListener("click", async () => {
      btnSync.disabled = true;
      try {
        const result = await DataSync.syncFromFolder(({ pct, msg }) => showProgress(pct, msg));
        toast("✅ Sincronizados " + result.productos.toLocaleString("es-CO") + " productos.");
        const saved = await DataSync.getSavedFolder();
        if (saved && document.getElementById("badgeFolderName")) {
          const b = document.getElementById("badgeFolderName");
          b.textContent = "📁 Carpeta: " + saved.name;
          b.style.display = "inline-flex";
        }
      } catch (err) {
        showProgress(100, "❌ " + err.message);
        toast(err.message, true);
      } finally {
        btnSync.disabled = false;
        hideProgress();
      }
    });
  }
  if (btnChange) {
    btnChange.addEventListener("click", async () => {
      try {
        const handle = await DataSync.pickFolder();
        const b = document.getElementById("badgeFolderName");
        if (b) { b.textContent = "📁 Carpeta: " + handle.name; b.style.display = "inline-flex"; }
        toast("✅ Carpeta configurada: " + handle.name);
      } catch (e) {
        if (e.name !== "AbortError") toast(e.message, true);
      }
    });
  }
  if (manualInput) {
    manualInput.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      try {
        const result = await DataSync.syncFromFiles(files, ({ pct, msg }) => showProgress(pct, msg));
        toast("✅ Sincronizados " + result.productos.toLocaleString("es-CO") + " productos.");
      } catch (err) {
        showProgress(100, "❌ " + err.message);
        toast(err.message, true);
      } finally {
        manualInput.value = "";
        hideProgress();
      }
    });
  }
  if (btnReload) {
    btnReload.addEventListener("click", async () => {
      btnReload.disabled = true;
      try {
        await AppInit.boot();
        toast("Datos recargados: " + (STATE.datos || []).length.toLocaleString("es-CO") + " productos.");
      } catch (e) {
        toast("Error al conectar con la nube: " + e.message, true);
      } finally {
        btnReload.disabled = false;
      }
    });
  }
};
