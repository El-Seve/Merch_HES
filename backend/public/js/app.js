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
  const esLogin = ruta === '/api/login';
  const contentType = resp.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (resp.status === 401 && !esLogin) { cerrarSesion(); throw new Error('Sesión expirada'); }
    return resp; // pptx/zip binarios
  }
  const data = await resp.json();
  if (!resp.ok) {
    // Un 401 en el login es "usuario/contraseña incorrectos", no una sesión que expiró.
    if (resp.status === 401 && !esLogin) { cerrarSesion(); throw new Error('Sesión expirada'); }
    throw new Error(data.error || 'Error inesperado');
  }
  return data;
}

function mostrarVistaApp() {
  $('vista-login').classList.remove('activa');
  $('vista-app').classList.add('activa');
  $('rol-badge').textContent = USUARIO.rol === 'admin' ? 'Administrador' : 'Promotor';
  if (USUARIO.rol === 'admin') {
    $('nav-admin').classList.remove('oculto');
    $('nav-presentaciones').classList.remove('oculto');
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
  const [tiendas, promotores, tiposMerch] = await Promise.all([
    api('/api/tiendas'), api('/api/promotores'), api('/api/tipos-merch'),
  ]);
  const opcionesTiendas = (sel, incluirTodas) => {
    sel.innerHTML = (incluirTodas ? '<option value="">Todas</option>' : '') +
      tiendas.map((t) => `<option value="${t.id}">${t.nombre} (${t.ciudad || ''})</option>`).join('');
  };
  opcionesTiendas($('ne-tienda'), false);
  opcionesTiendas($('f-tienda'), true);
  opcionesTiendas($('pr-tienda'), false);
  if (USUARIO.rol === 'admin') {
    opcionesTiendas($('limp-tienda'), false);
    opcionesTiendas($('limp-tienda-definitivo'), false);
  }
  $('p-tiendas').innerHTML = tiendas.map((t) => `<option value="${t.id}">${t.nombre}</option>`).join('');

  // El filtro de Evidencias sigue siendo un desplegable (elegir entre existentes).
  $('f-promotor').innerHTML = '<option value="">Todos</option>' +
    promotores.map((p) => `<option value="${p.id}">${p.nombre} — ${p.tienda_nombre || ''}</option>`).join('');

  // Nueva entrega (solo admin): campo de texto libre con sugerencias de nombres ya usados.
  $('ne-tipo-lista').innerHTML = tiposMerch.map((m) => `<option value="${m.descripcion}">`).join('');

  if (USUARIO.rol === 'admin') renderizarCatalogosAdmin(tiendas, promotores, tiposMerch);
}

function renderizarCatalogosAdmin(tiendas, promotores, tiposMerch) {
  $('lista-tiendas').innerHTML = tiendas.map((t) =>
    `<div class="entrega-item"><div class="fila-top"><span>${t.nombre} — ${t.ciudad || 's/d'}</span></div></div>`
  ).join('') || '<p class="estado-vacio">Sin tiendas aún.</p>';

  $('lista-promotores').innerHTML = promotores.map((p) =>
    `<div class="entrega-item"><div class="fila-top"><span>${p.nombre} — ${p.tienda_nombre || 's/d'}</span></div></div>`
  ).join('') || '<p class="estado-vacio">Sin promotores aún.</p>';

  $('lista-tipos-merch').innerHTML = tiposMerch.map((m) =>
    `<div class="entrega-item"><div class="fila-top"><span>${m.descripcion} <span style="color:#6b7378">(${m.codigo})</span></span></div></div>`
  ).join('') || '<p class="estado-vacio">Sin tipos de merchandising aún.</p>';
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
$('btn-add-tipo-merch').onclick = async () => {
  await api('/api/tipos-merch', { method: 'POST', body: {
    codigo: $('tm-codigo').value.trim(), descripcion: $('tm-descripcion').value.trim(),
  }});
  $('tm-codigo').value = ''; $('tm-descripcion').value = '';
  cargarCatalogos();
};
$('btn-respaldar-ahora').onclick = async () => {
  const msg = $('respaldo-msg');
  msg.innerHTML = '<div class="estado-cargando">Respaldando...</div>';
  try {
    await api('/api/admin/respaldar-ahora', { method: 'POST', body: {} });
    msg.innerHTML = '<div class="estado-ok-app">Respaldo guardado en OneDrive correctamente.</div>';
  } catch (e) {
    msg.innerHTML = `<div class="estado-error-app">${e.message}</div>`;
  }
};
$('btn-resetear-usuarios').onclick = async () => {
  if (!confirm('Esto va a borrar TODOS los usuarios actuales y dejar solo 2 (admin + promotor). ¿Continuar?')) return;
  const msg = $('reset-usuarios-msg');
  msg.innerHTML = '<div class="estado-cargando">Reseteando...</div>';
  try {
    const r = await api('/api/admin/resetear-usuarios', { method: 'POST', body: {} });
    msg.innerHTML = `<div class="estado-ok-app">Listo. Usuario admin: <b>${r.usuario_admin}</b> / <b>${r.password_admin}</b><br>Usuario promotor: <b>${r.usuario_promotor}</b> / <b>${r.password_promotor}</b><br>Guárdalos — no se vuelven a mostrar aquí.</div>`;
  } catch (e) {
    msg.innerHTML = `<div class="estado-error-app">${e.message}</div>`;
  }
};
$('btn-importar-catalogo').onclick = async () => {
  const msg = $('importar-msg');
  msg.innerHTML = '<div class="estado-cargando">Importando...</div>';
  try {
    const r = await api('/api/admin/importar-catalogo-real', { method: 'POST', body: {} });
    msg.innerHTML = `<div class="estado-ok-app">Listo: ${r.tiendasNuevas} tienda(s) y ${r.merchNuevos} tipo(s) de merch nuevos agregados${r.desactivadas ? `, ${r.desactivadas} tienda(s) provisional(es) desactivadas` : ''}.</div>`;
    cargarCatalogos();
  } catch (e) {
    msg.innerHTML = `<div class="estado-error-app">${e.message}</div>`;
  }
};

// --- Limpieza de datos (reflejar borrados manuales hechos en OneDrive) ---
(function inicializarSelectorAnios() {
  const sel = $('limp-anio');
  if (!sel) return;
  const añoActual = new Date().getFullYear();
  const años = [añoActual, añoActual - 1, añoActual - 2];
  sel.innerHTML = años.map((a) => `<option value="${a}">${a}</option>`).join('');
})();

$('btn-limpiar-entregas').onclick = async () => {
  const tiendaId = $('limp-tienda').value;
  const anio = $('limp-anio').value;
  const mes = $('limp-mes').value;
  const tiendaTexto = $('limp-tienda').selectedOptions[0]?.textContent || '';
  const mesTexto = $('limp-mes').selectedOptions[0]?.textContent || '';
  if (!confirm(`Esto va a borrar de la base de datos TODAS las entregas de ${tiendaTexto} en ${mesTexto} ${anio}. No se puede deshacer. ¿Continuar?`)) return;
  const msg = $('limp-entregas-msg');
  msg.innerHTML = '<div class="estado-cargando">Borrando...</div>';
  try {
    const r = await api(`/api/entregas/limpiar?tienda_id=${tiendaId}&anio=${anio}&mes=${mes}`, { method: 'DELETE' });
    msg.innerHTML = `<div class="estado-ok-app">Listo: ${r.entregasBorradas} entrega(s) y ${r.fotosBorradas} foto(s) eliminadas del registro.</div>`;
    cargarEvidencias();
  } catch (e) {
    msg.innerHTML = `<div class="estado-error-app">${e.message}</div>`;
  }
};

$('btn-eliminar-tienda-definitivo').onclick = async () => {
  const tiendaId = $('limp-tienda-definitivo').value;
  const tiendaTexto = $('limp-tienda-definitivo').selectedOptions[0]?.textContent || '';
  if (!confirm(`Esto va a ELIMINAR PARA SIEMPRE la tienda "${tiendaTexto}" junto con todo su historial de entregas y fotos en la base de datos. No se puede deshacer. ¿Continuar?`)) return;
  const msg = $('limp-tienda-msg');
  msg.innerHTML = '<div class="estado-cargando">Eliminando...</div>';
  try {
    const r = await api(`/api/tiendas/${tiendaId}/definitivo`, { method: 'DELETE' });
    msg.innerHTML = `<div class="estado-ok-app">Listo: tienda "${r.tienda}" eliminada junto con ${r.entregasBorradas} entrega(s) y ${r.fotosBorradas} foto(s).</div>`;
    cargarCatalogos();
    cargarEvidencias();
  } catch (e) {
    msg.innerHTML = `<div class="estado-error-app">${e.message}</div>`;
  }
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
  const fd = new FormData();
  fd.append('tienda_id', tienda_id);
  fd.append('fecha', fecha);
  fd.append('tipo_merch', tipo_merch);
  fd.append('cantidad', cantidad);
  fd.append('observaciones', $('ne-obs').value.trim());
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
const EV_POR_PAGINA = 20;
let EV_DESPLAZAMIENTO = 0;

function parametrosFiltroEvidencias() {
  const params = new URLSearchParams();
  if ($('f-tienda').value) params.set('tienda_id', $('f-tienda').value);
  if (USUARIO.rol === 'admin' && $('f-promotor').value) params.set('promotor_id', $('f-promotor').value);
  if ($('f-desde').value) params.set('desde', $('f-desde').value);
  if ($('f-hasta').value) params.set('hasta', $('f-hasta').value);
  return params;
}

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

  EV_DESPLAZAMIENTO = 0;
  $('lista-entregas').innerHTML = '<div class="estado-cargando">Cargando...</div>';
  const hayMas = await agregarPaginaEvidencias(true);
  void hayMas;
}

// Trae UNA página de entregas (20 a la vez, no todo el histórico) y la agrega al listado.
async function agregarPaginaEvidencias(reemplazar) {
  const params = parametrosFiltroEvidencias();
  params.set('limite', EV_POR_PAGINA + 1); // uno extra solo para saber si hay más
  params.set('desplazamiento', EV_DESPLAZAMIENTO);
  let entregas = await api(`/api/entregas?${params}`);
  const hayMas = entregas.length > EV_POR_PAGINA;
  if (hayMas) entregas = entregas.slice(0, EV_POR_PAGINA);
  EV_DESPLAZAMIENTO += entregas.length;

  const contenedor = $('lista-entregas');
  if (reemplazar && entregas.length === 0) {
    contenedor.innerHTML = '<div class="estado-vacio">No hay entregas para estos filtros.</div>';
    return false;
  }
  const antiguo = document.getElementById('btn-ver-mas');
  if (antiguo) antiguo.remove();
  if (reemplazar) contenedor.innerHTML = '';
  contenedor.insertAdjacentHTML('beforeend', entregas.map(renderEntrega).join(''));
  if (hayMas) {
    contenedor.insertAdjacentHTML('beforeend',
      '<button id="btn-ver-mas" class="btn-secundario btn-bloque" style="margin-top:12px">Ver más entregas</button>');
    $('btn-ver-mas').onclick = async (ev) => {
      ev.target.disabled = true; ev.target.textContent = 'Cargando...';
      await agregarPaginaEvidencias(false);
    };
  }
  contenedor.querySelectorAll('[data-reintentar]:not([data-listo])').forEach((b) => {
    b.dataset.listo = '1';
    b.onclick = async () => {
      b.disabled = true; b.textContent = 'Reintentando...';
      await api(`/api/entregas/${b.dataset.reintentar}/reintentar`, { method: 'POST' });
      cargarEvidencias();
    };
  });
  observarMiniaturas();
  return hayMas;
}

$('btn-filtrar').onclick = cargarEvidencias;

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
      ${e.fotos.map((f) => `<img data-foto="${f.id}" alt="" title="${f.estado}" style="background:#e8ecee">`).join('')}
    </div>
    <div style="font-size:12px;color:#6b7378;margin-top:4px">${fotosOk} guardada(s) · ${fotosMal} pendiente(s)/fallida(s)</div>
    ${fotosMal > 0 ? `<button data-reintentar="${e.id}" class="btn-secundario" style="margin-top:8px">Reintentar cargas fallidas</button>` : ''}
  </div>`;
}

// --- Miniaturas: se cargan solo las que se ven en pantalla, de pocas en pocas ---
// Antes el navegador pedía TODAS las fotos completas al mismo tiempo apenas se
// abría el panel; con cientos de fotos eso saturaba el servidor y la pantalla.
const COLA_MINIATURAS = [];
let MINIATURAS_ACTIVAS = 0;
const MAX_MINIATURAS_A_LA_VEZ = 4;

const observadorMiniaturas = ('IntersectionObserver' in window)
  ? new IntersectionObserver((entradas) => {
      entradas.forEach((en) => {
        if (en.isIntersecting) {
          observadorMiniaturas.unobserve(en.target);
          encolarMiniatura(en.target);
        }
      });
    }, { rootMargin: '300px' })
  : null;

function observarMiniaturas() {
  document.querySelectorAll('.fotos-mini img[data-foto]:not([data-observada])').forEach((img) => {
    img.dataset.observada = '1';
    if (observadorMiniaturas) observadorMiniaturas.observe(img);
    else encolarMiniatura(img);
  });
}

function encolarMiniatura(img) {
  COLA_MINIATURAS.push(img);
  atenderColaMiniaturas();
}

function atenderColaMiniaturas() {
  while (MINIATURAS_ACTIVAS < MAX_MINIATURAS_A_LA_VEZ && COLA_MINIATURAS.length) {
    const img = COLA_MINIATURAS.shift();
    MINIATURAS_ACTIVAS++;
    cargarMiniatura(img).finally(() => { MINIATURAS_ACTIVAS--; atenderColaMiniaturas(); });
  }
}

async function cargarMiniatura(img) {
  try {
    const resp = await fetch(`/api/entregas/fotos/${img.dataset.foto}/contenido?mini=1`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!resp.ok) throw new Error('sin miniatura');
    img.src = URL.createObjectURL(await resp.blob());
    img.style.cursor = 'zoom-in';
    img.onclick = () => abrirFotoCompleta(img.dataset.foto);
  } catch {
    img.style.opacity = 0.3;
  }
}

// Al tocar una miniatura se abre la foto completa: directo desde OneDrive si hay
// link válido (no gasta banda de Render), o por el servidor como respaldo.
async function abrirFotoCompleta(id) {
  const ventana = window.open('', '_blank');
  try {
    const r = await fetch(`/api/entregas/fotos/${id}/enlace`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const data = await r.json();
    if (data.url) { ventana.location = data.url; return; }
    const resp = await fetch(`/api/entregas/fotos/${id}/contenido`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    ventana.location = URL.createObjectURL(await resp.blob());
  } catch {
    if (ventana) ventana.close();
  }
}

// --- Presentaciones (admin) ---
$('btn-pres-tienda').onclick = () => generarPresentacion('/api/presentaciones/por-tienda', 'p-msg');
$('btn-pres-consolidada').onclick = () => generarPresentacion('/api/presentaciones/consolidada', 'p-msg');
$('btn-pres-recuperacion').onclick = () => generarPresentacion('/api/presentaciones/recuperar-onedrive', 'p-msg-recuperacion');

async function generarPresentacion(ruta, idMensaje) {
  const msg = $(idMensaje);
  const botones = ['btn-pres-tienda', 'btn-pres-consolidada', 'btn-pres-recuperacion'].map($);
  const bloquear = (v) => botones.forEach((b) => { b.disabled = v; });
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  bloquear(true);
  msg.innerHTML = '<div class="estado-cargando">Iniciando...</div>';
  const tienda_ids = Array.from($('p-tiendas').selectedOptions).map((o) => Number(o.value));
  try {
    // 1) arranca el trabajo en el servidor (responde al toque)
    const { jobId } = await api(ruta, {
      method: 'POST',
      body: {
        tienda_ids,
        promotor_id: $('f-promotor').value || undefined,
        desde: $('f-desde').value || undefined,
        hasta: $('f-hasta').value || undefined,
      },
    });

    // 2) consulta el avance cada pocos segundos hasta que esté listo
    let fallosSeguidos = 0;
    const limite = Date.now() + 20 * 60 * 1000;
    for (;;) {
      if (Date.now() > limite) throw new Error('Está tardando demasiado. Inténtalo con menos tiendas o un rango de fechas menor.');
      await esperar(2000);
      let est;
      try {
        est = await api(`/api/presentaciones/estado/${jobId}`);
        fallosSeguidos = 0;
      } catch (e) {
        // un corte momentáneo de señal no debe tumbar todo
        if (e.message.includes('No se encontró el trabajo') || ++fallosSeguidos >= 5) throw e;
        continue;
      }
      if (est.estado === 'error') throw new Error(est.error || 'No se pudo generar la presentación.');
      if (est.estado === 'listo') break;
      const avance = est.total ? ` ${est.hecho} de ${est.total} fotos` : '';
      msg.innerHTML = `<div class="estado-cargando">Armando presentación…${avance}</div>`;
    }

    // 3) descarga el archivo terminado
    msg.innerHTML = '<div class="estado-cargando">Descargando...</div>';
    const resp = await fetch(`/api/presentaciones/descargar/${jobId}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!resp.ok) {
      let texto = 'No se pudo descargar la presentación.';
      try { texto = (await resp.json()).error || texto; } catch {}
      throw new Error(texto);
    }
    const blob = await resp.blob();
    const disposicion = resp.headers.get('Content-Disposition') || '';
    const nombre = /filename="(.+)"/.exec(disposicion)?.[1] || 'presentacion.pptx';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nombre; a.click();
    msg.innerHTML = '<div class="estado-ok-app">Presentación generada.</div>';
  } catch (e) {
    msg.innerHTML = `<div class="estado-error-app">${e.message}</div>`;
  } finally {
    bloquear(false);
  }
}

// --- Arranque ---
if (TOKEN && USUARIO) mostrarVistaApp();
