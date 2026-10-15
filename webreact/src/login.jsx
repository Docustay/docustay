// The /login entry (login.html) — the server serves it itself, same origin, so the sign-in POST sets ks_session.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Layout from "@/routes/Layout.jsx";
import LoginPage from "@/routes/login.jsx";
createRoot(document.getElementById("root")).render(<StrictMode><Layout><LoginPage /></Layout></StrictMode>);
