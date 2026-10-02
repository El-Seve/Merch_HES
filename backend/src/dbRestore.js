const fs = require('fs');
const path = require('path');
const graph = require('./graph');

const DB_PATH = path.join(__dirname, '..', 'data', 'merch.db');

/**
 * Si hay un respaldo de la base de datos en OneDrive y todavía no existe una
 * copia local (caso típico: el contenedor de Render acaba de arrancar desde
 * cero sin disco persistente), lo descarga antes de que better-sqlite3 abra
 * el archivo. Debe llamarse ANTES de requerir './db'.
 */
async function restaurarSiExiste() {
  if (graph.MODO !== 'produccion') return false;
  if (fs.existsSync(DB_PATH)) return false; // ya hay algo local, no pisarlo

  const buffer = await graph.descargarArchivoSistema('merch.db');
  if (!buffer) return false;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, buffer);
  return true;
}

module.exports = { restaurarSiExiste, DB_PATH };
