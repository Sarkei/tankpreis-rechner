import React, { useEffect, useRef } from "react";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./lib/AuthContext.tsx";
import { ToastProvider, useToast } from "./lib/ToastContext.tsx";
import App from "./App.tsx";

/** Zeigt einen Toast wenn die Internetverbindung verloren geht / wiederhergestellt wird */
function OfflineDetector() {
  const { warning, success } = useToast();
  const wasOffline = useRef(false);

  useEffect(() => {
    function handleOffline() {
      wasOffline.current = true;
      warning("Keine Verbindung – du bist offline");
    }
    function handleOnline() {
      if (wasOffline.current) {
        wasOffline.current = false;
        success("Verbindung wiederhergestellt");
      }
    }
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [warning, success]);

  return null;
}

export default function AppRoot() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <OfflineDetector />
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
