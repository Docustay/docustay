import { BulkHeadCell, BulkRowCell, RowMenuHeadCell, RowMenuCell } from "@/lib/lists/BulkCells.jsx";

export default function BookingLinksScreenTable1Table({
  bulk = null,
  links = [],
  options = {},
  copiedId = null,
  scopeText = () => "—",
  openEdit = () => {},
  archive = () => {},
  copy = () => {},
}) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <BulkHeadCell bulk={bulk} rows={links} />
          <th className="h-9 px-4 text-left text-xs font-medium text-mute border-b border-line bg-surface-sunken">
            Name
          </th>
          <th className="h-9 px-4 text-left text-xs font-medium text-mute border-b border-line bg-surface-sunken">
            Link
          </th>
          <th className="h-9 px-4 text-left text-xs font-medium text-mute border-b border-line bg-surface-sunken">
            Offers
          </th>
          <th className="h-9 px-4 text-left text-xs font-medium text-mute border-b border-line bg-surface-sunken">
            Staff
          </th>
          <th className="h-9 px-4 text-left text-xs font-medium text-mute border-b border-line bg-surface-sunken">
            Where
          </th>
          <th className="h-9 px-4 text-left text-xs font-medium text-mute border-b border-line bg-surface-sunken">
            Status
          </th>
          <th className="h-9 px-4 text-left text-xs font-medium text-mute border-b border-line bg-surface-sunken"></th>
          <RowMenuHeadCell bulk={bulk} />
        </tr>
      </thead>
      <tbody>
        {links.map((link) => (
          <tr key={link.id} data-testid="booking-links-row">
            <BulkRowCell bulk={bulk} id={link.id} />
            <td className="h-10 px-4 border-b border-hair-soft text-sm">
              <button
                type="button"
                className="bg-none border-0 p-0 font: inherit font-medium text-ink cursor-pointer text-left"
                onClick={() => openEdit(link)}
              >
                {link.name}
              </button>
            </td>
            <td className="h-10 px-4 border-b border-hair-soft text-sm">
              <span className="text-mute">
                {link.url ?? `/book/l/${link.slug}`}
              </span>
              {link.url && (
                <button
                  type="button"
                  className="bg-none border-0 p-0 text-primary font: inherit text-xs font-normal cursor-pointer ml-2"
                  onClick={() => copy(link)}
                >
                  {copiedId === link.id ? "Copied" : "Copy"}
                </button>
              )}
            </td>
            <td className="h-10 px-4 border-b border-hair-soft text-sm">
              {scopeText(link.categoryIds, options.categories, "Everything public")}
            </td>
            <td className="h-10 px-4 border-b border-hair-soft text-sm">
              {scopeText(link.staffIds, options.staff, "Everyone")}
            </td>
            <td className="h-10 px-4 border-b border-hair-soft text-sm">
              {scopeText(link.locationIds, options.locations, "Everywhere")}
            </td>
            <td className="h-10 px-4 border-b border-hair-soft text-sm">
              <span
                className={`inline-flex items-center h-[21px] px-[9px] rounded-sm text-xs font-medium ${
                  link.active
                    ? "bg-chip-ok-bg text-chip-ok-ink"
                    : "bg-chip-neutral-bg text-chip-neutral-ink"
                }`}
              >
                {link.active ? "Live" : "Off"}
              </span>
            </td>
            <td className="h-10 px-4 border-b border-hair-soft text-sm text-right whitespace-nowrap">
              <button
                type="button"
                className="bg-none border-0 p-0 text-primary font: inherit text-xs font-normal cursor-pointer"
                onClick={() => openEdit(link)}
              >
                Edit
              </button>
              <button
                type="button"
                className="bg-none border-0 p-0 text-primary font: inherit text-xs font-normal cursor-pointer ml-2"
                onClick={() => archive(link)}
              >
                Archive
              </button>
            </td>
            <RowMenuCell bulk={bulk} row={link} actions={[]} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}
