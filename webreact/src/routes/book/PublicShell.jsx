// PLATFORM'S OWN BOOKING PAGES — the shared frame (white page, Inter, periwinkle primary): the practice's mark and name,
// a sign-in link, one scrolling region, and "Booking by the platform". ★ Bounded to `h-dvh` with its own scroll region, the shape
// book.jsx and sign.jsx were fixed to on 29 Sep (theme.css puts `overflow: hidden` on body).
import { useEffect } from "react";
import { buttonVariants } from "@/lib/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/lib/components/ui/avatar";

export const initialsOf = (name) => { const p = String(name ?? "").trim().split(/\s+/).filter(Boolean); return p.length === 0 ? "?" : (p[0][0] + (p[1]?.[0] ?? "")).toUpperCase(); };

export default function PublicShell({ practice, testId = "public-book", children, narrow = true, fixedBar = false, title = null }) {
  const name = practice?.name ?? "";
  // pages that set their own tab title pass none; the not-available pages pass theirs (never a bare "the platform")
  useEffect(() => { if (title) document.title = name ? `${title} · ${name}` : title; }, [title, name]);
  return (
    <div className="flex h-dvh flex-col bg-surface" data-testid={testId}>
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-line px-5 py-4 sm:px-12 sm:py-4.5">
        {name ? (
          <Avatar className="size-10 rounded-bulk bg-brand" data-testid="practice-mark">
            {practice?.logoUrl ? <AvatarImage src={practice.logoUrl} alt="" className="rounded-bulk object-cover" /> : null}
            <AvatarFallback className="rounded-bulk bg-brand font-semibold text-white">{initialsOf(name)}</AvatarFallback>
          </Avatar>
        ) : null}
        <span className="min-w-0 grow line-clamp-2 break-words text-empty-title font-semibold leading-tight text-ink" data-testid="practice-name">{name}</span>
        <a className={buttonVariants({ variant: "outline" })} href={practice?.signInUrl || "/login"} data-testid="book-sign-in">Sign in</a>
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className={`flex w-full flex-col gap-6 px-5 py-8 sm:px-12 sm:py-10 ${narrow ? "mx-auto max-w-[40rem]" : ""}`}>{children}</div>
        <div className={`mt-auto px-5 py-3.5 text-caption text-mute sm:px-12 ${fixedBar ? "max-sm:pb-20" : ""}`}>Booking by Workbench</div>
      </div>
    </div>
  );
}

/** Email and Call buttons for "contact the practice directly". Missing details are left out, never rendered dead. */
export function ContactLinks({ contact, testId = "book-contact" }) {
  const email = contact?.email, phone = contact?.phone;
  if (!email && !phone) return null;
  return (
    <div className="flex flex-wrap justify-center gap-2" data-testid={testId}>
      {email ? <a className={buttonVariants({ variant: "outline" })} href={`mailto:${email}`}>Email</a> : null}
      {phone ? <a className={buttonVariants({ variant: "outline" })} href={`tel:${String(phone).replace(/[^+\d]/g, "")}`}>Call</a> : null}
    </div>
  );
}

export const Notice = ({ children, testId, tone = "plain" }) => (
  <div className={`flex flex-col items-center gap-3 rounded-card border px-6 py-8 text-center text-control ${tone === "bad" ? "border-bad-border bg-bad-bg text-bad" : "border-line text-mute"}`} data-testid={testId} role={tone === "bad" ? "alert" : undefined}>{children}</div>
);
