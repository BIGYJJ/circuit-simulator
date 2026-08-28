/** FLUXLAB 工作台暂时保留遗留路由，直至 Task 19 用统一项目工作区替换。 */

import { Toaster } from "sonner";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AppRoutes } from "./app/routes";

export default function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="dark"><Toaster theme="dark" position="bottom-center" /><AppRoutes /></ThemeProvider></ErrorBoundary>;
}
