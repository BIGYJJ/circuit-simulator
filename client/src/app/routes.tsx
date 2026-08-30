import { useEffect, useState } from "react";
import { Route, Switch, useLocation, useParams } from "wouter";
import ProjectLibrary from "../features/project-library/ProjectLibrary";
import { openOrCreateLessonProject } from "../features/learning/lessons";
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

function LearnRoute() {
  const params = useParams<{ lessonId: string }>();
  const [, navigate] = useLocation();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void openOrCreateLessonProject(params.lessonId).then(result => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.diagnostics[0]?.code ?? "LESSON_UNKNOWN");
        return;
      }
      navigate(`/project/${result.value.projectId}?lesson=${result.value.lesson.id}&view=guided`, { replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [navigate, params.lessonId]);

  if (error) {
    return (
      <main className="workspace-error">
        <p data-testid="lesson-route-error">{error}</p>
      </main>
    );
  }
  return <main className="workspace-error">正在打开课程…</main>;
}

export default function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={ProjectLibrary} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/learn/:lessonId" component={LearnRoute} />
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
