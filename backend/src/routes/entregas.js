const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { db, reservarCorrelativo, correlativoFormateado } = require('../db');
const graph = require('../graph');
const { procesarImagen } = require('../imagenes');

const router = express.Router();
const LIMITE_FOTOS_POR_ENTREGA = 100; // liquidaciones grandes pueden traer 50+ fotos
const CONCURRENCIA_SUBIDA = 4; // cuántas fotos se procesan/suben en paralelo
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const PENDIENTES_DIR = path.join(__dirname, '..', '..', 'data', 'pendientes');
if (!fs.existsSync(PENDIENTES_DIR)) fs.mkdirSync(PENDIENTES_DIR, { recursive: true });

/** Corre `worker` sobre `items` con un máximo de `limite` tareas en paralelo. */
async function limitarConcurrencia(items, limite, worker) {
  let indice = 0;
  async function siguiente() {
    while (indice < items.length) {
      const miIndice = indice++;
      await worker(items[miIndice], miIndice);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, siguiente));
}

/** Sube una foto ya registrada en BD (estado subiendo/error) y actualiza su fila. */
async function procesarFoto(foto, entrega, nombreTienda) {
  const rutaStaging = path.join(PENDIENTES_DIR, foto.nombre_archivo);
  db.prepare("UPDATE fotos SET estado = 'subiendo' WHERE id = ?").run(foto.id);
  try {
    const buffer = fs.readFileSync(rutaStaging);
    const resultado = await graph.subirFoto({
      buffer,
      nombreArchivo: foto.nombre_archivo,
      nombreTienda,
      fechaISO: entrega.fecha,
    });
    db.prepare(
      "UPDATE fotos SET estado = 'completo', onedrive_path = ? WHERE id = ?"
    ).run(resultado.path, foto.id);
    // Solo borramos el respaldo local una vez confirmada la subida.
    fs.unlinkSync(rutaStaging);
    return true;
  } catch (e) {
    db.prepare(
      "UPDATE fotos SET estado = 'error', intentos = intentos + 1 WHERE id = ?"
    ).run(foto.id);
    return false;
  }
}

function recalcularEstadoEntrega(entregaId) {
  const fotos = db.prepare('SELECT estado FROM fotos WHERE entrega_id = ?').all(entregaId);
  const todasCompletas = fotos.length > 0 && fotos.every((f) => f.estado === 'completo');
  db.prepare('UPDATE entregas SET estado = ? WHERE id = ?').run(
    todasCompletas ? 'completo' : 'error',
    entregaId
  );
}

