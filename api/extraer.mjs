export const config = { maxDuration: 60 };

const MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
];

const ESQUEMA = {
  type: 'object',
  properties: {
    proveedor: { type: 'string', description: 'Razón social completa del proveedor.' },
    factura: { type: 'string', description: 'Número de factura.' },
    fecha: { type: 'string', description: 'Fecha de expedición en formato AAAA-MM-DD.' },
    nit: { type: 'string', description: 'NIT con dígito de verificación.' },
    productos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          articulo: { type: 'string', description: 'Código de referencia o SKU.' },
          nombre: { type: 'string', description: 'Descripción completa del producto.' },
          invima: { type: 'string', description: 'Registro sanitario o INVIMA; "0" si no aplica.' },
          lote: { type: 'string', description: 'Lote sin espacios ni símbolos.' },
          vencimiento: {
            type: 'string',
            description: 'Fecha de vencimiento en formato AAAA-MM-DD o AAAA-MM.'
          },
          cantidad: { type: 'number', description: 'Número de unidades.' },
          vu: { type: 'number', description: 'Valor unitario sin separadores de miles.' }
        },
        required: ['articulo', 'nombre', 'invima', 'lote', 'vencimiento', 'cantidad', 'vu']
      }
    }
  },
  required: ['proveedor', 'factura', 'fecha', 'nit', 'productos']
};

function construirPrompt(xmlTexto) {
  let prompt = `Eres un asistente especializado en leer facturas electrónicas colombianas y extraer datos para un sistema contable.

Analiza el archivo adjunto (PDF o imagen de una factura) y devuelve únicamente un JSON válido con los datos.

Reglas:
- Proveedor: razón social completa, tal como aparece en la factura.
- Factura: número de factura en MAYÚSCULAS y solo con letras y números (sin espacios, guiones ni símbolos).
- Fecha: fecha de expedición en formato AAAA-MM-DD.
- Nit: NIT con dígito de verificación (ejemplo: 900294380-1).
- Productos: incluye TODAS las líneas de la factura, en el mismo orden en que aparecen, de arriba hacia abajo. No los ordenes por código, nombre ni valor.
- Artículo: código de referencia o SKU.
- Nombre: descripción completa del producto.
- Invima: registro sanitario o INVIMA. Si no aparece, usa "0".
- Lote: lote del producto, sin espacios ni símbolos. Si no aparece, cadena vacía.
- Vencimiento: fecha de vencimiento en formato AAAA-MM-DD o AAAA-MM. Si no aparece, cadena vacía.
- Cantidad: número de unidades, como número (sin separadores de miles).
- V/U: valor unitario, como número (sin separadores de miles ni símbolos de moneda).
- No inventes datos. Si un dato no aparece en la factura, usa cadena vacía.
- Si el documento tiene varias páginas, léelas todas.
- No incluyas explicaciones, texto adicional ni bloques de código: solo el JSON.`;

  if (xmlTexto) {
    prompt += `

Además, se incluye el texto del XML de la misma factura. Úsalo para confirmar el NIT, el número de factura y la fecha; si hay diferencias en esos tres datos, prioriza el XML.

Texto del XML:
---
${xmlTexto}
---`;
  }

  return prompt;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(500).json({
      ok: false,
      error: 'Servidor sin clave.'
    });
  }

  const { archivoBase64, archivoMime, xmlTexto } = req.body || {};

  if (!archivoBase64 || typeof archivoBase64 !== 'string') {
    return res.status(400).json({ ok: false, error: 'Falta el archivo.' });
  }
  if (!MIMES.includes(archivoMime)) {
    return res.status(400).json({ ok: false, error: 'Formato no válido.' });
  }
  if (archivoBase64.length > 6000000) {
    return res.status(413).json({
      ok: false,
      error: 'Archivo demasiado grande.'
    });
  }

  const xml = typeof xmlTexto === 'string' ? xmlTexto.slice(0, 150000) : '';
  const modelo = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const modelos = [...new Set([modelo, 'gemini-3.6-flash', 'gemini-3.5-flash'])];

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: construirPrompt(xml) },
          { inline_data: { mime_type: archivoMime, data: archivoBase64 } }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 16384,
      responseMimeType: 'application/json',
      responseSchema: ESQUEMA
    }
  };

  let resp;
  const ocupado = (s) => s === 503 || s === 500;
  const sinCupo = (s) => s === 429;
  for (let intento = 0; intento < 2; intento++) {
    if (intento > 0) await new Promise((r) => setTimeout(r, 1500));
    for (let i = 0; i < modelos.length; i++) {
      try {
        resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelos[i]}:generateContent`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': key
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(45000)
          }
        );
      } catch (err) {
        const timeout = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
        return res.status(timeout ? 504 : 502).json({
          ok: false,
          error: timeout
            ? 'Tiempo de espera agotado.'
            : 'Sin conexión con el servicio.'
        });
      }
      if (!ocupado(resp.status) && !sinCupo(resp.status)) break;
      if (i < modelos.length - 1) await new Promise((r) => setTimeout(r, 600));
    }
    if (resp && !ocupado(resp.status)) break;
  }

  if (!resp.ok) {
    try {
      const errJson = await resp.json();
      const detalle = errJson?.error?.message;
      if (detalle) console.error('Gemini:', detalle);
    } catch {}
    const mensajes = {
      400: 'No se pudo procesar el archivo.',
      401: 'Clave no válida.',
      403: 'Clave sin permisos.',
      404: 'Modelo no disponible.',
      429: 'Cupo agotado.',
      503: 'Servicio ocupado.'
    };
    return res.status(resp.status === 429 ? 429 : 502).json({
      ok: false,
      error: mensajes[resp.status] || `Error ${resp.status}.`
    });
  }

  let data;
  try {
    data = await resp.json();
  } catch {
    return res.status(502).json({ ok: false, error: 'Respuesta no válida.' });
  }

  const candidato = data?.candidates?.[0];
  if (!candidato) {
    return res.status(502).json({
      ok: false,
      error: 'Sin resultados.'
    });
  }
  if (candidato.finishReason === 'MAX_TOKENS') {
    return res.status(502).json({
      ok: false,
      error: 'Demasiados productos.'
    });
  }

  const texto = (candidato.content?.parts || [])
    .map((p) => p.text || '')
    .join('')
    .trim();

  let datos;
  try {
    const limpio = texto.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    datos = JSON.parse(limpio);
  } catch {
    return res.status(502).json({
      ok: false,
      error: 'Datos no válidos.'
    });
  }

  if (!datos || typeof datos !== 'object' || !Array.isArray(datos.productos)) {
    return res.status(502).json({
      ok: false,
      error: 'Sin productos.'
    });
  }

  return res.status(200).json({ ok: true, datos });
}
