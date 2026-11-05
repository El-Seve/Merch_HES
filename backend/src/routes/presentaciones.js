const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const { db } = require('../db');
const { soloAdmin } = require('../auth');
const { generarPptxTienda, generarPptxConsolidado } = require('../pptx/generarPresentaciones');
const { generarPptxRecuperacion } = require('../pptx/generarRecuperacion');

const router = express.Router();
router.use(soloAdmin); // solo el administrador genera presentaciones

const MIME_PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

// ---------------------------------------------------------------------------
// Trabajos en segundo plano.
// Armar una presentación con cientos de fotos tarda minutos: si se hacía dentro
// de UNA sola petición HTTP, Render/el celular la cortaban por tiempo y la
// presentación nunca llegaba. Ahora la petición solo "arranca" el trabajo y
// devuelve un id; la pantalla consulta el avance y descarga cuando está listo.
// ---------------------------------------------------------------------------
const trabajos = new Map();
const VIDA_TRABAJO_MS = 30 * 60 * 1000;

function limpiarTrabajosViejos() {
  const ahora = Date.now();
  for (const [id, t] of trabajos) {
    if (t.estado !== 'procesando' && ahora - t.creado > VIDA_TRABAJO_MS) {
      if (t.archivo) fs.promises.unlink(t.archivo).catch(() => {});
      trabajos.delete(id);
    }
  }
}
setInterval(limpiarTrabajosViejos, 5 * 60 * 1000).unref();

function hayTrabajoEnCurso() {
  for (const t of trabajos.values()) if (t.estado === 'procesando') return true;
  return false;
}

/**
 * Crea el trabajo y lo ejecuta sin bloquear la respuesta.
 * `ejecutar(ctx)` debe devolver { buffer? , archivo?, nombre, contentType }.
 */
function iniciarTrabajo(res, total, ejecutar) {
  if (hayTrabajoEnCurso()) {
    return res.status(409).json({
      error: 'Ya hay una presentación generándose. Espera a que termine e inténtalo de nuevo.',
    });
  }
  const id = crypto.randomBytes(8).toString('hex');
  const trabajo = { id, estado: 'procesando', total, hecho: 0, creado: Date.now() };
  trabajos.set(id, trabajo);

  const ctx = {
    onFoto: () => { trabajo.hecho++; },
    setTotal: (n) => { trabajo.total = n; },
  };

  (async () => {
    try {
      const r = await ejecutar(ctx);
      let archivo = r.archivo;
      if (!archivo) {
        archivo = path.join(os.tmpdir(), `pres-${id}`);
        await fs.promises.writeFile(archivo, r.buffer); // fuera de la RAM
      }
      Object.assign(trabajo, { estado: 'listo', archivo, nombre: r.nombre, contentType: r.contentType });
    } catch (e) {
      console.error('Error generando presentación:', e);
      Object.assign(trabajo, { estado: 'error', error: e.userMessage || 'No se pudo generar la presentación. Inténtalo de nuevo.' });
    }
    trabajo.creado = Date.now();
  })();

  res.status(202).json({ jobId: id, total });
}

function erroresNoHayEvidencias() {
  const e = new Error('sin evidencias');
  e.userMessage = 'No hay evidencias guardadas para los filtros seleccionados.';
  return e;
}

function obtenerEntregasFiltradas({ tienda_id, promotor_id, desde, hasta }) {
  const condiciones = [];
  const params = [];
  if (tienda_id) { condiciones.push('e.tienda_id = ?'); params.push(tienda_id); }
  if (promotor_id) { condiciones.push('e.promotor_id = ?'); params.push(promotor_id); }
  if (desde) { condiciones.push('e.fecha >= ?'); params.push(desde); }
  if (hasta) { condiciones.push('e.fecha <= ?'); params.push(hasta); }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const entregas = db.prepare(
    `SELECT e.*, t.nombre AS tienda_nombre, p.nombre AS promotor_nombre
     FROM entregas e
     JOIN tiendas t ON t.id = e.tienda_id
     JOIN promotores p ON p.id = e.promotor_id
     ${where}
     ORDER BY p.nombre, e.fecha`
  ).all(...params);

  const ids = entregas.map((e) => e.id);
  let fotosPorEntrega = {};
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    const fotos = db.prepare(`SELECT * FROM fotos WHERE entrega_id IN (${ph})`).all(...ids);
    fotosPorEntrega = fotos.reduce((acc, f) => {
      (acc[f.entrega_id] = acc[f.entrega_id] || []).push(f);
      return acc;
    }, {});
  }
  return entregas.map((e) => ({ ...e, fotos: fotosPorEntrega[e.id] || [] }));
}

function contarFotosCompletas(entregas) {
  return entregas.reduce((acc, e) => acc + e.fotos.filter((f) => f.estado === 'completo').length, 0);
}

function periodoTexto(desde, hasta) {
  if (desde && hasta) return `${desde} a ${hasta}`;
  if (desde) return `Desde ${desde}`;
  if (hasta) return `Hasta ${hasta}`;
  return 'Todo el histórico';
}

