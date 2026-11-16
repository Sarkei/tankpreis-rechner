import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

/**
 * Demo-Zugang: ?demo=1 meldet automatisch das Demo-Konto an (Session-Cookie).
 * Der Merker verhindert eine Schleife — HttpOnly-Cookies sind für JavaScript unsichtbar.
 */
async function start() {
  const isDemo =
    window.location.hostname.startsWith("demo-") || window.location.hostname.startsWith("demo.") ||
    new URLSearchParams(window.location.search).has("demo");
  const tried = sessionStorage.getItem("mitfahr.demoTried");
  if (isDemo && !tried) {
    sessionStorage.setItem("mitfahr.demoTried", "1");
    try {
      const r = await fetch("/api/auth/demo");
      if (r.ok) {
        window.location.replace(window.location.pathname + window.location.search);
        return;
      }
    } catch {
      /* ohne Demo weiter */
    }
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

void start();
