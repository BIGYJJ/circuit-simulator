import { useEffect, useState } from "react";
import { Link } from "wouter";
import type { Diagnostic } from "../../domain/project/project-v2";
import { catalogLockState, completedLessonIdsFromStore } from "./evidence";
import { listLessons } from "./lessons";

export default function LessonCatalog() {
  const [rows, setRows] = useState(() => catalogLockState(new Set(), listLessons()));
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);

  useEffect(() => {
    let cancelled = false;
    void completedLessonIdsFromStore().then(result => {
      if (cancelled) return;
      setRows(catalogLockState(result.completed));
      setDiagnostics(result.diagnostics);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="lesson-catalog" data-testid="lesson-catalog" aria-label="课程目录">
      <h2>引导课程</h2>
      {diagnostics.map(item => (
        <p key={item.code} className="library-diagnostic">
          {item.code}
        </p>
      ))}
      <ul>
        {rows.map(row => (
          <li key={row.lesson.id} data-testid={`lesson-row-${row.lesson.id}`}>
            {row.locked ? (
              <span data-testid={`lesson-locked-${row.lesson.id}`}>{`${row.lesson.title}（未解锁）`}</span>
            ) : (
              <Link href={`/learn/${row.lesson.id}`}>{row.lesson.title}</Link>
            )}
            {row.completed ? <span data-testid={`lesson-complete-${row.lesson.id}`}>已完成</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
