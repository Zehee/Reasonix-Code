import type { Action, IncomingEvent, SessionFile, SkillInfo, State, UsageStats } from "../protocol";
import { t } from "../i18n";
import type { ChatMessage } from "../types";


function fallbackSkillDesc(skill: SkillInfo): string {
  const scope =
    skill.scope === "builtin"
      ? t("app.skill.scope.builtin")
      : skill.scope === "global"
        ? t("app.skill.scope.global")
        : t("app.skill.scope.project");
  const runAs =
    skill.runAs === "subagent" ? t("app.skill.runAs.subagent") : t("app.skill.runAs.inline");
  return t("app.skill.generic", { scope, runAs });
}

function nextMessageTurn(messages: ChatMessage[]): number {
  const lastTurn = messages.reduce((max, m) => {
    if (m.kind === "user" || m.kind === "assistant") return Math.max(max, m.turn);
    return max;
  }, 0);
  return lastTurn + 1;
}

function reduce(state: State, action: Action): State {
  return withElidedTranscript(reduceRaw(state, action));
}

function reduceRaw(state: State, action: Action): State {
  switch (action.t) {
    case "send_user": {
      return {
        ...state,
        busy: true,
        messages: [
          ...state.messages,
          {
            kind: "user",
            text: action.text,
            clientId: action.clientId,
            turn: nextMessageTurn(state.messages),
          },
        ],
      };
    }
    case "start_skill": {
      const argsLine = action.args ? ` ${action.args}` : "";
      return {
        ...state,
        busy: true,
        activeSkill: action.skill,
        messages: [
          ...state.messages,
          {
            kind: "user",
            text: `/${action.skill.name}${argsLine}`,
            clientId: action.clientId,
            turn: nextMessageTurn(state.messages),
            skill: action.skill,
          },
        ],
      };
    }
    case "rpc_exit":
      return {
        ...state,
        ready: false,
        busy: false,
        activeSkill: null,
        queuedSends: [],
        messages: [
          ...state.messages,
          { kind: "error", message: `reasonix-code exited (code ${action.code ?? "?"})` },
        ],
      };
    case "incoming":
      return applyIncoming(state, action.event);
    case "batch_delta": {
      const collapsed: DeltaBatchItem[] = [];
      for (const item of action.items) {
        const last = collapsed[collapsed.length - 1];
        if (last && last.turn === item.turn && last.channel === item.channel) {
          last.text += item.text;
        } else {
          collapsed.push({ ...item });
        }
      }
      return {
        ...state,
        messages: state.messages.map((m) => {
          if (m.kind !== "assistant") return m;
          const relevant = collapsed.filter((it) => it.turn === m.turn);
          if (relevant.length === 0) return m;
          let segments = m.segments;
          for (const it of relevant) {
            segments = appendTextSegment(
              segments,
              it.channel === "content" ? "text" : "reasoning",
              it.text,
            );
          }
          return { ...m, segments };
        }),
      };
    }
    case "clear":
      return {
        ...state,
        busy: false,
        currentSession: undefined,
        messages: [],
        pendingConfirms: [],
        pendingPathAccess: [],
        pendingChoices: [],
        pendingPlans: [],
        pendingCheckpoints: [],
        pendingRevisions: [],
        activePlan: null,
        usage: zeroUsage(),
        sessionFiles: [],
        activeSkill: null,
        queuedSends: [],
        retryNonce: 0,
      };
    case "resolve_confirm":
      return {
        ...state,
        pendingConfirms: state.pendingConfirms.filter((c) => c.id !== action.id),
      };
    case "resolve_path_access":
      return {
        ...state,
        pendingPathAccess: state.pendingPathAccess.filter((p) => p.id !== action.id),
      };
    case "resolve_choice":
      return {
        ...state,
        pendingChoices: state.pendingChoices.filter((c) => c.id !== action.id),
      };
    case "resolve_plan": {
      const removed = state.pendingPlans.find((p) => p.id === action.id);
      let activePlan = state.activePlan;
      if (removed && action.verdict.type === "approve") {
        const pendingSteps = (removed as PendingPlan & { steps?: PlanStep[] }).steps;
        activePlan = {
          plan: removed.plan,
          summary: removed.summary,
          steps: pendingSteps ?? [],
          completedStepIds: [],
          stepResults: {},
        };
      }
      return {
        ...state,
        pendingPlans: state.pendingPlans.filter((p) => p.id !== action.id),
        activePlan,
      };
    }
    case "resolve_checkpoint":
      return {
        ...state,
        pendingCheckpoints: state.pendingCheckpoints.filter((c) => c.id !== action.id),
      };
    case "resolve_revision": {
      const removed = state.pendingRevisions.find((r) => r.id === action.id);
      let activePlan = state.activePlan;
      if (removed && action.verdict.type === "accepted" && activePlan) {
        const doneIds = new Set(activePlan.completedStepIds);
        const keptDone = activePlan.steps.filter((s) => doneIds.has(s.id));
        activePlan = {
          ...activePlan,
          steps: [...keptDone, ...removed.remainingSteps],
        };
      }
      return {
        ...state,
        pendingRevisions: state.pendingRevisions.filter((r) => r.id !== action.id),
        activePlan,
      };
    }
    case "dismiss_plan":
      return { ...state, activePlan: null };
    case "mention_results":
      return { ...state, mentionResults: action.results };
    case "mention_preview":
      return { ...state, mentionPreview: action.preview };
    case "enqueue_send":
      return { ...state, queuedSends: [...state.queuedSends, action.text] };
    case "dequeue_send":
      return {
        ...state,
        queuedSends: state.queuedSends.filter((_, i) => i !== action.index),
      };
    case "shift_queued_send":
      return { ...state, queuedSends: state.queuedSends.slice(1) };
  }
}

