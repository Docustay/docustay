// PLATFORM'S OWN BOOKING PAGES — the practice has switched online booking OFF (F36). Not "this page isn't available": the
// link is fine, the practice is just not taking bookings here right now. `practice` = { name, phone } from the server's
// `booking_closed` refusal (src/routes/public.mjs closedRefusal); a missing phone leaves out the Call button, never a dead one.
import PublicShell, { ContactLinks, Notice } from "./PublicShell.jsx";

export default function ClosedPage({ practice }) {
  const name = practice?.name || "This practice";
  const contact = practice?.phone ? { phone: practice.phone } : null;
  return (
    <PublicShell practice={practice ?? null} testId="book-closed" title="Not taking bookings online">
      <div className="flex flex-col items-center gap-4 py-12 text-center" data-testid="book-closed-message">
        <h1 className="m-0 text-page-title font-medium text-ink">{name} isn't taking bookings online right now.</h1>
        <Notice testId="book-closed-contact"><span>{contact ? "To book, get in touch with them directly." : "To book, contact them directly."}</span><ContactLinks contact={contact} /></Notice>
      </div>
    </PublicShell>
  );
}
