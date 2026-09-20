const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { soloAdmin } = require('../auth');

const router = express.Router();

router.get('/', (req, res) => {
  const filas = db
    .prepare(
      `SELECT p.*, t.nombre AS tienda_nombre FROM promotores p
       LEFT JOIN tiendas t ON t.id = p.tienda_id
       WHERE p.activo = 1 ORDER BY p.nombre`
    )
    .all();
  res.json(filas);
});

// Crea el promotor y, opcionalmente, su usuario de acceso (usuario/contraseña simple)
router.post('/', soloAdmin, (req, res) => {
  const { nombre, tienda_id, usuario, password } = req.body;
  if (!nombre || !tienda_id) {
    return res.status(400).json({ error: 'Falta nombre o tienda' });
  }
  const info = db
    .prepare('INSERT INTO promotores (nombre, tienda_id) VALUES (?, ?)')
    .run(nombre, tienda_id);
  const promotorId = info.lastInsertRowid;

  if (usuario && password) {
    db.prepare(
      'INSERT INTO usuarios (usuario, password_hash, rol, promotor_id) VALUES (?, ?, ?, ?)'
    ).run(usuario, bcrypt.hashSync(password, 10), 'promotor', promotorId);
  }
  res.json({ id: promotorId });
});

router.put('/:id', soloAdmin, (req, res) => {
  const { nombre, tienda_id, activo } = req.body;
  db.prepare(
    'UPDATE promotores SET nombre = COALESCE(?, nombre), tienda_id = COALESCE(?, tienda_id), activo = COALESCE(?, activo) WHERE id = ?'
  ).run(nombre, tienda_id, activo, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', soloAdmin, (req, res) => {
  db.prepare('UPDATE promotores SET activo = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
