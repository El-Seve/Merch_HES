let TOKEN = localStorage.getItem('token') || null;
let USUARIO = JSON.parse(localStorage.getItem('usuario') || 'null');
let ARCHIVOS_SELECCIONADOS = [];

function $(id) { return document.getElementById(id); }

async function api(ruta, opciones = {}) {
  const cabeceras = opciones.headers || {};
  if (!(opciones.body instanceof FormData) && opciones.body) {
    cabeceras['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(opciones.body);
  }
  if (TOKEN) cabeceras['Authorization'] = `Bearer ${TOKEN}`;
  const resp = await fetch(ruta, { ...opciones, headers: cabeceras });
  if (resp.status === 401) { cerrarSesion(); throw new Error('Sesión expirada'); }
  const contentType = resp.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return resp; // pptx/zip binarios
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'Error inesperado');
  return data;
}

function mostrarVistaApp() {
  $('vista-login').classList.remove('activa');
  $('vista-app').classList.add('activa');
  $('rol-badge').textContent = USUARIO.rol === 'admin' ? 'Administrador' : 'Promotor';
  if (USUARIO.rol === 'admin') {
    $('nav-admin').classList.remove('oculto');
    $('nav-presentaciones').classList.remove('oculto');
    $('lbl-promotor-wrap').classList.remove('oculto');
    $('ne-promotor').classList.remove('oculto');
    $('f-promotor-wrap').classList.remove('oculto');
  }
  cargarCatalogos();
  cargarEvidencias();
}

function cerrarSesion() {
  TOKEN = null; USUARIO = null;
  localStorage.removeItem('token'); localStorage.removeItem('usuario');
  $('vista-app').classList.remove('activa');
  $('vista-login').classList.add('activa');
}

$('btn-login').onclick = async () => {
  $('login-error').classList.add('oculto');
  try {
    const r = await api('/api/login', { method: 'POST', body: {
      usuario: $('login-usuario').value.trim(),
      password: $('login-password').value,
    }});
    TOKEN = r.token; USUARIO = r;
    localStorage.setItem('token', TOKEN);
    localStorage.setItem('usuario', JSON.stringify(USUARIO));
    mostrarVistaApp();
  } catch (e) {
    $('login-error').textContent = e.message;
    $('login-error').classList.remove('oculto');
  }
};
$('btn-salir').onclick = cerrarSesion;

// --- Navegación inferior ---
document.querySelectorAll('.nav-inferior button').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.nav-inferior button').forEach((b) => b.classList.remove('activo'));
    btn.classList.add('activo');
    document.querySelectorAll('.panel').forEach((p) => p.classList.add('oculto'));
    $(btn.dataset.panel).classList.remove('oculto');
    if (btn.dataset.panel === 'panel-evidencias') cargarEvidencias();
    if (btn.dataset.panel === 'panel-admin') cargarEstadoOneDrive();
  };
});

// --- Catálogos (selects compartidos) ---
async function cargarCatalogos() {
  const [tiendas, promotores] = await Promise.all([api('/api/tiendas'), api('/api/promotores')]);
  const opcionesTiendas = (sel, incluirTodas) => {
    sel.innerHTML = (incluirTodas ? '<option value="">Todas</option>' : '') +
      tiendas.map((t) => `<option value="${t.id}">${t.nombre} (${t.ciudad || ''})</option>`).join('');
  };
  opcionesTiendas($('ne-tienda'), false);
  opcionesTiendas($('f-tienda'), true);
  opcionesTiendas($('pr-tienda'), false);
  $('p-tiendas').innerHTML = tiendas.map((t) => `<option value="${t.id}">${t.nombre}</option>`).join('');

  const opcionesPromotores = (sel, incluirTodas) => {
    sel.innerHTML = (incluirTodas ? '<option value="">Todos</option>' : '') +
      promotores.map((p) => `<option value="${p.id}">${p.nombre} — ${p.tienda_nombre || ''}</option>`).join('');
  };
  opcionesPromotores($('ne-promotor'), false);
  opcionesPromotores($('f-promotor'), true);

  if (USUARIO.rol === 'admin') renderizarCatalogosAdmin(tiendas, promotores);
}

