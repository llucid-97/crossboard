import assert from "node:assert/strict";
import test from "node:test";
import { chooseComputerMove } from "../app/game/ai";
import {
  applyMove,
  calculateStateHash,
  createGameState,
  getAllLegalMoves,
  getLegalMovesForPiece,
  normalizeGameState,
  passTurn,
  squareKey,
  startGame,
  undoLastTurn,
  updateLobby,
} from "../app/game/engine";
import {
  CheckersCaptureSearchDiagnostics,
  checkersRulesForPreset,
  checkersCapturesForPiece,
  createInitialCheckersBoard,
  getAllCheckersLegalMoves,
} from "../app/game/checkers";
import {
  BoardState,
  GameMode,
  GameState,
  Piece,
  PlayerColor,
  PLAYER_COLORS,
  TeamAssignments,
} from "../app/game/types";

function checker(
  color: PlayerColor,
  id: string,
  type: "man" | "crowned" = "man",
): Piece {
  return { id, color, type, hasMoved: false };
}

function position(
  mode: GameMode,
  board: BoardState,
  turn: PlayerColor = "red",
): GameState {
  const initial = createGameState(
    "CHECKERS-TEST",
    mode,
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
  const state: GameState = {
    ...initial,
    seats,
    phase: "playing",
    board,
    turn,
    revision: 4,
    lastActionId: "checkers-fixture",
    stateHash: "",
  };
  return { ...state, stateHash: calculateStateHash(state) };
}

test("four-player checkers starts with twelve dark-square men per color", () => {
  const board = createInitialCheckersBoard();
  assert.equal(Object.keys(board).length, 48);
  for (const color of PLAYER_COLORS) {
    const pieces = Object.entries(board).filter(
      ([, piece]) => piece.color === color,
    );
    assert.equal(pieces.length, 12);
    assert.ok(pieces.every(([, piece]) => piece.type === "man"));
    assert.ok(
      pieces.every(([key]) => {
        const [row, col] = key.split(",").map(Number);
        return (row + col) % 2 === 1;
      }),
    );
  }
});

test("all four colors open toward the center of the cross", () => {
  const initial = createGameState(
    "CHECKERS-OPENINGS",
    "ffa",
    "Red",
    "checkers",
  );
  const seats = { ...initial.seats };
  PLAYER_COLORS.forEach((color) => {
    seats[color] = { color, controller: "computer", name: color };
  });
  const started = startGame(updateLobby(initial, { seats }, "ready"));
  const expectedFront: Record<PlayerColor, (move: { to: { row: number; col: number } }) => boolean> = {
    red: (move) => move.to.row === 10,
    yellow: (move) => move.to.row === 3,
    blue: (move) => move.to.col === 3,
    green: (move) => move.to.col === 10,
  };
  for (const color of PLAYER_COLORS) {
    const colorState = { ...started, turn: color };
    const moves = getAllLegalMoves(colorState, color);
    assert.equal(moves.length, 7);
    assert.ok(moves.every(expectedFront[color]));
  }
});

test("men move forward while backward captures follow the selected variation", () => {
  const state = position("ffa", {
    "6,5": checker("red", "red"),
    "7,6": checker("blue", "blue"),
    "0,3": checker("yellow", "yellow"),
    "3,13": checker("green", "green"),
  });
  const houseMoves = getLegalMovesForPiece(state, { row: 6, col: 5 });
  assert.ok(
    houseMoves.some(
      (move) =>
        move.to.row === 8 &&
        move.to.col === 7 &&
        move.capturedSquare?.row === 7,
    ),
  );

  const american: GameState = {
    ...state,
    checkersRules: checkersRulesForPreset("american"),
  };
  const americanMoves = getLegalMovesForPiece(american, { row: 6, col: 5 });
  assert.equal(americanMoves.some((move) => move.capturedSquare), false);
  assert.deepEqual(
    americanMoves.map((move) => move.to),
    [
      { row: 5, col: 4 },
      { row: 5, col: 6 },
    ],
  );
});

test("a mandatory capture suppresses every ordinary move", () => {
  const state = position("ffa", {
    "6,5": checker("red", "red-capturer"),
    "8,3": checker("red", "red-walker"),
    "5,6": checker("blue", "blue"),
    "0,3": checker("yellow", "yellow"),
    "3,13": checker("green", "green"),
  });
  assert.deepEqual(
    getLegalMovesForPiece(state, { row: 8, col: 3 }),
    [],
  );
  const moves = getAllLegalMoves(state, "red");
  assert.equal(moves.length, 1);
  assert.deepEqual(moves[0].capturedSquare, { row: 5, col: 6 });
});

test("captures and ordinary moves coexist when forced captures are disabled", () => {
  const state = position("ffa", {
    "6,5": checker("red", "red-capturer"),
    "8,3": checker("red", "red-walker"),
    "5,6": checker("blue", "blue"),
    "0,3": checker("yellow", "yellow"),
    "3,13": checker("green", "green"),
  });
  const optionalState: GameState = {
    ...state,
    checkersRules: {
      ...state.checkersRules,
      preset: "custom",
      mandatoryCapture: false,
      maximumCapture: false,
    },
  };
  const moves = getAllLegalMoves(optionalState, "red");
  assert.ok(moves.some((move) => move.capturedSquare));
  assert.ok(moves.some((move) => !move.capturedSquare));
});

test("team partners block one another and can never be captured", () => {
  const state = position("teams", {
    "6,5": checker("red", "red"),
    "5,6": checker("yellow", "yellow-ally"),
    "0,3": checker("yellow", "yellow"),
    "3,0": checker("blue", "blue"),
    "3,13": checker("green", "green"),
  });
  const moves = getLegalMovesForPiece(state, { row: 6, col: 5 });
  assert.equal(
    moves.some(
      (move) =>
        move.capturedSquare?.row === 5 && move.capturedSquare.col === 6,
    ),
    false,
  );
  assert.ok(moves.some((move) => move.to.row === 5 && move.to.col === 4));
});

test("custom teams, not board position, decide who can be captured", () => {
  const state = position("teams", {
    "6,5": checker("red", "red"),
    "5,4": checker("blue", "blue-ally"),
    "5,6": checker("yellow", "yellow-opponent"),
    "3,13": checker("green", "green"),
  });
  const teamAssignments: TeamAssignments = {
    red: "warm",
    blue: "warm",
    yellow: "cool",
    green: "cool",
  };
  const moves = getLegalMovesForPiece(
    { ...state, teamAssignments },
    { row: 6, col: 5 },
  );
  assert.equal(moves.length, 1);
  assert.deepEqual(moves[0].capturedSquare, { row: 5, col: 6 });
  assert.deepEqual(moves[0].to, { row: 4, col: 7 });
});

test("a three-player team wins when the lone opponent is eliminated", () => {
  const state = position("teams", {
    "8,3": checker("red", "red"),
    "7,4": checker("blue", "blue"),
    "0,3": checker("yellow", "yellow"),
    "3,13": checker("green", "green"),
  });
  const teamAssignments: TeamAssignments = {
    red: "warm",
    blue: "cool",
    yellow: "warm",
    green: "warm",
  };
  const finished = applyMove(
    { ...state, teamAssignments },
    {
      from: { row: 8, col: 3 },
      to: { row: 6, col: 5 },
    },
  );
  assert.equal(finished.phase, "finished");
  assert.deepEqual(finished.winners, ["red", "yellow", "green"]);
});

test("captures chain with the same checker before the turn advances", () => {
  const first = position("ffa", {
    "8,3": checker("red", "red"),
    "7,4": checker("blue", "blue"),
    "5,6": checker("green", "green"),
    "0,3": checker("yellow", "yellow"),
  });
  const second = applyMove(first, {
    from: { row: 8, col: 3 },
    to: { row: 6, col: 5 },
  });
  assert.equal(second.turn, "red");
  assert.deepEqual(second.continuationFrom, { row: 6, col: 5 });
  assert.equal(second.history.at(-1)?.continued, true);
  assert.deepEqual(
    getAllLegalMoves(second, "red").map((move) => move.to),
    [{ row: 4, col: 7 }],
  );

  const third = applyMove(second, {
    from: { row: 6, col: 5 },
    to: { row: 4, col: 7 },
  });
  assert.equal(third.turn, "yellow");
  assert.equal(third.continuationFrom, null);
  assert.deepEqual(third.eliminated, ["blue", "green"]);
  assert.equal(third.history.length, 2);
});

test("one undo restores the position before a whole human capture chain and bot reply", () => {
  const opening = position("ffa", {
    "8,3": checker("red", "red"),
    "7,4": checker("blue", "blue"),
    "5,6": checker("green", "green"),
    "0,3": checker("yellow", "yellow"),
  });
  const firstJump = applyMove(opening, {
    from: { row: 8, col: 3 },
    to: { row: 6, col: 5 },
  });
  assert.equal(firstJump.undoStack?.length, 1);
  assert.deepEqual(firstJump.undoStack?.[0].continuationFrom, null);

  const completedTurn = applyMove(firstJump, {
    from: { row: 6, col: 5 },
    to: { row: 4, col: 7 },
  });
  assert.equal(completedTurn.undoStack?.length, 1);
  const botMove = getAllLegalMoves(completedTurn, "yellow")[0];
  assert.ok(botMove);
  const afterBot = applyMove(completedTurn, botMove);
  assert.equal(afterBot.undoStack?.length, 1);

  const restored = undoLastTurn(afterBot);
  assert.deepEqual(restored.board, opening.board);
  assert.equal(restored.turn, opening.turn);
  assert.equal(restored.history.length, opening.history.length);
  assert.equal(restored.continuationFrom, null);
  assert.deepEqual(restored.pendingCapturedSquares, []);
});

test("automatic no-move elimination preserves the prior human undo checkpoint", () => {
  const base = position("ffa", {
      "8,3": checker("red", "red"),
      "3,0": checker("blue", "trapped-blue"),
      "4,1": checker("red", "blue-blocker"),
      "5,2": checker("yellow", "landing-blocker"),
      "0,9": checker("yellow", "yellow"),
      "3,13": checker("green", "green"),
    });
  const opening: GameState = {
    ...base,
    checkersRules: checkersRulesForPreset("american"),
    stateHash: "",
  };
  opening.stateHash = calculateStateHash(opening);
  const moved = applyMove(opening, {
    from: { row: 8, col: 3 },
    to: { row: 7, col: 4 },
  });
  assert.equal(moved.turn, "blue");
  assert.deepEqual(getAllLegalMoves(moved, "blue"), []);
  assert.equal(moved.undoStack?.length, 1);

  const eliminated = passTurn(moved, "blue");
  assert.equal(eliminated.undoStack?.length, 1);
  const restored = undoLastTurn(eliminated);
  assert.deepEqual(restored.board, opening.board);
  assert.deepEqual(restored.eliminated, opening.eliminated);
  assert.equal(restored.turn, "red");
});

test("capturing both opponents ends a team game but never removes an ally", () => {
  const first = position("teams", {
    "8,3": checker("red", "red"),
    "7,4": checker("blue", "blue"),
    "5,6": checker("green", "green"),
    "0,3": checker("yellow", "yellow"),
  });
  const second = applyMove(first, {
    from: { row: 8, col: 3 },
    to: { row: 6, col: 5 },
  });
  assert.equal(second.phase, "playing");
  const finished = applyMove(second, {
    from: { row: 6, col: 5 },
    to: { row: 4, col: 7 },
  });
  assert.equal(finished.phase, "finished");
  assert.deepEqual(finished.winners, ["red", "yellow"]);
  assert.ok(finished.board["0,3"]);
});

test("men crown on the far edge", () => {
  const state = position("ffa", {
    "1,4": checker("red", "red"),
    "0,3": checker("yellow", "yellow"),
    "3,0": checker("blue", "blue"),
    "3,13": checker("green", "green"),
  });
  const crowned = applyMove(state, {
    from: { row: 1, col: 4 },
    to: { row: 0, col: 5 },
  });
  assert.equal(crowned.board["0,5"].type, "crowned");
  assert.equal(crowned.history.at(-1)?.promotion, "crowned");
});

test("a rules option controls whether crowning continues a capture chain", () => {
  const state = position("ffa", {
    "2,3": checker("red", "red"),
    "1,4": checker("blue", "blue"),
    "1,6": checker("green", "green"),
    "0,9": checker("yellow", "yellow"),
  });
  const continued = applyMove(state, {
    from: { row: 2, col: 3 },
    to: { row: 0, col: 5 },
  });
  assert.deepEqual(continued.continuationFrom, { row: 0, col: 5 });
  assert.ok(
    getAllLegalMoves(continued, "red").some(
      (move) => move.to.row === 2 && move.to.col === 7,
    ),
  );

  const stopState: GameState = {
    ...state,
    checkersRules: {
      ...state.checkersRules,
      preset: "custom",
      continueAfterCrowning: false,
    },
  };
  const stopped = applyMove(stopState, {
    from: { row: 2, col: 3 },
    to: { row: 0, col: 5 },
  });
  assert.equal(stopped.continuationFrom, null);
  assert.equal(stopped.turn, "yellow");
});

test("International captured pieces block reverse flying routes until the chain ends", () => {
  const state: GameState = {
    ...position("ffa", {
      "8,3": checker("red", "red-king", "crowned"),
      "6,5": checker("blue", "blue"),
      "9,2": checker("green", "green"),
      "0,9": checker("yellow", "yellow"),
    }),
    checkersRules: checkersRulesForPreset("international"),
  };
  const next = applyMove(state, {
    from: { row: 8, col: 3 },
    to: { row: 5, col: 6 },
  });

  assert.equal(next.continuationFrom, null);
  assert.deepEqual(next.pendingCapturedSquares, []);
  assert.equal(next.board["6,5"], undefined);
  assert.ok(next.board["9,2"]);
});

test("International men do not gain flying-king movement during a capture", () => {
  const state: GameState = {
    ...position("ffa", {
      "2,3": checker("red", "red"),
      "1,4": checker("blue", "blue"),
      "2,7": checker("green", "distant-green"),
      "0,9": checker("yellow", "yellow"),
    }),
    checkersRules: checkersRulesForPreset("international"),
  };
  const crownedAtTurnEnd = applyMove(state, {
    from: { row: 2, col: 3 },
    to: { row: 0, col: 5 },
  });
  assert.equal(crownedAtTurnEnd.continuationFrom, null);
  assert.equal(crownedAtTurnEnd.board["0,5"].type, "crowned");
  assert.ok(crownedAtTurnEnd.board["2,7"]);

  const adjacentState: GameState = {
    ...state,
    board: {
      "2,3": checker("red", "red"),
      "1,4": checker("blue", "blue"),
      "1,6": checker("green", "adjacent-green"),
      "0,9": checker("yellow", "yellow"),
    },
  };
  const midChain = applyMove(adjacentState, {
    from: { row: 2, col: 3 },
    to: { row: 0, col: 5 },
  });
  assert.deepEqual(midChain.continuationFrom, { row: 0, col: 5 });
  assert.equal(midChain.board["0,5"].type, "man");
  const finished = applyMove(midChain, {
    from: { row: 0, col: 5 },
    to: { row: 2, col: 7 },
  });
  assert.equal(finished.board["2,7"].type, "man");
  assert.equal(finished.continuationFrom, null);
});

test("customizing International keeps its sequence timing mechanics", () => {
  const customizedRules = {
    ...checkersRulesForPreset("international"),
    preset: "custom" as const,
    maximumCapture: false,
  };
  const reverseRoute: GameState = {
    ...position("ffa", {
      "8,3": checker("red", "red-king", "crowned"),
      "6,5": checker("blue", "blue"),
      "9,2": checker("green", "green"),
      "0,9": checker("yellow", "yellow"),
    }),
    checkersRules: customizedRules,
  };
  const afterCapture = applyMove(reverseRoute, {
    from: { row: 8, col: 3 },
    to: { row: 5, col: 6 },
  });
  assert.equal(customizedRules.deferredCaptureRemoval, true);
  assert.equal(afterCapture.continuationFrom, null);
  assert.ok(afterCapture.board["9,2"]);

  const promotionRoute: GameState = {
    ...position("ffa", {
      "2,3": checker("red", "red"),
      "1,4": checker("blue", "blue"),
      "1,6": checker("green", "green"),
      "0,9": checker("yellow", "yellow"),
    }),
    checkersRules: customizedRules,
  };
  const midChain = applyMove(promotionRoute, {
    from: { row: 2, col: 3 },
    to: { row: 0, col: 5 },
  });
  assert.equal(customizedRules.deferredPromotion, true);
  assert.equal(midChain.board["0,5"].type, "man");
  assert.deepEqual(midChain.continuationFrom, { row: 0, col: 5 });
});

test("International history records every color eliminated at chain end", () => {
  const state: GameState = {
    ...position("ffa", {
      "8,3": checker("red", "red"),
      "7,4": checker("blue", "last-blue"),
      "5,6": checker("green", "last-green"),
      "0,9": checker("yellow", "yellow"),
    }),
    checkersRules: checkersRulesForPreset("international"),
  };
  const first = applyMove(state, {
    from: { row: 8, col: 3 },
    to: { row: 6, col: 5 },
  });
  assert.equal(first.history.at(-1)?.eliminatedColors, undefined);
  const finished = applyMove(first, {
    from: { row: 6, col: 5 },
    to: { row: 4, col: 7 },
  });
  assert.deepEqual(finished.eliminated, ["blue", "green"]);
  assert.deepEqual(
    finished.history.at(-1)?.eliminatedColors,
    ["blue", "green"],
  );
});

test("flying kings may land on any clear square beyond one opponent", () => {
  const state = position("ffa", {
    "8,3": checker("red", "red-king", "crowned"),
    "6,5": checker("blue", "blue"),
    "0,3": checker("yellow", "yellow"),
    "3,13": checker("green", "green"),
  });
  const captures = getLegalMovesForPiece(state, { row: 8, col: 3 });
  assert.deepEqual(
    captures.map((move) => move.to),
    [
      { row: 5, col: 6 },
      { row: 4, col: 7 },
      { row: 3, col: 8 },
      { row: 2, col: 9 },
      { row: 1, col: 10 },
    ],
  );
});

test("the maximum-capture option keeps only the longest available chain", () => {
  const state = position("ffa", {
    "8,3": checker("red", "red-long"),
    "8,7": checker("red", "red-short"),
    "7,4": checker("blue", "blue"),
    "5,6": checker("green", "green"),
    "7,8": checker("yellow", "yellow"),
  });
  const maximumState: GameState = {
    ...state,
    checkersRules: {
      ...state.checkersRules,
      preset: "custom",
      maximumCapture: true,
    },
  };
  const moves = getAllLegalMoves(maximumState, "red");
  assert.equal(moves.length, 1);
  assert.equal(squareKey(moves[0].from), "8,3");
});

test("International maximum-capture search memoizes an adversarial flying-king tree", () => {
  const enemies = [
    ["5,10", "blue"],
    ["11,8", "yellow"],
    ["7,4", "green"],
    ["10,11", "blue"],
    ["7,12", "yellow"],
    ["3,0", "green"],
    ["1,4", "blue"],
    ["1,8", "yellow"],
    ["4,5", "green"],
    ["6,9", "blue"],
    ["12,5", "yellow"],
    ["4,7", "green"],
    ["7,8", "blue"],
    ["8,1", "yellow"],
    ["5,4", "green"],
    ["4,1", "blue"],
    ["4,11", "yellow"],
    ["8,9", "green"],
    ["8,7", "blue"],
    ["10,5", "yellow"],
    ["6,3", "green"],
    ["1,6", "blue"],
    ["8,5", "yellow"],
    ["6,1", "green"],
  ] as const;
  const board: BoardState = {
    "13,6": {
      ...checker("red", "red-flying-king", "crowned"),
      hasMoved: true,
    },
  };
  for (const [key, color] of enemies) {
    board[key] = {
      ...checker(
        color,
        `${color}-${key}`,
        color === "green" && key === "3,0" ? "crowned" : "man",
      ),
      hasMoved: true,
    };
  }
  const state: GameState = {
    ...position("ffa", board),
    checkersRules: checkersRulesForPreset("international"),
  };

  assert.equal(
    checkersCapturesForPiece(state, { row: 13, col: 6 }).length,
    6,
  );
  const first: CheckersCaptureSearchDiagnostics = {
    expandedStates: 0,
    cacheHits: 0,
    topLevelCacheHits: 0,
  };
  const moves = getAllCheckersLegalMoves(state, "red", first);
  assert.equal(moves.length, 6);
  assert.deepEqual(first, {
    expandedStates: 50_109,
    cacheHits: 20_917,
    topLevelCacheHits: 0,
  });

  const second: CheckersCaptureSearchDiagnostics = {
    expandedStates: 0,
    cacheHits: 0,
    topLevelCacheHits: 0,
  };
  assert.deepEqual(
    getAllCheckersLegalMoves(state, "red", second),
    moves,
  );
  assert.deepEqual(second, {
    expandedStates: 0,
    cacheHits: 0,
    topLevelCacheHits: 1,
  });
  assert.ok(chooseComputerMove(state, "red"));
});

test("a color with no legal move is eliminated when its turn passes", () => {
  const state: GameState = {
    ...position("ffa", {
      "0,3": checker("red", "trapped-red"),
      "3,0": checker("blue", "blue"),
      "0,9": checker("yellow", "yellow"),
      "3,13": checker("green", "green"),
    }),
    pendingCapturedSquares: [{ row: 1, col: 4 }],
  };
  assert.deepEqual(getAllLegalMoves(state, "red"), []);
  const next = passTurn(state, "red");
  assert.deepEqual(next.eliminated, ["red"]);
  assert.equal(next.board["0,3"], undefined);
  assert.equal(next.turn, "blue");
  assert.deepEqual(next.pendingCapturedSquares, []);
});

test("the casual bot returns the same legal checkers move every time", () => {
  const initial = createGameState(
    "CHECKERS-BOT",
    "ffa",
    "Computer Red",
    "checkers",
  );
  const seats = { ...initial.seats };
  PLAYER_COLORS.forEach((color) => {
    seats[color] = { color, controller: "computer", name: color };
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

test("the bot sees a no-move elimination as an immediate tactical win", () => {
  const state: GameState = {
    ...position(
      "teams",
      {
        "4,1": checker("red", "red-blocker"),
        "8,3": checker("red", "red-mover"),
        "3,0": checker("blue", "trapped-blue"),
        "5,2": checker("yellow", "landing-blocker"),
        "0,9": checker("yellow", "yellow"),
      },
      "red",
    ),
    eliminated: ["green"],
    checkersRules: checkersRulesForPreset("american"),
  };
  const allMoves = getAllLegalMoves(state, "red");
  assert.ok(
    allMoves.some((move) => squareKey(move.from) === "4,1"),
  );
  assert.ok(
    allMoves.some((move) => squareKey(move.from) === "8,3"),
  );

  const winningMove = chooseComputerMove(state, "red");
  assert.ok(winningMove);
  assert.equal(squareKey(winningMove.from), "8,3");
  const afterMove = applyMove(state, winningMove, false);
  assert.deepEqual(getAllLegalMoves(afterMove, "blue"), []);
  const won = passTurn(afterMove, "blue");
  assert.equal(won.phase, "finished");
  assert.deepEqual(won.winners, ["red", "yellow"]);
});

test("changing a replicated checkers option changes the deterministic hash", () => {
  const initial = createGameState(
    "CHECKERS-HASH",
    "teams",
    "Red",
    "checkers",
  );
  const changed = updateLobby(
    initial,
    {
      checkersRules: {
        ...initial.checkersRules,
        preset: "custom",
        flyingKings: false,
      },
    },
    "short-kings",
  );
  assert.equal(changed.parentHash, initial.stateHash);
  assert.notEqual(changed.stateHash, initial.stateHash);
  assert.equal(calculateStateHash(changed), changed.stateHash);
});

test("schema v3 rejects self-hashed partial or invalid team assignments", () => {
  const initial = createGameState(
    "CHECKERS-FORGED-TEAMS",
    "teams",
    "Red",
    "checkers",
  );
  const forgedAssignments = [
    {
      red: "warm",
      blue: "cool",
      yellow: "warm",
    },
    {
      ...initial.teamAssignments,
      green: "spectator",
    },
  ];

  for (const teamAssignments of forgedAssignments) {
    const forged = {
      ...initial,
      teamAssignments,
      stateHash: "",
    } as unknown as GameState;
    forged.stateHash = calculateStateHash(forged);
    assert.equal(normalizeGameState(forged), null);
  }
});

test("schema v3 hashes every replicated checkers and move-history field", () => {
  const opening = position("ffa", {
    "8,3": checker("red", "red"),
    "7,4": checker("blue", "blue"),
    "0,9": checker("yellow", "yellow"),
    "3,13": checker("green", "green"),
  });
  const played = applyMove(opening, {
    from: { row: 8, col: 3 },
    to: { row: 6, col: 5 },
  });
  const record = played.history[0];
  assert.ok(record);

  const variants: GameState[] = [
    {
      ...played,
      continuationFrom: { row: 4, col: 7 },
    },
    {
      ...played,
      pendingCapturedSquares: [{ row: 7, col: 4 }],
    },
  ];
  for (const color of PLAYER_COLORS) {
    variants.push({
      ...played,
      teamAssignments: {
        ...played.teamAssignments,
        [color]:
          played.teamAssignments[color] === "warm" ? "cool" : "warm",
      },
    });
  }
  variants.push({
    ...played,
    checkersRules: {
      ...played.checkersRules,
      preset: "custom",
    },
  });
  for (const rule of [
    "flyingKings",
    "backwardCaptures",
    "mandatoryCapture",
    "maximumCapture",
    "continueAfterCrowning",
    "deferredCaptureRemoval",
    "deferredPromotion",
  ] as const) {
    variants.push({
      ...played,
      checkersRules: {
        ...played.checkersRules,
        [rule]: !played.checkersRules[rule],
      },
    });
  }
  const recordVariants = [
    { ...record, id: `${record.id}-changed` },
    { ...record, revision: record.revision + 1 },
    { ...record, round: record.round + 1 },
    { ...record, color: "yellow" as const },
    { ...record, piece: "crowned" as const },
    { ...record, from: { ...record.from, row: record.from.row + 1 } },
    { ...record, from: { ...record.from, col: record.from.col + 1 } },
    { ...record, to: { ...record.to, row: record.to.row + 1 } },
    { ...record, to: { ...record.to, col: record.to.col + 1 } },
    { ...record, captured: "crowned" as const },
    { ...record, capturedColor: "green" as const },
    { ...record, eliminated: "green" as const },
    {
      ...record,
      eliminatedColors: ["blue" as const, "green" as const],
    },
    {
      ...record,
      capturedSquare: {
        row: (record.capturedSquare?.row ?? 0) + 1,
        col: record.capturedSquare?.col ?? 0,
      },
    },
    {
      ...record,
      capturedSquare: {
        row: record.capturedSquare?.row ?? 0,
        col: (record.capturedSquare?.col ?? 0) + 1,
      },
    },
    { ...record, promotion: "crowned" as const },
    { ...record, continued: !record.continued },
    { ...record, notation: `${record.notation}!` },
  ];
  variants.push(
    ...recordVariants.map((changedRecord) => ({
      ...played,
      history: [changedRecord],
    })),
  );

  for (const variant of variants) {
    assert.notEqual(calculateStateHash(variant), played.stateHash);
    assert.equal(normalizeGameState(variant), null);
  }
});
