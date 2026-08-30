import { Toaster } from "sonner";
import { createProductSimulatorWorker } from "./app/build-info";
import AppRoutes from "./app/routes";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

void createProductSimulatorWorker;

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
