import { Toaster } from "sonner";
import AppRoutes from "./app/routes";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <Toaster theme="dark" position="bottom-center" />
        <AppRoutes />
      </ThemeProvider>
    </ErrorBoundary>
  );
}
