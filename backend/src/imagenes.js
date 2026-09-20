const sharp = require('sharp');

const ANCHO_MAX = 1920; // suficiente para ver detalle en la foto, pero baja bastante el peso
const CALIDAD_JPEG = 85; // visualmente indistinguible del original para fines de evidencia

function escaparXml(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function construirSvgMarcaAgua({ ancho, alto, lineas }) {
  const tamanoFuente = Math.max(16, Math.round(ancho * 0.02));
  const interlineado = Math.round(tamanoFuente * 1.35);
  const padding = Math.round(ancho * 0.018);
  const alturaBanda = interlineado * lineas.length + padding;
  const y0 = alto - alturaBanda;

  const textos = lineas
    .map((linea, i) => {
      const y = y0 + padding + tamanoFuente + i * interlineado;
      return `<text x="${padding}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${tamanoFuente}" fill="white" font-weight="600">${escaparXml(linea)}</text>`;
    })
    .join('');

  return `<svg width="${ancho}" height="${alto}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="${y0}" width="${ancho}" height="${alturaBanda}" fill="black" fill-opacity="0.5" />
    ${textos}
  </svg>`;
}

/**
 * Redimensiona, comprime y marca con agua (tienda + promotor + fecha/hora) una
 * fotografía antes de subirla. Siempre devuelve JPEG — por eso el correlativo
 * de fotos usa extensión .jpg de aquí en adelante (coincide con el formato
 * real ya procesado, como pide la especificación original).
 */
async function procesarImagen(buffer, { tiendaNombre, promotorNombre, fechaISO }) {
  const redimensionada = await sharp(buffer, { failOn: 'none' })
    .rotate() // respeta la orientación EXIF de fotos tomadas con celular
    .resize({ width: ANCHO_MAX, height: ANCHO_MAX, fit: 'inside', withoutEnlargement: true })
    .toBuffer();

  const metadata = await sharp(redimensionada).metadata();
  const horaTexto = new Date().toTimeString().slice(0, 5);

  const svg = construirSvgMarcaAgua({
    ancho: metadata.width,
    alto: metadata.height,
    lineas: [tiendaNombre, `${promotorNombre} · ${fechaISO} ${horaTexto}`],
  });

  return sharp(redimensionada)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: CALIDAD_JPEG })
    .toBuffer();
}

module.exports = { procesarImagen };
