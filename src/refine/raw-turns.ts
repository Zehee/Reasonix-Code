/** Convert a chronological ChatMessage array into RawTurns. */

import type { ChatMessage } from "../types.js";
import type { RawAction, RawTurn } from "./types.js";

/** Group ChatMessages into RawTurns (one per user → assistant cycle). */
export function messagesToRawTurns(messages: ChatMessage[]): RawTurn[] {
  const turns: RawTurn[] = [];
  let currentTurnId: number | undefined;
  let currentUser = "";
  let currentAgent = "";
  let currentActions: RawAction[] = [];
  let currentTimestamp: string | undefined;

  for (const msg of messages) {
    if (msg.role === "user") {
      // Flush previous turn
      if (currentUser || currentAgent) {
        turns.push({
          turnId: currentTurnId,
          timestamp: currentTimestamp,
          user: currentUser,
          agentText: currentAgent,
          agent: currentAgent,
          actions: currentActions,
        });
      }
      currentTurnId = msg.turnId ?? (currentTurnId ?? 0) + 1;
      currentUser = String(msg.content ?? "");
      currentAgent = "";
      currentActions = [];
      currentTimestamp = undefined;
    } else if (msg.role === "assistant") {
      currentAgent = (currentAgent + "\n" + String(msg.content ?? "")).trim();
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          currentActions.push({
            name: tc.function?.name ?? "unknown",
            args: (() => {
              try {
                const raw = tc.function?.arguments;
                return raw ? JSON.parse(raw) : undefined;
              } catch {
                return tc.function?.arguments;
              }
            })(),
          });
        }
      }
    } else if (msg.role === "tool") {
      currentActions.push({
        name: msg.name ?? "tool",
        args: {},
        result: msg.content,
      });
    }
  }

  // Flush last turn
  if (currentUser || currentAgent) {
    turns.push({
      turnId: currentTurnId,
      timestamp: currentTimestamp,
      user: currentUser,
      agentText: currentAgent,
      agent: currentAgent,
      actions: currentActions,
    });
  }

  return turns;
}
