const express = require('express');
const { db } = require('../db');
const { soloAdmin } = require('../auth');

const router = express.Router();

router.get('/', (req, res) => {
  const filas = db.prepare('SELECT * FROM tipos_merch WHERE activo = 1').all();
  // Ordena por el número que trae la descripción (1, 2, 3...19), no alfabéticamente
  // (alfabético mezclaría 1, 10, 11...19, 2, 3 — que es justo el problema reportado).
  filas.sort((a, b) => {
    const na = parseInt(a.descripcion, 10);
    const nb = parseInt(b.descripcion, 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.descripcion.localeCompare(b.descripcion);
  });
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
