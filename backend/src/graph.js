const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const MODO = process.env.MODO || 'demo';
const DEMO_DIR = path.join(__dirname, '..', 'data', 'demo-fotos');
if (!fs.existsSync(DEMO_DIR)) fs.mkdirSync(DEMO_DIR, { recursive: true });

const RCLONE_BIN = process.env.RCLONE_BIN || path.join(__dirname, '..', 'bin', 'rclone');
const RCLONE_CONF_PATH =
  process.env.RCLONE_CONFIG_PATH || path.join(__dirname, '..', 'data', 'rclone.conf');
const REMOTE = process.env.RCLONE_REMOTE_NAME || 'onedrive';

// El contenido del archivo rclone.conf (generado UNA vez en tu propia PC con
// `rclone config`) se pega completo como variable de entorno RCLONE_CONFIG_CONTENT
// en Render. Al arrancar el servidor lo volcamos a un archivo real, porque rclone
// necesita leerlo de disco.
function prepararConfigRclone() {
  if (MODO === 'demo') return;
  const contenido = process.env.RCLONE_CONFIG_CONTENT;
  if (contenido && contenido.trim()) {
    fs.mkdirSync(path.dirname(RCLONE_CONF_PATH), { recursive: true });
    fs.writeFileSync(RCLONE_CONF_PATH, contenido.trim() + '\n');
  }
}
prepararConfigRclone();

function ejecutarRclone(args) {
  return new Promise((resolve, reject) => {
    execFile(
      RCLONE_BIN,
      args,
      { maxBuffer: 1024 * 1024 * 50, encoding: 'buffer', env: { ...process.env, RCLONE_CONFIG: RCLONE_CONF_PATH } },
      (error, stdout, stderr) => {
        if (error) {
          error.stderrTexto = stderr ? stderr.toString('utf8') : '';
          return reject(error);
        }
        resolve(stdout);
      }
    );
  });
}

async function onedriveConectado() {
  if (MODO === 'demo') return true;
  if (!fs.existsSync(RCLONE_CONF_PATH)) return false;
  try {
    await ejecutarRclone(['lsd', `${REMOTE}:`, '--max-depth', '1']);
    return true;
  } catch {
    return false;
  }
}

function sanear(nombre) {
  return String(nombre)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .replace(/\s+/g, '_');
}

function rutaCarpeta(nombreTienda, fechaISO) {
  const [anio, mes] = fechaISO.split('-');
  const root = process.env.ONEDRIVE_ROOT_FOLDER || 'Merch_HES';
  return `${root}/${sanear(nombreTienda)}/${anio}/${mes}`;
}

/**
 * Sube una fotografía. En modo demo la guarda en disco local (misma estructura
 * de carpetas). En modo producción la sube de verdad a OneDrive vía rclone.
 */
async function subirFoto({ buffer, nombreArchivo, nombreTienda, fechaISO }) {
  const carpeta = rutaCarpeta(nombreTienda, fechaISO);
  const rutaCompleta = `${carpeta}/${nombreArchivo}`;

  if (MODO === 'demo') {
    const destino = path.join(DEMO_DIR, carpeta.replace(/\//g, path.sep));
    fs.mkdirSync(destino, { recursive: true });
    fs.writeFileSync(path.join(destino, nombreArchivo), buffer);
    return { path: rutaCompleta, demo: true };
  }

  const temporal = path.join(require('os').tmpdir(), `subida-${Date.now()}-${nombreArchivo}`);
  fs.writeFileSync(temporal, buffer);
  try {
    await ejecutarRclone(['copyto', temporal, `${REMOTE}:${rutaCompleta}`]);
  } finally {
    fs.unlinkSync(temporal);
  }
  return { path: rutaCompleta, demo: false };
}

/** Descarga bytes de una foto ya subida (para incrustarla en el PPTX o mostrarla en el panel). */
async function descargarFoto(fotoDb) {
  if (MODO === 'demo' || fotoDb.demo) {
    const destino = path.join(DEMO_DIR, fotoDb.onedrive_path.replace(/\//g, path.sep));
    return fs.readFileSync(destino);
  }
  return ejecutarRclone(['cat', `${REMOTE}:${fotoDb.onedrive_path}`]);
}

/**
 * Lista TODOS los archivos guardados en OneDrive (recursivo), sin tocar la
 * base de datos. Sirve para reconstruir reportes aunque se haya perdido el
 * registro de entregas (ej. reinicio del contenedor sin disco persistente).
 * Devuelve rutas relativas a ONEDRIVE_ROOT_FOLDER, ej. "MiTienda/2026/09/Merch_0001.jpg".
 */
async function listarArchivos() {
  const root = process.env.ONEDRIVE_ROOT_FOLDER || 'Merch_HES';

  if (MODO === 'demo') {
    const base = path.join(DEMO_DIR, root);
    const resultados = [];
    function recorrer(dir, prefijo) {
      if (!fs.existsSync(dir)) return;
      for (const nombre of fs.readdirSync(dir)) {
        const completo = path.join(dir, nombre);
        if (fs.statSync(completo).isDirectory()) recorrer(completo, `${prefijo}${nombre}/`);
        else resultados.push(`${prefijo}${nombre}`);
      }
    }
    recorrer(base, '');
    return resultados.sort();
  }

  const salida = await ejecutarRclone(['lsjson', `${REMOTE}:${root}`, '--recursive', '--files-only']);
  const items = JSON.parse(salida.toString('utf8'));
  return items.map((i) => i.Path).sort();
}

/** Lee un archivo por su ruta relativa a ONEDRIVE_ROOT_FOLDER (para el reporte de recuperación). */
async function leerArchivoPorRuta(rutaRelativa) {
  const root = process.env.ONEDRIVE_ROOT_FOLDER || 'Merch_HES';
  if (MODO === 'demo') {
    return fs.readFileSync(path.join(DEMO_DIR, root, rutaRelativa));
  }
  return ejecutarRclone(['cat', `${REMOTE}:${root}/${rutaRelativa}`]);
}

module.exports = {
  MODO,
  onedriveConectado,
  subirFoto,
  descargarFoto,
  listarArchivos,
  leerArchivoPorRuta,
  sanear,
};
