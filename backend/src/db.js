const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'data', 'merch.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS tiendas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  ciudad TEXT,
  distribuidor TEXT,
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS promotores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  tienda_id INTEGER REFERENCES tiendas(id),
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('promotor','admin')),
  promotor_id INTEGER REFERENCES promotores(id),
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS entregas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tienda_id INTEGER NOT NULL REFERENCES tiendas(id),
  promotor_id INTEGER NOT NULL REFERENCES promotores(id),
  fecha TEXT NOT NULL,
  tipo_merch TEXT NOT NULL,
  cantidad INTEGER NOT NULL,
  observaciones TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','completo','error')),
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Contador global de correlativo. Fila única id=1. Nunca se reinicia ni se reutiliza.
CREATE TABLE IF NOT EXISTS contador_global (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  valor INTEGER NOT NULL
);
INSERT OR IGNORE INTO contador_global (id, valor) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS fotos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entrega_id INTEGER NOT NULL REFERENCES entregas(id),
  correlativo INTEGER NOT NULL UNIQUE,
  nombre_archivo TEXT NOT NULL,
  extension TEXT NOT NULL,
  onedrive_item_id TEXT,
  onedrive_path TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','subiendo','completo','error')),
  intentos INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fotos_entrega ON fotos(entrega_id);
CREATE INDEX IF NOT EXISTS idx_entregas_tienda ON entregas(tienda_id);
CREATE INDEX IF NOT EXISTS idx_entregas_promotor ON entregas(promotor_id);
CREATE INDEX IF NOT EXISTS idx_entregas_fecha ON entregas(fecha);
`);

/**
 * Reserva el siguiente correlativo global (0001-9999).
 *
 * Por qué esto NO produce duplicados con cargas simultáneas:
 * better-sqlite3 es SÍNCRONO (no usa async/await ni promesas para las
 * consultas). Todo el cuerpo de esta función corre en un único "tick"
 * del event loop de Node sin ceder el control a ninguna otra petición
 * a mitad de camino. Dos peticiones HTTP concurrentes en Express nunca
 * pueden intercalar sus llamadas a esta función: la segunda petición
 * literalmente espera su turno en la cola del event loop hasta que la
 * primera termina de leer+incrementar+escribir. Es el mismo efecto que
 * un lock, sin necesitar uno.
 *
 * Si en el futuro se migra a Postgres con un driver asíncrono, esta
 * función debe reescribirse con una transacción real
 * (`SELECT ... FOR UPDATE` o `UPDATE ... RETURNING`) para conservar la
 * misma garantía.
 */
function reservarCorrelativo() {
  const actual = db.prepare('SELECT valor FROM contador_global WHERE id = 1').get().valor;
  if (actual >= 9999) {
    const err = new Error('LIMITE_CORRELATIVO_ALCANZADO');
    err.code = 'LIMITE_CORRELATIVO';
    throw err;
  }
  const nuevo = actual + 1;
  db.prepare('UPDATE contador_global SET valor = ? WHERE id = 1').run(nuevo);
  return nuevo;
}

function correlativoFormateado(n) {
  return String(n).padStart(4, '0');
}

// --- Semilla de catálogo provisional (Seve confirmó: usar provisional, luego reemplaza) ---
function sembrarCatalogoProvisional() {
  const hayTiendas = db.prepare('SELECT COUNT(*) c FROM tiendas').get().c;
  if (hayTiendas > 0) return;

  const insertarTienda = db.prepare(
    'INSERT INTO tiendas (nombre, ciudad, distribuidor) VALUES (?, ?, ?)'
  );
  const t1 = insertarTienda.run('HES Provisional 1', 'Lima', 'QTC').lastInsertRowid;
  const t2 = insertarTienda.run('HES Provisional 2', 'Lima', 'Sany').lastInsertRowid;

  const insertarPromotor = db.prepare(
    'INSERT INTO promotores (nombre, tienda_id) VALUES (?, ?)'
  );
  const p1 = insertarPromotor.run('Promotor Demo 1', t1).lastInsertRowid;
  const p2 = insertarPromotor.run('Promotor Demo 2', t2).lastInsertRowid;

  const hash = bcrypt.hashSync('1234', 10);
  db.prepare(
    'INSERT OR IGNORE INTO usuarios (usuario, password_hash, rol, promotor_id) VALUES (?, ?, ?, ?)'
  ).run('admin', bcrypt.hashSync('admin', 10), 'admin', null);
  db.prepare(
    'INSERT OR IGNORE INTO usuarios (usuario, password_hash, rol, promotor_id) VALUES (?, ?, ?, ?)'
  ).run('promotor1', hash, 'promotor', p1);
  db.prepare(
    'INSERT OR IGNORE INTO usuarios (usuario, password_hash, rol, promotor_id) VALUES (?, ?, ?, ?)'
  ).run('promotor2', hash, 'promotor', p2);
}

module.exports = {
  db,
  reservarCorrelativo,
  correlativoFormateado,
  sembrarCatalogoProvisional,
};
