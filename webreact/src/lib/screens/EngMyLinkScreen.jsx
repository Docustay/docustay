import { useState, useEffect } from "react";
import { api, ApiError } from "@/lib/api.js";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { Badge } from "@/lib/components/ui/badge.jsx";
import { Avatar, AvatarFallback } from "@/lib/components/ui/avatar.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

export default function EngMyLinkScreen({
  view = null,
  displayName = null,
  role = null,
  appUserId = null,
  onNavigate = null,
  onDone = null,
}) {
  const slug = view?.slug ?? null;
  const url = view?.url ?? null;
  const domain = view?.domain ?? null;
  const acceptingNewBookings = view?.acceptingNewBookings ?? true;
  const taggedLinks = view?.taggedLinks ?? [];

  const [slugDraft, setSlugDraft] = useState(slug ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [copied, setCopied] = useState(false);
  const [taggingOpen, setTaggingOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState("");

  // Resync slug draft whenever view changes
  useEffect(() => {
    setSlugDraft(view?.slug ?? "");
  }, [view?.slug]);

  const initials = (() => {
    const words = String(displayName ?? "").trim().split(/\s+/).filter(Boolean);
    return words
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "") || "?";
  })();

  function goto(e, href) {
    e?.preventDefault?.();
    onNavigate?.(href);
  }

  async function saveSlug() {
    const next = slugDraft.trim().toLowerCase();
    if (!next || next === slug) {
      setSlugDraft(slug ?? "");
      return;
    }
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.updateMyLink({ slug: next });
      onDone?.();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : String(err?.message ?? err);
      setProblem(msg);
      setSlugDraft(slug ?? "");
    } finally {
      setBusy(false);
    }
  }

  function onSlugKeydown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    }
  }

  async function toggleAccepting(next) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.updateMyLink({ acceptingNewBookings: next });
      onDone?.();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : String(err?.message ?? err);
      setProblem(msg);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      setProblem("Could not copy — copy it from the field instead.");
    }
  }

  async function copyTaggedLink() {
    const tag = tagDraft.trim();
    if (!url || !tag) return;
    try {
      await navigator.clipboard.writeText(
        `${url}?src=${encodeURIComponent(tag)}`
      );
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      setProblem("Could not copy — copy it from the field instead.");
    }
  }

  return (
    <div
      className="flex flex-col max-w-[920px]"
      data-testid="mylink-page"
    >
      {/* Breadcrumb */}
      <p className="m-0 text-xs text-muted-foreground">
        <a
          href="/settings"
          onClick={(e) => goto(e, "/settings")}
          className="text-primary no-underline hover:underline"
        >
          My settings
        </a>{" "}
        › Booking link
      </p>

      {/* Title */}
      <h1 className="m-0 mt-1 text-2xl font-medium -tracking-[0.01em]">
        My booking link
      </h1>
      <p className="m-0 mt-1.5 mb-4 text-sm text-muted-foreground">
        Share it anywhere. Times come from your hours and your Google Busy blocks.
      </p>

      {/* Error message */}
      {problem && (
        <p
          className="m-0 mb-4 text-sm text-destructive max-w-[68ch]"
          data-testid="mylink-problem"
          role="alert"
        >
          {problem}
        </p>
      )}

      {/* ═══ Link Section ═════════════════════════════════════════════════════════════════════ */}
      <section
        className="grid grid-cols-[240px_minmax(0,1fr)] gap-8 py-6 px-0 border-t border-line max-sm:grid-cols-1 max-sm:gap-2.5"
        data-testid="mylink-section-link"
      >
        <div className="flex flex-col gap-1 min-w-0">
          <h2 className="m-0 text-sm font-semibold text-foreground">Link</h2>
          <p className="m-0 text-xs text-muted-foreground">
            Old links keep working if you change it.
          </p>
        </div>

        <div className="flex flex-col gap-3 max-w-[480px] min-w-0">
          <label className="flex flex-col gap-1" htmlFor="mylink-slug-input">
            <span className="text-xs font-medium">Your link</span>
            <div className="flex items-stretch">
              <span
                className="flex items-center px-2.5 border border-r-0 border-line-strong rounded-l-sm bg-surface-sunken text-muted-foreground font-normal text-xs overflow-hidden text-ellipsis whitespace-nowrap"
                data-testid="mylink-prefix"
              >
                {domain ? `${domain}/book/` : "…/book/"}
              </span>
              <input
                id="mylink-slug-input"
                className="flex-grow min-w-0 px-3 py-2 border border-line-strong border-l-0 rounded-r-sm bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
                type="text"
                data-testid="mylink-slug-input"
                value={slugDraft}
                onChange={(e) => setSlugDraft(e.target.value)}
                disabled={busy}
                placeholder="your-name"
                onBlur={saveSlug}
                onKeyDown={onSlugKeydown}
              />
            </div>
          </label>

          {slug ? (
            <span
              className="text-xs text-[var(--color-signer-parent-ink)] mt-0.5"
              data-testid="mylink-slug-owned"
            >
              {slug} is yours.
            </span>
          ) : (
            <span
              className="text-xs text-muted-foreground"
              data-testid="mylink-slug-empty"
            >
              Set a link to start sharing it.
            </span>
          )}

          <div className="flex gap-2 mt-0.5 flex-wrap">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="mylink-copy"
              disabled={!url}
              onClick={copyLink}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="mylink-qr"
              disabled
              title="Not available yet — no QR generator is built yet"
            >
              QR code
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="mylink-embed"
              disabled
              title="Not available yet — no embed snippet is built yet"
            >
              Embed on a website
            </Button>
          </div>
        </div>
      </section>

      {/* ═══ Taking Bookings Section ═════════════════════════════════════════════════════ */}
      <section
        className="grid grid-cols-[240px_minmax(0,1fr)] gap-8 py-6 px-0 border-t border-line max-sm:grid-cols-1 max-sm:gap-2.5"
        data-testid="mylink-section-accepting"
      >
        <div className="flex flex-col gap-1 min-w-0">
          <h2 className="m-0 text-sm font-semibold text-foreground">
            Taking bookings
          </h2>
          <p className="m-0 text-xs text-muted-foreground">
            Switch off when you're full.
          </p>
        </div>

        <div className="flex flex-col gap-3 max-w-[480px] min-w-0">
          <div className="flex items-center gap-4 py-3.5 px-0">
            <span className="flex flex-col flex-grow gap-0.5">
              <span className="text-sm">Accept new bookings from my link</span>
              <span className="text-xs text-muted-foreground">
                When off, the link shows the practice page instead
              </span>
            </span>
            <Switch
              checked={acceptingNewBookings}
              disabled={busy}
              aria-label="Accept new bookings from my link"
              data-testid="mylink-accepting-toggle"
              onCheckedChange={toggleAccepting}
            />
          </div>
        </div>
      </section>

      {/* ═══ How You Appear Section ═══════════════════════════════════════════════════════ */}
      <section
        className="grid grid-cols-[240px_minmax(0,1fr)] gap-8 py-6 px-0 border-t border-line max-sm:grid-cols-1 max-sm:gap-2.5"
        data-testid="mylink-section-appearance"
      >
        <div className="flex flex-col gap-1 min-w-0">
          <h2 className="m-0 text-sm font-semibold text-foreground">
            How you appear
          </h2>
          <p className="m-0 text-xs text-muted-foreground">From your profile.</p>
        </div>

        <div className="flex flex-col gap-3 max-w-[480px] min-w-0">
          <div className="flex gap-3.5 items-center p-3.5 border border-line rounded-sm max-sm:flex-wrap">
            <Avatar className="w-14 h-14 text-xs flex-shrink-0">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <span className="flex flex-col min-w-0 gap-0.5">
              <span
                className="text-sm font-semibold text-foreground overflow-hidden text-ellipsis whitespace-nowrap"
                data-testid="mylink-appear-name"
              >
                {displayName ?? "Your name"}
              </span>
              <span
                className="text-xs text-muted-foreground"
                data-testid="mylink-appear-role"
              >
                {role ?? "Staff"}
              </span>
            </span>
            {appUserId && (
              <a
                href={`/record/person/${appUserId}`}
                className="ml-auto text-xs text-primary no-underline whitespace-nowrap hover:underline max-sm:ml-0"
                data-testid="mylink-edit-profile"
                onClick={(e) => goto(e, `/record/person/${appUserId}`)}
              >
                Edit profile
              </a>
            )}
          </div>
        </div>
      </section>

      {/* ═══ Where Bookings Came From Section ═════════════════════════════════════════════ */}
      <section
        className="grid grid-cols-[240px_minmax(0,1fr)] gap-8 py-6 px-0 border-t border-line max-sm:grid-cols-1 max-sm:gap-2.5"
        data-testid="mylink-section-tags"
      >
        <div className="flex flex-col gap-1 min-w-0">
          <h2 className="m-0 text-sm font-semibold text-foreground">
            Where bookings came from
          </h2>
          <p className="m-0 text-xs text-muted-foreground">
            Add a tag to know which link worked.
          </p>
        </div>

        <div className="flex flex-col gap-3 max-w-[480px] min-w-0">
          {taggedLinks.length === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="mylink-tags-empty">
              No tagged links yet.
            </p>
          ) : (
            <div className="flex gap-2 flex-wrap" data-testid="mylink-tags-list">
              {taggedLinks.map((t) => (
                <Badge
                  key={t.tag}
                  className="max-w-[220px] overflow-hidden text-ellipsis bg-[var(--color-chip-neutral-bg)] text-[var(--color-chip-neutral-ink)] h-auto text-xs"
                  data-testid={`mylink-tag-${t.tag}`}
                  title={t.tag}
                >
                  {t.tag} · {t.bookingsCount}
                </Badge>
              ))}
            </div>
          )}

          {!taggingOpen ? (
            <button
              type="button"
              className="text-primary text-xs no-underline hover:underline disabled:text-muted-foreground disabled:cursor-default disabled:no-underline mt-2 w-fit"
              data-testid="mylink-make-tag-open"
              disabled={!url}
              onClick={() => {
                if (url) setTaggingOpen(true);
              }}
            >
              Make a tagged link
            </button>
          ) : (
            <div className="flex items-end gap-2 mt-2 flex-wrap" data-testid="mylink-make-tag-form">
              <label className="flex flex-col gap-1 flex-1 min-w-[200px]">
                <span className="text-xs font-medium">Tag</span>
                <input
                  id="mylink-tag-input"
                  className="px-3 py-2 border border-line-strong rounded-sm bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  type="text"
                  placeholder="instagram"
                  data-testid="mylink-tag-input"
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                />
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="mylink-tag-copy"
                disabled={!tagDraft.trim()}
                onClick={copyTaggedLink}
              >
                {copied ? "Copied" : "Copy tagged link"}
              </Button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
