// PLATFORM'S OWN BOOKING PAGES — change or cancel from the email link (plan frame 8 in the platform's look), /book/manage?t=<token>.
// The link authorises exactly one booking. ★ The server decides what is still allowed: outside the notice window the page offers
// New day / New time and Move, and Cancel (one confirm); inside it, the practice's phone; bad, expired, cancelled or started, the
// "can't be changed online anymore" sentence. ★ Idempotency keys live in refs and are dropped on a definitive answer.
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, buttonVariants } from "@/lib/components/ui/button";
import { bookApi, BookError, botToken, newKey } from "@/lib/booking/public/api.js";
import { addDays, dateInZone, modalityLabel, noticeText, timeLabel, visitorZone, whenLong, zoneLine } from "@/lib/booking/public/format.js";
import PublicShell, { Notice } from "./PublicShell.jsx";
import { DayTimeFields } from "./fields.jsx";

const Row = ({ label, children, testId }) => (
  <div className="flex gap-4 py-2.5 text-body" data-testid={testId}><span className="w-16 shrink-0 text-mute">{label}</span><span className="min-w-0 text-ink">{children}</span></div>
);
const digits = (p) => String(p ?? "").replace(/[^+\d]/g, "");

function CallText({ phone }) {
  if (!phone) return null;
  return (
    <div className="flex flex-wrap justify-center gap-2" data-testid="manage-call-text">
      <a className={buttonVariants({ variant: "outline" })} href={`tel:${digits(phone)}`}>Call</a>
      <a className={buttonVariants({ variant: "outline" })} href={`sms:${digits(phone)}`}>Text</a>
    </div>
  );
}

