import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import "./dark.css";
import { appMode } from "./lib/appMode";
import { supabaseConfigured } from "./lib/supabase";
import { AuthProvider } from "./lib/auth";
import { Loading, ToastProvider } from "./components/ui";
import { DemoBanner, DemoCheckout, esCheckoutDemo } from "@backend";

const ErpApp = lazy(() => import("./erp/ErpApp"));
const PortalApp = lazy(() => import("./portal/PortalApp"));

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
});

document.title = appMode.app === "erp" ? "ERP · CeCIP Paraná" : "Portal de Socios · CeCIP Paraná";

// En local, "/" redirige al ERP
if (appMode.basename && window.location.pathname === "/") {
  window.history.replaceState(null, "", "/erp" + window.location.hash);
}

function App() {
  if (!supabaseConfigured) {
    return (
      <div className="mx-auto mt-20 max-w-lg rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        <b>Falta configurar Supabase.</b> Copiá <code>.env.example</code> como <code>.env</code> y completá
        <code> VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code>.
      </div>
    );
  }
  if (DemoCheckout && esCheckoutDemo()) return <DemoCheckout />;
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter basename={appMode.basename}>
            <Suspense fallback={<Loading />}>{appMode.app === "erp" ? <ErpApp /> : <PortalApp />}</Suspense>
          </BrowserRouter>
          {DemoBanner && <DemoBanner />}
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
