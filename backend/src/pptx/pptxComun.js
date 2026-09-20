const graph = require('../graph');

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

/**
 * Añade una o más diapositivas de evidencias para UNA entrega (un promotor,
 * una fecha, un tipo de merchandising), repartiendo sus fotos en bloques de
 * hasta 10 (5x2), igual que la plantilla.
 */
async function agregarSlidesDeEntrega(pres, { tiendaNombre, entrega }) {
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

    for (let idx = 0; idx < bloque.length; idx++) {
      const foto = bloque[idx];
      const col = idx % COLS;
      const row = Math.floor(idx / COLS);
      const x = MARGEN_X + col * (CELDA_ANCHO + GAP);
      const y = GRID_Y + row * (CELDA_ALTO + GAP);
      try {
        const buffer = await graph.descargarFoto(foto);
        const b64 = buffer.toString('base64');
        const ext = (foto.extension || 'jpg').toLowerCase();
        const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
        slide.addImage({
          data: `${mime};base64,${b64}`,
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
    slidesCreadas++;
  }
  return slidesCreadas;
}

module.exports = {
  configurarPresentacion,
  portada,
  separadorTienda,
  agregarSlidesDeEntrega,
};
