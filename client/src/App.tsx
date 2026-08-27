/** 精密实验档案：RC 瞬态实验为默认入口，分压器自由搭建工作台保留在独立可返回路由。 */

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import DividerLab from "@/pages/DividerLab";
import LEDLab from "@/pages/LEDLab";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";

function Router() {
  return <Switch><Route path="/" component={Home} /><Route path="/led" component={LEDLab} /><Route path="/divider" component={DividerLab} /><Route path="/404" component={NotFound} /><Route component={NotFound} /></Switch>;
}

export default function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="dark"><TooltipProvider><Toaster theme="dark" position="bottom-center" /><Router /></TooltipProvider></ThemeProvider></ErrorBoundary>;
}
