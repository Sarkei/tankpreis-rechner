import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

/**
 * Demo-Domains (demo-*) öffnen sich mit dem Beispielkonto, ohne Registrierung.
 * Die Sitzung liegt in einem httpOnly-Cookie, deshalb genügt ein Aufruf von
 * /api/auth/demo vor dem Rendern — danach findet die App eine gültige Sitzung vor.
 */
async function bootstrapDemo(): Promise<void> {
  if (!location.hostname.startsWith("demo-")) return;
  try {
    const me = await fetch("/api/auth/me", { credentials: "same-origin" }).then((r) => r.json());
    if (me?.me) return;
    await fetch("/api/auth/demo", { method: "POST", credentials: "same-origin" });
  } catch {
    /* Demo bleibt dann auf der Anmeldeseite */
  }
}

const root = createRoot(document.getElementById("root")!);

void bootstrapDemo().finally(() => {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
});
