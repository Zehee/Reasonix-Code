/**
 * Refined turn orchestrator.
 *
 * Delegates extraction, storage, and row mapping to focused modules under
 * src/refine/. This file keeps the original public API and owns cross-cutting
 * concerns such as the write mutex.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { workspaceSlug } from "../memory/session.js";
import { type DenoisedTurn, denoisedToRefined } from "./denoise.js";
import { extract } from "./extractor.js";
import { RefinedStore } from "./store.js";
import type { RawTurn, RefinedSearchMatch, RefinedSearchOptions, RefinedTurn } from "./types.js";
import { Mutex } from "./utils/mutex.js";

function refinedRootForCwd(): string {
  const cwd = process.cwd();
  const slug = workspaceSlug(cwd);
  return join(homedir(), ".reasonix", "refined", slug);
}

let _sharedRefinedManager: RefinedManager | null = null;

/**
 * Shared RefinedManager for the current workspace.
 * Tools and ContextManager both use this instance.
 */
export function getRefinedManager(): RefinedManager {
  if (!_sharedRefinedManager) {
    _sharedRefinedManager = new RefinedManager(refinedRootForCwd());
  }
  return _sharedRefinedManager;
}

export type {
  RawAction,
  RawTurn,
  RefinedTurn,
  RefinedSearchOptions,
  RefinedSearchMatch,
} from "./types.js";
export type { DenoisedTurn, DenoiseSource } from "./denoise.js";

export class RefinedManager {
  refinedRoot: string;
  private store: RefinedStore;
  private mutex: Mutex;

  constructor(refinedRoot: string) {
    this.refinedRoot = refinedRoot;
    this.store = new RefinedStore(refinedRoot);
    this.mutex = new Mutex();
  }

  refineTurn(turn: RawTurn, sessionId: string): RefinedTurn {
    return extract(turn, sessionId);
  }

  /**
   * Save denoised turns by converting them to the legacy RefinedTurn shape.
   * This keeps the SQLite schema stable while the internal model evolves.
   */
  async saveDenoisedTurns(denoisedTurns: DenoisedTurn[]): Promise<void> {
    return this.mutex.runExclusive(() => {
      const bySession = new Map<string, DenoisedTurn[]>();
      for (const turn of denoisedTurns) {
        const list = bySession.get(turn.sessionId) ?? [];
        list.push(turn);
        bySession.set(turn.sessionId, list);
      }
      for (const [sessionId, turns] of bySession) {
        const refined = turns.map(denoisedToRefined);
        this.store.saveRefinedTurns(sessionId, refined);
      }
    });
  }

  async saveRefinedTurns(sessionId: string, refinedTurns: RefinedTurn[]): Promise<void> {
    return this.mutex.runExclusive(() => {
      this.store.saveRefinedTurns(sessionId, refinedTurns);
    });
  }

  loadRefinedTurns(sessionId: string): RefinedTurn[] {
    return this.store.loadRefinedTurns(sessionId);
  }

  loadRefinedTurn(sessionId: string, turnId: number): RefinedTurn | undefined {
    return this.store.loadRefinedTurn(sessionId, turnId);
  }

  getDbPath(): string {
    return this.store.getDbPath();
  }

  searchRefinedTurns(options: RefinedSearchOptions): RefinedSearchMatch[] {
    return this.store.searchRefinedTurns(options);
  }

  countAll(): number {
    return this.store.countAll();
  }

  listRecentTurns(limit: number): RefinedTurn[] {
    return this.store.listRecentTurns(limit);
  }

  async deleteRefinedTurns(refs: Array<{ sessionId: string; turnId: number }>): Promise<number> {
    return this.mutex.runExclusive(() => {
      return this.store.deleteRefinedTurns(refs);
    });
  }

  recordTurnAttention(query: string, refs: Array<{ sessionId: string; turnId: number }>): void {
    this.store.recordTurnAttention(query, refs);
  }

  close(): void {
    this.store.close();
  }
}
