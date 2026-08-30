import { Route, Switch, useParams } from "wouter";
import ProjectLibrary from "../features/project-library/ProjectLibrary";
import DividerLab from "../pages/DividerLab";
import EngineeringOps from "../pages/EngineeringOps";
import EngineeringStudio from "../pages/EngineeringStudio";
import LEDLab from "../pages/LEDLab";
import NotFound from "../pages/NotFound";
import ProjectWorkspace from "./ProjectWorkspace";
import SettingsPage from "./SettingsPage";

function ProjectRoute() {
  const params = useParams<{ projectId: string }>();
  return <ProjectWorkspace projectId={params.projectId} />;
}

export default function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={ProjectLibrary} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/project/:projectId" component={ProjectRoute} />
      <Route path="/engineering/ops" component={EngineeringOps} />
      <Route path="/engineering" component={EngineeringStudio} />
      <Route path="/led" component={LEDLab} />
      <Route path="/divider" component={DividerLab} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}