function withElidedTranscript(state: State): State {
  const messages = elideTranscriptMessages(state.messages);
  return messages === state.messages ? state : { ...state, messages };
}

const READING_TOOLS = new Set(["read_file"]);
const MODIFYING_TOOLS = new Set(["edit_file", "write_file"]);

function extractToolFiles(name: string, args: string): SessionFile[] {
  try {
    const parsed = JSON.parse(args) as { path?: unknown; edits?: unknown };
    if (READING_TOOLS.has(name) && typeof parsed?.path === "string") {
      return [{ path: parsed.path, status: "c" }];
    }
    if (MODIFYING_TOOLS.has(name) && typeof parsed?.path === "string") {
      return [{ path: parsed.path, status: "m" }];
    }
    if (name === "multi_edit" && Array.isArray(parsed?.edits)) {
      const out: SessionFile[] = [];
      const seen = new Set<string>();
      for (const e of parsed.edits as Array<{ path?: unknown }>) {
        if (typeof e?.path === "string" && !seen.has(e.path)) {
          seen.add(e.path);
          out.push({ path: e.path, status: "m" });
        }
      }
      return out;
    }
  } catch {
    // malformed args — skip; tool will error on the real side anyway
  }
  return [];
}

function mergeSessionFiles(existing: SessionFile[], adds: SessionFile[]): SessionFile[] {
  if (adds.length === 0) return existing;
  const next = [...existing];
  const indexByPath = new Map<string, number>();
  next.forEach((f, i) => indexByPath.set(f.path, i));
  let changed = false;
  for (const add of adds) {
    const idx = indexByPath.get(add.path);
    if (idx === undefined) {
      indexByPath.set(add.path, next.length);
      next.push(add);
      changed = true;
      continue;
    }
    const prev = next[idx];
    if (!prev || prev.status === "m") continue; // never downgrade m → c
    if (prev.status === add.status) continue;
    next[idx] = add;
    changed = true;
  }
  return changed ? next : existing;
}

function zeroUsage(): UsageStats {
  return {
    totalCostUsd: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    lastCallCacheHit: null,
    lastCallCacheMiss: null,
    reservedTokens: 0,
    logTokens: 0,
    lastPromptTokens: 0,
    contextCapTokens: 1_000_000,
    lastTurnCostUsd: 0,
  };
}

function appendTextSegment(
  segments: AssistantSegment[],
  kind: "text" | "reasoning",
  text: string,
): AssistantSegment[] {
  const last = segments[segments.length - 1];
  if (last && last.kind === kind) {
    return [...segments.slice(0, -1), { ...last, text: last.text + text }];
  }
  return [...segments, { kind, text }];
}

