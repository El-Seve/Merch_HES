const msal = require('@azure/msal-node');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const MODO = process.env.MODO || 'demo';
const CACHE_PATH = path.join(__dirname, '..', 'data', 'msal-cache.json');
const DEMO_DIR = path.join(__dirname, '..', 'data', 'demo-fotos');

if (!fs.existsSync(DEMO_DIR)) fs.mkdirSync(DEMO_DIR, { recursive: true });

// --- Persistencia simple del cache de tokens de MSAL (así el refresh token
// sobrevive a reinicios del servidor y no hay que volver a autorizar cada vez) ---
const cachePlugin = {
  beforeCacheAccess: async (ctx) => {
    if (fs.existsSync(CACHE_PATH)) {
      ctx.tokenCache.deserialize(fs.readFileSync(CACHE_PATH, 'utf8'));
    }
  },
  afterCacheAccess: async (ctx) => {
    if (ctx.cacheHasChanged) {
      fs.writeFileSync(CACHE_PATH, ctx.tokenCache.serialize());
    }
  },
};

let msalApp = null;
function getMsalApp() {
  if (msalApp) return msalApp;
  msalApp = new msal.ConfidentialClientApplication({
    auth: {
      clientId: process.env.AZURE_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT || 'consumers'}`,
      clientSecret: process.env.AZURE_CLIENT_SECRET,
    },
    cache: cachePlugin,
  });
  return msalApp;
}

const SCOPES = ['Files.ReadWrite', 'offline_access', 'User.Read'];

function urlDeAutorizacion() {
  return getMsalApp().getAuthCodeUrl({
    scopes: SCOPES,
    redirectUri: process.env.AZURE_REDIRECT_URI,
  });
}

async function intercambiarCodigo(code) {
  const resultado = await getMsalApp().acquireTokenByCode({
    code,
    scopes: SCOPES,
    redirectUri: process.env.AZURE_REDIRECT_URI,
  });
  return resultado;
}

async function obtenerTokenSilencioso() {
  const app = getMsalApp();
  const cuentas = await app.getTokenCache().getAllAccounts();
  if (cuentas.length === 0) {
    const err = new Error('ONEDRIVE_NO_CONECTADO');
    err.code = 'ONEDRIVE_NO_CONECTADO';
    throw err;
  }
  const resultado = await app.acquireTokenSilent({
    account: cuentas[0],
    scopes: SCOPES,
  });
  return resultado.accessToken;
}

async function onedriveConectado() {
  if (MODO === 'demo') return true;
  try {
    await obtenerTokenSilencioso();
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
 * Sube una fotografía. En modo demo la guarda en disco local (misma
 * estructura de carpetas) para poder probar todo el flujo sin credenciales
 * de Microsoft reales. En modo producción sube de verdad a OneDrive.
 *
 * @returns {{ id: string, path: string, demo: boolean }}
 */
async function subirFoto({ buffer, nombreArchivo, nombreTienda, fechaISO }) {
  const carpeta = rutaCarpeta(nombreTienda, fechaISO);
  const rutaCompleta = `${carpeta}/${nombreArchivo}`;

  if (MODO === 'demo') {
    const destino = path.join(DEMO_DIR, carpeta.replace(/\//g, path.sep));
    fs.mkdirSync(destino, { recursive: true });
    fs.writeFileSync(path.join(destino, nombreArchivo), buffer);
    return { id: `demo-${Date.now()}-${nombreArchivo}`, path: rutaCompleta, demo: true };
  }

  const token = await obtenerTokenSilencioso();
  const CUATRO_MB = 4 * 1024 * 1024;

  if (buffer.length <= CUATRO_MB) {
    // Subida simple. Graph crea las carpetas intermedias que falten.
    const resp = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURI(rutaCompleta)}:/content`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
        body: buffer,
      }
    );
    if (!resp.ok) throw new Error(`GRAPH_UPLOAD_ERROR ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    return { id: data.id, path: rutaCompleta, demo: false };
  }

  // Archivo grande: sesión de carga reanudable (necesaria a partir de ~4MB por spec de Graph)
  const sesionResp = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURI(rutaCompleta)}:/createUploadSession`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'fail' } }),
    }
  );
  if (!sesionResp.ok) throw new Error(`GRAPH_SESSION_ERROR ${sesionResp.status}`);
  const sesion = await sesionResp.json();

  const CHUNK = 320 * 1024 * 10; // ~3.2MB por chunk (múltiplo de 320KiB, requisito de Graph)
  let subido = 0;
  let ultimaRespuesta = null;
  while (subido < buffer.length) {
    const fin = Math.min(subido + CHUNK, buffer.length);
    const trozo = buffer.subarray(subido, fin);
    const r = await fetch(sesion.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': String(trozo.length),
        'Content-Range': `bytes ${subido}-${fin - 1}/${buffer.length}`,
      },
      body: trozo,
    });
    if (!r.ok) throw new Error(`GRAPH_CHUNK_ERROR ${r.status}: ${await r.text()}`);
    ultimaRespuesta = await r.json();
    subido = fin;
  }
  return { id: ultimaRespuesta.id, path: rutaCompleta, demo: false };
}

/** Descarga bytes de una foto ya subida (para incrustarla en el PPTX). */
async function descargarFoto(fotoDb) {
  if (MODO === 'demo' || fotoDb.demo) {
    const destino = path.join(DEMO_DIR, fotoDb.onedrive_path.replace(/\//g, path.sep));
    return fs.readFileSync(destino);
  }
  const token = await obtenerTokenSilencioso();
  const resp = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${fotoDb.onedrive_item_id}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`GRAPH_DOWNLOAD_ERROR ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

module.exports = {
  MODO,
  urlDeAutorizacion,
  intercambiarCodigo,
  onedriveConectado,
  subirFoto,
  descargarFoto,
  sanear,
};
