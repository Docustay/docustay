import { LedgerPage } from "@/lib/components/kit/archetypes/index.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { Card, CardContent } from "@/lib/components/ui/card.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";

export default function ImageLibraryPageItemsImagesTable({
  onNavigate,
  isCoach,
  phase,
  error,
  filtered,
  uploadErrors,
  usageLine,
  deleteErrors,
  deletingId,
  runDelete,
  displayPhase,
  summaryText,
  emptyBlock,
  clearFilters,
  search,
  onSearchChange,
  usedFilter,
  onUsedFilterChange,
  sizeSort,
  onSizeSortChange,
  showControls,
  exportFiltered,
  openFilePicker,
  uploading,
}) {
  return (
    <LedgerPage
      title="Images"
      summary={summaryText}
      primary={isCoach ? null : { label: "Upload", onClick: openFilePicker, disabled: uploading }}
      testId="items-images"
    >
      <ScreenState
        phase={displayPhase}
        error={displayPhase === "error" ? error : null}
        reason={displayPhase === "denied" ? (error?.message ?? null) : null}
        empty={emptyBlock}
        onClearFilters={clearFilters}
        onNavigate={onNavigate}
      >
        {showControls && (
          <div className="mb-3.5 flex flex-wrap items-center gap-2" data-testid="items-images-controls">
            <Input
              placeholder="Search"
              className="min-w-[200px] max-w-[280px]"
              data-testid="items-images-search"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
            <NativeSelect
              value={usedFilter}
              onChange={(e) => onUsedFilterChange(e.target.value)}
              data-testid="items-images-filter-used"
            >
              <NativeSelectOption value="all">Used: Anywhere</NativeSelectOption>
              <NativeSelectOption value="used">Used somewhere</NativeSelectOption>
              <NativeSelectOption value="unused">Not used</NativeSelectOption>
            </NativeSelect>
            <NativeSelect
              value={sizeSort}
              onChange={(e) => onSizeSortChange(e.target.value)}
              data-testid="items-images-filter-size"
            >
              <NativeSelectOption value="none">Size: Default order</NativeSelectOption>
              <NativeSelectOption value="largest">Size: Largest first</NativeSelectOption>
              <NativeSelectOption value="smallest">Size: Smallest first</NativeSelectOption>
            </NativeSelect>
            <div className="flex-1" />
            {/* Export menu would go here */}
          </div>
        )}

        {uploadErrors.length > 0 && (
          <div className="mb-4 flex flex-col gap-3" data-testid="items-images-upload-errors">
            {uploadErrors.map((e, i) => (
              <div
                key={i}
                className="flex gap-2.5 items-start bg-bad-soft text-bad-ink border border-bad-border rounded-lg p-3 text-xs leading-relaxed"
                role="alert"
              >
                <span aria-hidden="true" className="flex-shrink-0">!</span>
                <span>
                  <b>{e.name}</b> — {e.message}{e.requestId ? ` (ref ${e.requestId})` : ""}
                </span>
              </div>
            ))}
          </div>
        )}

        <div
          className="gap-4"
          data-testid="items-images-grid"
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))" }}
        >
          {filtered.map((row) => (
            <Card key={row.id} className="border-line" data-testid={`items-images-tile-${row.id}`}>
              <img
                src={`/api/items/images/${row.id}/raw`}
                alt={row.name}
                loading="lazy"
                className="block w-full h-[110px] object-cover bg-surface-sunken"
                data-testid={`items-images-thumb-${row.id}`}
              />
              <CardContent className="flex flex-col gap-0.75 pt-4">
                <b
                  className="font-medium text-ink overflow-wrap-break-word"
                  data-testid={`items-images-name-${row.id}`}
                  title={row.name}
                >
                  {row.name}
                </b>
                <span className="text-xs text-ink-muted" data-testid={`items-images-usage-${row.id}`}>
                  {usageLine(row)}
                </span>
                {!isCoach && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="self-start mt-1 px-0"
                    data-testid={`items-images-delete-${row.id}`}
                    disabled={deletingId === row.id}
                    onClick={() => runDelete(row)}
                  >
                    {deletingId === row.id ? "Deleting…" : "Delete"}
                  </Button>
                )}
                {deleteErrors[row.id] && (
                  <div
                    className="flex gap-2.5 items-start bg-bad-soft text-bad-ink border border-bad-border rounded-lg p-3 mt-2 text-xs leading-relaxed"
                    role="alert"
                    data-testid={`items-images-delete-error-${row.id}`}
                  >
                    <span aria-hidden="true" className="flex-shrink-0">!</span>
                    <span>
                      {deleteErrors[row.id].message}{deleteErrors[row.id].requestId
                        ? ` (ref ${deleteErrors[row.id].requestId})`
                        : ""}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </ScreenState>
    </LedgerPage>
  );
}
