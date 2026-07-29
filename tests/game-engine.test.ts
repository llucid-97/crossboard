import assert from "node:assert/strict";
import test from "node:test";
import { chooseComputerMove } from "../app/game/ai";
import {
  applyMove,
  calculateStateHash,
  createGameState,
  createInitialBoard,
  createPracticeGame,
  getAllLegalMoves,
  getLegalMovesForPiece,
  getUndoActionCount,
  isPlayableSquare,
  normalizeGameState,
  playerAppearance,
  squareKey,
  startGame,
  teamOf,
  updateLobby,
  undoLastTurn,
} from "../app/game/engine";
import {
  configureFriendsVsComputers,
  runLobbyCommand,
} from "../app/game/lobby";
import {
  coordinatorOwnsState,
  electCoordinator,
  seatPeerId,
  shouldAdoptSnapshot,
  undoRequesterFor,
} from "../app/game/network";
import {
  BoardState,
  GameMode,
  GameState,
  Piece,
  PlayerColor,
  PLAYER_COLORS,
  TeamAssignments,
} from "../app/game/types";

function piece(
  color: PlayerColor,
  type: Piece["type"],
  id: string,
): Piece {
  return { id, color, type, hasMoved: false };
}

function position(
  mode: GameMode,
  board: BoardState,
  turn: PlayerColor = "red",
): GameState {
  const initial = createGameState("TEST-ROOM-01", mode);
  const seats = { ...initial.seats };
  PLAYER_COLORS.forEach((color) => {
    seats[color] = {
      color,
      controller: color === "red" ? "human" : "computer",
      name: color,
    };
  });
  const state: GameState = {
    ...initial,
    seats,
    mode,
    phase: "playing",
    board,
    turn,
    revision: 4,
    lastActionId: "fixture",
    stateHash: "",
  };
  return { ...state, stateHash: calculateStateHash(state) };
}

test("the 14 by 14 cross contains 160 playable squares", () => {
  let playable = 0;
  for (let row = 0; row < 14; row += 1) {
    for (let col = 0; col < 14; col += 1) {
      playable += isPlayableSquare(row, col) ? 1 : 0;
    }
  }
  assert.equal(playable, 160);
  assert.equal(isPlayableSquare(0, 0), false);
  assert.equal(isPlayableSquare(0, 3), true);
  assert.equal(isPlayableSquare(13, 10), true);
});

test("initial setup gives every color sixteen pieces", () => {
  const board = createInitialBoard();
  assert.equal(Object.keys(board).length, 64);
  for (const color of PLAYER_COLORS) {
    assert.equal(
      Object.values(board).filter((candidate) => candidate.color === color).length,
      16,
    );
  }
});

test("chess practice starts directly in teams or free-for-all", () => {
  const teams = createPracticeGame("teams", "Player", "chess");
  assert.equal(teams.phase, "playing");
  assert.equal(teams.mode, "teams");
  assert.equal(teams.seats.red.controller, "human");
  assert.equal(teams.seats.yellow.controller, "computer");
  assert.equal(
    teamOf("red", teams.teamAssignments),
    teamOf("yellow", teams.teamAssignments),
  );

  const freeForAll = createPracticeGame("ffa", "Player", "chess");
  assert.equal(freeForAll.phase, "playing");
  assert.equal(freeForAll.mode, "ffa");
  for (const color of ["blue", "yellow", "green"] as const) {
    assert.equal(freeForAll.seats[color].controller, "computer");
  }
});

test("the friends preset opens an invite online but stays startable locally", () => {
  const base = createGameState(
    "TEST-PRESET-SCOPE",
    "ffa",
    "Player",
    "checkers",
  );
  const local = configureFriendsVsComputers(base, "red", false);
  for (const color of ["blue", "yellow", "green"] as const) {
    assert.equal(local.seats[color].controller, "computer");
  }
  assert.equal(startGame(local).phase, "playing");

  const networked = configureFriendsVsComputers(base, "red", true);
  assert.equal(networked.seats.yellow.controller, "open");
  assert.equal(networked.seats.blue.controller, "computer");
  assert.equal(networked.seats.green.controller, "computer");
  assert.equal(startGame(networked).phase, "lobby");
});

