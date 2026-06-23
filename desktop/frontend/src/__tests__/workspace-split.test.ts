// Run: tsx src/__tests__/workspace-split.test.ts

import { initialWorkspaceSplitTreeWidth, workspaceSplitMinWidth } from "../lib/workspaceSplit";
import { resolveWorkspacePanelWidth } from "../lib/workspaceLayout";

let passed = 0;
let failed = 0;

function eq(a: unknown, b: unknown, label: string) {
  if (a === b) {
    process.stdout.write(`  PASS  ${label}\n`);
    passed += 1;
  } else {
    process.stdout.write(`  FAIL  ${label}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}\n`);
    failed += 1;
  }
}

console.log("\nworkspace file split");

const TREE_MIN_WIDTH = 300;
const PREVIEW_MIN_WIDTH = 300;

eq(
  initialWorkspaceSplitTreeWidth({
    panelWidth: 660,
    savedTreeWidth: null,
    treeMinWidth: TREE_MIN_WIDTH,
    previewMinWidth: PREVIEW_MIN_WIDTH,
  }),
  330,
  "first split divides the file area evenly without a saved preference",
);

eq(
  initialWorkspaceSplitTreeWidth({
    panelWidth: 660,
    savedTreeWidth: 420,
    treeMinWidth: TREE_MIN_WIDTH,
    previewMinWidth: PREVIEW_MIN_WIDTH,
  }),
  360,
  "saved tree width is clamped so the preview keeps its minimum width",
);

eq(workspaceSplitMinWidth(TREE_MIN_WIDTH, PREVIEW_MIN_WIDTH), 600, "split minimum is the sum of pane minimums");

eq(
  resolveWorkspacePanelWidth({
    open: true,
    maximized: false,
    preferredWidth: 660,
    minWidth: workspaceSplitMinWidth(TREE_MIN_WIDTH, PREVIEW_MIN_WIDTH),
    availableWidth: 520,
    enforceMinWidth: true,
  }),
  600,
  "split file area preserves its minimum total width instead of silently compacting",
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
