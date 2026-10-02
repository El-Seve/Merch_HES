require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { sembrarCatalogoProvisional } = require('./db');
const { login, middlewareAuth, soloAdmin } = require('./auth');
const graph = require('./graph');

sembrarCatalogoProvisional();

const app = express();
app.use(cors());
app.use(express.json());

// --- Login (usuario/contraseña simple, como se acordó) ---
app.post('/api/login', (req, res) => {
  const { usuario, password } = req.body;
  const resultado = login(usuario, password);
  if (!resultado) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  res.json(resultado);
});

// --- Estado de conexión con OneDrive (para mostrar aviso en el panel admin) ---
app.get('/api/estado/onedrive', middlewareAuth, soloAdmin, async (req, res) => {
  res.json({ modo: graph.MODO, conectado: await graph.onedriveConectado() });
});

// --- Rutas de la aplicación (todas requieren sesión) ---
app.use('/api/tiendas', middlewareAuth, require('./routes/tiendas'));
app.use('/api/promotores', middlewareAuth, require('./routes/promotores'));
app.use('/api/tipos-merch', middlewareAuth, require('./routes/tiposMerch'));
app.use('/api/entregas', middlewareAuth, require('./routes/entregas'));
app.use('/api/presentaciones', middlewareAuth, require('./routes/presentaciones'));

// --- Importar catálogo real (tiendas + merchandising) — se puede correr las veces que sea ---
app.post('/api/admin/importar-catalogo-real', middlewareAuth, soloAdmin, (req, res) => {
  const { importarCatalogoReal } = require('./seedReal');
  res.json(importarCatalogoReal());
});

// --- Borra todos los usuarios y deja solo 2: admin + promotor genérico ---
app.post('/api/admin/resetear-usuarios', middlewareAuth, soloAdmin, (req, res) => {
  const { resetearUsuarios } = require('./seedReal');
  res.json(resetearUsuarios());
});

// --- Frontend estático (mobile-first, sin build step) ---
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/auth')) return res.status(404).end();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Merch HES corriendo en http://localhost:${PORT}  (modo: ${graph.MODO})`);
});
