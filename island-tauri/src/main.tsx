import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Onboarding from "./Onboarding";
import DemoApp from "./demo/DemoApp";
import "./fonts.css";
import "./index.css";

// ?demo (nur Browser-Dev): UI-Harness mit Mock-Daten statt Live-Store.
// Das separate Setup-Fenster nutzt ?onboarding; die Pill bleibt im Hauptfenster.
const demoMode =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("demo");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {new URLSearchParams(location.search).has("onboarding") ||
    (import.meta.env.DEV &&
      new URLSearchParams(location.search).has("onboarding-preview")) ? (
      <Onboarding />
    ) : demoMode ? (
      <DemoApp />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