function renderizarCatalogosAdmin(tiendas, promotores) {
  $('lista-tiendas').innerHTML = tiendas.map((t) =>
    `<div class="entrega-item"><div class="fila-top"><span>${t.nombre} — ${t.ciudad || 's/d'} (${t.distribuidor || 's/d'})</span></div></div>`
  ).join('') || '<p class="estado-vacio">Sin tiendas aún.</p>';

  $('lista-promotores').innerHTML = promotores.map((p) =>
    `<div class="entrega-item"><div class="fila-top"><span>${p.nombre} — ${p.tienda_nombre || 's/d'}</span></div></div>`
  ).join('') || '<p class="estado-vacio">Sin promotores aún.</p>';
}

$('btn-add-tienda').onclick = async () => {
  await api('/api/tiendas', { method: 'POST', body: {
    nombre: $('t-nombre').value.trim(), ciudad: $('t-ciudad').value.trim(), distribuidor: $('t-distribuidor').value,
  }});
  $('t-nombre').value = ''; $('t-ciudad').value = '';
  cargarCatalogos();
};
$('btn-add-promotor').onclick = async () => {
  await api('/api/promotores', { method: 'POST', body: {
    nombre: $('pr-nombre').value.trim(), tienda_id: $('pr-tienda').value,
    usuario: $('pr-usuario').value.trim(), password: $('pr-password').value,
  }});
  $('pr-nombre').value = ''; $('pr-usuario').value = ''; $('pr-password').value = '';
  cargarCatalogos();
};

async function cargarEstadoOneDrive() {
  const r = await api('/api/estado/onedrive');
  const el = $('onedrive-estado');
  if (r.modo === 'demo') {
    el.innerHTML = `<div class="estado-ok-app">Modo demostración activo: las fotos se guardan localmente, no en OneDrive real. Cambia MODO=produccion (y configura RCLONE_CONFIG_CONTENT) cuando estés listo — ver README, sección "Conectar OneDrive".</div>`;
  } else if (r.conectado) {
    el.innerHTML = `<div class="estado-ok-app">OneDrive conectado ✅</div>`;
  } else {
    el.innerHTML = `<div class="estado-error-app">OneDrive NO conectado. Revisa que la variable de entorno RCLONE_CONFIG_CONTENT esté bien pegada en el servidor (ver README, sección "Conectar OneDrive").</div>`;
  }
}

// --- Nueva entrega: previsualización de fotos ---
$('btn-tomar-foto').onclick = () => $('ne-fotos-camara').click();
$('btn-elegir-galeria').onclick = () => $('ne-fotos-galeria').click();

function agregarArchivosSeleccionados(lista) {
  ARCHIVOS_SELECCIONADOS = ARCHIVOS_SELECCIONADOS.concat(Array.from(lista));
  renderizarPreviews();
}
$('ne-fotos-camara').onchange = (e) => { agregarArchivosSeleccionados(e.target.files); e.target.value = ''; };
$('ne-fotos-galeria').onchange = (e) => { agregarArchivosSeleccionados(e.target.files); e.target.value = ''; };
function renderizarPreviews() {
  $('ne-previews').innerHTML = ARCHIVOS_SELECCIONADOS.map((f, i) =>
    `<div class="miniatura"><img src="${URL.createObjectURL(f)}"><button data-i="${i}">×</button></div>`
  ).join('');
  $('ne-previews').querySelectorAll('button').forEach((b) => {
    b.onclick = () => { ARCHIVOS_SELECCIONADOS.splice(Number(b.dataset.i), 1); renderizarPreviews(); };
  });
}

