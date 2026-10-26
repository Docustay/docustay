// PLATFORM'S OWN BOOKING PAGES — the organization page /book (plan frame 9), and frame 12 when the practice is not set up.
// Frame 9: "Book with <name>", the public services (name, minutes, price, how, Book), "Or book with a coach" (only when the
// practice lets visitors choose), "Already a client? Sign in to book your sessions.", footer "Booking by the platform".
// Frame 12: "<name> isn't taking online bookings yet. Contact them directly to book." with Email and Call.
import { useEffect } from "react";
import { buttonVariants } from "@/lib/components/ui/button";
import { formatValue } from "@/lib/format.js";
import { modalitiesText } from "@/lib/booking/public/format.js";
import PublicShell, { ContactLinks } from "./PublicShell.jsx";

const priceText = (s) => (!s || s.free || !s.priceMinor ? "Free" : formatValue(s.priceMinor, "money", { currency: s.currency }));

export default function OrgPage({ practice }) {
  const name = practice.name ?? "this practice";
  const services = practice.bookableServices ?? [];
  const people = practice.showStaffChoice ? practice.people ?? [] : [];
  const closed = practice.notSetUp === true || services.length === 0;
  useEffect(() => { document.title = closed ? name : `Book with ${name}`; }, [closed, name]);

  if (closed) {
    return (
      <PublicShell practice={practice} testId="book-org-not-set-up">
        <div className="flex flex-col gap-4" data-testid="book-not-set-up">
          <h1 className="m-0 text-page-title font-medium text-ink">{name} isn't taking online bookings yet.</h1>
          <p className="m-0 text-body text-ink-2">Contact them directly to book.</p>
          <ContactLinks contact={practice.contact} />
          <p className="m-0 text-control text-mute">Already a client? <a className="text-brand hover:underline" href={practice.signInUrl || "/login"}>Sign in</a></p>
        </div>
      </PublicShell>
    );
  }
  return (
    <PublicShell practice={practice} testId="book-org">
      <h1 className="m-0 text-page-title font-medium text-ink" data-testid="book-org-title">Book with {name}</h1>
      <div className="flex flex-col gap-3" data-testid="book-org-services">
        {services.map((s) => {
          const detail = [`${s.durationMinutes} minutes`, priceText(s), modalitiesText(s.modalities)].filter(Boolean).join(", ");
          return (
            <div key={s.key ?? s.id} className="flex items-center gap-4 rounded-card border border-line bg-surface p-4 sm:p-5" data-testid="book-org-service">
              <div className="min-w-0 grow">
                <span className="block text-body font-medium text-ink">{s.name}</span>
                <span className="mt-1 block text-caption text-mute">{detail}</span>
              </div>
              {s.path ? <a className={buttonVariants({ variant: "default" })} href={s.path} data-testid="book-org-book">Book</a> : <span className="text-caption text-mute">Not available online</span>}
            </div>
          );
        })}
      </div>
      {people.length ? (
        <div className="flex flex-col gap-3" data-testid="book-org-people">
          <h2 className="m-0 text-modal-title font-semibold text-ink">Or book with a coach</h2>
          <div className="flex flex-wrap gap-2">
            {people.map((p) => <a key={p.slug} className={buttonVariants({ variant: "outline" })} href={p.path ?? `/book/${p.slug}`} data-testid="book-org-person">{p.name}</a>)}
          </div>
        </div>
      ) : null}
      <p className="m-0 text-control text-ink-2" data-testid="book-org-sign-in">Already a client? <a className="text-brand hover:underline" href={practice.signInUrl || "/login"}>Sign in</a> to book your sessions.</p>
    </PublicShell>
  );
}