// --- Presentación por tienda (una tienda, o varias en una sola operación) ---
router.post('/por-tienda', (req, res) => {
  const { tienda_ids, promotor_id, desde, hasta } = req.body;
  if (!Array.isArray(tienda_ids) || tienda_ids.length === 0) {
    return res.status(400).json({ error: 'Selecciona al menos una tienda' });
  }

  // Se arma el plan ahora (rápido, solo base de datos) para avisar enseguida si no hay nada.
  const plan = [];
  for (const tiendaId of tienda_ids) {
    const tienda = db.prepare('SELECT nombre FROM tiendas WHERE id = ?').get(tiendaId);
    if (!tienda) continue;
    const entregas = obtenerEntregasFiltradas({ tienda_id: tiendaId, promotor_id, desde, hasta });
    const fotos = contarFotosCompletas(entregas);
    if (fotos > 0) plan.push({ tienda, entregas, fotos });
  }
  if (plan.length === 0) {
    return res.status(404).json({ error: 'No hay evidencias guardadas para los filtros seleccionados.' });
  }
  const total = plan.reduce((acc, p) => acc + p.fotos, 0);

  iniciarTrabajo(res, total, async (ctx) => {
    const resultados = [];
    for (const { tienda, entregas } of plan) {
      const { buffer, slidesConFotos } = await generarPptxTienda({
        tiendaNombre: tienda.nombre,
        entregas,
        periodoTexto: periodoTexto(desde, hasta),
        onFoto: ctx.onFoto,
      });
      if (slidesConFotos > 0) {
        resultados.push({ nombre: `Merch_${tienda.nombre.replace(/\s+/g, '_')}.pptx`, buffer });
      }
    }
    if (resultados.length === 0) throw erroresNoHayEvidencias();

    if (resultados.length === 1) {
      return { buffer: resultados[0].buffer, nombre: resultados[0].nombre, contentType: MIME_PPTX };
    }

    // Varias tiendas: se empaquetan en un .zip escrito directo a disco.
    const archivoZip = path.join(os.tmpdir(), `pres-zip-${Date.now()}`);
    await new Promise((resolve, reject) => {
      const salida = fs.createWriteStream(archivoZip);
      const zip = archiver('zip');
      salida.on('close', resolve);
      zip.on('error', reject);
      zip.pipe(salida);
      for (const r of resultados) zip.append(r.buffer, { name: r.nombre });
      zip.finalize();
    });
    return { archivo: archivoZip, nombre: 'Presentaciones_por_tienda.zip', contentType: 'application/zip' };
  });
});

// --- Presentación consolidada (todas las tiendas de los filtros, en un solo archivo) ---
router.post('/consolidada', (req, res) => {
  const { tienda_ids, promotor_id, desde, hasta } = req.body;

  let tiendas;
  if (Array.isArray(tienda_ids) && tienda_ids.length > 0) {
    const ph = tienda_ids.map(() => '?').join(',');
    tiendas = db.prepare(`SELECT * FROM tiendas WHERE id IN (${ph})`).all(...tienda_ids);
  } else {
    tiendas = db.prepare('SELECT * FROM tiendas WHERE activo = 1').all();
  }

  const entregasPorTienda = {};
  let totalEntregas = 0;
  let totalFotos = 0;
  const promotoresSet = new Set();

  for (const tienda of tiendas) {
    const entregas = obtenerEntregasFiltradas({ tienda_id: tienda.id, promotor_id, desde, hasta });
    const conFotos = entregas.filter((e) => e.fotos.some((f) => f.estado === 'completo'));
    if (conFotos.length === 0) continue;
    entregasPorTienda[tienda.nombre] = conFotos;
    totalEntregas += conFotos.length;
    conFotos.forEach((e) => {
      promotoresSet.add(e.promotor_id);
      totalFotos += e.fotos.filter((f) => f.estado === 'completo').length;
    });
  }

  if (Object.keys(entregasPorTienda).length === 0) {
    return res.status(404).json({ error: 'No hay evidencias guardadas para los filtros seleccionados.' });
  }

  iniciarTrabajo(res, totalFotos, async (ctx) => {
    const { buffer } = await generarPptxConsolidado({
      entregasPorTienda,
      periodoTexto: periodoTexto(desde, hasta),
      resumen: {
        tiendas: Object.keys(entregasPorTienda).length,
        promotores: promotoresSet.size,
        entregas: totalEntregas,
        fotos: totalFotos,
      },
      onFoto: ctx.onFoto,
    });
    return { buffer, nombre: 'Merch_Consolidado_HES.pptx', contentType: MIME_PPTX };
  });
});

// --- Recuperación: genera el consolidado leyendo DIRECTO de OneDrive, sin la base de datos ---
// Útil si se perdió el registro de entregas (ej. reinicio de contenedor sin disco persistente)
// pero las fotos siguen a salvo en OneDrive.
router.post('/recuperar-onedrive', (req, res) => {
  iniciarTrabajo(res, 0, async (ctx) => {
    const { buffer } = await generarPptxRecuperacion({ onTotal: ctx.setTotal, onFoto: ctx.onFoto });
    if (!buffer) {
      const e = new Error('sin fotos');
      e.userMessage = 'No se encontró ninguna fotografía en OneDrive para reconstruir.';
      throw e;
    }
    return { buffer, nombre: 'Merch_Recuperado_OneDrive.pptx', contentType: MIME_PPTX };
  });
});

// --- Avance de un trabajo ---
router.get('/estado/:id', (req, res) => {
  const t = trabajos.get(req.params.id);
  if (!t) {
    return res.status(404).json({
      error: 'No se encontró el trabajo (el servidor pudo reiniciarse). Vuelve a generar la presentación.',
    });
  }
  res.json({ estado: t.estado, hecho: t.hecho, total: t.total, error: t.error || null, nombre: t.nombre || null });
});

// --- Descarga del resultado ---
router.get('/descargar/:id', (req, res) => {
  const t = trabajos.get(req.params.id);
  if (!t || t.estado !== 'listo' || !t.archivo || !fs.existsSync(t.archivo)) {
    return res.status(404).json({ error: 'La presentación ya no está disponible. Genérala de nuevo.' });
  }
  res.set('Content-Type', t.contentType);
  res.set('Content-Disposition', `attachment; filename="${t.nombre}"`);
  fs.createReadStream(t.archivo).pipe(res);
});

module.exports = router;