$('btn-guardar-entrega').onclick = async () => {
  const msg = $('nueva-entrega-msg');
  msg.innerHTML = '';
  const tienda_id = $('ne-tienda').value;
  const fecha = $('ne-fecha').value;
  const tipo_merch = $('ne-tipo').value.trim();
  const cantidad = $('ne-cantidad').value;

  if (!tienda_id || !fecha || !tipo_merch || !cantidad) {
    msg.innerHTML = '<div class="estado-error-app">Completa tienda, fecha, tipo y cantidad.</div>'; return;
  }
  if (ARCHIVOS_SELECCIONADOS.length === 0) {
    msg.innerHTML = '<div class="estado-error-app">Adjunta al menos una fotografía.</div>'; return;
  }
  if (USUARIO.rol === 'admin' && !$('ne-promotor').value) {
    msg.innerHTML = '<div class="estado-error-app">Selecciona el promotor.</div>'; return;
  }

  const fd = new FormData();
  fd.append('tienda_id', tienda_id);
  fd.append('fecha', fecha);
  fd.append('tipo_merch', tipo_merch);
  fd.append('cantidad', cantidad);
  fd.append('observaciones', $('ne-obs').value.trim());
  if (USUARIO.rol === 'admin') fd.append('promotor_id', $('ne-promotor').value);
  ARCHIVOS_SELECCIONADOS.forEach((f) => fd.append('fotos', f));

  $('btn-guardar-entrega').disabled = true;
  $('ne-progreso').classList.remove('oculto');
  $('ne-progreso').textContent = 'Subiendo 0%...';

  try {
    await subirConProgreso('/api/entregas', fd, (pct) => {
      $('ne-progreso').textContent = `Subiendo ${pct}%...`;
    });
    msg.innerHTML = '<div class="estado-ok-app">Entrega guardada correctamente.</div>';
    ARCHIVOS_SELECCIONADOS = []; renderizarPreviews();
    $('ne-tipo').value = ''; $('ne-cantidad').value = ''; $('ne-obs').value = '';
  } catch (e) {
    msg.innerHTML = `<div class="estado-error-app">${e.message}</div>`;
  } finally {
    $('btn-guardar-entrega').disabled = false;
    $('ne-progreso').classList.add('oculto');
  }
};

