import assert from "node:assert/strict";
import test from "node:test";
import {
  assignPlayerIdentity,
  calculateStateHash,
  createGameState,
  createPracticeGame,
  normalizeGameState,
  updateLobby,
} from "../app/game/engine";
import { formatPlayerId } from "../app/game/identity";
import { playerSeatFor } from "../app/game/network";
import {
  appendStateChain,
  createStateChain,
  latestStateChainEntry,
  MAX_STATE_CHAIN_ENTRIES,
  mergeStateChains,
  normalizeStateChain,
} from "../app/game/replication";
import { GameState } from "../app/game/types";

const RED_ID = "CB-AAAA-BBBB-CCCC-DDDD";
const YELLOW_ID = "CB-EEEE-FFFF-GGGG-HHHH";

test("player codes are readable, stable-width identifiers", () => {
  const bytes = Uint8Array.from({ length: 16 }, (_, index) => index);
  const first = formatPlayerId(bytes);
  const second = formatPlayerId(bytes);

  assert.equal(first, second);
  assert.match(first, /^CB-[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/);
});

test("a legacy human seat can gain one recovery identity after play starts", () => {
  const playing = createPracticeGame("teams", "Red", "chess");
  const claimed = assignPlayerIdentity(playing, "red", RED_ID);

  assert.equal(claimed.phase, "playing");
  assert.equal(claimed.seats.red.playerId, RED_ID);
  assert.equal(claimed.parentHash, playing.stateHash);
  assert.equal(claimed.revision, playing.revision + 1);
  assert.equal(calculateStateHash(claimed), claimed.stateHash);
  assert.equal(assignPlayerIdentity(claimed, "red", YELLOW_ID), claimed);
});

test("a logical timestamp advances when a device clock stalls or moves backward", () => {
  const initial = createGameState(
    "CHAIN-CLOCK",
    "teams",
    "Red",
    "chess",
    RED_ID,
  );
  const chain = createStateChain(initial, RED_ID, 1_000);
  const changed = updateLobby(initial, { mode: "ffa" }, "clock-change");
  const appended = appendStateChain(chain, changed, RED_ID, 900);
  const latest = latestStateChainEntry(appended);

  assert.equal(latest.timestamp.wallTime, 1_000);
  assert.equal(latest.timestamp.counter, 1);
  assert.equal(latest.timestamp.playerId, RED_ID);
});

test("partitioned chains merge deterministically and select the newest timestamp", () => {
  const initial = createGameState(
    "CHAIN-MERGE",
    "teams",
    "Red",
    "chess",
    RED_ID,
  );
  const root = createStateChain(initial, RED_ID, 1_000);
  const olderState = updateLobby(initial, { mode: "ffa" }, "older-branch");
  const newerState = updateLobby(
    initial,
    {
      seats: {
        ...initial.seats,
        yellow: {
          color: "yellow",
          controller: "human",
          name: "Yellow",
          playerId: YELLOW_ID,
        },
      },
    },
    "newer-branch",
  );
  const older = appendStateChain(root, olderState, RED_ID, 1_100);
  const newer = appendStateChain(root, newerState, YELLOW_ID, 1_200);

  const firstOrder = mergeStateChains(older, newer);
  const secondOrder = mergeStateChains(newer, older);
  assert.deepEqual(firstOrder, secondOrder);
  assert.equal(
    latestStateChainEntry(firstOrder).state.stateHash,
    newerState.stateHash,
  );
  assert.equal(
    playerSeatFor(latestStateChainEntry(firstOrder).state, YELLOW_ID),
    "yellow",
  );
});

test("merging the same checkpoint never gives it a newer timestamp", () => {
  const initial = createGameState(
    "CHAIN-DUPLICATE",
    "teams",
    "Red",
    "chess",
    RED_ID,
  );
  const earlier = createStateChain(initial, RED_ID, 1_000);
  const later = createStateChain(initial, YELLOW_ID, 9_000);
  const merged = mergeStateChains(later, earlier);

  assert.equal(merged.entries.length, 1);
  assert.equal(merged.entries[0].timestamp.wallTime, 1_000);
  assert.equal(merged.entries[0].timestamp.playerId, RED_ID);
});

test("recovery chains reject a state whose signed fields were changed", () => {
  const initial = createGameState(
    "CHAIN-TAMPER",
    "teams",
    "Red",
    "checkers",
    RED_ID,
  );
  const chain = createStateChain(initial, RED_ID, 1_000);
  const tampered = structuredClone(chain);
  tampered.entries[0].state.mode = "ffa";

  assert.equal(normalizeStateChain(tampered), null);
  assert.ok(normalizeStateChain(chain));
});

test("a forged recovery code is rejected even when the state is rehashed", () => {
  const initial = createGameState(
    "CHAIN-FORGED-IDENTITY",
    "teams",
    "Red",
    "chess",
    RED_ID,
  );
  const forged: GameState = {
    ...initial,
    seats: {
      ...initial.seats,
      red: {
        ...initial.seats.red,
        playerId: "not-a-player-code",
      },
    },
    stateHash: "",
  };
  forged.stateHash = calculateStateHash(forged);

  assert.equal(normalizeStateChain(createStateChain(forged, RED_ID)), null);
});

test("the bounded recovery chain works for both chess and checkers", () => {
  for (const gameKind of ["chess", "checkers"] as const) {
    let state = createGameState(
      `CHAIN-${gameKind.toUpperCase()}`,
      "teams",
      "Red",
      gameKind,
      RED_ID,
    );
    let chain = createStateChain(state, RED_ID, 1_000);
    for (let index = 1; index <= MAX_STATE_CHAIN_ENTRIES + 7; index += 1) {
      state = updateLobby(
        state,
        { mode: index % 2 ? "ffa" : "teams" },
        `${gameKind}-checkpoint-${index}`,
      );
      chain = appendStateChain(chain, state, RED_ID, 1_000 + index);
    }

    assert.equal(chain.entries.length, MAX_STATE_CHAIN_ENTRIES);
    assert.equal(latestStateChainEntry(chain).state.gameKind, gameKind);
    assert.equal(latestStateChainEntry(chain).state.stateHash, state.stateHash);
    assert.ok(normalizeStateChain(chain));
  }
});

test("verified schema-v3 states migrate without claiming a recovery identity", () => {
  const current = createGameState(
    "CHAIN-SCHEMA-V3",
    "teams",
    "Red",
    "chess",
    RED_ID,
  );
  const seats = Object.fromEntries(
    Object.entries(current.seats).map(([color, seat]) => [
      color,
      {
        color: seat.color,
        controller: seat.controller,
        name: seat.name,
        peerId: seat.peerId,
      },
    ]),
  );
  const legacy = {
    ...current,
    schemaVersion: 3,
    seats,
    stateHash: "",
  };
  legacy.stateHash = calculateStateHash(legacy as unknown as GameState);

  const migrated = normalizeGameState(legacy);
  assert.ok(migrated);
  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migrated.seats.red.playerId, undefined);
  assert.equal(migrated.parentHash, legacy.stateHash);
});
