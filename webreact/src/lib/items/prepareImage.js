// prepareImage — shared by ImageLibraryPage.jsx and ServiceEditor.jsx's photo drop. Extracted
// verbatim (the maintainer, 29 Sep 2026): downsizes to MAX_DIMENSION, re-encodes under IMAGE_MAX_BYTES,
// base64s the result for POST /api/items/images's {dataBase64, contentType, width, height} body.
export const IMAGE_MAX_BYTES = 700 * 1024;
const MAX_DIMENSION = 2000;
export const TEN_MB_MESSAGE = "That one's over 10 MB — resize it and try again.";

export async function prepareImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / bitmap.width, MAX_DIMENSION / bitmap.height);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  const toBlob = (type, q) => new Promise((res) => canvas.toBlob(res, type, q));

  let blob = await toBlob("image/png");
  let contentType = "image/png";
  let quality = 0.9;
  while (blob.size > IMAGE_MAX_BYTES && quality > 0.35) {
    blob = await toBlob("image/webp", quality);
    contentType = "image/webp";
    quality -= 0.15;
  }

  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { dataBase64: btoa(bin), contentType, width: w, height: h };
}

export function nameFromFile(file) {
  const base = String(file?.name ?? "image").replace(/\.[^./\\]+$/, "").trim();
  return base || "image";
}
