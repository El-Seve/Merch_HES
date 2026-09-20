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

module.exports = router;
