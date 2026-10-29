import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./styles.css";
import "./features.css";
import "./polish.css";
import "./statements.css";
import { Shell } from "./components/Shell";
import { FeedbackProvider } from "./components/feedback";
import { NewAnalysisPage } from "./pages/NewAnalysis";
import { EmptyState, Spinner } from "./components/ui";

const AnalysesPage = lazy(() => import("./pages/Analyses").then((m) => ({ default: m.AnalysesPage })));
const JobPage = lazy(() => import("./pages/Job").then((m) => ({ default: m.JobPage })));
const SettingsPage = lazy(() => import("./pages/Settings").then((m) => ({ default: m.SettingsPage })));
const ComparePage = lazy(() => import("./pages/Compare").then((m) => ({ default: m.ComparePage })));

function PageFallback() {
  return (
    <div className="page" style={{ padding: "48px 24px", display: "flex", justifyContent: "center", alignItems: "center" }}>
      <Spinner size={24} />
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <FeedbackProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<NewAnalysisPage />} />
              <Route path="analyses" element={<Suspense fallback={<PageFallback />}><AnalysesPage /></Suspense>} />
              <Route path="analyses/:jobId" element={<Suspense fallback={<PageFallback />}><JobPage /></Suspense>} />
              <Route path="compare" element={<Suspense fallback={<PageFallback />}><ComparePage /></Suspense>} />
              <Route path="settings" element={<Suspense fallback={<PageFallback />}><SettingsPage /></Suspense>} />
              <Route path="*" element={<div className="page"><EmptyState title="Page not found">That address doesn't match anything in FinSight.</EmptyState></div>} />
            </Route>
          </Routes>
        </BrowserRouter>
      </FeedbackProvider>
    </QueryClientProvider>
  </StrictMode>,
);

