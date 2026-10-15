import { useState, useEffect, useCallback, useMemo } from "react";
import { request, ApiError } from "@/lib/api.js";
import { FileDropZone, displaySize, ACCEPT_IMAGE } from "@/lib/components/ui/file-drop-zone.jsx";
import { prepareImage as sharedPrepareImage, nameFromFile as sharedNameFromFile, TEN_MB_MESSAGE } from "@/lib/items/prepareImage.js";
import ImageLibraryPageItemsImagesTable from "./ImageLibraryPageItemsImagesTable.jsx";

const UPLOAD_INPUT_ID = "image-library-upload-input";

export default function ImageLibraryPage({ path = "/items/images", params = null, app = null, onNavigate = null, onRefetch = null }) {
  const rank = app?.nav?.rank ?? null;
  const isCoach = rank === `coach`;

  // Loading and error state
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);

  // Filter state
  const [search, setSearch] = useState("");
  const [usedFilter, setUsedFilter] = useState("all"); // "all" | "used" | "unused"
  const [sizeSort, setSizeSort] = useState("none");  // "none" | "largest" | "smallest"

  // Upload state
  const [uploadErrors, setUploadErrors] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [pendingRejects, setPendingRejects] = useState([]);

  // Delete state
  const [deleteErrors, setDeleteErrors] = useState({});
  const [deletingId, setDeletingId] = useState(null);

  // Load data from API
  const load = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const body = await request("/api/items/images");
      const data = Array.isArray(body?.data) ? body.data : [];
      setRows(data);
      setPhase(data.length === 0 ? "empty" : "ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPhase("denied");
        setError(err);
      } else {
        setPhase("error");
        setError(err instanceof ApiError
          ? { message: err.message, requestId: err.requestId }
          : { message: String(err?.message ?? err) });
      }
    }
  }, []);

  // Compute filtered rows
  const filtered = useMemo(() => {
    let r = rows;
    const q = search.trim().toLowerCase();
    if (q) r = r.filter((x) => String(x.name ?? "").toLowerCase().includes(q));
    if (usedFilter === "used") {
      r = r.filter((x) => x.usedCount !== null && x.usedCount !== undefined && Number(x.usedCount) > 0);
    } else if (usedFilter === "unused") {
      r = r.filter((x) => x.usedCount !== null && x.usedCount !== undefined && Number(x.usedCount) === 0);
    }
    if (sizeSort !== "none") {
      r = [...r].sort((a, b) =>
        sizeSort === "largest" ? (Number(b.bytes) || 0) - (Number(a.bytes) || 0)
                                : (Number(a.bytes) || 0) - (Number(b.bytes) || 0));
    }
    return r;
  }, [rows, search, usedFilter, sizeSort]);

  const isFiltered = search.trim() !== "" || usedFilter !== "all";
  const displayPhase = phase === "ready" && filtered.length === 0 ? "empty" : phase;
  const showControls = phase === "ready" && rows.length > 0;

  const clearFilters = useCallback(() => {
    setSearch("");
    setUsedFilter("all");
  }, []);

  const openFilePicker = useCallback(() => {
    if (typeof document === "undefined" || isCoach) return;
    document.getElementById(UPLOAD_INPUT_ID)?.click();
  }, [isCoach]);

  const emptyBlock = useCallback(() => {
    if (isFiltered) {
      return {
        kind: "filtered",
        headline: "Nothing matches those filters",
        line: "Try a different search or clear the filters.",
        action: null,
      };
    }
    return {
      kind: "first-run",
      headline: "No images yet",
      line: "Drop images here. They'll be everywhere you can use one — services, your booking page, posts.",
      // ★ F-empty-state-nav-only — same class as EmptyState.jsx's 28 Sep fix (WeekView's "Book
      //   someone"): `href` alone only works on a fresh mount that reads `?upload=1` itself
      //   (this screen's own effect below), never on an in-app click, because an SPA navigation
      //   that only changes the query string doesn't remount this component or re-run that
      //   effect. `onClick` calls the real file picker directly — `href` stays as a harmless,
      //   bookmarkable fallback for a hard page load.
      action: isCoach ? null : { label: "Upload", href: `${path}?upload=1`, onClick: openFilePicker },
    };
  }, [isFiltered, isCoach, path, openFilePicker]);

  // Compute the summary text
  const summaryText = useMemo(() => {
    if (phase !== "ready" || rows.length === 0) return null;
    const total = rows.length;
    const known = rows.filter((r) => r.usedCount !== null && r.usedCount !== undefined);
    const unused = known.filter((r) => Number(r.usedCount) === 0).length;
    const missing = total - known.length;
    const parts = [total === 1 ? "One image." : `${total} images.`];
    if (unused > 0) parts.push(unused === 1 ? "One isn't used anywhere." : `${unused} aren't used anywhere.`);
    if (missing > 0) {
      parts.push(missing === 1 ? "Usage isn't available for one of them."
                                : `Usage isn't available for ${missing} of them.`);
    }
    return parts.join(" ");
  }, [phase, rows]);

  const usageLine = useCallback((row) => {
    if (row.usedCount === null || row.usedCount === undefined) return "Usage not available";
    if (typeof row.usedLabel === "string" && row.usedLabel) return row.usedLabel;
    const n = Number(row.usedCount) || 0;
    return n === 0 ? "Not used" : `On ${n} item${n === 1 ? "" : "s"}`;
  }, []);

  // Image preparation for upload — shared with ServiceEditor.jsx's photo drop.
  const prepareImage = sharedPrepareImage;
  const nameFromFile = useCallback(sharedNameFromFile, []);

  const onFileRejected = useCallback(({ reason }) => {
    setPendingRejects((prev) => [...prev, {
      name: "That file",
      message: reason === "Maximum file size exceeded" ? TEN_MB_MESSAGE : "Use a PNG, JPG or WebP image.",
      requestId: null,
    }]);
  }, []);

  const handleUpload = useCallback(async (files) => {
    const rejects = pendingRejects;
    setPendingRejects([]);
    if (isCoach) {
      setUploadErrors(rejects);
      return;
    }
    setUploading(true);
    const failures = [...rejects];
    for (const file of files ?? []) {
      try {
        const prepared = await prepareImage(file);
        await request("/api/items/images", {
          method: "POST",
          body: {
            name: nameFromFile(file),
            dataBase64: prepared.dataBase64,
            contentType: prepared.contentType,
            width: prepared.width,
            height: prepared.height,
          },
        });
      } catch (err) {
        failures.push({
          name: file?.name ?? "That file",
          message: err instanceof ApiError ? err.message : String(err?.message ?? err),
          requestId: err instanceof ApiError ? err.requestId : null,
        });
      }
    }
    setUploadErrors(failures);
    setUploading(false);
    await load();
    onRefetch?.();
  }, [pendingRejects, isCoach, nameFromFile, load, onRefetch]);

  const runDelete = useCallback(async (row) => {
    setDeletingId(row.id);
    setDeleteErrors((prev) => ({ ...prev, [row.id]: null }));
    try {
      await request("/api/items/images/delete", { method: "POST", body: { id: row.id } });
      await load();
      onRefetch?.();
    } catch (err) {
      setDeleteErrors((prev) => ({
        ...prev,
        [row.id]: err instanceof ApiError
          ? { message: err.message, requestId: err.requestId }
          : { message: String(err?.message ?? err) },
      }));
    } finally {
      setDeletingId(null);
    }
  }, [load, onRefetch]);

  // CSV export
  const toCsv = useCallback((list) => {
    const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const headers = ["Name", "Used", "Size (KB)", "Width", "Height"];
    const lines = [headers.map(escape).join(",")];
    for (const r of list) {
      lines.push([
        r.name,
        usageLine(r),
        r.bytes != null ? Math.round(r.bytes / 1024) : "",
        r.width ?? "",
        r.height ?? "",
      ].map(escape).join(","));
    }
    return lines.join("\r\n");
  }, [usageLine]);

  const downloadCsv = useCallback((list) => {
    const blob = new Blob([toCsv(list)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "images.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [toCsv]);

  const exportFiltered = useCallback((key) => {
    if (key !== "csv") return;
    downloadCsv(filtered);
  }, [filtered, downloadCsv]);

  // Load on mount
  useEffect(() => {
    load();
  }, [load]);

  // Check for "upload=1" query param on mount
  useEffect(() => {
    if (typeof window === "undefined" || isCoach) return;
    const qp = new URLSearchParams(window.location.search);
    if (qp.get("upload") === "1") {
      openFilePicker();
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }
  }, [isCoach, openFilePicker]);

  if (isCoach) {
    return (
      <ImageLibraryPageItemsImagesTable
        onNavigate={onNavigate}
        isCoach={isCoach}
        phase={phase}
        error={error}
        filtered={filtered}
        uploadErrors={uploadErrors}
        usageLine={usageLine}
        deleteErrors={deleteErrors}
        deletingId={deletingId}
        runDelete={runDelete}
        displayPhase={displayPhase}
        summaryText={summaryText}
        emptyBlock={emptyBlock()}
        clearFilters={clearFilters}
        search={search}
        onSearchChange={setSearch}
        usedFilter={usedFilter}
        onUsedFilterChange={setUsedFilter}
        sizeSort={sizeSort}
        onSizeSortChange={setSizeSort}
        showControls={showControls}
        exportFiltered={exportFiltered}
        uploading={uploading}
      />
    );
  }

  return (
    <FileDropZone.Root
      id={UPLOAD_INPUT_ID}
      accept={ACCEPT_IMAGE}
      maxFileSize={10 * 1000 * 1000}
      disabled={uploading}
      onUpload={handleUpload}
      onFileRejected={onFileRejected}
    >
      <ImageLibraryPageItemsImagesTable
        onNavigate={onNavigate}
        isCoach={isCoach}
        phase={phase}
        error={error}
        filtered={filtered}
        uploadErrors={uploadErrors}
        usageLine={usageLine}
        deleteErrors={deleteErrors}
        deletingId={deletingId}
        runDelete={runDelete}
        displayPhase={displayPhase}
        summaryText={summaryText}
        emptyBlock={emptyBlock()}
        clearFilters={clearFilters}
        search={search}
        onSearchChange={setSearch}
        usedFilter={usedFilter}
        onUsedFilterChange={setUsedFilter}
        sizeSort={sizeSort}
        onSizeSortChange={setSizeSort}
        showControls={showControls}
        exportFiltered={exportFiltered}
        openFilePicker={openFilePicker}
        uploading={uploading}
      />
      <FileDropZone.DragOverlay>
        <span>Drop images here to upload</span>
      </FileDropZone.DragOverlay>
    </FileDropZone.Root>
  );
}
