// The app shell scrolls ONE element (the main column), not the window (COMBINED-STYLE-SPEC section 3), so code that used to scroll the window asks for it here.
export const mainScroller = () => (typeof document === "undefined" ? null : document.querySelector("[data-scroll-main]"));
export const scrollMainTo = (top = 0, behavior = "instant") => { const m = mainScroller(); if (m) m.scrollTo({ top, left: 0, behavior }); else if (typeof window !== "undefined") window.scrollTo({ top, left: 0, behavior }); };
export const scrollMainBy = (top, behavior = "instant") => { const m = mainScroller(); if (m) m.scrollBy({ top, behavior }); else if (typeof window !== "undefined") window.scrollBy({ top, behavior }); };
