// PLATFORM'S OWN BOOKING PAGES — a service (frame 10), a person (frame 11) or a custom page (frame 17's /book/p/<slug>), and the
// phone layout (frame 14). One form, four native dropdowns: How, Who with (only when the visitor may choose), Day, Time; then Name,
// Email, Phone and an optional note. ★ "Anyone available" is the default and the server assigns the person atomically under its
// rule. ★ A taken time (409) keeps every typed detail and reopens Time. ★ The idempotency key is minted once per attempt and
// reused on a retry after a network failure; it is dropped on a definitive answer.
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/lib/components/ui/button";
import { Input } from "@/lib/components/ui/input";
import { Textarea } from "@/lib/components/ui/textarea";
import { Skeleton } from "@/lib/components/ui/skeleton";
import { formatValue } from "@/lib/format.js";
import { bookApi, BookError, botToken, newKey } from "@/lib/booking/public/api.js";
import { addDays, attributionFromLocation, dateInZone, modalitiesText, modalityLabel, noticeText, timeLabel, visitorZone, zoneLine } from "@/lib/booking/public/format.js";
import PublicShell, { ContactLinks, Notice } from "./PublicShell.jsx";
import { DayTimeFields, Field, Select } from "./fields.jsx";
import BookedPage from "./BookedPage.jsx";

const FIELD_FOR = { startsAt: "time", modality: "modality", name: "name", email: "email", phone: "phone", message: "message", host: "host" };
const priceText = (s) => (!s || s.free || !s.priceMinor ? "Free" : formatValue(s.priceMinor, "money", { currency: s.currency }));
const summaryOf = (s) => [s?.durationMinutes ? `${s.durationMinutes} minutes` : null, priceText(s), modalitiesText(s?.modalities)].filter(Boolean).join(" · ");

