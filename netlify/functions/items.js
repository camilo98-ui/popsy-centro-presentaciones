/* =========================================================================
   netlify/functions/items.js — presentaciones compartidas del Centro de
   Presentaciones Popsy
   =========================================================================
   El panel original guardaba cada presentación subida en IndexedDB (local al
   navegador) — por eso lo que alguien subía solo lo veía esa persona, en ese
   dispositivo. Esta function guarda TODAS las presentaciones en Netlify Blobs
   (una sola colección compartida), para que cualquiera que abra el panel, en
   cualquier dispositivo, vea lo mismo.

   GET    /.netlify/functions/items            → array con todas las presentaciones
   PUT    /.netlify/functions/items             → guarda/actualiza una (body = item con "id")
   DELETE /.netlify/functions/items?id=<id>      → elimina una por id

   Se guardan todas en un solo blob (simple y suficiente para el volumen de
   uso de este panel — subidas ocasionales, no miles simultáneas). Cada
   presentación incluye su HTML completo, así que el límite de tamaño de
   Netlify Functions (payloads sync ~6MB) es la restricción práctica por
   presentación individual — ver MAX_ITEM_BYTES abajo.
   ========================================================================= */

const { connectLambda, getStore } = require("@netlify/blobs");

const STORE_NAME = "popsy-presentaciones";
const KEY = "items.json";
const MAX_ITEM_BYTES = 6 * 1024 * 1024; // límite práctico de una function síncrona de Netlify

exports.handler = async (event) => {
  // Firma clásica de Lambda: Netlify Blobs no autoconfigura el entorno solo aquí,
  // hay que conectarlo explícitamente antes de pedir cualquier store.
  connectLambda(event);

  const store = getStore(STORE_NAME);

  try {
    if (event.httpMethod === "GET") {
      const items = await readAll(store);
      return json(200, items);
    }

    if (event.httpMethod === "PUT") {
      const body = event.body || "";
      if (Buffer.byteLength(body, "utf8") > MAX_ITEM_BYTES) {
        return json(413, { error: "Esta presentación es demasiado grande para guardarse." });
      }
      let item;
      try {
        item = JSON.parse(body);
      } catch (e) {
        return json(400, { error: "El cuerpo debe ser JSON válido." });
      }
      if (!item || typeof item.id !== "string" || !item.id) {
        return json(400, { error: "Falta el id de la presentación." });
      }
      const items = await readAll(store);
      const idx = items.findIndex((x) => x.id === item.id);
      if (idx >= 0) items[idx] = item;
      else items.push(item);
      await store.set(KEY, JSON.stringify(items));
      return json(200, { ok: true });
    }

    if (event.httpMethod === "DELETE") {
      const id = event.queryStringParameters && event.queryStringParameters.id;
      if (!id) return json(400, { error: "Falta el id a eliminar." });
      const items = await readAll(store);
      const next = items.filter((x) => x.id !== id);
      await store.set(KEY, JSON.stringify(next));
      return json(200, { ok: true, removed: items.length !== next.length });
    }

    return json(405, { error: "Método no soportado." });
  } catch (err) {
    console.error("[popsy items function] error inesperado:", err);
    return json(500, { error: "Error inesperado guardando/leyendo las presentaciones." });
  }
};

async function readAll(store) {
  const raw = await store.get(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(obj),
  };
}
