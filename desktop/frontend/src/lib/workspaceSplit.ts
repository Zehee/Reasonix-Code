export function workspaceSplitMinWidth(treeMinWidth: number, previewMinWidth: number): number {
  return Math.round(treeMinWidth) + Math.round(previewMinWidth);
}

export function clampWorkspaceSplitTreeWidth({
  width,
  panelWidth,
  treeMinWidth,
  previewMinWidth,
}: {
  width: number;
  panelWidth?: number;
  treeMinWidth: number;
  previewMinWidth: number;
}): number {
  const min = Math.round(treeMinWidth);
  const rounded = Math.round(width);
  if (typeof panelWidth !== "number" || !Number.isFinite(panelWidth)) {
    return Math.max(min, rounded);
  }
  const max = Math.max(min, Math.round(panelWidth) - Math.round(previewMinWidth));
  return Math.min(max, Math.max(min, rounded));
}

export function initialWorkspaceSplitTreeWidth({
  panelWidth,
  savedTreeWidth,
  treeMinWidth,
  previewMinWidth,
}: {
  panelWidth?: number;
  savedTreeWidth: number | null;
  treeMinWidth: number;
  previewMinWidth: number;
}): number {
  const target =
    savedTreeWidth !== null && Number.isFinite(savedTreeWidth)
      ? savedTreeWidth
      : typeof panelWidth === "number" && Number.isFinite(panelWidth)
        ? panelWidth / 2
        : treeMinWidth;
  return clampWorkspaceSplitTreeWidth({ width: target, panelWidth, treeMinWidth, previewMinWidth });
}