// --- Registrar nueva entrega con sus fotografías ---
router.post('/', upload.array('fotos', LIMITE_FOTOS_POR_ENTREGA), async (req, res) => {
  const { tienda_id, fecha, tipo_merch, cantidad, observaciones } = req.body;
  const promotorId =
    req.usuario.rol === 'promotor' ? req.usuario.promotor_id : req.body.promotor_id;

  if (!tienda_id || !fecha || !tipo_merch || !cantidad || !promotorId) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'Debes adjuntar al menos una fotografía' });
  }

  const tienda = db.prepare('SELECT nombre FROM tiendas WHERE id = ?').get(tienda_id);
  if (!tienda) return res.status(400).json({ error: 'Tienda no encontrada' });
  const promotor = db.prepare('SELECT nombre FROM promotores WHERE id = ?').get(promotorId);

  const infoEntrega = db
    .prepare(
      `INSERT INTO entregas (tienda_id, promotor_id, fecha, tipo_merch, cantidad, observaciones)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(tienda_id, promotorId, fecha, tipo_merch, Number(cantidad), observaciones || null);
  const entregaId = infoEntrega.lastInsertRowid;

  const fotosCreadas = [];
  const entrega = { fecha };
  try {
    await limitarConcurrencia(req.files, CONCURRENCIA_SUBIDA, async (archivo) => {
      const n = reservarCorrelativo(); // síncrono -> sin condición de carrera, ver db.js
      const nombreArchivo = `Merch_${correlativoFormateado(n)}.jpg`;
      // Comprime, redimensiona y marca con agua (tienda/promotor/fecha) antes de guardar.
      const bufferProcesado = await procesarImagen(archivo.buffer, {
        tiendaNombre: tienda.nombre,
        promotorNombre: promotor?.nombre || 'Promotor',
        fechaISO: fecha,
      });
      fs.writeFileSync(path.join(PENDIENTES_DIR, nombreArchivo), bufferProcesado);
      const infoFoto = db
        .prepare(
          "INSERT INTO fotos (entrega_id, correlativo, nombre_archivo, extension, estado) VALUES (?, ?, ?, 'jpg', 'pendiente')"
        )
        .run(entregaId, n, nombreArchivo);
      const fotoDb = { id: infoFoto.lastInsertRowid, nombre_archivo: nombreArchivo };
      fotosCreadas.push(fotoDb);
      // Subida a OneDrive (rclone) — en el mismo worker, así queda paralelizada con el resto.
      await procesarFoto(fotoDb, entrega, tienda.nombre);
    });
  } catch (e) {
    if (e.code === 'LIMITE_CORRELATIVO') {
      return res.status(507).json({
        error:
          'Se alcanzó el límite de 9999 fotografías del sistema. Se bloquearon nuevas cargas — contacta al administrador.',
      });
    }
    throw e;
  }

  recalcularEstadoEntrega(entregaId);

  const entregaFinal = db.prepare('SELECT * FROM entregas WHERE id = ?').get(entregaId);
  const fotosFinal = db.prepare('SELECT * FROM fotos WHERE entrega_id = ?').all(entregaId);
  res.json({ entrega: entregaFinal, fotos: fotosFinal });
});

// --- Reintentar fotos que quedaron pendientes o con error ---
router.post('/:id/reintentar', async (req, res) => {
  const entrega = db.prepare('SELECT * FROM entregas WHERE id = ?').get(req.params.id);
  if (!entrega) return res.status(404).json({ error: 'Entrega no encontrada' });
  if (req.usuario.rol === 'promotor' && entrega.promotor_id !== req.usuario.promotor_id) {
    return res.status(403).json({ error: 'No puedes modificar entregas de otro promotor' });
  }
  const tienda = db.prepare('SELECT nombre FROM tiendas WHERE id = ?').get(entrega.tienda_id);
  const pendientes = db
    .prepare("SELECT * FROM fotos WHERE entrega_id = ? AND estado != 'completo'")
    .all(entrega.id);

  await limitarConcurrencia(pendientes, CONCURRENCIA_SUBIDA, (foto) =>
    procesarFoto(foto, entrega, tienda.nombre)
  );
  recalcularEstadoEntrega(entrega.id);
  const fotosFinal = db.prepare('SELECT * FROM fotos WHERE entrega_id = ?').all(entrega.id);
  res.json({ fotos: fotosFinal });
});



// --- Consulta con filtros (tienda, promotor, rango de fechas) ---
router.get('/', (req, res) => {
  const { tienda_id, promotor_id, desde, hasta } = req.query;
  const condiciones = [];
  const params = [];

  if (req.usuario.rol === 'promotor') {
    condiciones.push('e.promotor_id = ?');
    params.push(req.usuario.promotor_id);
  } else if (promotor_id) {
    condiciones.push('e.promotor_id = ?');
    params.push(promotor_id);
  }
  if (tienda_id) {
    condiciones.push('e.tienda_id = ?');
    params.push(tienda_id);
  }
  if (desde) {
    condiciones.push('e.fecha >= ?');
    params.push(desde);
  }
  if (hasta) {
    condiciones.push('e.fecha <= ?');
    params.push(hasta);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const entregas = db
    .prepare(
      `SELECT e.*, t.nombre AS tienda_nombre, p.nombre AS promotor_nombre
       FROM entregas e
       JOIN tiendas t ON t.id = e.tienda_id
       JOIN promotores p ON p.id = e.promotor_id
       ${where}
       ORDER BY e.fecha DESC, e.id DESC`
    )
    .all(...params);

  const idsEntregas = entregas.map((e) => e.id);
  let fotosPorEntrega = {};
  if (idsEntregas.length) {
    const placeholders = idsEntregas.map(() => '?').join(',');
    const fotos = db
      .prepare(`SELECT * FROM fotos WHERE entrega_id IN (${placeholders})`)
      .all(...idsEntregas);
    fotosPorEntrega = fotos.reduce((acc, f) => {
      (acc[f.entrega_id] = acc[f.entrega_id] || []).push(f);
      return acc;
    }, {});
  }

  res.json(entregas.map((e) => ({ ...e, fotos: fotosPorEntrega[e.id] || [] })));
});

// --- Resumen para tarjetas KPI del panel admin ---
router.get('/resumen', (req, res) => {
  const totalEntregas = db.prepare('SELECT COUNT(*) c FROM entregas').get().c;
  const totalFotos = db.prepare('SELECT COUNT(*) c FROM fotos').get().c;
  const fotosPendientes = db
    .prepare("SELECT COUNT(*) c FROM fotos WHERE estado IN ('pendiente','subiendo')")
    .get().c;
  const fotosError = db.prepare("SELECT COUNT(*) c FROM fotos WHERE estado = 'error'").get().c;
  const correlativoActual = db.prepare('SELECT valor FROM contador_global WHERE id = 1').get().valor;
  res.json({
    totalEntregas,
    totalFotos,
    fotosPendientes,
    fotosError,
    correlativoActual,
    correlativoRestante: 9999 - correlativoActual,
  });
});

// --- Servir el contenido de una fotografía (respeta permisos por rol) ---
router.get('/fotos/:id/contenido', async (req, res) => {
  const foto = db.prepare('SELECT * FROM fotos WHERE id = ?').get(req.params.id);
  if (!foto) return res.status(404).end();
  const entrega = db.prepare('SELECT * FROM entregas WHERE id = ?').get(foto.entrega_id);
  if (req.usuario.rol === 'promotor' && entrega.promotor_id !== req.usuario.promotor_id) {
    return res.status(403).end();
  }
  try {
    if (foto.estado !== 'completo') {
      // Aún en staging local: la mostramos igual para vista previa/reintento.
      const rutaStaging = path.join(PENDIENTES_DIR, foto.nombre_archivo);
      return res.sendFile(rutaStaging);
    }
    const buffer = await graph.descargarFoto({
      demo: graph.MODO === 'demo',
      onedrive_item_id: foto.onedrive_item_id,
      onedrive_path: foto.onedrive_path,
    });
    res.set('Content-Type', 'image/jpeg');
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: 'No se pudo obtener la fotografía' });
  }
});

module.exports = router;

// --- Manejo de errores de subida (Multer): mensaje claro en vez de "Error al guardar" genérico ---
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'Una de las fotos pesa más de 25 MB. Reduce la resolución de la cámara e inténtalo de nuevo.',
      });
    }
    return res.status(400).json({
      error: `No se pudo procesar la subida (${err.message}). Máximo ${LIMITE_FOTOS_POR_ENTREGA} fotos por entrega.`,
    });
  }
  console.error('Error en /api/entregas:', err);
  res.status(500).json({ error: 'Ocurrió un error inesperado al guardar la entrega. Inténtalo de nuevo.' });
});

