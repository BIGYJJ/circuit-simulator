import { Toaster } from "sonner";
import OfflineStatus from "./app/OfflineStatus";
import AppRoutes from "./app/routes";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider, usePreferences } from "./contexts/ThemeContext";

function ThemedToaster() {
  const { resolvedTheme } = usePreferences();
  return <Toaster theme={resolvedTheme} position="bottom-center" />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ThemedToaster />
        <OfflineStatus />
        <AppRoutes />
      </ThemeProvider>
    </ErrorBoundary>
  );
}
