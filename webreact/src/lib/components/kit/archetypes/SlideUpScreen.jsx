// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SlideUpScreen — the shared surface for Accounts, Clients, Money and Services create/edit screens
// (the maintainer's ruling, specs/de-code/SLIDEUP-AUDIT.md, 28 Sep 2026): a FULL SCREEN that slides up from the
// bottom — like Square's New invoice — never a side panel, never a separate page. Short confirms are
// unaffected: they stay centred boxes (DecisionModal etc.), this is only for the big editors.
//
// ★ Pure overlay + animation shell. It owns the fixed positioning, covering the WHOLE viewport
//   (sidebar included) and the slide transition, and nothing else — the "X top-left, title centred,
//   actions top-right" header is the CHILD's own job (EditorHeader.jsx, now centred — see that
//   file's own note).
// ★ the maintainer, 29 Sep 2026 — rebuilt on Motion (motion.dev, MIT, already a dependency — same library
//   AuthPanel.jsx already uses, same useReducedMotion()/AnimatePresence conventions):
//   · ENTER: a gentle spring, not a fixed-duration tween — feels like something with weight sliding
//     up, not a CSS transition snapping between two states.
//   · EXIT: `onClose` is NOT called the instant something asks to close. `requestClose()` — handed
//     to `children` as a render prop, and wired to Escape internally — only flips local `closing`
//     state, which un-renders the <motion.div> INSIDE <AnimatePresence>. Motion intercepts that
//     removal, plays the exit animation on the still-mounted element, and only once it finishes
//     does `onExitComplete` fire the REAL `onClose` prop — the thing that actually unmounts this
//     component from its caller (a `?new=1` surface slot, in every case that exists today).
//   ★★★ A CHILD MUST ROUTE EVERY WAY IT CAN CLOSE — an X button, "done, redirect away", a Cancel
//       button — through the `requestClose` this component hands it, NEVER by calling the surface's
//       own onCancel/onDone directly. Calling those directly skips the exit animation entirely,
//       because THIS component is what is actually mounted in the tree; the surface's own callback
//       only removes IT from ITS caller after this one is done animating and calls onClose itself.
//   · REDUCED MOTION: `useReducedMotion()` — the same platform preference AuthPanel.jsx already
//     respects — collapses both transitions to a single instant frame.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { useEscape, useFocusTrapLite } from "@/lib/hooks/useOverlay.js";

const SPRING = { type: "spring", stiffness: 300, damping: 30 };
const INSTANT = { duration: 0 };

export default function SlideUpScreen({ onClose = null, children, testId = "slide-up-screen" }) {
  const reduceMotion = useReducedMotion();
  const [closing, setClosing] = useState(false);
  const panel = useRef(null);

  const requestClose = () => setClosing(true);

  useEscape(() => { if (!closing) requestClose(); });
  useFocusTrapLite(panel);

  return (
    <AnimatePresence onExitComplete={() => onClose?.()}>
      {!closing && (
        <motion.div
          ref={panel}
          key="panel"
          className="fixed inset-0 z-50 flex flex-col bg-surface"
          initial={reduceMotion ? false : { y: "100%" }}
          animate={{ y: 0 }}
          exit={reduceMotion ? { y: 0 } : { y: "100%" }}
          transition={reduceMotion ? INSTANT : SPRING}
          role="dialog"
          aria-modal="true"
          data-testid={testId}
        >
          {typeof children === "function" ? children({ requestClose }) : children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
