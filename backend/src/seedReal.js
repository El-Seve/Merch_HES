const bcrypt = require('bcryptjs');
const { db } = require('./db');

// --- Fuente: Tablas_Basicas_-_Tiendas.xlsx (24 PDV HES reales por región) ---
const TIENDAS_REALES = [
  ['Región Sur', 'HES AREQUIPA'],
  ['Región Norte', 'HES CHICLAYO'],
  ['Región Lima', 'HES COMAS'],
  ['Región Sur', 'HES CUSCO'],
  ['Región Centro', 'HES HUANCAYO'],
  ['Región Sur', 'HES ISLA AREQUIPA'],
  ['Región Lima', 'HES ISLA CENTRO CIVICO'],
  ['Región Lima', 'HES ISLA JOCKEY PLAZA'],
  ['Región Lima', 'HES ISLA SJL'],
  ['Región Sur', 'HES JULIACA'],
  ['Región Lima', 'HES MALL DEL SUR'],
  ['Región Lima', 'HES MEGA PLAZA'],
  ['Región Lima', 'HES MINKA'],
  ['Región Norte', 'HES PIURA'],
  ['Región Lima', 'HES PLAZA NORTE'],
  ['Región Centro', 'HES PUCALLPA'],
  ['Región Lima', 'HES PURUCHUCO'],
  ['Región Lima', 'HES SANTA ANITA'],
  ['Región Norte', 'HES TRUJILLO'],
  ['Región Norte', 'HES CHIMBOTE'],
  ['Región Lima', 'HES BELLAVISTA'],
  ['Región Centro', 'HES HUANUCO'],
  ['Región Lima', 'HES ISLA PRIMAVERA'],
  ['Región Lima', 'HES ISLA SALAVERRY'],
];

// --- Fuente: Tablas_Basicas_-_Merch.xlsx (19 tipos de merchandising con código) ---
const MERCH_REAL = [
  ['9711ACKW', '1.Notebook-HONOR Talents-Harmonious'],
  ['9711ACKY', '2.Notebook & Pen Set*'],
  ['9711ACLC', '3.Coffee Cup-HONOR Talents-Moonlight'],
  ['9711ACLK', '4.Sports Kettle 600ml-HONOR Talents-Moonlight'],
  ['9711ACMK', '5.Canvas Bag-HONOR talents-Moonlight Sonata'],
  ['9711ACML', '6.Backpack-Lozenge Black*'],
  ['9711ACMM', '7.Backpack-Cream Color*'],
  ['9711ACMX', '8.Daily Gift Package 2*'],
  ['9711ACNG', '9.Tote bag Life Full of Love'],
  ['9711ACNF', '10.Thermal Jug-HONOR talents-A Dozen Strange Birds'],
  ['9711ACKS', '11.Phone Holder-Black'],
  ['9711ACLM', '12.Sports Kettle 600ml-HONOR Talents-Life is not a label'],
  ['9711ACKV', '13.Notebook-HONOR Talents-Egret'],
  ['9711ACMQ', '14.Sport Shoulder Bag-Yellow'],
  ['9711ACMR', '15.Sport Should Bag-Blue'],
  ['9711ACMN', '16.Casual Shoulder Bag-Tidewater Teal'],
  ['PELUCHE', '17.PELUCHE DELFIN BTL'],
  ['9711AFEA', '18.Portable wireless Speaker'],
  ['9711AFW', '19.Portable Neck Fan'],
];

/**
 * Importa el catálogo real (idempotente: se puede correr las veces que sea,
 * nunca duplica). También desactiva las tiendas "HES Provisional *" de prueba,
 * sin borrarlas (por si alguna entrega antigua las referencia).
 */
function importarCatalogoReal() {
  const insertarTienda = db.prepare('INSERT INTO tiendas (nombre, ciudad) VALUES (?, ?)');
  const existeTienda = db.prepare('SELECT id FROM tiendas WHERE nombre = ?');
  let tiendasNuevas = 0;
  for (const [region, nombre] of TIENDAS_REALES) {
    if (!existeTienda.get(nombre)) {
      insertarTienda.run(nombre, region);
      tiendasNuevas++;
    }
  }

  const insertarMerch = db.prepare('INSERT INTO tipos_merch (codigo, descripcion) VALUES (?, ?)');
  const existeMerch = db.prepare('SELECT id FROM tipos_merch WHERE codigo = ?');
  let merchNuevos = 0;
  for (const [codigo, descripcion] of MERCH_REAL) {
    if (!existeMerch.get(codigo)) {
      insertarMerch.run(codigo, descripcion);
      merchNuevos++;
    }
  }

  const desactivadas = db
    .prepare("UPDATE tiendas SET activo = 0 WHERE nombre LIKE 'HES Provisional%' AND activo = 1")
    .run().changes;

  return { tiendasNuevas, merchNuevos, desactivadas };
}

/**
 * Borra TODOS los usuarios actuales y deja exactamente 2: un admin y un
 * promotor genérico compartido por todo el equipo (ya no se distingue por
 * persona, solo por tienda — como se pidió). Se puede correr las veces que
 * sea; siempre vuelve a dejar solo estos 2.
 */
function resetearUsuarios() {
  // Necesita un promotor_id válido (la tabla entregas lo exige). Se reutiliza
  // uno llamado "Equipo HES" si ya existe, o se crea.
  let generico = db
    .prepare("SELECT id FROM promotores WHERE nombre = 'Equipo HES' AND activo = 1")
    .get();
  const promotorId = generico
    ? generico.id
    : db.prepare("INSERT INTO promotores (nombre, tienda_id) VALUES ('Equipo HES', NULL)").run()
        .lastInsertRowid;

  db.prepare('DELETE FROM usuarios').run();

  const USUARIO_ADMIN = 'admin';
  const PASSWORD_ADMIN = 'admin';
  const USUARIO_PROMOTOR = 'promotor';
  const PASSWORD_PROMOTOR = 'HES2026';

  db.prepare(
    "INSERT INTO usuarios (usuario, password_hash, rol, promotor_id) VALUES (?, ?, 'admin', ?)"
  ).run(USUARIO_ADMIN, bcrypt.hashSync(PASSWORD_ADMIN, 10), promotorId);
  db.prepare(
    "INSERT INTO usuarios (usuario, password_hash, rol, promotor_id) VALUES (?, ?, 'promotor', ?)"
  ).run(USUARIO_PROMOTOR, bcrypt.hashSync(PASSWORD_PROMOTOR, 10), promotorId);

  return {
    usuario_admin: USUARIO_ADMIN,
    password_admin: PASSWORD_ADMIN,
    usuario_promotor: USUARIO_PROMOTOR,
    password_promotor: PASSWORD_PROMOTOR,
  };
}

module.exports = { importarCatalogoReal, resetearUsuarios };
