const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('./db');

function login(usuario, password) {
  const fila = db
    .prepare('SELECT * FROM usuarios WHERE usuario = ? AND activo = 1')
    .get(usuario);
  if (!fila) return null;
  if (!bcrypt.compareSync(password, fila.password_hash)) return null;

  const payload = {
    id: fila.id,
    usuario: fila.usuario,
    rol: fila.rol,
    promotor_id: fila.promotor_id,
  };
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '12h' });
  return { token, ...payload };
}

function middlewareAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    req.usuario = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
}

function soloAdmin(req, res, next) {
  if (req.usuario.rol !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores' });
  }
  next();
}

module.exports = { login, middlewareAuth, soloAdmin };