test("pawns move one or two squares and promote on the rank-eleven line", () => {
  const opening = startGame(
    updateLobby(createGameState("TEST-ROOM-02", "ffa"), {
      seats: {
        red: { color: "red", controller: "human", name: "Red" },
        blue: { color: "blue", controller: "computer", name: "Blue" },
        yellow: { color: "yellow", controller: "computer", name: "Yellow" },
        green: { color: "green", controller: "computer", name: "Green" },
      },
    }, "ready"),
  );
  const pawnMoves = getLegalMovesForPiece(opening, { row: 12, col: 6 });
  assert.deepEqual(
    pawnMoves.map((move) => move.to.row).sort(),
    [10, 11],
  );

  const promotion = position("ffa", {
    "4,6": piece("red", "pawn", "red-pawn"),
    "8,6": piece("red", "king", "red-king"),
    "4,8": piece("blue", "king", "blue-king"),
    "2,7": piece("yellow", "king", "yellow-king"),
    "7,11": piece("green", "king", "green-king"),
  });
  const promoted = applyMove(promotion, {
    from: { row: 4, col: 6 },
    to: { row: 3, col: 6 },
  });
  assert.equal(promoted.board["3,6"].type, "queen");
  const restored = undoLastTurn(promoted);
  assert.equal(restored.board["4,6"].type, "pawn");
  assert.equal(restored.board["4,6"].hasMoved, false);
  assert.equal(restored.board["3,6"], undefined);
});

test("capturing a king eliminates a color in free-for-all", () => {
  const state = position("ffa", {
    "6,5": piece("red", "rook", "red-rook"),
    "8,6": piece("red", "king", "red-king"),
    "6,7": piece("blue", "king", "blue-king"),
    "7,7": piece("blue", "pawn", "blue-pawn"),
    "2,7": piece("yellow", "king", "yellow-king"),
    "7,11": piece("green", "king", "green-king"),
  });
  const next = applyMove(state, {
    from: { row: 6, col: 5 },
    to: { row: 6, col: 7 },
  });
  assert.deepEqual(next.eliminated, ["blue"]);
  assert.equal(
    Object.values(next.board).some((candidate) => candidate.color === "blue"),
    false,
  );
  assert.equal(next.turn, "yellow");
  assert.equal(next.phase, "playing");
});

test("capturing either enemy king immediately wins a team game", () => {
  const state = position("teams", {
    "6,5": piece("red", "rook", "red-rook"),
    "8,6": piece("red", "king", "red-king"),
    "6,7": piece("blue", "king", "blue-king"),
    "2,7": piece("yellow", "king", "yellow-king"),
    "7,11": piece("green", "king", "green-king"),
  });
  const next = applyMove(state, {
    from: { row: 6, col: 5 },
    to: { row: 6, col: 7 },
  });
  assert.equal(next.phase, "finished");
  assert.deepEqual(next.winners, ["red", "yellow"]);

  const restored = undoLastTurn(next);
  assert.deepEqual(restored.board, state.board);
  assert.deepEqual(restored.eliminated, state.eliminated);
  assert.equal(restored.phase, "playing");
  assert.equal(restored.winners, null);
});

test("the casual four-ply bot is deterministic and returns a legal move", () => {
  const initial = createGameState("TEST-ROOM-03", "ffa");
  const seats = { ...initial.seats };
  PLAYER_COLORS.forEach((color) => {
    seats[color] = {
      color,
      controller: "computer",
      name: color,
    };
  });
  const game = startGame(updateLobby(initial, { seats }, "ready"));
  const first = chooseComputerMove(game, "red");
  const second = chooseComputerMove(game, "red");
  assert.deepEqual(first, second);
  assert.ok(first);
  assert.ok(
    getAllLegalMoves(game, "red").some(
      (move) =>
        squareKey(move.from) === squareKey(first.from) &&
        squareKey(move.to) === squareKey(first.to),
    ),
  );
});

test("one undo rewinds a human chess move and every computer reply", () => {
  const opening = createPracticeGame("ffa", "Player", "chess");
  let played = opening;
  for (let index = 0; index < PLAYER_COLORS.length; index += 1) {
    const move = getAllLegalMoves(played, played.turn)[0];
    assert.ok(move);
    played = applyMove(played, move);
  }

  assert.equal(played.turn, "red");
  assert.equal(played.history.length, 4);
  assert.equal(played.undoStack?.length, 1);
  assert.equal(getUndoActionCount(played), 1);

  const undone = undoLastTurn(played);
  assert.deepEqual(undone.board, opening.board);
  assert.equal(undone.turn, opening.turn);
  assert.equal(undone.round, opening.round);
  assert.equal(undone.history.length, 0);
  assert.equal(undone.undoStack?.length, 0);
  assert.equal(undone.revision, played.revision + 1);
  assert.equal(undone.parentHash, played.stateHash);
  assert.equal(calculateStateHash(undone), undone.stateHash);
  assert.equal(shouldAdoptSnapshot(played, undone), true);
  assert.equal(shouldAdoptSnapshot(undone, played), false);
});

