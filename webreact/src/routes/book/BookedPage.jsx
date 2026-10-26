// PLATFORM'S OWN BOOKING PAGES — "You're booked." (plan frame 6 / 7 in the platform's look): When, How, With, the two calendar
// buttons, the change line, and What happens next. `result` is the 201 from POST /api/public/book/team.
import { useState } from "react";
import { Button, buttonVariants } from "@/lib/components/ui/button";
import { whenLong, modalityLabel, noticeText } from "@/lib/booking/public/format.js";

const Row = ({ label, children, testId }) => (
  <div className="flex gap-4 py-2.5 text-body" data-testid={testId}>
    <span className="w-16 shrink-0 text-mute">{label}</span><span className="min-w-0 text-ink">{children}</span>
  </div>
);

export default function BookedPage({ result, visitorTz, noticeMinutes, onBookAnother }) {
  const [calOpen, setCalOpen] = useState(false);
  const b = result.booking;
  const notice = noticeText(noticeMinutes);
  const who = b.host?.firstName || b.host?.name || "Your host";
  return (
    <div className="flex flex-col gap-6 pb-10 max-sm:pb-20" data-testid="book-booked">
      <div>
        <h1 className="m-0 text-page-title font-medium text-ink" data-testid="book-booked-title">You're booked.</h1>
        <p className="mt-2 mb-0 text-body text-ink-2">{b.service?.name}{b.reference ? <span className="text-mute"> · Reference {b.reference}</span> : null}</p>
      </div>
      <div className="flex flex-col divide-y divide-hair rounded-card border border-line px-5 py-1.5">
        <Row label="When" testId="booked-when">{whenLong(b.startsAt, visitorTz)}</Row>
        <Row label="How" testId="booked-how">{modalityLabel(b.modality)}</Row>
        {b.host?.name ? <Row label="With" testId="booked-with">{b.host.name}</Row> : null}
      </div>
      <div className="flex flex-col gap-2.5 max-sm:hidden sm:flex-row" data-testid="booked-calendar-inline">
        {result.calendar?.googleUrl ? <a className={buttonVariants({ variant: "default" })} href={result.calendar.googleUrl} target="_blank" rel="noreferrer" data-testid="booked-google">Add to Google Calendar</a> : null}
        {result.calendar?.icsUrl ? <a className={buttonVariants({ variant: "outline" })} href={result.calendar.icsUrl} data-testid="booked-ics">Apple or Outlook calendar</a> : null}
      </div>
      {result.calendar?.googleUrl || result.calendar?.icsUrl ? (
        <div className="fixed inset-x-0 bottom-0 z-10 flex flex-col gap-2 border-t border-line bg-surface p-3 sm:hidden" data-testid="booked-calendar-bar">
          {calOpen ? (
            <div className="flex flex-col gap-2" data-testid="booked-calendar-choice">
              {result.calendar?.googleUrl ? <a className={buttonVariants({ variant: "outline" })} href={result.calendar.googleUrl} target="_blank" rel="noreferrer" data-testid="booked-google-phone">Google Calendar</a> : null}
              {result.calendar?.icsUrl ? <a className={buttonVariants({ variant: "outline" })} href={result.calendar.icsUrl} data-testid="booked-ics-phone">Apple or Outlook calendar</a> : null}
            </div>
          ) : null}
          <Button type="button" size="lg" className="w-full" aria-expanded={calOpen} onClick={() => setCalOpen((o) => !o)} data-testid="booked-add-calendar">Add to my calendar</Button>
        </div>
      ) : null}
      <p className="m-0 text-control text-ink-2" data-testid="booked-change">
        Need to change it? Use the links in your email{notice ? `, up to ${notice} before` : ""}.
        {result.manageUrl ? <> <a className="text-brand hover:underline" href={result.manageUrl} data-testid="booked-manage">Change or cancel</a></> : null}
      </p>
      <div className="flex flex-col gap-3" data-testid="booked-next">
        <h2 className="m-0 text-modal-title font-semibold text-ink">What happens next</h2>
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {[
            ["You get a confirmation", "By email right now, with a calendar file and links to change or cancel."],
            // the day-before reminder is never sent late: a booking less than a day ahead gets none, so none is promised
            ...(b.startsAt && new Date(b.startsAt).getTime() - Date.now() > 86400000 ? [["We remind you", "One email the day before."]] : []),
            // plan frame 6 step 3 ("A an example organisation coach talks with you (thirty minutes, no pressure to sign up)"), for any practice
            [`${who} talks with you`, `${b.durationMinutes ? `${b.durationMinutes} minutes` : "At the time you chose"}, no pressure to sign up.`],
          ].map(([title, text], i) => (
            <li key={title} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-pill bg-brand-soft text-caption font-semibold text-brand">{i + 1}</span>
              <span className="text-body text-ink"><b className="font-medium">{title}.</b> <span className="text-ink-2">{text}</span></span>
            </li>
          ))}
        </ol>
      </div>
      {onBookAnother ? <button type="button" className="self-start text-control text-brand hover:underline" onClick={onBookAnother}>Book another time</button> : null}
    </div>
  );
}
