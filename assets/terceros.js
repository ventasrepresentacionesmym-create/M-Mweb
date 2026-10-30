'use strict';

window.Terceros = (() => {
  const CFG = window.CONFIG || {};
  if (!window.supabase || !CFG.SUPABASE_URL || !CFG.SUPABASE_KEY) {
    return { abrir() {}, buscar: async () => null, texto: () => '', aprender: async () => false, invalidar() {} };
  }

  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);
  const $ = (id) => document.getElementById(id);

  const PAGO = { contado: 'Contado', credito: 'Crédito', ambos: 'Contado y crédito', '': '' };
  const RET = { no: 'No hace', si: 'Hace sobre base', '': '' };
  const PAGO_TEXTO = { contado: 'Contado', credito: 'Crédito', ambos: 'Contado y crédito', '': '' };
  const RET_TEXTO = {
    no: 'No hace retención en la fuente',
    si: 'Hace retención en la fuente sobre base',
    '': ''
  };

  let rows = [];
  let cargado = false;
  let cargando = null;
  let ultimoError = null;
  let editandoId = null;
  let busqueda = '';

  function esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function soloDigitos(v) {
    return String(v || '').replace(/\D/g, '');
  }

  function normalizarNit(v) {
    const s = String(v || '').trim();
    if (!s) return '';
    if (s.includes('-')) {
      const [base, dv] = s.split('-');
      return soloDigitos(base) + '-' + soloDigitos(dv);
    }
    return soloDigitos(s);
  }

  function baseNit(v) {
    const s = String(v || '');
    if (s.includes('-')) return soloDigitos(s.split('-')[0]);
    const d = soloDigitos(s);
    return d.length > 9 ? d.slice(0, -1) : d;
  }

  function coincideNit(a, b) {
    const da = soloDigitos(a);
    const db = soloDigitos(b);
    if (!da || !db) return false;
    if (da === db) return true;
    const ba = baseNit(a);
    const bb = baseNit(b);
    return ba === db || bb === da || ba === bb;
  }

  function normNombre(v) {
    let s = String(v || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/&/g, ' Y ')
      .replace(/[^A-Z0-9]+/g, ' ');
    s = s.replace(/\bS A S\b/g, ' ');
    s = s.replace(/\bS A\b/g, ' ');
    s = s.replace(/\bE U\b/g, ' ');
    s = s.replace(/\b(LTDA|LIMITADA|SAS|SA|EU|BIC)\b/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
  }

  function puntajeNombre(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 100;
    const ta = a.split(' ');
    const tb = b.split(' ');
    if (ta.every((t) => tb.includes(t))) return 85 - Math.max(0, tb.length - ta.length);
    if (tb.every((t) => ta.includes(t))) return 75 - Math.max(0, ta.length - tb.length);
    if (a.startsWith(b + ' ') || b.startsWith(a + ' ')) return 60;
    return 0;
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

  function faltaTabla(err) {
    return !!err && (
      err.code === '42P01' ||
      err.code === 'PGRST205' ||
      /does not exist|could not find the table|no existe/i.test(String(err.message || ''))
    );
  }

  async function cargar(forzar) {
    if (cargando) return cargando;
    if (cargado && !forzar) return rows;
    cargando = (async () => {
      const { data, error } = await sb
        .from('terceros')
        .select('*')
        .order('nombre', { ascending: true });
      if (error) {
        rows = [];
        cargado = false;
        ultimoError = error;
        throw error;
      }
      rows = data || [];
      cargado = true;
      ultimoError = null;
      return rows;
    })();
    try {
      return await cargando;
    } finally {
      cargando = null;
    }
  }

  function invalidar() {
    cargado = false;
  }

  function buscarPorNombre(nombre) {
    const n = normNombre(nombre);
    if (!n) return null;
    const ranked = rows
      .map((r) => ({ r, s: puntajeNombre(n, normNombre(r.nombre)) }))
      .filter((x) => x.s >= 65)
      .sort((a, b) => b.s - a.s);
    if (!ranked.length) return null;
    if (ranked.length > 1 && ranked[0].s === ranked[1].s) return null;
    return ranked[0].r;
  }

  async function buscar(nit, nombre) {
    try {
      await cargar();
    } catch {
      return null;
    }
    if (!rows.length) return null;
    const nd = soloDigitos(nit);
    if (nd) {
      const porNit = rows.filter((r) => coincideNit(r.nit, nd));
      if (porNit.length === 1) return porNit[0];
      if (porNit.length > 1) {
        const exactos = porNit.filter((r) => soloDigitos(r.nit) === nd);
        return exactos.length === 1 ? exactos[0] : null;
      }
    }
    return buscarPorNombre(nombre);
  }

  function texto(row) {
    if (!row) return '';
    const pago = PAGO_TEXTO[row.pago] || '';
    const ret = RET_TEXTO[row.retencion] || '';
    const partes = [];
    if (pago) partes.push('<strong>' + esc(pago) + '</strong>');
    if (ret) partes.push(esc(ret));
    return partes.join(' · ');
  }

  function render() {
    const q = busqueda.trim().toLowerCase();
    const visibles = rows.filter((r) => {
      if (!q) return true;
      return `${r.nombre || ''} ${r.nit || ''}`.toLowerCase().includes(q);
    });

    const tbody = $('terTbody');
    const vacia = $('terVacia');
    const cuenta = $('terCuenta');
    if (cuenta) {
      cuenta.textContent = q
        ? `${visibles.length} de ${rows.length}`
        : `${rows.length} ${rows.length === 1 ? 'empresa' : 'empresas'}`;
    }

    if (!visibles.length) {
      tbody.innerHTML = '';
      vacia.hidden = false;
      vacia.textContent = rows.length ? 'Sin resultados.' : 'Sin empresas.';
      return;
    }
    vacia.hidden = true;
    tbody.innerHTML = visibles
      .map(
        (r) => `
      <tr data-id="${esc(r.id)}">
        <td>${esc(r.nombre)}</td>
        <td>${esc(r.nit || '—')}</td>
        <td>${esc(PAGO[r.pago] || '—')}</td>
        <td>${esc(RET[r.retencion] || '—')}</td>
        <td class="ter-acciones">
          <button type="button" class="btn-ghost btn-sm" data-editar>Editar</button>
          <button type="button" class="btn-danger btn-sm" data-quitar>Quitar</button>
        </td>
      </tr>`
      )
      .join('');
  }

  function limpiarForm() {
    editandoId = null;
    $('terNombre').value = '';
    $('terNit').value = '';
    $('terPago').value = '';
    $('terRet').value = '';
    $('terFormTitulo').textContent = 'Agregar empresa';
    $('terGuardar').textContent = 'Agregar';
    $('terCancelar').hidden = true;
  }

  function cargarEnForm(row) {
    editandoId = row.id;
    $('terNombre').value = row.nombre || '';
    $('terNit').value = row.nit || '';
    $('terPago').value = PAGO[row.pago] ? row.pago : '';
    $('terRet').value = RET[row.retencion] ? row.retencion : '';
    $('terFormTitulo').textContent = 'Editar empresa';
    $('terGuardar').textContent = 'Guardar cambios';
    $('terCancelar').hidden = false;
    setMsg('terMsg', '');
    window.scrollTo({ top: 0, behavior: 'auto' });
    $('terNombre').focus();
  }

  async function guardar() {
    const btn = $('terGuardar');
    const nombre = $('terNombre').value.trim();
    const nit = normalizarNit($('terNit').value);
    const pago = PAGO[$('terPago').value] ? $('terPago').value : '';
    const retencion = RET[$('terRet').value] ? $('terRet').value : '';

    if (!nombre) {
      setMsg('terMsg', 'Escribe el nombre.', 'err');
      return;
    }

    const dup = rows.find((r) => {
      if (editandoId && r.id === editandoId) return false;
      if (normNombre(r.nombre) === normNombre(nombre)) return true;
      return nit ? coincideNit(r.nit, nit) : false;
    });
    if (dup) {
      setMsg('terMsg', 'Ese nombre o NIT ya existe.', 'err');
      return;
    }

    setBusy(btn, true, 'Guardando');
    setMsg('terMsg', '');
    try {
      const payload = {
        nombre,
        nit,
        pago,
        retencion,
        updated_at: new Date().toISOString()
      };
      const res = editandoId
        ? await sb.from('terceros').update(payload).eq('id', editandoId)
        : await sb.from('terceros').insert(payload);
      if (res.error) throw res.error;

      invalidar();
      await cargar(true);
      render();
      limpiarForm();
      setMsg('terMsg', 'Guardado.', 'ok');
      setMsg('terListaMsg', '');
    } catch (err) {
      setMsg(
        'terMsg',
        err && err.code === '23505' ? 'Ese nombre o NIT ya existe.' : 'No se pudo guardar.',
        'err'
      );
    } finally {
      setBusy(btn, false);
    }
  }

  async function quitar(row) {
    if (!row) return;
    if (!confirm(`¿Quitar ${row.nombre}?`)) return;
    try {
      const { error } = await sb.from('terceros').delete().eq('id', row.id);
      if (error) throw error;
      invalidar();
      await cargar(true);
      render();
      if (editandoId === row.id) limpiarForm();
      setMsg('terListaMsg', '');
      setMsg('terMsg', 'Quitado.', 'ok');
    } catch {
      setMsg('terListaMsg', 'No se pudo quitar.', 'err');
    }
  }

  async function aprender(nombre, nit) {
    const n = normalizarNit(nit);
    if (!n || !nombre) return false;
    try {
      await cargar();
    } catch {
      return false;
    }
    const fila = buscarPorNombre(nombre);
    if (!fila || fila.nit) return false;
    if (rows.some((r) => r.id !== fila.id && coincideNit(r.nit, n))) return false;
    const { error } = await sb
      .from('terceros')
      .update({ nit: n, updated_at: new Date().toISOString() })
      .eq('id', fila.id);
    if (error) return false;
    fila.nit = n;
    return true;
  }

  async function abrir() {
    setMsg('terListaMsg', '');
    if (!cargado) setMsg('terListaMsg', 'Cargando.', '');
    try {
      await cargar(true);
      render();
      setMsg('terListaMsg', '');
    } catch (err) {
      rows = [];
      render();
      setMsg(
        'terListaMsg',
        faltaTabla(err) ? 'Falta crear la tabla en Supabase.' : 'No se pudo cargar la tabla.',
        'err'
      );
    }
  }

  function init() {
    $('terGuardar').addEventListener('click', guardar);
    $('terCancelar').addEventListener('click', () => {
      limpiarForm();
      setMsg('terMsg', '');
    });
    $('terBusqueda').addEventListener('input', (e) => {
      busqueda = e.target.value;
      render();
    });
    ['terNombre', 'terNit'].forEach((id) => {
      $(id).addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          guardar();
        }
      });
    });
    $('terTbody').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const tr = btn.closest('tr');
      if (!tr) return;
      const row = rows.find((r) => r.id === tr.dataset.id);
      if (!row) return;
      if (btn.hasAttribute('data-editar')) cargarEnForm(row);
      if (btn.hasAttribute('data-quitar')) quitar(row);
    });
  }

  init();

  return { abrir, buscar, texto, aprender, invalidar, cargar };
})();
