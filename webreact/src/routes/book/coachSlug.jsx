// BOOK WITH ONE COACH (R3.022, webui routes/book/[coachSlug]/+page.svelte) — pick a day, a time, give a name and an
// email; no account. `data` = { coach, coachSlug, confirmed, srcTag } | { problem } from the loader (which follows a
// moved link itself). Times are shown in the coach's zone and SAY so.
// ★ This page IS the confirmation surface: after booking, `?confirmed=<id>` is written into the URL (replaceState) so a
//   reload still shows it. ★ Booking for someone under 18 is refused here with a sentence — not available on this page.
// ★ The server's own message and requestId on a refusal, never a rewrite. The booking goes through performWrite
//   (route kind `public` — no session needed, still the one write path).
// ★ Fix carried over (27 Sep): the Svelte cleared the chosen time in an effect with no dependency, so it never cleared
//   on a new day; here it clears when the day changes, which is what its comment said it did.
import { Suspense, useEffect, useState } from "react";
import { ApiError } from "@/lib/api.js";
import { performWrite } from "@/lib/permissions/write.js";
import { Button, buttonVariants } from "@/lib/components/ui/button";
import { Input } from "@/lib/components/ui/input";
import { Label } from "@/lib/components/ui/label";
import { Checkbox } from "@/lib/components/ui/checkbox";
import { Skeleton } from "@/lib/components/ui/skeleton";
import { Avatar, AvatarImage, AvatarFallback } from "@/lib/components/ui/avatar";
import Figure from "@/lib/components/kit/Figure.jsx";
import { fileComponent } from "@/lib/app/lazyScreens.js";
import { cn } from "@/lib/utils";

const BookingConfirmation = fileComponent("lib/screens/engagements/BookingConfirmation.jsx");
const PAYMENT_LABEL = { free: "free", card_on_file: "card on file", deposit: "deposit required", pay_in_full: "pay in full" };
const dateKey = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const Card = ({ className = "", testId, children }) => <div className={`rounded-card border border-line bg-surface ${className}`} data-testid={testId}>{children}</div>;

