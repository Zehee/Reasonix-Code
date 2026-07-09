import type { ChatMessage, ToolCall } from "../types.js";
import { isThinkingModeModel } from "./thinking.js";

let _toolCallIdSeq = 0;

/** DeepSeek 400s on tool_calls missing `id`. Give bare calls a stable fallback so
 *  the matching `role: tool` messages can reference them. Mutates in place so the
 *  same ToolCall objects used by dispatch carry the id. */
function stampMissingToolCallIds(calls: ToolCall[]): ToolCall[] {
  for (const c of calls) {
    if (!c.id) {
      c.id = `rx-call-${Date.now()}-${_toolCallIdSeq++}`;
    }
  }
  return calls;
}

/** Match Go's serialization: reasoning_content only when non-empty; content=null for pure tool-call messages. */
export function buildAssistantMessage(
  content: string,
  toolCalls: ToolCall[],
  producingModel: string,
  reasoningContent?: string | null,
): ChatMessage {
  const msg: ChatMessage = { role: "assistant" };
  // Pure tool-call assistant → content: null (Go v2 format). Non-tool → content: "<text>".
  if (toolCalls.length === 0 || content.length > 0) {
    msg.content = content;
  } else {
    msg.content = null;
  }
  if (toolCalls.length > 0) msg.tool_calls = stampMissingToolCallIds(toolCalls);
  // Only include reasoning_content when the model produced actual reasoning text.
  // Go v2 uses omitempty on the wire — empty string is never sent.
  if (reasoningContent && reasoningContent.length > 0) {
    msg.reasoning_content = reasoningContent;
  }
  return msg;
}

/** Abort notices etc — caller passes its current model as the thinking-mode stamp. */
export function buildSyntheticAssistantMessage(
  content: string,
  fallbackModel: string,
): ChatMessage {
  return { role: "assistant", content };
}
