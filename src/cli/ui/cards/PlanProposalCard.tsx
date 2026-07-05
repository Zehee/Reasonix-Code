/** Inline plan proposal card — renders plan as a bordered box in the conversation flow. */

import { Box, Text } from "ink";
// biome-ignore lint/style/useImportType: tsconfig jsx=react needs React in value scope for JSX compilation
import React from "react";
import type { PlanStep } from "../../../tools/plan.js";
import { MarkdownView } from "../markdown-view.js";
import { PlanStepList } from "../PlanStepList.js";
import { extractOpenQuestionsSection } from "../plan-open-questions.js";
import { FG, TONE } from "../theme/tokens.js";

export interface PlanProposalCardProps {
  body: string;
  steps?: PlanStep[];
  completedStepIds?: Set<string>;
  summary?: string;
}

export function PlanProposalCard({
  body,
  steps,
  completedStepIds,
  summary,
}: PlanProposalCardProps): React.ReactElement {
  const openQuestions = extractOpenQuestionsSection(body);
  const statuses = completedStepIds
    ? Object.fromEntries([...completedStepIds].map((id) => [id, "done" as const]))
    : undefined;
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={TONE.accent}
      paddingLeft={1}
      paddingRight={1}
      marginTop={1}
      width="100%"
    >
      <Text bold color={TONE.accent}>
        {" plan "}
      </Text>
      {summary ? (
        <Box marginTop={1}>
          <Text color={FG.body}>{summary}</Text>
        </Box>
      ) : null}
      {steps && steps.length > 0 ? (
        <Box marginTop={1} flexDirection="column">
          <PlanStepList steps={steps} statuses={statuses} />
        </Box>
      ) : null}
      <Box marginTop={1} flexDirection="column">
        <MarkdownView text={body} />
      </Box>
      {openQuestions ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={TONE.warn}>{" open questions"}</Text>
          <MarkdownView text={openQuestions} />
        </Box>
      ) : null}
    </Box>
  );
}
