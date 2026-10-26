// Runs before the first paint (a blocking, same-origin script, so the strict CSP allows it): marks the page as script-capable (the stylesheet hides reveal effects only then) and applies a saved dark or auto theme without a flash.
document.documentElement.classList.add("js");
try { var t = localStorage.getItem("docustay-theme"); if (t === "dark" || t === "auto") document.documentElement.setAttribute("data-theme", t); } catch (e) { /* storage blocked: stay light */ }