test("verified v1 and v2 chess recovery copies migrate to schema v3", () => {
  const current = createGameState("TEST-LEGACY", "teams", "Player");
  for (const schemaVersion of [1, 2] as const) {
    const legacy = {
      ...current,
      schemaVersion,
      gameKind: undefined,
      teamAssignments: undefined,
      checkersRules: undefined,
      continuationFrom: undefined,
      pendingCapturedSquares: undefined,
      undoStack: schemaVersion === 2 ? [] : undefined,
      stateHash: "",
    };
    legacy.stateHash = calculateStateHash(
      legacy as unknown as GameState,
    );

    const migrated = normalizeGameState(legacy);
    assert.ok(migrated);
    assert.equal(migrated.schemaVersion, 3);
    assert.equal(migrated.gameKind, "chess");
    assert.deepEqual(migrated.undoStack, []);
    assert.deepEqual(migrated.pendingCapturedSquares, []);
    assert.equal(
      migrated.checkersRules.deferredCaptureRemoval,
      false,
    );
    assert.equal(migrated.checkersRules.deferredPromotion, false);
    assert.equal(migrated.revision, legacy.revision + 1);
    assert.equal(migrated.parentHash, legacy.stateHash);
    assert.equal(calculateStateHash(migrated), migrated.stateHash);
  }
});

test("a schema-v2 undo frame migrates with explicit checkers continuation fields", () => {
  const opening = createPracticeGame("ffa", "Player", "chess");
  const played = applyMove(
    opening,
    getAllLegalMoves(opening, "red")[0],
  );
  const legacy = {
    ...played,
    schemaVersion: 2,
    gameKind: undefined,
    teamAssignments: undefined,
    checkersRules: undefined,
    continuationFrom: undefined,
    pendingCapturedSquares: undefined,
    undoStack: played.undoStack?.map((frame) => ({
      actor: frame.actor,
      phase: frame.phase,
      board: frame.board,
      turn: frame.turn,
      round: frame.round,
      historyLength: frame.historyLength,
      eliminated: frame.eliminated,
      winners: frame.winners,
    })),
    stateHash: "",
  };
  legacy.stateHash = calculateStateHash(legacy as unknown as GameState);

  const migrated = normalizeGameState(legacy);
  assert.ok(migrated);
  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.undoStack?.length, 1);
  assert.equal(migrated.undoStack?.[0].continuationFrom, null);
  assert.deepEqual(migrated.undoStack?.[0].pendingCapturedSquares, []);
});

test("host election moves to the lowest connected human seat", () => {
  const state = createGameState("TEST-ROOM-04", "teams");
  state.seats.yellow = {
    color: "yellow",
    controller: "human",
    name: "Yellow",
  };
  state.seats.green = {
    color: "green",
    controller: "human",
    name: "Green",
  };
  assert.equal(electCoordinator(state, "yellow", ["green"]), "yellow");
  assert.equal(electCoordinator(state, "green", []), "green");
});

test("timer guards reject stale state and a coordinator handoff", () => {
  const state = createGameState("TEST-TIMER-GUARD", "teams");
  state.seats.yellow = {
    color: "yellow",
    controller: "human",
    name: "Yellow",
  };
  state.stateHash = calculateStateHash(state);

  assert.equal(
    coordinatorOwnsState(state, state.stateHash, "red", ["yellow"]),
    true,
  );
  assert.equal(
    coordinatorOwnsState(state, "stale-hash", "red", ["yellow"]),
    false,
  );
  assert.equal(
    coordinatorOwnsState(state, state.stateHash, "yellow", ["red"]),
    false,
  );
});

test("only the coordinator accepts a current undo request from its human seat", () => {
  const state = createPracticeGame("teams", "Red", "chess");
  state.seats.yellow = {
    color: "yellow",
    controller: "human",
    name: "Yellow",
  };
  state.stateHash = calculateStateHash(state);
  const yellowPeerId = seatPeerId(state.roomCode, "yellow");

  assert.equal(
    undoRequesterFor(
      state,
      "red",
      ["yellow"],
      yellowPeerId,
      state.stateHash,
    ),
    "yellow",
  );
  assert.equal(
    undoRequesterFor(state, "red", ["yellow"], yellowPeerId, "stale"),
    null,
  );
});

