/**
 * LiveActivityArea — the "what's happening right now" region of the UI.
 * Extracted from App.tsx per #565 Phase 2.
 */

import { Box } from "ink";
import React from "react";

import type { PlanStep } from "../../tools/plan.js";
import { PlanProposalCard } from "./cards/PlanProposalCard.js";
import { OngoingToolRow, SubagentLiveStack, ThinkingRow, UndoBanner } from "./layout/LiveRows.js";
import { ToastRail } from "./layout/ToastRail.js";
import { PlanLiveRow } from "./layout/plan-live-row.js";
import { useRenderTrace } from "./render-trace.js";

import type { SubagentActivity } from "./useSubagent.js";

// undoBanner uses types from "../../code/edit-blocks.js" (ApplyResult)
// and "./edit-history.js" (EditHistoryEntry).  Keep the prop loose to
// avoid a transitive import chain; the UndoBanner component enforces
// the concrete type at the call site.
type UndoBannerState = Parameters<typeof UndoBanner>[0]["banner"];

// ── Props ─────────────────────────────────────────────────────────

export interface LiveActivityAreaProps {
  noTakeoverOverlay: boolean;
  suppressPlanLiveRow?: boolean;
  ongoingTool: { name: string; args?: string } | null;
  toolProgress: { progress: number; total?: number; message?: string } | null;
  subagentActivities: ReadonlyArray<SubagentActivity>;
  statusLine: string | null;
  busy: boolean;
  isStreaming: boolean;
  activityLabel: string;
  undoBanner: UndoBannerState | null;
  hideUndo: boolean;
  /** When set, renders the inline PlanProposalCard in the live area. */
  pendingPlan?: string;
  planSteps?: PlanStep[];
  planSummary?: string;
}

// ── Component ─────────────────────────────────────────────────────

export const LiveActivityArea: React.FC<LiveActivityAreaProps> = React.memo(
  ({
    noTakeoverOverlay,
    suppressPlanLiveRow,
    ongoingTool,
    toolProgress,
    subagentActivities,
    statusLine,
    busy,
    isStreaming,
    activityLabel,
    undoBanner,
    hideUndo,
    pendingPlan,
    planSteps,
    planSummary,
  }) => {
    useRenderTrace("LiveActivityArea");
    return (
      <Box flexDirection="column" flexShrink={0} flexWrap="nowrap">
        {pendingPlan ? (
          <PlanProposalCard body={pendingPlan} steps={planSteps} summary={planSummary} />
        ) : null}
        {noTakeoverOverlay && ongoingTool ? (
          <OngoingToolRow
            tool={ongoingTool}
            progress={toolProgress}
            subagentActivities={subagentActivities}
          />
        ) : null}
        {noTakeoverOverlay && subagentActivities.length > 0 ? (
          <SubagentLiveStack activities={subagentActivities} max={3} />
        ) : null}
        {noTakeoverOverlay && !ongoingTool && statusLine ? <ThinkingRow text={statusLine} /> : null}
        {undoBanner && !hideUndo ? <UndoBanner banner={undoBanner} /> : null}
        {noTakeoverOverlay && busy && !isStreaming && !ongoingTool && !statusLine ? (
          <ThinkingRow text={activityLabel} />
        ) : null}
        {noTakeoverOverlay && !suppressPlanLiveRow ? <PlanLiveRow /> : null}
        <ToastRail />
      </Box>
    );
  },
);

LiveActivityArea.displayName = "LiveActivityArea";
