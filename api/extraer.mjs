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
- Productos: incluye TODAS las líneas de la factura, en el mismo orden en que aparecen.
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
      error: 'Falta configurar la clave de Gemini en el servidor (GEMINI_API_KEY).'
    });
  }

  const { archivoBase64, archivoMime, xmlTexto } = req.body || {};

  if (!archivoBase64 || typeof archivoBase64 !== 'string') {
    return res.status(400).json({ ok: false, error: 'No se recibió el archivo.' });
  }
  if (!MIMES.includes(archivoMime)) {
    return res.status(400).json({ ok: false, error: 'Formato de archivo no compatible.' });
  }
  if (archivoBase64.length > 6000000) {
    return res.status(413).json({
      ok: false,
      error: 'El archivo es demasiado grande. Usa una foto más liviana o un PDF más pequeño.'
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
            ? 'La IA tardó demasiado en responder. Intenta de nuevo.'
            : 'No se pudo conectar con la IA.'
        });
      }
      if (!ocupado(resp.status) && !sinCupo(resp.status)) break;
      if (i < modelos.length - 1) await new Promise((r) => setTimeout(r, 600));
    }
    if (resp && !ocupado(resp.status)) break;
  }

  if (!resp.ok) {
    let detalle = '';
    try {
      const errJson = await resp.json();
      detalle = errJson?.error?.message || '';
    } catch {}
    const mensajes = {
      400: 'La IA no pudo procesar el archivo. Revisa que sea un PDF o una foto legible.',
      401: 'La clave de Gemini no es válida. Revisa GEMINI_API_KEY.',
      403: 'La clave de Gemini no tiene permisos. Revisa GEMINI_API_KEY.',
      404: 'El modelo de IA no está disponible. Revisa GEMINI_MODEL.',
      429: 'La IA alcanzó su límite gratuito (por minuto o por día). Espera un momento y vuelve a intentar; si persiste, el cupo se renueva mañana o puedes activar facturación en Google AI Studio.',
      503: 'La IA está saturada en este momento. Espera unos segundos y vuelve a intentar.'
    };
    const msg = mensajes[resp.status] || `La IA respondió con un error (${resp.status}).`;
    return res.status(resp.status === 429 ? 429 : 502).json({
      ok: false,
      error: msg + (detalle ? ' ' + detalle.slice(0, 200) : '')
    });
  }

  let data;
  try {
    data = await resp.json();
  } catch {
    return res.status(502).json({ ok: false, error: 'La IA devolvió una respuesta ilegible.' });
  }

  const candidato = data?.candidates?.[0];
  if (!candidato) {
    return res.status(502).json({
      ok: false,
      error: 'La IA no devolvió resultados. Intenta con una foto más nítida.'
    });
  }
  if (candidato.finishReason === 'MAX_TOKENS') {
    return res.status(502).json({
      ok: false,
      error: 'La factura tiene demasiados productos para procesarla de una vez. Intenta con una foto más nítida.'
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
      error: 'La IA no devolvió los datos en el formato esperado. Intenta de nuevo.'
    });
  }

  if (!datos || typeof datos !== 'object' || !Array.isArray(datos.productos)) {
    return res.status(502).json({
      ok: false,
      error: 'La IA no devolvió la lista de productos. Intenta de nuevo.'
    });
  }

  return res.status(200).json({ ok: true, datos });
}
