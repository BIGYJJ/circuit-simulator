import { lazy, Suspense, useEffect, useState } from "react";
import { Route, Switch, useLocation, useParams } from "wouter";
import NotFound from "../pages/NotFound";

const ProjectLibrary = lazy(() => import("../features/project-library/ProjectLibrary"));
const ProjectWorkspace = lazy(() => import("./ProjectWorkspace"));
const SettingsPage = lazy(() => import("./SettingsPage"));
const LegacyRedirect = lazy(() => import("./LegacyRedirect"));

function Fallback() {
  return <main className="workspace-error">正在打开…</main>;
}

function ProjectRoute() {
  const params = useParams<{ projectId: string }>();
  return (
    <Suspense fallback={<Fallback />}>
      <ProjectWorkspace projectId={params.projectId} />
    </Suspense>
  );
}

function LearnRoute() {
  const params = useParams<{ lessonId: string }>();
  const [, navigate] = useLocation();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("../features/learning/lessons").then(({ openOrCreateLessonProject }) => {
      void openOrCreateLessonProject(params.lessonId).then(result => {
        if (cancelled) return;
        if (!result.ok) {
          setError(result.diagnostics[0]?.code ?? "LESSON_UNKNOWN");
          return;
        }
        navigate(`/project/${result.value.projectId}?lesson=${result.value.lesson.id}&view=guided`, { replace: true });
      });
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
      <Route path="/">
        {() => (
          <Suspense fallback={<Fallback />}>
            <ProjectLibrary />
          </Suspense>
        )}
      </Route>
      <Route path="/settings">
        {() => (
          <Suspense fallback={<Fallback />}>
            <SettingsPage />
          </Suspense>
        )}
      </Route>
      <Route path="/learn/:lessonId" component={LearnRoute} />
      <Route path="/project/:projectId" component={ProjectRoute} />
      <Route path="/engineering/ops">
        {() => (
          <Suspense fallback={<Fallback />}>
            <LegacyRedirect path="/engineering/ops" />
          </Suspense>
        )}
      </Route>
      <Route path="/engineering">
        {() => (
          <Suspense fallback={<Fallback />}>
            <LegacyRedirect path="/engineering" />
          </Suspense>
        )}
      </Route>
      <Route path="/led">
        {() => (
          <Suspense fallback={<Fallback />}>
            <LegacyRedirect path="/led" />
          </Suspense>
        )}
      </Route>
      <Route path="/divider">
        {() => (
          <Suspense fallback={<Fallback />}>
            <LegacyRedirect path="/divider" />
          </Suspense>
        )}
      </Route>
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}
