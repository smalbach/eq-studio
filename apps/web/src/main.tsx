import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApiDashboard } from "@/components/api-dashboard";
import { ThemeRoot } from "@/components/app/appearance";
import { AuthGate } from "@/components/account/auth-gate";
import { LocaleProvider, initialLocale } from "@/lib/i18n";
import { routeFromParams } from "@/lib/routes";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LocaleProvider initial={initialLocale()}>
      <ThemeRoot>
        <AuthGate>
          <ApiDashboard initialRoute={routeFromParams(new URLSearchParams(window.location.search))}/>
        </AuthGate>
      </ThemeRoot>
    </LocaleProvider>
  </StrictMode>,
);
