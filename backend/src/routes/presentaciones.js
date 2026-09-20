const express = require('express');
const archiver = require('archiver');
const { db } = require('../db');
const { soloAdmin } = require('../auth');
const { generarPptxTienda, generarPptxConsolidado } = require('../pptx/generarPresentaciones');

const router = express.Router();
router.use(soloAdmin); // solo el administrador genera presentaciones

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

function periodoTexto(desde, hasta) {
  if (desde && hasta) return `${desde} a ${hasta}`;
  if (desde) return `Desde ${desde}`;
  if (hasta) return `Hasta ${hasta}`;
  return 'Todo el histórico';
}

// --- Presentación por tienda (una tienda, o varias en una sola operación) ---
router.post('/por-tienda', async (req, res) => {
  const { tienda_ids, promotor_id, desde, hasta } = req.body;
  if (!Array.isArray(tienda_ids) || tienda_ids.length === 0) {
    return res.status(400).json({ error: 'Selecciona al menos una tienda' });
  }

  const resultados = [];
  for (const tiendaId of tienda_ids) {
    const tienda = db.prepare('SELECT nombre FROM tiendas WHERE id = ?').get(tiendaId);
    if (!tienda) continue;
    const entregas = obtenerEntregasFiltradas({ tienda_id: tiendaId, promotor_id, desde, hasta });
    const { buffer, slidesConFotos } = await generarPptxTienda({
      tiendaNombre: tienda.nombre,
      entregas,
      periodoTexto: periodoTexto(desde, hasta),
    });
    if (slidesConFotos > 0) {
      resultados.push({ nombre: `Merch_${tienda.nombre.replace(/\s+/g, '_')}.pptx`, buffer });
    }
  }

  if (resultados.length === 0) {
    return res.status(404).json({ error: 'No hay evidencias guardadas para los filtros seleccionados.' });
  }

  if (resultados.length === 1) {
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.set('Content-Disposition', `attachment; filename="${resultados[0].nombre}"`);
    return res.send(resultados[0].buffer);
  }

  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', 'attachment; filename="Presentaciones_por_tienda.zip"');
  const archivo = archiver('zip');
  archivo.pipe(res);
  for (const r of resultados) archivo.append(r.buffer, { name: r.nombre });
  archivo.finalize();
});

// --- Presentación consolidada (todas las tiendas de los filtros, en un solo archivo) ---
router.post('/consolidada', async (req, res) => {
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

  const { buffer } = await generarPptxConsolidado({
    entregasPorTienda,
    periodoTexto: periodoTexto(desde, hasta),
    resumen: {
      tiendas: Object.keys(entregasPorTienda).length,
      promotores: promotoresSet.size,
      entregas: totalEntregas,
      fotos: totalFotos,
    },
  });

  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  res.set('Content-Disposition', 'attachment; filename="Merch_Consolidado_HES.pptx"');
  res.send(buffer);
});

module.exports = router;
