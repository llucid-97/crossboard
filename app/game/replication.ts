import { normalizeGameState } from "./engine";
import { GameState, isPlayerId, PlayerId } from "./types";

export const STATE_CHAIN_VERSION = 1;
export const MAX_STATE_CHAIN_ENTRIES = 48;

export interface StateTimestamp {
  wallTime: number;
  counter: number;
  playerId: PlayerId;
}

export interface StateChainEntry {
  timestamp: StateTimestamp;
  state: GameState;
}

export interface StateChain {
  version: typeof STATE_CHAIN_VERSION;
  roomCode: string;
  entries: StateChainEntry[];
}

export interface StateChainSummary {
  digest: string;
  latestStateHash: string;
  entryCount: number;
}

export function compareStateTimestamps(
  first: StateTimestamp,
  second: StateTimestamp,
): number {
  return (
    first.wallTime - second.wallTime ||
    first.counter - second.counter ||
    first.playerId.localeCompare(second.playerId)
  );
}

export function compareStateChainEntries(
  first: StateChainEntry,
  second: StateChainEntry,
): number {
  return (
    compareStateTimestamps(first.timestamp, second.timestamp) ||
    first.state.revision - second.state.revision ||
    first.state.stateHash.localeCompare(second.state.stateHash)
  );
}

function isStateTimestamp(value: unknown): value is StateTimestamp {
  if (!value || typeof value !== "object") {
    return false;
  }
  const timestamp = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(timestamp.wallTime) &&
    Number(timestamp.wallTime) >= 0 &&
    Number.isSafeInteger(timestamp.counter) &&
    Number(timestamp.counter) >= 0 &&
    isPlayerId(timestamp.playerId)
  );
}

function canonicalizeEntries(
  entries: StateChainEntry[],
): StateChainEntry[] {
  const byHash = new Map<string, StateChainEntry>();
  for (const entry of entries) {
    const existing = byHash.get(entry.state.stateHash);
    if (
      !existing ||
      compareStateTimestamps(entry.timestamp, existing.timestamp) < 0
    ) {
      byHash.set(entry.state.stateHash, entry);
    }
  }
  return [...byHash.values()]
    .sort(compareStateChainEntries)
    .slice(-MAX_STATE_CHAIN_ENTRIES);
}

export function latestStateChainEntry(
  chain: StateChain,
): StateChainEntry {
  const latest = chain.entries.at(-1);
  if (!latest) {
    throw new Error("State chain is empty");
  }
  return latest;
}

export function createStateChain(
  state: GameState,
  playerId: PlayerId,
  wallTime = Date.now(),
): StateChain {
  return {
    version: STATE_CHAIN_VERSION,
    roomCode: state.roomCode,
    entries: [
      {
        timestamp: {
          wallTime: Math.max(0, Math.floor(wallTime)),
          counter: 0,
          playerId,
        },
        state,
      },
    ],
  };
}

export function appendStateChain(
  chain: StateChain,
  state: GameState,
  playerId: PlayerId,
  wallTime = Date.now(),
): StateChain {
  if (state.roomCode !== chain.roomCode) {
    throw new Error("Cannot append a different room to this state chain");
  }
  if (chain.entries.some((entry) => entry.state.stateHash === state.stateHash)) {
    return chain;
  }
  const latest = latestStateChainEntry(chain);
  const physicalTime = Math.max(0, Math.floor(wallTime));
  const nextWallTime = Math.max(physicalTime, latest.timestamp.wallTime);
  const counter =
    nextWallTime === latest.timestamp.wallTime
      ? latest.timestamp.counter + 1
      : 0;
  return {
    ...chain,
    entries: canonicalizeEntries([
      ...chain.entries,
      {
        timestamp: {
          wallTime: nextWallTime,
          counter,
          playerId,
        },
        state,
      },
    ]),
  };
}

export function mergeStateChains(
  first: StateChain,
  second: StateChain,
): StateChain {
  if (first.roomCode !== second.roomCode) {
    throw new Error("Cannot merge state chains from different rooms");
  }
  return {
    version: STATE_CHAIN_VERSION,
    roomCode: first.roomCode,
    entries: canonicalizeEntries([...first.entries, ...second.entries]),
  };
}

export function stateChainDigest(chain: StateChain): string {
  const input = chain.entries
    .map(
      (entry) =>
        `${entry.state.stateHash}@${entry.timestamp.wallTime.toString(36)}.${entry.timestamp.counter.toString(36)}.${entry.timestamp.playerId}`,
    )
    .join("|");
  let first = 2166136261;
  let second = 2246822507;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 3266489909);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

export function stateChainSummary(chain: StateChain): StateChainSummary {
  return {
    digest: stateChainDigest(chain),
    latestStateHash: latestStateChainEntry(chain).state.stateHash,
    entryCount: chain.entries.length,
  };
}

export function stateChainMatchesSummary(
  chain: StateChain,
  summary: StateChainSummary,
): boolean {
  const local = stateChainSummary(chain);
  return (
    local.digest === summary.digest &&
    local.latestStateHash === summary.latestStateHash &&
    local.entryCount === summary.entryCount
  );
}

export function normalizeStateChain(value: unknown): StateChain | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== STATE_CHAIN_VERSION ||
    typeof candidate.roomCode !== "string" ||
    !Array.isArray(candidate.entries) ||
    !candidate.entries.length ||
    candidate.entries.length > MAX_STATE_CHAIN_ENTRIES * 2
  ) {
    return null;
  }

  const entries: StateChainEntry[] = [];
  for (const value of candidate.entries) {
    if (!value || typeof value !== "object") {
      return null;
    }
    const entry = value as Record<string, unknown>;
    if (!isStateTimestamp(entry.timestamp)) {
      return null;
    }
    const rawState = entry.state as { schemaVersion?: unknown } | undefined;
    if (rawState?.schemaVersion !== 4) {
      return null;
    }
    const state = normalizeGameState(entry.state);
    if (!state || state.roomCode !== candidate.roomCode) {
      return null;
    }
    entries.push({
      timestamp: entry.timestamp,
      state,
    });
  }

  return {
    version: STATE_CHAIN_VERSION,
    roomCode: candidate.roomCode,
    entries: canonicalizeEntries(entries),
  };
}
