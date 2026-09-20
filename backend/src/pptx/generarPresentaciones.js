const pptxgen = require('pptxgenjs');
const { configurarPresentacion, portada, separadorTienda, agregarSlidesDeEntrega } = require('./pptxComun');

async function generarPptxTienda({ tiendaNombre, entregas, periodoTexto }) {
  const pres = new pptxgen();
  configurarPresentacion(pres);
  portada(pres, {
    titulo1: 'LIQUIDACIÓN MERCHANDISING',
    titulo2: `Impulso de ventas en HES — ${tiendaNombre}`,
    periodoTexto,
  });

  let totalSlides = 0;
  for (const entrega of entregas) {
    totalSlides += await agregarSlidesDeEntrega(pres, { tiendaNombre, entrega });
  }
  return { buffer: await pres.write({ outputType: 'nodebuffer' }), slidesConFotos: totalSlides };
}

async function generarPptxConsolidado({ entregasPorTienda, periodoTexto, resumen }) {
  const pres = new pptxgen();
  configurarPresentacion(pres);
  portada(pres, {
    titulo1: 'LIQUIDACIÓN MERCHANDISING',
    titulo2: 'Consolidado HES — todas las tiendas',
    periodoTexto,
  });

  const s = pres.addSlide();
  s.background = { color: 'FFFFFF' };
  s.addText('Resumen', {
    x: 0.5, y: 0.6, w: 12.3, h: 0.6, fontFace: 'Arial', fontSize: 28, bold: true, color: '000000', isTextBox: true,
  });
  s.addText(
    [
      { text: `Tiendas: ${resumen.tiendas}`, options: { breakLine: true } },
      { text: `Promotores: ${resumen.promotores}`, options: { breakLine: true } },
      { text: `Entregas: ${resumen.entregas}`, options: { breakLine: true } },
      { text: `Fotografías: ${resumen.fotos}`, options: {} },
    ],
    { x: 0.5, y: 1.5, w: 8, h: 2.5, fontFace: 'Arial', fontSize: 18, color: '000000', isTextBox: true }
  );

  let totalSlides = 0;
  for (const [tiendaNombre, entregas] of Object.entries(entregasPorTienda)) {
    separadorTienda(pres, {
      tiendaNombre,
      resumenTexto: `${entregas.length} entrega(s)`,
    });
    for (const entrega of entregas) {
      totalSlides += await agregarSlidesDeEntrega(pres, { tiendaNombre, entrega });
    }
  }
  return { buffer: await pres.write({ outputType: 'nodebuffer' }), slidesConFotos: totalSlides };
}

module.exports = { generarPptxTienda, generarPptxConsolidado };
