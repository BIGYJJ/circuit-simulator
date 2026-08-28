/** FLUXLAB routes preserve legacy paths temporarily while the local-first v2 workspace becomes the canonical entry. */
import { Route, Switch } from "wouter";
import ProjectWorkspace from "./ProjectWorkspace";
import SettingsPage from "./SettingsPage";
import ProjectLibrary from "../features/project-library/ProjectLibrary";
import DividerLab from "../pages/DividerLab"; import LEDLab from "../pages/LEDLab"; import EngineeringStudio from "../pages/EngineeringStudio"; import EngineeringOps from "../pages/EngineeringOps"; import NotFound from "../pages/NotFound";
export function AppRoutes() { return <Switch><Route path="/" component={ProjectLibrary} /><Route path="/project/:projectId" component={ProjectWorkspace} /><Route path="/settings" component={SettingsPage} /><Route path="/engineering/ops" component={EngineeringOps} /><Route path="/engineering" component={EngineeringStudio} /><Route path="/led" component={LEDLab} /><Route path="/divider" component={DividerLab} /><Route component={NotFound} /></Switch>; }
