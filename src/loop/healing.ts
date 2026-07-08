import type { ChatMessage, ToolCall } from "../types.js";
import { isThinkingModeModel } from "./thinking.js";

let _stampSeq = 0;

/** DeepSeek 400s on tool_calls missing `id`. Give bare calls a fallback. */
function stampMissingIds(calls: ToolCall[]): ToolCall[] {
  return calls.map((c) => (c.id ? c : { ...c, id: `z-ext-${Date.now()}-${_stampSeq++}` }));
}

/** Drops both unpaired assistant.tool_calls and stray tool messages — DeepSeek 400s on either. */
export function fixToolCallPairing(messages: ChatMessage[]): {
  messages: ChatMessage[];
  droppedAssistantCalls: number;
  droppedStrayTools: number;
} {
  const out: ChatMessage[] = [];
  let droppedAssistantCalls = 0;
  let droppedStrayTools = 0;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg.role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      // Stamp missing ids before validation — DeepSeek rejects tool_calls without id.
      const calls = stampMissingIds(msg.tool_calls);
      const needed = new Set<string>();
      for (const call of calls) {
        if (call.id) needed.add(call.id);
      }
      const candidates: ChatMessage[] = [];
      let j = i + 1;
      while (j < messages.length && needed.size > 0) {
        const nxt = messages[j]!;
        if (nxt.role !== "tool") break;
        const id = nxt.tool_call_id ?? "";
        if (!needed.has(id)) break;
        needed.delete(id);
        candidates.push(nxt);
        j++;
      }
      if (needed.size === 0) {
        out.push({ ...msg, tool_calls: calls });
        for (const r of candidates) out.push(r);
        i = j - 1;
      } else {
        droppedAssistantCalls += 1;
        droppedStrayTools += candidates.length;
        i = j - 1;
      }
      continue;
    }
    if (msg.role === "tool") {
      droppedStrayTools += 1;
      continue;
    }
    out.push(msg);
  }
  return { messages: out, droppedAssistantCalls, droppedStrayTools };
}

export function healLoadedMessages(
  messages: ChatMessage[],
  _maxChars: number,
): { messages: ChatMessage[]; healedCount: number; healedFrom: number } {
  const paired = fixToolCallPairing(messages);
  const healedCount = paired.droppedAssistantCalls + paired.droppedStrayTools;
  return { messages: paired.messages, healedCount, healedFrom: 0 };
}

/** Go v2 compatible: never adds empty reasoning_content. Only preserves non-empty reasoning. */
export function stampMissingReasoningForThinkingMode(
  messages: ChatMessage[],
  model: string,
  options: { toolCallsOnly?: boolean } = {},
): { messages: ChatMessage[]; stampedCount: number } {
  if (!isThinkingModeModel(model)) {
    return { messages, stampedCount: 0 };
  }
  // Go v2 omits empty reasoning_content entirely (struct field has omitempty).
  // DeepSeek only requires it when actual reasoning was produced by the model.
  // Empty `reasoning_content: ""` adds 23 bytes per message vs Go's serialization.
  // We preserve non-empty reasoning but never add empty placeholders.
  return { messages, stampedCount: 0 };
}

/**
 * Strip stale reasoning_content from plain-text assistant messages before
 * sending the next request. Tool-call turns keep their reasoning so the model
 * can trace why a call was made; plain-text reasoning is only relevant for the
 * turn it was produced on.
 */
export function stripStalePlainReasoning(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (
      m.role === "assistant" &&
      (!Array.isArray(m.tool_calls) || m.tool_calls.length === 0) &&
      Object.hasOwn(m, "reasoning_content")
    ) {
      const { reasoning_content: _, ...rest } = m;
      return rest as ChatMessage;
    }
    return m;
  });
}

/** Token-cap variant — kept for API compatibility but no longer shrinks content.
 *  Tool results are preserved verbatim until fold time; this only repairs
 *  dangling tool-call pairings from a crashed or directly-mutated log. */
export function healLoadedMessagesByTokens(
  messages: ChatMessage[],
  _maxTokens: number,
): {
  messages: ChatMessage[];
  healedCount: number;
  tokensSaved: number;
  charsSaved: number;
} {
  const paired = fixToolCallPairing(messages);
  const healedCount = paired.droppedAssistantCalls + paired.droppedStrayTools;
  return {
    messages: paired.messages,
    healedCount,
    tokensSaved: 0,
    charsSaved: 0,
  };
}
