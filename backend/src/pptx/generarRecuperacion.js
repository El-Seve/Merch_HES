const pptxgen = require('pptxgenjs');
const { configurarPresentacion, portada, separadorTienda } = require('./pptxComun');
const graph = require('../graph');

const ANCHO = 13.333;
const MARGEN_X = 0.3;
const GRID_Y = 1.05;
const GRID_ALTO = 5.95;
const COLS = 5;
const ROWS = 2;
const GAP = 0.15;
const CELDA_ANCHO = (ANCHO - 2 * MARGEN_X - (COLS - 1) * GAP) / COLS;
const CELDA_ALTO = (GRID_ALTO - (ROWS - 1) * GAP) / ROWS;
const FOTOS_POR_SLIDE = COLS * ROWS;

/** Agrupa rutas planas "tienda/año/mes/archivo.jpg" en un árbol tienda -> año-mes -> [archivos]. */
function agruparPorTiendaYMes(rutas) {
  const arbol = {};
  for (const ruta of rutas) {
    const partes = ruta.split('/');
    if (partes.length < 4) continue; // ruta inesperada, se ignora
    const [tienda, anio, mes, archivo] = partes;
    arbol[tienda] = arbol[tienda] || {};
    const clave = `${anio}-${mes}`;
    arbol[tienda][clave] = arbol[tienda][clave] || [];
    arbol[tienda][clave].push({ archivo, ruta });
  }
  // Ordena archivos por nombre (el correlativo Merch_XXXX ya ordena bien alfabéticamente)
  for (const tienda of Object.keys(arbol)) {
    for (const clave of Object.keys(arbol[tienda])) {
      arbol[tienda][clave].sort((a, b) => a.archivo.localeCompare(b.archivo));
    }
  }
  return arbol;
}

async function agregarSlidesDeCarpeta(pres, { tiendaNombre, anioMes, archivos }) {
  const bloques = [];
  for (let i = 0; i < archivos.length; i += FOTOS_POR_SLIDE) {
    bloques.push(archivos.slice(i, i + FOTOS_POR_SLIDE));
  }

  for (const bloque of bloques) {
    const slide = pres.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addText(`${tiendaNombre} — ${anioMes}`, {
      x: MARGEN_X, y: 0.2, w: ANCHO - 2 * MARGEN_X, h: 0.5,
      fontFace: 'Arial', fontSize: 18, bold: true, color: '000000', isTextBox: true,
    });
    slide.addText(`Recuperado desde OneDrive · ${archivos.length} foto(s) en este mes`, {
      x: MARGEN_X, y: 0.62, w: ANCHO - 2 * MARGEN_X, h: 0.3,
      fontFace: 'Arial', fontSize: 12, color: '6B7378', isTextBox: true,
    });

    for (let idx = 0; idx < bloque.length; idx++) {
      const item = bloque[idx];
      const col = idx % COLS;
      const row = Math.floor(idx / COLS);
      const x = MARGEN_X + col * (CELDA_ANCHO + GAP);
      const y = GRID_Y + row * (CELDA_ALTO + GAP);
      try {
        const buffer = await graph.leerArchivoPorRuta(item.ruta);
        const b64 = buffer.toString('base64');
        slide.addImage({
          data: `image/jpeg;base64,${b64}`,
          x, y, w: CELDA_ANCHO, h: CELDA_ALTO,
          sizing: { type: 'contain', w: CELDA_ANCHO, h: CELDA_ALTO },
        });
      } catch (e) {
        slide.addText('Foto no disponible', {
          x, y, w: CELDA_ANCHO, h: CELDA_ALTO,
          align: 'center', valign: 'middle', fontFace: 'Arial', fontSize: 10, color: 'C85C4A',
          isTextBox: true,
        });
      }
    }
  }
}

/** Genera un PPTX consolidado leyendo directo de OneDrive (sin base de datos). */
async function generarPptxRecuperacion() {
  const rutas = await graph.listarArchivos();
  const arbol = agruparPorTiendaYMes(rutas);
  const tiendas = Object.keys(arbol).sort();

  if (tiendas.length === 0) {
    return { buffer: null, totalTiendas: 0, totalFotos: 0 };
  }

  const pres = new pptxgen();
  configurarPresentacion(pres);
  portada(pres, {
    titulo1: 'LIQUIDACIÓN MERCHANDISING',
    titulo2: 'Recuperado directo desde OneDrive',
    periodoTexto: `${tiendas.length} tienda(s) · ${rutas.length} fotografía(s)`,
  });

  for (const tienda of tiendas) {
    const mesesClaves = Object.keys(arbol[tienda]).sort();
    const totalFotosTienda = mesesClaves.reduce((acc, c) => acc + arbol[tienda][c].length, 0);
    separadorTienda(pres, { tiendaNombre: tienda, resumenTexto: `${totalFotosTienda} foto(s)` });
    for (const anioMes of mesesClaves) {
      await agregarSlidesDeCarpeta(pres, { tiendaNombre: tienda, anioMes, archivos: arbol[tienda][anioMes] });
    }
  }

  const buffer = await pres.write({ outputType: 'nodebuffer' });
  return { buffer, totalTiendas: tiendas.length, totalFotos: rutas.length };
}

module.exports = { generarPptxRecuperacion };