export default function BookingPage({ data }) {
  const { view, practice, address } = data;
  const person = view === "person" ? address.person : null;
  const customPage = view === "page" ? address.page : null;
  const services = view === "service" ? [address.service] : view === "person" ? address.services ?? [] : customPage?.services ?? [];
  const fixedHost = person?.slug ?? null;
  const pageSlug = customPage?.slug ?? null;
  const anyoneAllowed = customPage ? customPage.anyone !== false : true;
  const visitorTz = useMemo(visitorZone, []);

  const [serviceKey, setServiceKey] = useState(services.length === 1 ? services[0].key : "");
  const [detail, setDetail] = useState(view === "service" ? address : null);
  const [detailError, setDetailError] = useState(false);
  const [modality, setModality] = useState("");
  const [host, setHost] = useState("any");
  const [days, setDays] = useState([]);
  const [slots, setSlots] = useState([]);
  const [slotsState, setSlotsState] = useState("idle"); // idle | loading | ready | error
  const [nonce, setNonce] = useState(0);
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState(null);
  const [slotNote, setSlotNote] = useState(null);
  const [booked, setBooked] = useState(null);
  const keyRef = useRef(null);
  const timeRef = useRef(null);
  const topRef = useRef(null);

  const service = services.find((s) => s.key === serviceKey) ?? null;
  const practiceTz = detail?.timeZone ?? "America/Los_Angeles";
  const contact = practice?.contact ?? null;
  useEffect(() => { document.title = `${person ? `Book with ${person.name}` : customPage ? customPage.name : service ? `Book ${service.name}` : "Book a session"}${practice?.name ? ` · ${practice.name}` : ""}`; }, [person, customPage, service, practice?.name]);

  // The chosen service's own facts (who can be chosen, the zone, the notice). The page's own service came with the address.
  useEffect(() => {
    if (!serviceKey) { setDetail(null); return undefined; }
    if (view === "service") { setDetail(address); return undefined; }
    let live = true;
    setDetail(null); setDetailError(false);
    bookApi.service(serviceKey, pageSlug).then((d) => { if (live) setDetail(d); }).catch(() => { if (live) setDetailError(true); });
    return () => { live = false; };
  }, [serviceKey, view, pageSlug, address]);

  // New service: start the choices over (the typed details stay).
  useEffect(() => {
    const modes = service?.modalities ?? [];
    setModality(modes.length === 1 ? modes[0] : "");
    setHost(anyoneAllowed ? "any" : "");
    setDay(""); setTime(""); setErrors((e) => ({ ...e, modality: undefined, day: undefined, time: undefined })); setSlotNote(null);
  }, [serviceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const choosing = !fixedHost && detail?.hostChoice && (detail.hosts ?? []).length > 0;
  useEffect(() => {
    if (choosing && !anyoneAllowed && !host && detail.hosts[0]) setHost(detail.hosts[0].slug);
  }, [choosing, anyoneAllowed, host, detail]);

  // The free times: today through the booking window, for this service and (if chosen) this person.
  useEffect(() => {
    if (!serviceKey || !detail || detail.unavailable) { setDays([]); setSlots([]); setSlotsState("idle"); return undefined; }
    let live = true;
    const tz = detail.timeZone ?? "America/Los_Angeles";
    const from = dateInZone(new Date().toISOString(), tz);
    const to = addDays(from, Math.min(Number(detail.windowDays) || 30, 61));
    const hostParam = fixedHost ?? (choosing && host && host !== "any" ? host : undefined);
    setSlotsState("loading");
    bookApi.slots({ service: serviceKey, from, to, host: hostParam, page: pageSlug }).then((r) => {
      if (!live) return;
      const list = r.slots ?? [];
      setSlots(list); setDays(r.days ?? []); setSlotsState(r.unavailable ? "idle" : "ready");
      setDay((d) => (d && list.some((s) => dateInZone(s.startsAt, tz) === d) ? d : ""));
      setTime((t) => (t && list.some((s) => s.startsAt === t) ? t : ""));
    }).catch(() => { if (live) { setSlots([]); setDays([]); setSlotsState("error"); } });
    return () => { live = false; };
  }, [serviceKey, detail, host, fixedHost, choosing, pageSlug, nonce]);

  const notice = noticeText(detail?.noticeMinutes);
  const unavailable = serviceKey && detail?.unavailable;
  const noTimes = slotsState === "ready" && slots.length === 0;

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const errs = {};
    if (!modality) errs.modality = "Choose how you'd like to meet.";
    if (!day) errs.day = "Choose a day.";
    if (day && !time) errs.time = "Choose a time.";
    if (!name.trim()) errs.name = "Enter your name.";
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) errs.email = "Enter a valid email address.";
    if (phone.replace(/\D/g, "").length < 7) errs.phone = "Enter a phone number we can reach you on.";
    setErrors(errs); setBanner(null); setSlotNote(null);
    const first = Object.keys(errs)[0];
    if (first) { document.getElementById(`bk-${first}`)?.focus(); return; }
    setBusy(true);
    const key = (keyRef.current ??= newKey());
    const body = {
      service: serviceKey, startsAt: time, modality, name: name.trim(), email: email.trim(), phone: phone.trim(),
      message: message.trim() || undefined, inviteeTimezone: visitorTz, idempotencyKey: key, website,
      ...(fixedHost ? { host: fixedHost } : choosing && host && host !== "any" ? { host } : {}),
      ...(pageSlug ? { page: pageSlug } : {}), attribution: attributionFromLocation(),
    };
    try {
      let res;
      try { res = await bookApi.team({ ...body, turnstileToken: await botToken() }); }
      catch (err) { if (err instanceof BookError && err.code === "turnstile") res = await bookApi.team({ ...body, turnstileToken: await botToken() }); else throw err; }
      keyRef.current = null;
      setBooked(res);
    } catch (err) {
      if (err instanceof BookError && err.status === 409 && err.kind === "slot_taken") {
        keyRef.current = null;
        setSlotNote(`Someone just took ${timeLabel(time, visitorTz, practiceTz)}. Pick another time and your details stay as you typed them.`);
        setTime(""); setNonce((n) => n + 1);
        setTimeout(() => { timeRef.current?.focus(); try { timeRef.current?.showPicker?.(); } catch { /* needs a gesture on some browsers */ } }, 0);
      } else if (err instanceof BookError && err.status === 400 && err.fields) {
        keyRef.current = null;
        const mapped = {};
        for (const [k, v] of Object.entries(err.fields)) mapped[FIELD_FOR[k] ?? "form"] = String(v);
        setErrors(mapped);
        if (mapped.form) setBanner(mapped.form);
      } else {
        setBanner(err instanceof BookError && err.status === 429
          ? "That's a lot of tries in a row. Wait a minute and try again."
          : `We couldn't book that. Try again${contact?.phone ? `, or call ${contact.phone}` : ""}.`);
      }
    } finally { setBusy(false); }
  };

  useEffect(() => { if (booked) topRef.current?.scrollIntoView?.({ block: "start" }); }, [booked]);

  const title = person ? `Book with ${person.name}` : customPage ? customPage.name : service ? `Book ${service.name}` : "Book a session";
  let body;
  if (booked) {
    body = <BookedPage result={booked} visitorTz={visitorTz} noticeMinutes={detail?.noticeMinutes} onBookAnother={() => { setBooked(null); setTime(""); setNonce((n) => n + 1); }} />;
  } else if (services.length === 0) {
    body = <Notice testId="book-nothing"><span>{person ? `${person.firstName || person.name} has nothing to book online right now.` : "Nothing is available to book online right now."} Contact the practice directly.</span><ContactLinks contact={contact} /></Notice>;
  } else {
    body = (
      <form onSubmit={submit} noValidate className="flex flex-col gap-5 max-sm:pb-20" data-testid="book-form">
        {services.length > 1 || view === "person" ? (
          <Field id="bk-service" label="What would you like to book?">
            <Select id="bk-service" value={serviceKey} onChange={setServiceKey} testId="book-service">
              <option value="">Choose a service</option>
              {services.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
            </Select>
          </Field>
        ) : null}
        {serviceKey && !detail && !detailError ? <Skeleton className="h-24 w-full rounded-card" data-testid="book-loading" /> : null}
        {detailError ? <Notice tone="bad" testId="book-detail-error">We couldn't load that. Try again in a moment.</Notice> : null}
        {unavailable ? (
          <Notice testId="book-unavailable"><span>Not available online right now. Contact the practice.</span><ContactLinks contact={contact} /></Notice>
        ) : serviceKey && detail ? (noTimes ? (
          <Notice testId="book-no-times"><span>No open times in the next {Number(detail.windowDays) || 30} days. Contact {practice?.name || "the practice"} to find a time.</span><ContactLinks contact={contact} /></Notice>
        ) : (
          <>
            {slotNote ? <div className="rounded-sm border border-line bg-brand-soft px-3 py-2.5 text-control text-ink" role="status" data-testid="book-slot-taken">{slotNote}</div> : null}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="bk-modality" label="How would you like to meet?" error={errors.modality}>
                <Select id="bk-modality" value={modality} onChange={setModality} invalid={!!errors.modality} testId="book-how">
                  <option value="">Choose how</option>
                  {(service?.modalities ?? []).map((m) => <option key={m} value={m}>{modalityLabel(m)}</option>)}
                </Select>
              </Field>
              {choosing ? (
                <Field id="bk-host" label="Who with?">
                  <Select id="bk-host" value={host} onChange={(v) => { setHost(v); setDay(""); setTime(""); }} testId="book-who">
                    {anyoneAllowed ? <option value="any">Anyone available</option> : null}
                    {detail.hosts.map((h) => <option key={h.slug} value={h.slug}>{h.name}</option>)}
                  </Select>
                </Field>
              ) : null}
              <DayTimeFields ref={timeRef} idPrefix="bk" days={days} slots={slots} practiceTz={practiceTz} visitorTz={visitorTz} day={day} time={time}
                onDay={(v) => { setDay(v); setTime(""); setSlotNote(null); }} onTime={setTime} loading={slotsState === "loading"} errors={errors} />
            </div>
            {slotsState === "error" ? <p className="m-0 text-control text-bad" role="alert" data-testid="book-slots-error">We couldn't load times. <button type="button" className="text-brand hover:underline" onClick={() => setNonce((n) => n + 1)}>Try again</button></p> : null}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="bk-name" label="Your name" error={errors.name}><Input id="bk-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={200} placeholder="Full name" aria-invalid={errors.name ? true : undefined} data-testid="book-name" /></Field>
              <Field id="bk-email" label="Email" error={errors.email}><Input id="bk-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={320} placeholder="name@example.com" aria-invalid={errors.email ? true : undefined} data-testid="book-email" /></Field>
              <Field id="bk-phone" label="Phone" error={errors.phone} className="sm:col-span-2"><Input id="bk-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" maxLength={30} placeholder="(555) 555-5555" aria-invalid={errors.phone ? true : undefined} data-testid="book-phone" /></Field>
            </div>
            <Field id="bk-message" label="Anything we should know? (optional)" error={errors.message}><Textarea id="bk-message" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} rows={3} data-testid="book-message" /></Field>
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Website<input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label></div>
            {banner ? <div className="rounded-sm border border-bad-border bg-bad-bg px-3 py-2 text-control text-bad" role="alert" data-testid="book-error">{banner}</div> : null}
            <div className="max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-10 max-sm:border-t max-sm:border-line max-sm:bg-surface max-sm:p-3" data-testid="book-submit-bar">
              <Button type="submit" size="lg" disabled={busy} className="w-full sm:w-auto sm:px-9" data-testid="book-submit">{busy ? "Booking…" : "Book"}</Button>
            </div>
            <p className="m-0 text-caption text-mute" data-testid="book-zone-line">{zoneLine(visitorTz, practiceTz)}{notice ? ` You can change or cancel from your email, up to ${notice} before.` : ""}</p>
          </>
        )) : null}
      </form>
    );
  }

  return (
    <PublicShell practice={practice} testId="book-page" fixedBar={!!booked || services.length > 0}>
      <div ref={topRef} className="flex flex-col gap-1.5">
        {booked ? null : (
          <>
            <a href="/book" className="text-control text-brand no-underline hover:underline" data-testid="book-back">← All bookings</a>
            <h1 className="m-0 text-page-title font-medium text-ink" data-testid="book-title">{title}</h1>
            {view === "service" ? <p className="m-0 text-body text-ink-2" data-testid="book-summary">{summaryOf(address.service)}</p>
              : service ? <p className="m-0 text-body text-ink-2" data-testid="book-summary">{summaryOf(service)}</p>
              : person && services.length > 0 ? <p className="m-0 text-body text-ink-2">Pick what you'd like, then a day and time.</p> : null}
          </>
        )}
      </div>
      {body}
    </PublicShell>
  );
}