export default function BookCoachPage({ data }) {
  const result = data?.coach ?? null;
  const tz = result?.timezoneDefault ?? "UTC";
  const groups = (() => {
    const by = new Map();
    for (const t of result?.availableTimes ?? []) { const k = dateKey(t.startsAt); if (!by.has(k)) by.set(k, []); by.get(k).push(t.startsAt); }
    return [...by.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, slots]) => ({ key, date: new Date(slots[0]), slots }));
  })();
  const [dayKey, setDayKey] = useState(null);
  const [slot, setSlot] = useState(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [brings, setBrings] = useState("");
  const [forMinor, setForMinor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);
  const [bookedId, setBookedId] = useState(data?.confirmed ?? null);
  const activeDay = dayKey ?? groups[0]?.key ?? null;
  const group = groups.find((g) => g.key === activeDay) ?? null;
  useEffect(() => { document.title = `Book with ${result?.coach?.displayName ?? "a coach"}`; }, [result?.coach?.displayName]);
  useEffect(() => { setSlot(null); }, [activeDay]);

  const fmt = (iso, o) => new Date(iso).toLocaleDateString(undefined, { ...o, timeZone: tz });
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz });
  const fmtLong = (iso) => `${fmt(iso, { weekday: "long", day: "numeric", month: "long" })}, ${fmtTime(iso)}`;

  const submit = async (e) => {
    e.preventDefault();
    if (busy || !slot || !result?.service) return;
    if (forMinor) { setFormError({ message: "Booking for someone under 18 isn't available on this page yet. Please contact the practice directly." }); return; }
    setBusy(true); setFormError(null);
    try {
      const res = await performWrite(null, "publicBookSubmit", [{ coachSlug: data.coachSlug, serviceId: result.service.id, startsAt: slot, name: name.trim(), email: email.trim(), phone: phone.trim(), whatBringsYou: brings.trim() || undefined, forMinor: false, srcTag: data?.srcTag ?? undefined }]);
      setBookedId(res.bookingId);
      const url = new URL(window.location.href); url.searchParams.set("confirmed", res.bookingId); window.history.replaceState({}, "", url);
    } catch (err) { setFormError({ message: err instanceof ApiError ? err.message : String(err?.message ?? err), requestId: err instanceof ApiError ? err.requestId : null }); }
    finally { setBusy(false); }
  };

  // ★ the maintainer, 29 Sep 2026 — same defect as sign.jsx and book.jsx: `min-h-dvh` with no internal scroll
  //   region, on a page whose date/time pills plus the booking form routinely exceed a phone screen
  //   (this page is single-column below `lg`, so ALL of it stacks: coach card, both pill rows, then
  //   the full form). `h-dvh` here; the real-content return below adds its own
  //   `flex-1 overflow-y-auto` region under the fixed header, same shape as the other two fixes.
  const shell = (inner) => <div className="flex h-dvh flex-col bg-surface" data-testid="eng-public-coach">{inner}</div>;
  if (data?.problem) return shell(<div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 px-6 text-center" data-testid="public-coach-problem" role="alert"><h1 className="m-0 text-page-title font-medium text-ink">This page isn't available.</h1><p className="m-0 text-control text-mute">Check the link, or contact the practice directly.</p></div>);
  if (!result) return shell(<><div className="flex items-center gap-3 border-b border-line px-12 py-4.5" data-testid="public-coach-loading"><Skeleton className="size-10 rounded-bulk" /><Skeleton className="h-5 w-48" /></div><div className="grid grid-cols-1 gap-10 px-12 py-9 lg:grid-cols-[20rem_minmax(0,1fr)]"><Skeleton className="h-64" /><Skeleton className="h-96" /></div></>);
  const initial = (result.coach.displayName ?? "?").slice(0, 1).toUpperCase();
  const svc = result.service;
  return shell(
    <>
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-line px-12 py-4.5">
        <Avatar className="size-10 rounded-bulk bg-brand"><AvatarFallback className="rounded-bulk bg-brand font-semibold text-white">{initial}</AvatarFallback></Avatar>
        <span className="grow text-empty-title font-semibold text-ink">Book a session</span>
        <a className={buttonVariants({ variant: "outline" })} href="/login">Already a client? Sign in</a>
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="grid grid-cols-1 gap-10 px-12 py-9 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <Avatar className="size-22 border border-line">{result.coach.photoUrl ? <AvatarImage src={result.coach.photoUrl} alt="" className="object-cover" /> : null}<AvatarFallback className="text-caption">{initial}</AvatarFallback></Avatar>
          <h1 className="m-0 text-page-title font-medium text-ink" data-testid="coach-name">{result.coach.displayName}</h1>
          {result.coach.bio ? <p className="m-0 text-body text-ink-2">{result.coach.bio}</p> : null}
          {svc ? (
            <Card className="flex flex-col gap-1 p-3.5" testId="coach-service">
              <span className="text-body font-semibold text-ink">{svc.name}</span>
              <span className="text-control text-mute">{svc.durationMinutes} min{svc.paymentMode === "free" || svc.priceMinor == null ? " · free" : ""}{svc.paymentMode !== "free" ? ` · ${PAYMENT_LABEL[svc.paymentMode] ?? svc.paymentMode}` : ""}</span>
            </Card>
          ) : null}
        </div>
        <div className="flex flex-col gap-4.5">
          {bookedId ? (
            <Suspense fallback={null}><BookingConfirmation startsAt={slot} timezone={tz} coachName={result.coach.displayName} email={email} paymentMode={svc?.paymentMode ?? null} /></Suspense>
          ) : !result.bookable ? (
            <Card className="p-8 text-center" testId="coach-not-bookable"><p className="m-0 text-control text-mute">Not taking new clients right now.</p></Card>
          ) : (
            <>
              <div className="flex items-baseline justify-between"><h2 className="m-0 text-modal-title font-semibold text-ink">Pick a time</h2><span className="text-meta text-mute">Times shown in {tz}</span></div>
              {groups.length === 0 ? (
                <p className="m-0 rounded-card border border-line px-5 py-8 text-center text-control text-mute" data-testid="coach-no-times">No times available in the next {svc?.windowDays ?? 14} days. Contact the practice directly.</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2" data-testid="date-pills">
                    {groups.map((g) => {
                      const on = g.key === activeDay;
                      return (
                        <button type="button" key={g.key} onClick={() => setDayKey(g.key)} data-testid="date-pill" data-selected={on}
                          className={cn("flex flex-col items-center gap-0.5 rounded-card border px-3.5 py-2.5", on ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink")}>
                          <span className="text-caption">{fmt(g.date, { weekday: "short" })}</span>
                          <Figure size="sm">{fmt(g.date, { day: "numeric" })}</Figure>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap gap-2" data-testid="time-pills">
                    {(group?.slots ?? []).map((s) => (
                      <button type="button" key={s} onClick={() => setSlot(s)} data-testid="time-pill" data-selected={s === slot}
                        className={cn("rounded-pill border px-4 py-2.5 text-body", s === slot ? "border-brand bg-brand-soft font-medium text-brand" : "border-line text-ink")}>{fmtTime(s)}</button>
                    ))}
                  </div>
                  {slot ? (
                    <form onSubmit={submit} noValidate className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5" data-testid="public-booking-form">
                      <span className="text-body font-semibold text-ink">{fmtLong(slot)}</span>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="flex flex-col gap-1.5"><Label htmlFor="pb-name">Your name</Label><Input id="pb-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} placeholder="Full name" data-testid="pb-name" /></div>
                        <div className="flex flex-col gap-1.5"><Label htmlFor="pb-email">Email</Label><Input id="pb-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={320} placeholder="name@example.com" data-testid="pb-email" /></div>
                        <div className="flex flex-col gap-1.5"><Label htmlFor="pb-phone">Phone</Label><Input id="pb-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required maxLength={30} placeholder="(555) 555-5555" data-testid="pb-phone" /></div>
                      </div>
                      <div className="flex flex-col gap-1.5"><Label htmlFor="pb-brings">What brings you to coaching? (optional)</Label><Input id="pb-brings" value={brings} onChange={(e) => setBrings(e.target.value)} maxLength={500} placeholder="A sentence is plenty" data-testid="pb-brings" /></div>
                      <div className="flex items-center gap-2.5 text-control"><Checkbox id="pb-minor" checked={forMinor} onCheckedChange={(c) => setForMinor(!!c)} data-testid="pb-minor" /><Label htmlFor="pb-minor">I'm booking for someone under 18</Label></div>
                      {formError ? (
                        <div className="rounded-sm border border-bad-border bg-bad-bg px-3 py-2 text-meta text-bad" role="alert" data-testid="pb-error">
                          {formError.message}
                          {formError.requestId ? <span className="block text-caption opacity-80" data-testid="pb-error-request-id">Reference: {formError.requestId}</span> : null}
                        </div>
                      ) : null}
                      <Button type="submit" disabled={busy} size="lg" className="self-start px-7" data-testid="pb-submit">{busy ? "Booking…" : "Book my call"}</Button>
                      <span className="text-caption text-mute">Protected against spam bookings.</span>
                    </form>
                  ) : null}
                </>
              )}
            </>
          )}
        </div>
      </div>
      <div className="mt-auto px-12 py-3.5 text-caption text-mute">Booking by Workbench</div>
      </div>
    </>
  );
}
