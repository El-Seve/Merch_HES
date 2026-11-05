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

// Tope global de procesos rclone simultáneos. Sin esto, abrir el panel de
// Evidencias o generar una presentación lanzaba cientos de procesos a la vez,
// reventaba la memoria del plan Free de Render (512 MB) y todo se ponía lentísimo.
const MAX_RCLONE_SIMULTANEOS = 4;
let rcloneActivos = 0;
const colaRclone = [];

function ejecutarRclone(args) {
  return new Promise((resolve, reject) => {
    colaRclone.push({ args, resolve, reject });
    atenderColaRclone();
  });
}

function atenderColaRclone() {
  while (rcloneActivos < MAX_RCLONE_SIMULTANEOS && colaRclone.length) {
    const { args, resolve, reject } = colaRclone.shift();
    rcloneActivos++;
    execFile(
      RCLONE_BIN,
      // timeouts para que una conexión colgada no bloquee la cola para siempre
      [...args, '--contimeout', '20s', '--timeout', '90s', '--low-level-retries', '3'],
      { maxBuffer: 1024 * 1024 * 50, encoding: 'buffer', env: { ...process.env, RCLONE_CONFIG: RCLONE_CONF_PATH } },
      (error, stdout, stderr) => {
        rcloneActivos--;
        if (error) {
          error.stderrTexto = stderr ? stderr.toString('utf8') : '';
          reject(error);
        } else {
          resolve(stdout);
        }
        atenderColaRclone();
      }
    );
  }
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

/**
 * Genera (y valida) un link directo de OneDrive para que el NAVEGADOR descargue
 * la foto directo de Microsoft, sin pasar por Render — así no se gasta banda
 * ancha de Render cada vez que alguien mira una evidencia en el panel.
 *
 * Por qué valida con un HEAD antes de confiar en el link: OneDrive a veces
 * entrega un link de "vista previa" (una página HTML) en vez del archivo
 * binario. Si no fuera una imagen de verdad, devolvemos null y quien llama
 * cae de nuevo al proxy de siempre (más lento/con banda, pero siempre funciona).
 */
let fallosEnlaceDirecto = 0;
let enlaceDirectoPausadoHasta = 0;

async function obtenerLinkDirecto(rutaRelativa) {
  if (MODO === 'demo') return null;
  // Si el link directo falló varias veces seguidas (OneDrive no sirve imágenes
  // por ese medio), dejamos de intentarlo una hora en vez de gastar tiempo en cada foto.
  if (Date.now() < enlaceDirectoPausadoHasta) return null;
  try {
    const salida = await ejecutarRclone(['link', `${REMOTE}:${rutaRelativa}`]);
    let link = salida.toString('utf8').trim();
    if (!link) return null;
    // Truco conocido para OneDrive personal: "/redir?" abre la vista previa en
    // HTML; "/download?" fuerza la descarga directa del archivo real.
    if (link.includes('onedrive.live.com') && link.includes('/redir?')) {
      link = link.replace('/redir?', '/download?');
    }
    const resp = await fetch(link, { method: 'HEAD', redirect: 'follow' });
    const tipo = resp.headers.get('content-type') || '';
    if (resp.ok && tipo.startsWith('image/')) {
      fallosEnlaceDirecto = 0;
      return link;
    }
    registrarFalloEnlaceDirecto();
    return null;
  } catch {
    registrarFalloEnlaceDirecto();
    return null;
  }
}

function registrarFalloEnlaceDirecto() {
  fallosEnlaceDirecto++;
  if (fallosEnlaceDirecto >= 3) {
    enlaceDirectoPausadoHasta = Date.now() + 60 * 60 * 1000;
    fallosEnlaceDirecto = 0;
  }
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

/**
 * Sube un archivo "de sistema" (no una foto de evidencia) a una carpeta fija
 * _sistema/ dentro de tu OneDrive. Se usa para respaldar la base de datos
 * SQLite completa, así el plan Free de Render (sin disco persistente) deja
 * de perder el catálogo y las entregas cada vez que el contenedor se reinicia.
 */
async function subirArchivoSistema(buffer, nombreArchivo) {
  const root = process.env.ONEDRIVE_ROOT_FOLDER || 'Merch_HES';
  if (MODO === 'demo') {
    const destino = path.join(DEMO_DIR, root, '_sistema');
    fs.mkdirSync(destino, { recursive: true });
    fs.writeFileSync(path.join(destino, nombreArchivo), buffer);
    return;
  }
  const temporal = path.join(require('os').tmpdir(), `sys-${Date.now()}-${nombreArchivo}`);
  fs.writeFileSync(temporal, buffer);
  try {
    await ejecutarRclone(['copyto', temporal, `${REMOTE}:${root}/_sistema/${nombreArchivo}`]);
  } finally {
    fs.unlinkSync(temporal);
  }
}

/** Descarga un archivo de _sistema/ (ej. el respaldo de la base de datos). Null si no existe. */
async function descargarArchivoSistema(nombreArchivo) {
  const root = process.env.ONEDRIVE_ROOT_FOLDER || 'Merch_HES';
  if (MODO === 'demo') {
    const ruta = path.join(DEMO_DIR, root, '_sistema', nombreArchivo);
    if (!fs.existsSync(ruta)) return null;
    return fs.readFileSync(ruta);
  }
  try {
    return await ejecutarRclone(['cat', `${REMOTE}:${root}/_sistema/${nombreArchivo}`]);
  } catch {
    return null;
  }
}

module.exports = {
  MODO,
  onedriveConectado,
  subirFoto,
  descargarFoto,
  obtenerLinkDirecto,
  listarArchivos,
  leerArchivoPorRuta,
  subirArchivoSistema,
  descargarArchivoSistema,
  sanear,
};
