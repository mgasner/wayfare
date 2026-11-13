import { Outlet } from "react-router";
import { ToastProvider } from "./components/Toast";
import { DataProvider } from "./data/DataProvider";
import "./components/components.css";
import "./theme/base.css";
import "./theme/fonts";
import { ThemeProvider } from "./theme/themes";
import "./theme/tokens.css";

/** Root layout element: theme, toasts and global styles around every screen. */
export function AppProviders() {
  return (
    <DataProvider>
      <ThemeProvider>
        <ToastProvider>
          <Outlet />
        </ToastProvider>
      </ThemeProvider>
    </DataProvider>
  );
}
