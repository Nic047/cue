import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import "./fonts.css";
import "./index.css";

const App = lazy(() => import("./App"));
const UpdatesPanel = lazy(() => import("./components/updates-panel"));
const Onboarding = lazy(() => import("./Onboarding"));
const DemoApp = import.meta.env.DEV ? lazy(() => import("./demo/DemoApp")) : null;
const params = new URLSearchParams(location.search);
const setupMode = params.has("onboarding") ||
  (import.meta.env.DEV && params.has("onboarding-preview"));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Suspense fallback={null}>
      {params.has("updates") ? <UpdatesPanel /> : setupMode ? <Onboarding /> : DemoApp && params.has("demo") ? <DemoApp /> : <App />}
    </Suspense>
  </React.StrictMode>,
);
