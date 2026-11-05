const sharp = require('sharp');
const graph = require('../graph');

// Menos caché de sharp = menos memoria (el plan Free de Render tiene 512 MB).
sharp.cache(false);

// Medidas tomadas de Plantilla_Liquidación_Merch.pptx (slide 13.333" x 7.5", grilla 5x2, texto plano sin decoración)
const ANCHO = 13.333;
const ALTO = 7.5;
const MARGEN_X = 0.3;
const GRID_Y = 1.35;
const GRID_ALTO = 5.65;
const COLS = 5;
const ROWS = 2;
const GAP = 0.15;
const CELDA_ANCHO = (ANCHO - 2 * MARGEN_X - (COLS - 1) * GAP) / COLS;
const CELDA_ALTO = (GRID_ALTO - (ROWS - 1) * GAP) / ROWS;
const FOTOS_POR_SLIDE = COLS * ROWS;

// Cada celda mide ~2.4" x 2.8": con 900 px por lado sobra calidad (>300 dpi) y
// cada foto pesa ~100 KB en vez de 1 MB, que es lo que hacía lenta la
// generación y reventaba la memoria del servidor.
const IMG_MAX_PX = 900;
const IMG_CALIDAD = 72;

function configurarPresentacion(pres) {
  pres.layout = 'LAYOUT_WIDE'; // 13.333" x 7.5" — igual a la plantilla
  pres.author = 'HES';
}

function portada(pres, { titulo1, titulo2, periodoTexto }) {
  const slide = pres.addSlide();
  slide.background = { color: 'FFFFFF' };
  slide.addText(
    [
      { text: titulo1, options: { breakLine: true } },
      { text: titulo2 || '', options: { breakLine: true } },
      { text: periodoTexto || '', options: {} },
    ],
    {
      x: 1.86, y: 0.7, w: 9.6, h: 3.65,
      align: 'center', valign: 'top',
      fontFace: 'Arial', fontSize: 40, color: '000000',
      isTextBox: true,
    }
  );
}

function separadorTienda(pres, { tiendaNombre, resumenTexto }) {
  const slide = pres.addSlide();
  slide.background = { color: 'FFFFFF' };
  slide.addText(tiendaNombre, {
    x: 0.5, y: 3.0, w: ANCHO - 1, h: 1.0,
    align: 'center', fontFace: 'Arial', fontSize: 32, bold: true, color: '000000',
    isTextBox: true,
  });
  if (resumenTexto) {
    slide.addText(resumenTexto, {
      x: 0.5, y: 3.95, w: ANCHO - 1, h: 0.6,
      align: 'center', fontFace: 'Arial', fontSize: 16, color: '3E4448',
      isTextBox: true,
    });
  }
}

/** Reduce y comprime una foto para incrustarla; devuelve base64 + dimensiones reales. */
async function prepararImagen(buffer) {
  const { data, info } = await sharp(buffer)
    .resize({ width: IMG_MAX_PX, height: IMG_MAX_PX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: IMG_CALIDAD, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { b64: data.toString('base64'), w: info.width, h: info.height };
}

/** Coloca la imagen centrada en su celda, respetando su proporción (sin deformarla). */
function agregarImagenEnCelda(slide, img, x, y, celdaAncho, celdaAlto) {
  const escala = Math.min(celdaAncho / img.w, celdaAlto / img.h);
  const w = img.w * escala;
  const h = img.h * escala;
  slide.addImage({
    data: `image/jpeg;base64,${img.b64}`,
    x: x + (celdaAncho - w) / 2,
    y: y + (celdaAlto - h) / 2,
    w,
    h,
  });
}

function marcarNoDisponible(slide, x, y, celdaAncho, celdaAlto) {
  slide.addText('Foto no disponible', {
    x, y, w: celdaAncho, h: celdaAlto,
    align: 'center', valign: 'middle', fontFace: 'Arial', fontSize: 10, color: 'C85C4A',
    isTextBox: true,
  });
}

/**
 * Descarga y prepara en paralelo las fotos de un bloque (el tope global de
 * rclone en graph.js evita saturar el servidor). Nunca lanza: si una foto
 * falla devuelve null en su lugar.
 */
async function prepararBloque(items, leerBuffer, onFoto) {
  return Promise.all(
    items.map(async (item) => {
      try {
        return await prepararImagen(await leerBuffer(item));
      } catch {
        return null;
      } finally {
        if (onFoto) onFoto();
      }
    })
  );
}

/**
 * Añade una o más diapositivas de evidencias para UNA entrega (un promotor,
 * una fecha, un tipo de merchandising), repartiendo sus fotos en bloques de
 * hasta 10 (5x2), igual que la plantilla.
 */
async function agregarSlidesDeEntrega(pres, { tiendaNombre, entrega, onFoto }) {
  const fotosCompletas = (entrega.fotos || []).filter((f) => f.estado === 'completo');
  if (fotosCompletas.length === 0) return 0;

  const bloques = [];
  for (let i = 0; i < fotosCompletas.length; i += FOTOS_POR_SLIDE) {
    bloques.push(fotosCompletas.slice(i, i + FOTOS_POR_SLIDE));
  }

  const etiqueta = `${entrega.tipo_merch}   "${entrega.cantidad}"`;
  const subtitulo = `${entrega.promotor_nombre} — ${entrega.fecha}${
    entrega.observaciones ? '  |  ' + entrega.observaciones : ''
  }`;

  let slidesCreadas = 0;
  for (const bloque of bloques) {
    const imagenes = await prepararBloque(bloque, (foto) => graph.descargarFoto(foto), onFoto);

    const slide = pres.addSlide();
    slide.background = { color: 'FFFFFF' };

    slide.addText(`Impulso de ventas en HES — ${tiendaNombre}`, {
      x: MARGEN_X, y: 0.17, w: ANCHO - 2 * MARGEN_X, h: 0.32,
      fontFace: 'Arial', fontSize: 14, color: '000000', isTextBox: true,
    });
    slide.addText(
      [
        { text: etiqueta, options: { bold: true, breakLine: true } },
        { text: subtitulo, options: {} },
      ],
      {
        x: MARGEN_X, y: 0.55, w: ANCHO - 2 * MARGEN_X, h: 0.6,
        fontFace: 'Arial', fontSize: 14, color: '000000', isTextBox: true,
      }
    );

    imagenes.forEach((img, idx) => {
      const col = idx % COLS;
      const row = Math.floor(idx / COLS);
      const x = MARGEN_X + col * (CELDA_ANCHO + GAP);
      const y = GRID_Y + row * (CELDA_ALTO + GAP);
      if (img) agregarImagenEnCelda(slide, img, x, y, CELDA_ANCHO, CELDA_ALTO);
      else marcarNoDisponible(slide, x, y, CELDA_ANCHO, CELDA_ALTO);
    });
    slidesCreadas++;
  }
  return slidesCreadas;
}

module.exports = {
  configurarPresentacion,
  portada,
  separadorTienda,
  agregarSlidesDeEntrega,
  prepararBloque,
  agregarImagenEnCelda,
  marcarNoDisponible,
};