function subirConProgreso(url, formData, onProgreso) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    if (TOKEN) xhr.setRequestHeader('Authorization', `Bearer ${TOKEN}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgreso(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
      else { try { reject(new Error(JSON.parse(xhr.responseText).error)); } catch { reject(new Error('Error al guardar')); } }
    };
    xhr.onerror = () => reject(new Error('Error de red'));
    xhr.send(formData);
  });
}

// --- Evidencias: filtros + listado ---
$('btn-filtrar').onclick = cargarEvidencias;

async function cargarEvidencias() {
  if (USUARIO.rol === 'admin') {
    const resumen = await api('/api/entregas/resumen');
    $('ev-kpis').innerHTML = `
      <div class="kpi"><div class="valor">${resumen.totalEntregas}</div><div class="etiqueta">Entregas registradas</div></div>
      <div class="kpi"><div class="valor">${resumen.totalFotos}</div><div class="etiqueta">Fotografías guardadas</div></div>
      <div class="kpi ${resumen.fotosPendientes > 0 ? 'alerta' : 'ok'}"><div class="valor">${resumen.fotosPendientes}</div><div class="etiqueta">Cargas pendientes</div></div>
      <div class="kpi ${resumen.fotosError > 0 ? 'alerta' : 'ok'}"><div class="valor">${resumen.fotosError}</div><div class="etiqueta">Cargas fallidas</div></div>
      <div class="kpi"><div class="valor">${resumen.correlativoActual}/9999</div><div class="etiqueta">Correlativo usado</div></div>
    `;
  }

  const params = new URLSearchParams();
  if ($('f-tienda').value) params.set('tienda_id', $('f-tienda').value);
  if (USUARIO.rol === 'admin' && $('f-promotor').value) params.set('promotor_id', $('f-promotor').value);
  if ($('f-desde').value) params.set('desde', $('f-desde').value);
  if ($('f-hasta').value) params.set('hasta', $('f-hasta').value);

  $('lista-entregas').innerHTML = '<div class="estado-cargando">Cargando...</div>';
  const entregas = await api(`/api/entregas?${params}`);
  if (entregas.length === 0) {
    $('lista-entregas').innerHTML = '<div class="estado-vacio">No hay entregas para estos filtros.</div>';
    return;
  }
  $('lista-entregas').innerHTML = entregas.map(renderEntrega).join('');
  document.querySelectorAll('[data-reintentar]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true; b.textContent = 'Reintentando...';
      await api(`/api/entregas/${b.dataset.reintentar}/reintentar`, { method: 'POST' });
      cargarEvidencias();
    };
  });
}

function renderEntrega(e) {
  const badge = (estado) => `<span class="badge ${estado}">${estado}</span>`;
  const fotosOk = e.fotos.filter((f) => f.estado === 'completo').length;
  const fotosMal = e.fotos.length - fotosOk;
  return `<div class="entrega-item">
    <div class="fila-top">
      <div>
        <strong>${e.tienda_nombre}</strong> — ${e.promotor_nombre}<br>
        <span style="font-size:13px;color:#6b7378">${e.fecha} · ${e.tipo_merch} × ${e.cantidad}</span>
      </div>
      ${badge(e.estado)}
    </div>
    ${e.observaciones ? `<div style="font-size:13px;margin-top:4px">${e.observaciones}</div>` : ''}
    <div class="fotos-mini">
      ${e.fotos.map((f) => `<img src="/api/entregas/fotos/${f.id}/contenido?t=${TOKEN.slice(0,8)}" onerror="this.style.opacity=0.3" title="${f.estado}">`).join('')}
    </div>
    <div style="font-size:12px;color:#6b7378;margin-top:4px">${fotosOk} guardada(s) · ${fotosMal} pendiente(s)/fallida(s)</div>
    ${fotosMal > 0 ? `<button data-reintentar="${e.id}" class="btn-secundario" style="margin-top:8px">Reintentar cargas fallidas</button>` : ''}
  </div>`;
}
// nota: las imágenes van con Authorization vía fetch+blob para respetar permisos; el <img src> directo no envía el header,
// así que se resuelven abajo tras el render.
function reemplazarImagenesConAuth() {
  document.querySelectorAll('.fotos-mini img').forEach(async (img) => {
    const url = img.getAttribute('src').split('?')[0];
    try {
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
      const blob = await resp.blob();
      img.src = URL.createObjectURL(blob);
    } catch {}
  });
}
const _cargarEvidenciasOriginal = cargarEvidencias;
cargarEvidencias = async function () { await _cargarEvidenciasOriginal(); reemplazarImagenesConAuth(); };

// --- Presentaciones (admin) ---
$('btn-pres-tienda').onclick = () => generarPresentacion('/api/presentaciones/por-tienda');
$('btn-pres-consolidada').onclick = () => generarPresentacion('/api/presentaciones/consolidada');

async function generarPresentacion(ruta) {
  const msg = $('p-msg');
  msg.innerHTML = '<div class="estado-cargando">Generando presentación...</div>';
  const tienda_ids = Array.from($('p-tiendas').selectedOptions).map((o) => Number(o.value));
  try {
    const resp = await fetch(ruta, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        tienda_ids,
        promotor_id: $('f-promotor').value || undefined,
        desde: $('f-desde').value || undefined,
        hasta: $('f-hasta').value || undefined,
      }),
    });
    if (!resp.ok) {
      const err = await resp.json();
      msg.innerHTML = `<div class="estado-error-app">${err.error}</div>`;
      return;
    }
    const blob = await resp.blob();
    const disposicion = resp.headers.get('Content-Disposition') || '';
    const nombre = /filename="(.+)"/.exec(disposicion)?.[1] || 'presentacion.pptx';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nombre; a.click();
    msg.innerHTML = '<div class="estado-ok-app">Presentación generada.</div>';
  } catch (e) {
    msg.innerHTML = `<div class="estado-error-app">${e.message}</div>`;
  }
}

// --- Arranque ---
if (TOKEN && USUARIO) mostrarVistaApp();
