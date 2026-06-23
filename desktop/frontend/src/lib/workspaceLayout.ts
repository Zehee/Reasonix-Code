export function availableWorkspacePanelWidth({
  viewportWidth,
  sidebarCollapsed,
  sidebarWidth,
  chatMinWidth,
  resizerWidth,
}: {
  viewportWidth: number;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  chatMinWidth: number;
  resizerWidth: number;
}): number {
  return Math.max(0, viewportWidth - (sidebarCollapsed ? 0 : sidebarWidth) - chatMinWidth - resizerWidth);
}

export function resolveWorkspacePanelWidth({
  open,
  maximized,
  preferredWidth,
  minWidth,
  availableWidth,
  enforceMinWidth = false,
}: {
  open: boolean;
  maximized: boolean;
  preferredWidth: number;
  minWidth: number;
  availableWidth: number;
  enforceMinWidth?: boolean;
}): number {
  if (!open || maximized) return preferredWidth;
  const available = Math.max(0, availableWidth);
  const target = Math.min(Math.max(minWidth, preferredWidth), available);
  return enforceMinWidth ? Math.max(minWidth, target) : target;
}

export function workspacePanelAriaMinWidth(minWidth: number, renderedWidth: number): number {
  return Math.min(minWidth, renderedWidth);
}
