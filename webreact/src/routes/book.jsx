// BOOK WITH US (R3.023, webui routes/book/+page.svelte) — the practice's public booking page, no account needed.
// `data` = { practice } | { problem } from the loader. `?serviceId=` turns it into the coach chooser for that service.
// ★ Named coaches appear ONLY when the practice chose `showStaffChoice` — the flag decides, never merely a non-empty
//   list; "Anyone" is the quickest free coach. ★ A service no coach can take renders a DISABLED control, never a dead
//   link. ★ A class's "places left" line is drawn only from a real seat count — never guessed.
import { useEffect, useState } from "react";
import { Skeleton } from "@/lib/components/ui/skeleton";
import { Button, buttonVariants } from "@/lib/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/lib/components/ui/avatar";
import { formatValue } from "@/lib/format.js";

export const initials = (name) => { const p = String(name ?? "").trim().split(/\s+/).filter(Boolean); return p.length === 0 ? "?" : (p[0][0] + (p[1]?.[0] ?? "")).toUpperCase(); };
function formatNext(iso) {
  if (!iso) return null;
  const d = new Date(iso); const now = new Date();
  const sod = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diff = Math.round((sod(d) - sod(now)) / 86_400_000);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (diff === 0) return `today ${time}`;
  if (diff === 1) return `tomorrow ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
}
const priceLabel = (s) => (!s ? "" : s.paymentMode === "free" || s.priceMinor == null ? "Free" : formatValue(s.priceMinor, "money", { currency: s.currency }));
function classNote(s) {
  const nc = s?.nextClass;
  if (!nc || typeof nc.placesLeft !== "number") return null;
  return `${nc.placesLeft} place${nc.placesLeft === 1 ? "" : "s"} left on ${new Date(nc.startsAt).toLocaleDateString(undefined, { day: "numeric", month: "long" })}`;
}
/** An anchor that looks like a button, or a disabled button when there is nowhere to go. */
const LinkButton = ({ href, children, testId, variant = "default" }) => (href
  ? <a className={buttonVariants({ variant })} href={href} data-testid={testId}>{children}</a>
  : <Button variant={variant} disabled data-testid={testId}>{children}</Button>);
const Card = ({ className = "", testId, children, ...rest }) => <div className={`rounded-card border border-line bg-surface ${className}`} data-testid={testId} {...rest}>{children}</div>;
const Muted = ({ children, testId }) => <p className="m-0 text-control text-mute" data-testid={testId}>{children}</p>;

export default function BookPage({ data }) {
  const practice = data?.practice ?? null;
  const [serviceIdParam, setServiceIdParam] = useState(null);
  useEffect(() => { setServiceIdParam(new URLSearchParams(window.location.search).get("serviceId")); }, []);
  useEffect(() => { document.title = `Book a session${practice?.name ? ` · ${practice.name}` : ""}`; }, [practice?.name]);
  const chosen = serviceIdParam ? (practice?.services ?? []).find((s) => s.id === serviceIdParam) ?? null : null;
  const accepting = (practice?.coaches ?? []).filter((c) => c.acceptingNewBookings && c.firstAvailable);
  const anyone = accepting.length ? accepting.reduce((b, c) => (c.firstAvailable < b.firstAvailable ? c : b)) : null;
  const findTimeHref = (s) => ((practice?.coaches ?? []).length === 0 ? null : `/book?serviceId=${encodeURIComponent(s.id)}`);
  const seeTimes = (coach) => `/book/${encodeURIComponent(coach.bookingSlug)}?serviceId=${encodeURIComponent(chosen.id)}`;

  if (data?.problem) {
    return <div className="flex min-h-dvh flex-col bg-surface" data-testid="eng-public-practice"><div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 px-6 text-center" data-testid="public-practice-problem" role="alert"><h1 className="m-0 text-page-title font-medium text-ink">This page isn't available.</h1><Muted>Check the link, or contact the practice directly.</Muted></div></div>;
  }
  if (!practice) {
    return (
      <div className="flex min-h-dvh flex-col bg-surface" data-testid="eng-public-practice">
        <div className="flex items-center gap-3 border-b border-line px-12 py-4.5" data-testid="public-practice-loading"><Skeleton className="size-10 rounded-bulk" /><Skeleton className="h-5 w-48" /></div>
        <div className="flex flex-col gap-6 px-12 py-10"><Skeleton className="h-9 w-96" /><div className="flex flex-col gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-card" />)}</div></div>
      </div>
    );
  }
  return (
    // ★ the maintainer, 29 Sep 2026 — FOUND LIVE alongside the identical sign.jsx defect: `min-h-dvh` on a page
    //   whose services/coaches list is unbounded (a practice can publish any number of either), with
    //   no internal scroll region, under theme.css's global `overflow: hidden` on body. Bounded to
    //   `h-dvh` with the avatar bar as a fixed header and everything else in its own
    //   `flex-1 overflow-y-auto` region, the same shape sign.jsx now uses.
    <div className="flex h-dvh flex-col bg-surface" data-testid="eng-public-practice">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-line px-12 py-4.5">
        <Avatar className="size-10 rounded-bulk bg-brand" data-testid="practice-mark">
          {practice.logoUrl ? <AvatarImage src={practice.logoUrl} alt="" className="rounded-bulk object-cover" /> : null}
          <AvatarFallback className="rounded-bulk bg-brand font-semibold text-white">{initials(practice.name)}</AvatarFallback>
        </Avatar>
        <span className="grow text-empty-title font-semibold text-ink" data-testid="practice-name">{practice.name ?? "This practice"}</span>
        <a className={buttonVariants({ variant: "outline" })} href="/login">Already a client? Sign in</a>
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto">
      {chosen ? (
        <div className="flex flex-col gap-6 px-12 py-10" data-testid="coach-chooser">
          <a href="/book" className="text-control text-brand no-underline hover:underline">← Back to services</a>
          <div>
            <h1 className="m-0 text-page-title font-medium text-ink">Who would you like to see?</h1>
            <p className="mt-2 mb-0 text-body text-ink-2">{chosen.name}, {chosen.durationMinutes} minutes, {priceLabel(chosen)}. Any of them can take it.</p>
          </div>
          {(practice.coaches ?? []).length === 0 ? (
            <Card className="p-6 text-center" testId="chooser-unreachable"><Muted>Online booking with a specific coach isn't set up for this yet. Contact the practice directly.</Muted></Card>
          ) : (
            <Card className="flex flex-col divide-y divide-hair px-4 py-1.5" testId="chooser-coaches">
              {anyone ? (
                <div className="flex items-center gap-3 py-3.5" data-testid="chooser-anyone">
                  <Avatar className="border border-line"><AvatarFallback>☆</AvatarFallback></Avatar>
                  <div className="grow"><span className="block text-field font-medium text-ink">Anyone</span><span className="block text-control text-mute">Whoever has a time that suits you. Usually the quickest way in.</span></div>
                  <LinkButton href={seeTimes(anyone)}>See times</LinkButton>
                </div>
              ) : null}
              {practice.showStaffChoice ? practice.coaches.map((coach) => (
                <div key={coach.id} className="flex items-center gap-3 py-3.5" data-testid="chooser-coach-row" data-accepting={coach.acceptingNewBookings}>
                  <Avatar className="border border-line">{coach.photoUrl ? <AvatarImage src={coach.photoUrl} alt="" className="object-cover" /> : null}<AvatarFallback>{initials(coach.displayName)}</AvatarFallback></Avatar>
                  <div className="min-w-0 grow">
                    <span className="block text-field font-medium text-ink">{coach.displayName}</span>
                    {coach.bio ? <span className="block truncate text-control text-mute">{String(coach.bio).split("\n")[0]}</span> : null}
                    {coach.acceptingNewBookings && coach.firstAvailable ? <span className="block text-control text-signer-parent-ink">Next free: {formatNext(coach.firstAvailable)}</span>
                      : !coach.acceptingNewBookings ? <span className="block text-control text-mute">Not taking new clients</span> : null}
                  </div>
                  <LinkButton href={coach.acceptingNewBookings ? seeTimes(coach) : null}>See times</LinkButton>
                </div>
              )) : null}
            </Card>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-6 px-12 py-10">
          <div>
            <h1 className="m-0 text-figure-md font-medium text-ink">Book with us</h1>
            <p className="mt-2 mb-0 max-w-[62ch] text-body text-ink-2">Pick what you'd like, then a time. You don't need an account, and nothing is charged until you've been.</p>
          </div>
          {(practice.services ?? []).length === 0 ? (
            <Card className="p-8 text-center" testId="public-practice-empty"><Muted>This practice hasn't published anything to book online yet. Contact them directly.</Muted></Card>
          ) : (
            <div className="flex flex-col gap-3" data-testid="public-practice-services">
              {practice.services.map((service) => (
                <Card key={service.id} className="flex items-center gap-4 p-5" testId="public-service-row">
                  <div className="grow">
                    <span className="block text-body font-medium text-ink">{service.name}</span>
                    <span className="mt-1.5 block text-caption text-mute">{service.durationMinutes} minutes</span>
                    {classNote(service) ? <span className="mt-1 block text-caption text-mute" data-testid="service-class-note">{classNote(service)}</span> : null}
                  </div>
                  <div className="flex flex-col items-end gap-2.5">
                    <span className="text-figure-sm font-normal text-ink" data-testid="service-price">{priceLabel(service)}</span>
                    <LinkButton href={findTimeHref(service)} testId="service-find-time">Find a time</LinkButton>
                  </div>
                </Card>
              ))}
            </div>
          )}
          {practice.policySentence ? <p className="m-0 max-w-[62ch] text-control text-mute" data-testid="practice-policy-sentence"><b className="font-medium text-ink">Before you book.</b> {practice.policySentence}</p> : null}
        </div>
      )}
      <div className="mt-auto px-12 py-3.5 text-caption text-mute">Booking by Workbench</div>
      </div>
    </div>
  );
}