test("every accepted action advances a deterministic hash chain", () => {
  const initial = createGameState("TEST-ROOM-05", "teams");
  const changed = updateLobby(initial, { mode: "ffa" }, "mode-ffa");
  assert.equal(changed.parentHash, initial.stateHash);
  assert.notEqual(changed.stateHash, initial.stateHash);
  assert.equal(calculateStateHash(changed), changed.stateHash);
});

test("team assignments are replicated and change the deterministic hash", () => {
  const initial = createGameState("TEST-ROOM-TEAMS", "teams");
  const teamAssignments: TeamAssignments = {
    red: "warm",
    blue: "warm",
    yellow: "warm",
    green: "cool",
  };
  const changed = updateLobby(
    initial,
    { teamAssignments },
    "three-versus-one",
  );
  assert.equal(changed.parentHash, initial.stateHash);
  assert.notEqual(changed.stateHash, initial.stateHash);
  assert.equal(calculateStateHash(changed), changed.stateHash);
});

test("team palettes label two-player and three-player sides consistently", () => {
  const initial = createGameState("TEST-ROOM-PALETTE", "teams");
  assert.equal(
    playerAppearance("red", "teams", initial.teamAssignments).label,
    "Light red",
  );
  assert.equal(
    playerAppearance("yellow", "teams", initial.teamAssignments).label,
    "Dark red",
  );
  assert.equal(
    playerAppearance("blue", "teams", initial.teamAssignments).label,
    "Light blue",
  );

  const threeVersusOne: TeamAssignments = {
    red: "warm",
    blue: "warm",
    yellow: "warm",
    green: "cool",
  };
  assert.equal(
    playerAppearance("yellow", "teams", threeVersusOne).label,
    "Orange",
  );
  assert.equal(
    playerAppearance("green", "teams", threeVersusOne).label,
    "Light blue",
  );
});

test("partitioned copies choose the same first child after their common ancestor", () => {
  const base = createGameState("TEST-ROOM-06", "teams");
  const ffaBranch = updateLobby(base, { mode: "ffa" }, "branch-ffa");
  const seats = {
    ...base.seats,
    green: {
      color: "green" as const,
      controller: "open" as const,
      name: "Open seat",
    },
  };
  const seatBranch = updateLobby(base, { seats }, "branch-seat");
  const expectedWinner =
    ffaBranch.stateHash.localeCompare(seatBranch.stateHash) < 0
      ? ffaBranch
      : seatBranch;
  const expectedLoser =
    expectedWinner === ffaBranch ? seatBranch : ffaBranch;

  assert.equal(shouldAdoptSnapshot(expectedLoser, expectedWinner), true);
  assert.equal(shouldAdoptSnapshot(expectedWinner, expectedLoser), false);

  const extendedWinner = updateLobby(
    expectedWinner,
    { mode: expectedWinner.mode },
    "winner-extension",
  );
  assert.equal(shouldAdoptSnapshot(expectedLoser, extendedWinner), true);
});

test("rapid lobby edits and Start serialize from the latest committed state", () => {
  const initial = createGameState(
    "TEST-LOBBY-SERIAL",
    "teams",
    "Red",
    "checkers",
  );
  const seats = { ...initial.seats };
  PLAYER_COLORS.forEach((color) => {
    seats[color] = {
      color,
      controller: color === "red" ? "human" : "computer",
      name: color,
    };
  });
  const ready = updateLobby(initial, { seats }, "fill-seats");
  const ref: { current: GameState | null } = { current: ready };
  const commit = (next: GameState) => {
    ref.current = next;
  };

  const edited = runLobbyCommand(ref, commit, (current) =>
    updateLobby(
      current,
      {
        checkersRules: {
          ...current.checkersRules,
          preset: "custom",
          flyingKings: false,
        },
      },
      "rapid-rule-edit",
    ),
  );
  const started = runLobbyCommand(ref, commit, startGame);

  assert.ok(edited);
  assert.ok(started);
  assert.equal(started.parentHash, edited.stateHash);
  assert.equal(started.checkersRules.flyingKings, false);
  assert.equal(started.phase, "playing");
});