export default function ManagePage({ data }) {
  const { practice, token } = data;
  const [view, setView] = useState(data.manage ?? null);
  const [outcome, setOutcome] = useState(null); // null | "moved" | "cancelled"
  const visitorTz = useMemo(visitorZone, []);
  const booking = view?.booking ?? null;
  const practiceTz = booking?.timeZone ?? "America/Los_Angeles";
  const phone = view?.contact?.phone ?? practice?.contact?.phone ?? null;
  const [days, setDays] = useState([]);
  const [slots, setSlots] = useState([]);
  const [slotsState, setSlotsState] = useState("idle");
  const [nonce, setNonce] = useState(0);
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(null); // "move" | "cancel"
  // the email's Cancel button links here with &do=cancel: open straight on the one confirm (frame 20)
  const [confirming, setConfirming] = useState(() => typeof location !== "undefined" && new URLSearchParams(location.search).get("do") === "cancel");
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);
  const moveKey = useRef(null); const cancelKey = useRef(null); const timeRef = useRef(null);

  const canChange = !!view?.canChange && !outcome;
  useEffect(() => { document.title = `Change your booking${practice?.name ? ` · ${practice.name}` : ""}`; }, [practice?.name]);

  useEffect(() => {
    if (!canChange || !token) return undefined;
    let live = true;
    const from = dateInZone(new Date().toISOString(), practiceTz);
    setSlotsState("loading");
    bookApi.manageSlots({ token, from, to: addDays(from, 30) }).then((r) => {
      if (!live) return;
      const list = r.slots ?? [];
      setSlots(list); setDays(r.days ?? []); setSlotsState("ready");
      setDay((d) => (d && list.some((s) => dateInZone(s.startsAt, practiceTz) === d) ? d : ""));
      setTime((t) => (t && list.some((s) => s.startsAt === t) ? t : ""));
    }).catch((err) => {
      if (!live) return;
      if (err instanceof BookError && err.status === 409) setView((v) => ({ ...v, canChange: false, reason: err.code ?? "closed" }));
      else setSlotsState("error");
    });
    return () => { live = false; };
  }, [canChange, token, practiceTz, nonce]);

  const refused = (err) => {
    if (err instanceof BookError && err.status === 409 && err.code) { setView((v) => ({ ...v, canChange: false, reason: err.code })); return true; }
    if (err instanceof BookError && err.status === 404) { setView(null); return true; }
    return false;
  };

  const move = async () => {
    if (busy || !time) return;
    setBusy("move"); setError(null); setNote(null);
    const idempotencyKey = (moveKey.current ??= newKey());
    try {
      const res = await bookApi.manageMove({ token, startsAt: time, idempotencyKey, turnstileToken: await botToken() });
      moveKey.current = null;
      setView((v) => ({ ...v, booking: res.booking })); setOutcome("moved");
    } catch (err) {
      if (err instanceof BookError && err.status === 409 && err.kind === "slot_taken") {
        moveKey.current = null;
        setNote(`Someone just took ${timeLabel(time, visitorTz, practiceTz)}. Pick another time.`);
        setTime(""); setNonce((n) => n + 1);
        setTimeout(() => { timeRef.current?.focus(); try { timeRef.current?.showPicker?.(); } catch { /* needs a gesture */ } }, 0);
      } else if (refused(err)) moveKey.current = null;
      else setError(`We couldn't move that. Try again${phone ? `, or call ${phone}` : ""}.`);
    } finally { setBusy(null); }
  };
  const cancel = async () => {
    if (busy) return;
    setBusy("cancel"); setError(null);
    const idempotencyKey = (cancelKey.current ??= newKey());
    try {
      const res = await bookApi.manageCancel({ token, idempotencyKey, turnstileToken: await botToken() });
      cancelKey.current = null;
      setView((v) => ({ ...v, booking: res.booking })); setOutcome("cancelled"); setConfirming(false);
    } catch (err) {
      if (refused(err)) { cancelKey.current = null; setConfirming(false); }
      else setError(`We couldn't cancel that. Try again${phone ? `, or call ${phone}` : ""}.`);
    } finally { setBusy(null); }
  };

  let body;
  if (!view || !booking) {
    body = (
      <>
        <h1 className="m-0 text-page-title font-medium text-ink" data-testid="manage-closed">This booking can't be changed online anymore.</h1>
        <Notice testId="manage-closed-help"><span>{phone ? `Call or text us at ${phone}.` : "Contact the practice directly."}</span><CallText phone={phone} /></Notice>
      </>
    );
  } else {
    const notice = noticeText(view.noticeMinutes);
    const name = booking.service?.name ?? "booking";
    const done = outcome === "cancelled" || booking.state === "cancelled";
    body = (
      <>
        <div>
          <h1 className="m-0 text-page-title font-medium text-ink" data-testid="manage-title">
            {outcome === "moved" ? "Your booking is moved." : done ? "Your booking is cancelled." : canChange ? `Change your ${name}` : `Your ${name}`}
          </h1>
          {outcome === "moved" ? <p className="mt-2 mb-0 text-body text-ink-2">We've sent you a new confirmation by email.</p> : null}
          {outcome === "cancelled" ? <p className="mt-2 mb-0 text-body text-ink-2">We've sent you a confirmation by email.</p> : null}
        </div>
        <div className="flex flex-col divide-y divide-hair rounded-card border border-line px-5 py-1.5" data-testid="manage-current">
          <Row label="When" testId="manage-when">{whenLong(booking.startsAt, visitorTz)}</Row>
          {booking.modality ? <Row label="How">{modalityLabel(booking.modality)}</Row> : null}
          {booking.host?.name ? <Row label="With">{booking.host.name}</Row> : null}
        </div>
        {outcome ? (
          <div className="flex flex-col gap-2.5 sm:flex-row">
            {outcome === "moved" && token ? <a className={buttonVariants({ variant: "default" })} href={`/api/public/book/ics?token=${encodeURIComponent(token)}`} data-testid="manage-ics">Add the new time to my calendar</a> : null}
            <a className={buttonVariants({ variant: "outline" })} href="/book" data-testid="manage-back">{done ? "Book a new time" : "Back to bookings"}</a>
          </div>
        ) : done ? (
          <a className={buttonVariants({ variant: "outline" })} href="/book" data-testid="manage-back">Book a new time</a>
        ) : ["started", "closed"].includes(view.reason) ? (
          <>
            <p className="m-0 text-body text-ink" data-testid="manage-closed">This booking can't be changed online anymore.</p>
            <CallText phone={phone} />
          </>
        ) : view.reason === "inside_notice" ? (
          <Notice testId="manage-inside-notice"><span>Changes online close {notice ?? "before the start"}{notice ? " before" : ""}. {phone ? `Call or text us at ${phone}.` : "Contact the practice directly."}</span><CallText phone={phone} /></Notice>
        ) : (
          <div className="flex flex-col gap-5 max-sm:pb-4" data-testid="manage-form">
            {note ? <div className="rounded-sm border border-line bg-brand-soft px-3 py-2.5 text-control text-ink" role="status" data-testid="manage-slot-taken">{note}</div> : null}
            {slotsState === "ready" && slots.length === 0 ? (
              <Notice testId="manage-no-times"><span>No other open times right now. {phone ? `Call or text us at ${phone}.` : "Contact the practice directly."}</span><CallText phone={phone} /></Notice>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <DayTimeFields ref={timeRef} idPrefix="mg" days={days} slots={slots} practiceTz={practiceTz} visitorTz={visitorTz} day={day} time={time}
                  onDay={(v) => { setDay(v); setTime(""); setNote(null); }} onTime={setTime} loading={slotsState === "loading"} dayLabelText="New day" timeLabelText="New time" />
              </div>
            )}
            {slotsState === "error" ? <p className="m-0 text-control text-bad" role="alert" data-testid="manage-slots-error">We couldn't load times. <button type="button" className="text-brand hover:underline" onClick={() => setNonce((n) => n + 1)}>Try again</button></p> : null}
            {error ? <div className="rounded-sm border border-bad-border bg-bad-bg px-3 py-2 text-control text-bad" role="alert" data-testid="manage-error">{error}</div> : null}
            <div className="flex flex-col gap-2.5 sm:flex-row">
              <Button type="button" size="lg" disabled={!time || !!busy} onClick={move} className="w-full sm:w-auto sm:px-7" data-testid="manage-move">{busy === "move" ? "Moving…" : "Move booking"}</Button>
              <Button type="button" size="lg" variant="outline" disabled={!!busy} onClick={() => setConfirming(true)} className="w-full sm:w-auto sm:px-7" data-testid="manage-cancel">Cancel booking</Button>
            </div>
            {confirming ? (
              <div className="flex flex-col gap-3 rounded-card border border-bad-border bg-bad-bg p-4" role="alertdialog" aria-labelledby="mg-confirm" data-testid="manage-confirm">
                <span id="mg-confirm" className="text-body font-medium text-ink">Cancel this booking?</span>
                <span className="text-control text-ink-2">{whenLong(booking.startsAt, visitorTz)}. You'll get an email to confirm it.</span>
                <div className="flex flex-col gap-2.5 sm:flex-row">
                  <Button type="button" disabled={!!busy} onClick={cancel} data-testid="manage-confirm-yes">{busy === "cancel" ? "Cancelling…" : "Yes, cancel it"}</Button>
                  <Button type="button" variant="outline" disabled={!!busy} onClick={() => setConfirming(false)} data-testid="manage-confirm-no">Keep it</Button>
                </div>
              </div>
            ) : null}
            <p className="m-0 text-caption text-mute">{zoneLine(visitorTz, practiceTz)}{notice ? ` You can change or cancel online up to ${notice} before.` : ""}{notice && phone ? ` After that, call or text ${phone}.` : ""}</p>
          </div>
        )}
      </>
    );
  }
  return <PublicShell practice={practice} testId="book-manage">{body}</PublicShell>;
}
