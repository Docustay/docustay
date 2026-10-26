// The /signup entry (signup.html) — the server serves it itself, same origin.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Layout from "@/routes/Layout.jsx";
import SignupPage from "@/routes/signup.jsx";
createRoot(document.getElementById("root")).render(<StrictMode><Layout><SignupPage /></Layout></StrictMode>);
