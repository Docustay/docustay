// The sign-in / sign-up page frame (the maintainer's ruling, 28 Sep 2026 — replaces the earlier two-column,
// dark-aside frame described in R3.018/AuthPanel.svelte).
//
// ★★★ ALL WHITE. No split screen, no dark panel down one side — a clean, technical-looking
//     sign-in page, full stop. No tagline: the platform is for small businesses generally and the
//     page does not need one for either audience.
// ★ `app.{domain}` (no tenant — `brand` is null): the the platform wordmark. A practice's own
//   subdomain: ITS logo/name, already working via `/api/auth/branding` — untouched here, only
//   the frame around it changed.
// ★ Motion (motion.dev, MIT), respecting the platform's own reduced-motion preference via
//   `useReducedMotion()` — the same content, no movement, when the viewer has turned animation
//   off. Keeps every existing testid (TESTID-CONTRACT, the harness reads them).
import { motion, useReducedMotion, AnimatePresence } from "motion/react";
import { PRODUCT_NAME } from "@/lib/auth/product.js";
import WorkbenchMark from "@/lib/auth/WorkbenchMark.jsx";

export default function AuthPanel({ brand = null, children, panelKey = null }) {
  const reduceMotion = useReducedMotion();
  const isTenant = Boolean(brand?.displayName);
  const title = isTenant ? brand.displayName : PRODUCT_NAME;

  const fadeUp = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] },
      };

  return (
    <div className="flex min-h-svh flex-col items-center bg-white px-6 py-12 lg:py-20">
      <motion.div className="flex w-full max-w-sm flex-col items-center gap-3" {...fadeUp} data-testid="auth-brand-panel">
        {isTenant && brand?.logoUrl ? (
          <img src={brand.logoUrl} alt={brand.displayName} data-testid="auth-brand-logo" className="h-10 w-auto max-w-56 object-contain" />
        ) : !isTenant ? (
          // ★ the maintainer, 28 Sep 2026 — THE REAL PLATFORM LOGO, not a text wordmark. Same "interlock" mark
          //   the marketing site uses (~/workbench-site's own Logo.svelte); the raster exports live
          //   under the old codename, ~/example-rebuild/brand/keystone-mark-*.png — same logo.
          <WorkbenchMark className="h-10 w-10" data-testid="auth-brand-logo" />
        ) : null}
        {/* ★ The the platform wordmark (no tenant) or the practice's own name (a tenant, alongside its
            logo above when it has one) — ONE prominent line either way, never both a wordmark
            AND a repeated name for the same audience. */}
        <p className={isTenant ? "m-0 text-control font-medium text-ink-2" : "m-0 text-empty-title font-semibold tracking-tight text-ink"} data-testid="auth-brand-name">{title}</p>
      </motion.div>
      {/* ★ AnimatePresence + a `panelKey` gives every stage change (email → practice picker →
          password/code → handoff/loading → error) its own enter/exit transition, per the maintainer's "good
          animated transitions throughout" — a caller that never sets panelKey still animates once
          on mount and never again, so this stays a no-op for screens that don't opt in. */}
      <AnimatePresence mode="wait" initial={!reduceMotion}>
        <motion.main
          key={panelKey ?? "static"}
          className="mt-10 w-full max-w-sm"
          initial={reduceMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? {} : { opacity: 0, y: -6 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        >
          {children}
        </motion.main>
      </AnimatePresence>
    </div>
  );
}
