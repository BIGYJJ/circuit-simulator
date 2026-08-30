export interface WorkspaceShortcutContext {
  selectedId: string | null;
  componentIds: string[];
  onSelect: (componentId: string | null) => void;
  onSelectWire: (wireId: string | null) => void;
  onNudge: (dx: number, dy: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onRun: () => void;
  onEscape: () => void;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function handleWorkspaceShortcut(event: KeyboardEvent, context: WorkspaceShortcutContext): boolean {
  const editable = isEditableTarget(event.target);
  if (editable && event.key !== "Escape") return false;
  const meta = event.ctrlKey || event.metaKey;
  if (meta && event.key.toLowerCase() === "z") {
    if (event.shiftKey) context.onRedo();
    else context.onUndo();
    return true;
  }
  if (meta && event.key === "Enter") {
    context.onRun();
    return true;
  }
  if (event.key === "Escape") {
    context.onEscape();
    return true;
  }
  if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown")) {
    const dx = event.key === "ArrowLeft" ? -20 : event.key === "ArrowRight" ? 20 : 0;
    const dy = event.key === "ArrowUp" ? -20 : event.key === "ArrowDown" ? 20 : 0;
    context.onNudge(dx, dy);
    return true;
  }
  if (!event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown")) {
    if (context.componentIds.length === 0) return false;
    const current = context.selectedId ? context.componentIds.indexOf(context.selectedId) : -1;
    const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const next = context.componentIds[(current + delta + context.componentIds.length) % context.componentIds.length] ?? null;
    context.onSelect(next);
    context.onSelectWire(null);
    return true;
  }
  return false;
}