export function applyIncoming(state: State, ev: IncomingEvent): State {
  return withElidedTranscript(applyIncomingRaw(state, ev));
}

function applyIncomingRaw(state: State, ev: IncomingEvent): State {
  switch (ev.type) {
    case "user.message": {
      const last = state.messages[state.messages.length - 1];
      if (state.busy && last?.kind === "user" && last.text === ev.text) {
        return state;
      }
      return {
        ...state,
        busy: true,
        messages: [
          ...state.messages,
          {
            kind: "user",
            text: ev.text,
            clientId: `remote-${ev.id}`,
            turn: ev.turn > 0 ? ev.turn : nextMessageTurn(state.messages),
          },
        ],
      };
    }
    case "$ready":
      return { ...state, ready: true, needsSetup: false };
    case "$needs_setup":
      return { ...state, needsSetup: true, ready: false };
    case "$turn_complete":
      return { ...state, busy: false, activeSkill: null };
    case "$confirm_required":
      return {
        ...state,
        pendingConfirms: [
          ...state.pendingConfirms,
          { id: ev.id, kind: ev.kind, command: ev.command },
        ],
      };
    case "$path_access_required":
      return {
        ...state,
        pendingPathAccess: [
          ...state.pendingPathAccess,
          {
            id: ev.id,
            path: ev.path,
            intent: ev.intent,
            toolName: ev.toolName,
            sandboxRoot: ev.sandboxRoot,
            allowPrefix: ev.allowPrefix,
          },
        ],
      };
    case "$choice_required":
      return {
        ...state,
        pendingChoices: [
          ...state.pendingChoices,
          {
            id: ev.id,
            question: ev.question,
            options: ev.options,
            allowCustom: ev.allowCustom,
          },
        ],
      };
    case "$plan_required": {
      const steps = Array.isArray(ev.steps) ? (ev.steps as PlanStep[]) : undefined;
      return {
        ...state,
        pendingPlans: [
          ...state.pendingPlans,
          { id: ev.id, plan: ev.plan, summary: ev.summary, ...(steps ? { steps } : {}) },
        ],
      };
    }
    case "$checkpoint_required":
      return {
        ...state,
        pendingCheckpoints: [
          ...state.pendingCheckpoints,
          {
            id: ev.id,
            stepId: ev.stepId,
            title: ev.title,
            result: ev.result,
            notes: ev.notes,
            completed: ev.completed,
            total: ev.total,
          },
        ],
      };
    case "$revision_required":
      return {
        ...state,
        pendingRevisions: [
          ...state.pendingRevisions,
          {
            id: ev.id,
            reason: ev.reason,
            remainingSteps: ev.remainingSteps,
            summary: ev.summary,
          },
        ],
      };
    case "$modal_dismissed":
      switch (ev.kind) {
        case "shell":
          return { ...state, pendingConfirms: [] };
        case "path":
          return { ...state, pendingPathAccess: [] };
        case "choice":
          return { ...state, pendingChoices: [] };
        case "plan":
          return { ...state, pendingPlans: [] };
        case "checkpoint":
          return { ...state, pendingCheckpoints: [] };
        case "revision":
          return { ...state, pendingRevisions: [] };
        default:
          return state;
      }
    case "$step_completed": {
      if (!state.activePlan) return state;
      const stepIds = new Set(state.activePlan.completedStepIds);
      stepIds.add(ev.stepId);
      return {
        ...state,
        activePlan: {
          ...state.activePlan,
          completedStepIds: [...stepIds],
          stepResults: { ...state.activePlan.stepResults, [ev.stepId]: ev.result },
        },
      };
    }
    case "$plan_cleared":
      return {
        ...state,
        activePlan: null,
        pendingCheckpoints: [],
        pendingRevisions: [],
      };
    case "$sessions": {
      const hasCurrent = "currentSession" in ev;
      const nextCurrent =
        ev.currentSession === null ? undefined : (ev.currentSession ?? state.currentSession);
      const currentChanged = hasCurrent && nextCurrent !== state.currentSession;
      return {
        ...state,
        sessions: ev.items,
        currentSession: nextCurrent,
        messages: currentChanged ? [] : state.messages,
        pendingConfirms: currentChanged ? [] : state.pendingConfirms,
        pendingPathAccess: currentChanged ? [] : state.pendingPathAccess,
        pendingChoices: currentChanged ? [] : state.pendingChoices,
        pendingPlans: currentChanged ? [] : state.pendingPlans,
        pendingCheckpoints: currentChanged ? [] : state.pendingCheckpoints,
        pendingRevisions: currentChanged ? [] : state.pendingRevisions,
        activePlan: currentChanged ? null : state.activePlan,
        usage: currentChanged ? zeroUsage() : state.usage,
        sessionFiles: currentChanged ? [] : state.sessionFiles,
        queuedSends: currentChanged ? [] : state.queuedSends,
      };
    }
    case "$session_usage": {
      const empty =
        ev.totalCostUsd === 0 &&
        ev.totalPromptTokens === 0 &&
        ev.totalCompletionTokens === 0 &&
        ev.cacheHitTokens === 0 &&
        ev.cacheMissTokens === 0;
      return {
        ...state,
        usage: {
          ...state.usage,
          totalCostUsd: ev.totalCostUsd,
          totalPromptTokens: ev.totalPromptTokens,
          totalCompletionTokens: ev.totalCompletionTokens,
          cacheHitTokens: ev.cacheHitTokens,
          cacheMissTokens: ev.cacheMissTokens,
          lastTurnCostUsd:
            typeof ev.lastTurnCostUsd === "number"
              ? ev.lastTurnCostUsd
              : state.usage.lastTurnCostUsd,
          lastPromptTokens:
            typeof ev.lastPromptTokens === "number"
              ? ev.lastPromptTokens
              : state.usage.lastPromptTokens,
          lastCallCacheHit: empty ? null : state.usage.lastCallCacheHit,
          lastCallCacheMiss: empty ? null : state.usage.lastCallCacheMiss,
        },
      };
    }
    case "$mcp_specs":
      return {
        ...state,
        mcpSpecs: Array.isArray(ev.specs) ? ev.specs : [],
        mcpBridged: Boolean(ev.bridged),
      };
    case "$skills":
      return { ...state, skills: ev.items };
    case "$ctx_breakdown":
      return {
        ...state,
        usage: {
          ...state.usage,
          reservedTokens: ev.reservedTokens,
          logTokens: ev.logTokens ?? state.usage.logTokens,
          contextCapTokens: ev.contextCapTokens ?? state.usage.contextCapTokens,
        },
      };
    case "$memory":
      return {
        ...state,
        memory: ev.entries,
        memoryDetail:
          state.memoryDetail && ev.entries.some((entry) => entry.path === state.memoryDetail?.path)
            ? state.memoryDetail
            : null,
      };
    case "$memory_detail":
      return { ...state, memoryDetail: ev.detail };
    case "$jobs":
      return { ...state, jobs: ev.items };
    case "$balance":
      return {
        ...state,
        balance: {
          currency: ev.currency,
          total: ev.total,
          isAvailable: ev.isAvailable,
        },
      };
    case "$qq_settings":
      return {
        ...state,
        qq: {
          appId: ev.appId,
          appSecret: ev.appSecret,
          sandbox: ev.sandbox,
          enabled: ev.enabled,
          configured: ev.configured,
          runtimeState: ev.runtimeState,
          lastError: ev.lastError,
          appIdPreview: ev.appIdPreview,
          access: ev.access,
        },
      };
    case "$settings": {
      const prevWs = state.settings?.workspaceDir;
      const wsChanged = prevWs !== undefined && prevWs !== ev.workspaceDir;
      return {
        ...state,
        busy: wsChanged ? false : state.busy,
        messages: wsChanged ? [] : state.messages,
        pendingConfirms: wsChanged ? [] : state.pendingConfirms,
        pendingPathAccess: wsChanged ? [] : state.pendingPathAccess,
        pendingChoices: wsChanged ? [] : state.pendingChoices,
        pendingPlans: wsChanged ? [] : state.pendingPlans,
        pendingCheckpoints: wsChanged ? [] : state.pendingCheckpoints,
        pendingRevisions: wsChanged ? [] : state.pendingRevisions,
        activePlan: wsChanged ? null : state.activePlan,
        usage: wsChanged ? zeroUsage() : state.usage,
        sessionFiles: wsChanged ? [] : state.sessionFiles,
        retryNonce: wsChanged ? 0 : state.retryNonce,
        settings: {
          reasoningEffort: ev.reasoningEffort,
          editMode: ev.editMode,
          budgetUsd: ev.budgetUsd,
          baseUrl: ev.baseUrl,
          apiKeyPrefix: ev.apiKeyPrefix,
          workspaceDir: ev.workspaceDir,
          recentWorkspaces: ev.recentWorkspaces,
          model: ev.model,
          editor: ev.editor,
          webSearchEngine: ev.webSearchEngine,
          webSearchApiKeys: ev.webSearchApiKeys,
          subagentModels: ev.subagentModels,
          showSystemEvents: ev.showSystemEvents,
          version: ev.version,
        },
      };
    }
    case "$session_loaded": {
      const sessionName = ev.name;
      const loaded: ChatMessage[] = ev.messages.map((m, i) => {
        if (m.kind === "user") {
          return { kind: "user", text: m.text, clientId: `c-loaded-${i}`, turn: i + 1 };
        }
        const segments: AssistantSegment[] = m.segments.map((s) => {
          if (s.kind === "tool") {
            return {
              kind: "tool",
              callId: s.callId,
              name: s.name,
              args: s.args,
              startedAt: 0,
              result: s.result,
              ok: s.ok,
              durationMs: 0,
            };
          }
          return s;
        });
        return { kind: "assistant", turn: m.turn, segments, pending: false };
      });
      let sessionFiles: SessionFile[] = [];
      for (const m of loaded) {
        if (m.kind !== "assistant") continue;
        for (const s of m.segments) {
          if (s.kind !== "tool") continue;
          // For replayed sessions we don't have tool.result ok-status here, but
          // segments only survive into history if the call completed. Trust it.
          sessionFiles = mergeSessionFiles(sessionFiles, extractToolFiles(s.name, s.args));
        }
      }
      return {
        ...state,
        busy: false,
        currentSession: sessionName,
        messages: loaded,
        pendingConfirms: [],
        pendingPathAccess: [],
        pendingChoices: [],
        pendingPlans: [],
        pendingCheckpoints: [],
        pendingRevisions: [],
        activePlan: null,
        usage: {
          ...zeroUsage(),
          totalCostUsd: ev.carryover.totalCostUsd,
          totalPromptTokens: ev.carryover.cacheHitTokens + ev.carryover.cacheMissTokens,
          cacheHitTokens: ev.carryover.cacheHitTokens,
          cacheMissTokens: ev.carryover.cacheMissTokens,
        },
        sessionFiles,
        activeSkill: null,
        queuedSends: [],
        retryNonce: 0,
      };
    }
    case "$session_empty": {
      // The sidecar successfully ran loadSessionMessages but the jsonl is
      // empty / all-malformed. Without this, the click looks like a no-op
      // because the chat just re-renders empty. Issue #1179.
      const sizeNote = ev.sizeBytes === 0 ? "0 bytes" : `${ev.sizeBytes} bytes, no valid entries`;
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            kind: "error",
            message:
              `Session "${ev.name}" loaded with no messages (${sizeNote}). ` +
              `The file ~/.reasonix/sessions/${ev.name}.jsonl exists but couldn't be parsed — ` +
              `start a new chat or restore from .jsonl.bak if you have one.`,
          },
        ],
      };
    }
    case "$error":
    case "error":
      return {
        ...state,
        busy: false,
        activeSkill: null,
        messages: [...state.messages, { kind: "error", message: ev.message }],
      };
    case "model.turn.started":
      if (state.messages.some((m) => m.kind === "assistant" && m.turn === ev.turn)) {
        return { ...state, model: ev.model };
      }
      return {
        ...state,
        model: ev.model,
        messages: [
          ...state.messages,
          { kind: "assistant", turn: ev.turn, segments: [], pending: true },
        ],
      };
    case "model.delta":
      return {
        ...state,
        messages: state.messages.map((m) => {
          if (m.kind !== "assistant" || m.turn !== ev.turn) return m;
          if (ev.channel === "content") {
            return { ...m, segments: appendTextSegment(m.segments, "text", ev.text) };
          }
          if (ev.channel === "reasoning") {
            return { ...m, segments: appendTextSegment(m.segments, "reasoning", ev.text) };
          }
          return m;
        }),
      };
    case "model.final": {
      const u = ev.usage;
      const callHit = u?.prompt_cache_hit_tokens ?? 0;
      const callMiss = u?.prompt_cache_miss_tokens ?? 0;
      const hasCall = callHit > 0 || callMiss > 0;
      const usage: UsageStats = {
        totalCostUsd: state.usage.totalCostUsd + (ev.costUsd ?? 0),
        totalPromptTokens: state.usage.totalPromptTokens + (u?.prompt_tokens ?? 0),
        totalCompletionTokens: state.usage.totalCompletionTokens + (u?.completion_tokens ?? 0),
        cacheHitTokens: state.usage.cacheHitTokens + callHit,
        cacheMissTokens: state.usage.cacheMissTokens + callMiss,
        lastCallCacheHit: hasCall ? callHit : state.usage.lastCallCacheHit,
        lastCallCacheMiss: hasCall ? callMiss : state.usage.lastCallCacheMiss,
        reservedTokens: state.usage.reservedTokens,
        logTokens: state.usage.logTokens,
        lastPromptTokens: u?.prompt_tokens ?? state.usage.lastPromptTokens,
        contextCapTokens: state.usage.contextCapTokens,
        lastTurnCostUsd: ev.costUsd ?? state.usage.lastTurnCostUsd,
      };
      return {
        ...state,
        usage,
        messages: state.messages.map((m) => {
          if (m.kind !== "assistant" || m.turn !== ev.turn) return m;
          return { ...m, pending: false };
        }),
      };
    }
    case "tool.preparing":
      return {
        ...state,
        messages: state.messages.map((m) => {
          if (m.kind !== "assistant" || m.turn !== ev.turn) return m;
          if (m.segments.some((s) => s.kind === "tool" && s.callId === ev.callId)) return m;
          return {
            ...m,
            segments: [
              ...m.segments,
              {
                kind: "tool",
                callId: ev.callId,
                name: ev.name,
                args: "",
                startedAt: Date.now(),
              },
            ],
          };
        }),
      };
    case "tool.intent": {
      const adds = extractToolFiles(ev.name, ev.args);
      return {
        ...state,
        sessionFiles: mergeSessionFiles(state.sessionFiles, adds),
        messages: state.messages.map((m) => {
          if (m.kind !== "assistant" || m.turn !== ev.turn) return m;
          const idx = m.segments.findIndex((s) => s.kind === "tool" && s.callId === ev.callId);
          if (idx >= 0) {
            const segs = [...m.segments];
            const seg = segs[idx];
            if (seg?.kind === "tool") {
              segs[idx] = { ...seg, args: ev.args };
            }
            return { ...m, segments: segs };
          }
          return {
            ...m,
            segments: [
              ...m.segments,
              {
                kind: "tool",
                callId: ev.callId,
                name: ev.name,
                args: ev.args,
                startedAt: Date.now(),
              },
            ],
          };
        }),
      };
    }
    case "tool.result":
      return {
        ...state,
        messages: state.messages.map((m) => {
          if (m.kind !== "assistant") return m;
          let mutated = false;
          const segs = m.segments.map((s) => {
            if (s.kind === "tool" && s.callId === ev.callId) {
              mutated = true;
              return {
                ...s,
                result: ev.output,
                ok: ev.ok,
                durationMs: Date.now() - s.startedAt,
              };
            }
            return s;
          });
          return mutated ? { ...m, segments: segs } : m;
        }),
      };
    case "$retry_result":
      return { ...state, retryText: ev.text, retryNonce: state.retryNonce + 1 };
    case "$btw_result":
      return {
        ...state,
        messages: [...state.messages, { kind: "status", text: `≫ btw\n${ev.answer}` }],
      };
    case "status":
      return state;
    case "warning":
      // High-severity only — eventize already drops "low". Render as a quiet
      // inline divider so users see compaction / abort / rate-limit events
      // without confusing them for errors.
      if (ev.severity !== "high") return state;
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            kind: "warning",
            id: `w-${ev.id}`,
            text: ev.text,
            severity: ev.severity,
          },
        ],
      };
    default:
      return state;
  }
}
