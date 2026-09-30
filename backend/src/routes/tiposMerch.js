const express = require('express');
const { db } = require('../db');
const { soloAdmin } = require('../auth');

const router = express.Router();

router.get('/', (req, res) => {
  const filas = db.prepare('SELECT * FROM tipos_merch WHERE activo = 1 ORDER BY descripcion').all();
  res.json(filas);
});

router.post('/', soloAdmin, (req, res) => {
  const { codigo, descripcion } = req.body;
  if (!codigo || !descripcion) return res.status(400).json({ error: 'Falta código o descripción' });
  const info = db
    .prepare('INSERT INTO tipos_merch (codigo, descripcion) VALUES (?, ?)')
    .run(codigo, descripcion);
  res.json({ id: info.lastInsertRowid });
});

router.delete('/:id', soloAdmin, (req, res) => {
  db.prepare('UPDATE tipos_merch SET activo = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
