// The app.html entry — every path the server answers with the SPA shell. CatchAll decides public page vs the app.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Layout from "@/routes/Layout.jsx";
import CatchAll from "@/routes/CatchAll.jsx";
import "@/lib/host/documentsHost.js"; // plugs the platform's programs / client types into Documents' generic labels
createRoot(document.getElementById("root")).render(<StrictMode><Layout><CatchAll /></Layout></StrictMode>);
