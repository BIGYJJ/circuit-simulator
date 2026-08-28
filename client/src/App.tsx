/** FLUXLAB 工作台暂时保留遗留路由，直至 Task 19 用统一项目工作区替换。 */

import DividerLab from "@/pages/DividerLab";
import LEDLab from "@/pages/LEDLab";
import EngineeringStudio from "@/pages/EngineeringStudio";
import EngineeringOps from "@/pages/EngineeringOps";
import NotFound from "@/pages/NotFound";
import { Toaster } from "sonner";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";

function Router() {
  return <Switch><Route path="/" component={Home} /><Route path="/engineering/ops" component={EngineeringOps} /><Route path="/engineering" component={EngineeringStudio} /><Route path="/led" component={LEDLab} /><Route path="/divider" component={DividerLab} /><Route path="/404" component={NotFound} /><Route component={NotFound} /></Switch>;
}

export default function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="dark"><Toaster theme="dark" position="bottom-center" /><Router /></ThemeProvider></ErrorBoundary>;
}
