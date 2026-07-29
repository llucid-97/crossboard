import assert from "node:assert/strict";
import test from "node:test";
import { chooseComputerMove } from "../app/game/ai";
import {
  applyMove,
  calculateStateHash,
  createGameState,
  getAllLegalMoves,
  getLegalMovesForPiece,
  passTurn,
  squareKey,
  startGame,
  updateLobby,
} from "../app/game/engine";
import {
  checkersRulesForPreset,
  createInitialCheckersBoard,
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

test("a color with no legal move is eliminated when its turn passes", () => {
  const state = position("ffa", {
    "0,3": checker("red", "trapped-red"),
    "3,0": checker("blue", "blue"),
    "0,9": checker("yellow", "yellow"),
    "3,13": checker("green", "green"),
  });
  assert.deepEqual(getAllLegalMoves(state, "red"), []);
  const next = passTurn(state, "red");
  assert.deepEqual(next.eliminated, ["red"]);
  assert.equal(next.board["0,3"], undefined);
  assert.equal(next.turn, "blue");
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
