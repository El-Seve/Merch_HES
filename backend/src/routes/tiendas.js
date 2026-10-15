const express = require('express');
const { db } = require('../db');
const { soloAdmin } = require('../auth');

const router = express.Router();

router.get('/', (req, res) => {
  const filas = db.prepare('SELECT * FROM tiendas WHERE activo = 1 ORDER BY nombre').all();
  res.json(filas);
});

router.post('/', soloAdmin, (req, res) => {
  const { nombre, ciudad, distribuidor } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Falta el nombre de la tienda' });
  const info = db
    .prepare('INSERT INTO tiendas (nombre, ciudad, distribuidor) VALUES (?, ?, ?)')
    .run(nombre, ciudad || null, distribuidor || null);
  res.json({ id: info.lastInsertRowid });
});

router.put('/:id', soloAdmin, (req, res) => {
  const { nombre, ciudad, distribuidor, activo } = req.body;
  db.prepare(
    'UPDATE tiendas SET nombre = COALESCE(?, nombre), ciudad = COALESCE(?, ciudad), distribuidor = COALESCE(?, distribuidor), activo = COALESCE(?, activo) WHERE id = ?'
  ).run(nombre, ciudad, distribuidor, activo, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', soloAdmin, (req, res) => {
  db.prepare('UPDATE tiendas SET activo = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --- Eliminación DEFINITIVA de una tienda y todo su historial (entregas + fotos en BD) ---
// Se usa cuando ya se borraron las fotos manualmente en OneDrive y hay que
// reflejar eso en la app: no vuelve a tocar OneDrive, solo limpia la base de datos.
router.delete('/:id/definitivo', soloAdmin, (req, res) => {
  const tienda = db.prepare('SELECT * FROM tiendas WHERE id = ?').get(req.params.id);
  if (!tienda) return res.status(404).json({ error: 'Tienda no encontrada' });

  const borrar = db.transaction((tiendaId) => {
    const entregas = db.prepare('SELECT id FROM entregas WHERE tienda_id = ?').all(tiendaId);
    const idsEntregas = entregas.map((e) => e.id);
    let fotosBorradas = 0;
    if (idsEntregas.length) {
      const placeholders = idsEntregas.map(() => '?').join(',');
      fotosBorradas = db
        .prepare(`DELETE FROM fotos WHERE entrega_id IN (${placeholders})`)
        .run(...idsEntregas).changes;
      db.prepare(`DELETE FROM entregas WHERE id IN (${placeholders})`).run(...idsEntregas);
    }
    db.prepare('DELETE FROM tiendas WHERE id = ?').run(tiendaId);
    return { entregasBorradas: idsEntregas.length, fotosBorradas };
  });

  const resultado = borrar(Number(req.params.id));
  res.json({ ok: true, tienda: tienda.nombre, ...resultado });
});

module.exports = router;
