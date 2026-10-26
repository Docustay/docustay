// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.010 — LogoUploader.
//
// ★ TY, 2026-09-16 — upload a logo as a FILE, Square-style: the recommended size is stated, the
//   image is resized in the browser to fit that box, and replacing a logo asks "are you sure?".
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { api } from "@/lib/api.js";
import { FileDropZone } from "@/lib/components/ui/file-drop-zone.jsx";
import LogoUploaderConfirm1Confirm from "./LogoUploaderConfirm1Confirm.jsx";

export default function LogoUploader({ logo, onSaved = null }) {
  const [src, setSrc] = useState(logo?.src ?? null);
  const [pending, setPending] = useState(null); // { dataBase64, previewUrl, w, h }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  /** Resize to fit inside logo.box (never upscale), keep aspect, PNG; fall back to WebP if large. */
  async function prepare(file) {
    const bitmap = await createImageBitmap(file);
    const { w: bw, h: bh } = logo.box;
    const scale = Math.min(1, bw / bitmap.width, bh / bitmap.height);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    const toBlob = (type, q) => new Promise((res) => canvas.toBlob(res, type, q));
    let blob = await toBlob("image/png");
    if (blob.size > 650 * 1024) blob = await toBlob("image/webp", 0.9);
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { dataBase64: btoa(bin), previewUrl: URL.createObjectURL(blob), w, h };
  }

  async function onUpload(files) {
    setError(null);
    setSaved(false);
    const file = files?.[0];
    if (!file) return;
    try {
      const prepared = await prepare(file);
      setPending(prepared);
    } catch {
      setError("That image could not be read. Try a PNG or JPG.");
    }
  }

  async function confirmUpload() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.uploadLogo({ kind: logo.kind, dataBase64: pending.dataBase64 });
      setSrc(res?.src ?? pending.previewUrl);
      setSaved(true);
      onSaved?.(logo.kind, res?.src ?? pending.previewUrl);
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  return (
    <>
      <div className="border-t border-structure-200 grid gap-3.5 py-5 max-w-[44rem]" data-testid={`logo-${logo.kind}`} data-kind={logo.kind}>
        <div className="grid gap-1">
          <h2 className="m-0 text-lg font-semibold text-structure-900">{logo.label}</h2>
          <p className="m-0 mt-1 text-sm text-structure-600">{logo.recommended}</p>
        </div>
        <div className="grid grid-cols-[200px_1fr] gap-4 items-stretch">
          <div className="flex items-center justify-center min-h-[120px] border border-structure-200 rounded-xl bg-structure-0 p-3" data-kind={logo.kind}>
            {src ? (
              <img src={src} alt={`Current ${logo.label.toLowerCase()}`} className="max-w-full max-h-24 object-contain" />
            ) : (
              <span className="text-sm text-structure-550">No logo yet</span>
            )}
          </div>
          <FileDropZone.Root
            accept="image/png,image/jpeg,image/webp"
            maxFiles={1}
            fileCount={0}
            maxFileSize={10 * 1000 * 1000}
            onUpload={onUpload}
            onFileRejected={({ reason }) => {
              setError(
                reason === "Maximum file size exceeded"
                  ? "That file is over 10 MB."
                  : "Use a PNG, JPG or WebP image."
              );
            }}
          >
            <FileDropZone.Trigger className="flex flex-col justify-center gap-1 min-h-[120px] p-5 border border-dashed border-structure-200 rounded-xl cursor-pointer hover:bg-action-50">
              <span className="text-base font-medium text-structure-900">{src ? "Replace logo" : "Upload logo"}</span>
              <span className="text-sm text-structure-600">Drag an image here or click to choose · PNG, JPG or WebP</span>
            </FileDropZone.Trigger>
          </FileDropZone.Root>
        </div>
        {saved && <p className="text-sm text-structure-900" role="status">Saved.</p>}
        {error && <p className="text-sm text-danger-700" role="alert">{error}</p>}
      </div>

      <LogoUploaderConfirm1Confirm
        open={pending !== null}
        onOpenChange={(o) => { if (!o && !busy) setPending(null); }}
        logo={logo}
        src={src}
        pending={pending}
        busy={busy}
        confirmUpload={confirmUpload}
      />
    </>
  );
}
