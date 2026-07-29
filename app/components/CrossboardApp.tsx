"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { chooseComputerMove } from "../game/ai";
import {
  applyMove,
  calculateStateHash,
  createGameState,
  createPracticeGame,
  describeWinner,
  getLegalMovesForPiece,
  getUndoActionCount,
  normalizeGameState,
  passTurn,
  sameSquare,
  squareKey,
  squareName,
  startGame,
  teamOf,
  undoLastTurn,
  updateLobby,
} from "../game/engine";
import {
  discoverRoom,
  electCoordinator,
  PeerMesh,
  seatPeerId,
  shouldAdoptSnapshot,
  SignalStatus,
  undoRequesterFor,
  WireMessage,
} from "../game/network";
import {
  COLOR_LABELS,
  COLOR_SYMBOLS,
  Coord,
  GameMode,
  GameState,
  PIECE_LABELS,
  PlayerColor,
  PLAYER_COLORS,
  SeatController,
} from "../game/types";
import { GameBoard } from "./GameBoard";

type View = "home" | "lobby" | "game";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const STORAGE_KEY = "crossboard:last-match";

function generateRoomCode(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const value = Array.from(
    bytes,
    (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length],
  ).join("");
  return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8)}`;
}

function normalizeRoomCode(value: string): string {
  const clean = value
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, "")
    .slice(0, 12);
  return [clean.slice(0, 4), clean.slice(4, 8), clean.slice(8)]
    .filter(Boolean)
    .join("-");
}

function humanSeatIsPresent(
  color: PlayerColor,
  localColor: PlayerColor,
  connectedColors: PlayerColor[],
): boolean {
  return color === localColor || connectedColors.includes(color);
}

interface StoredMatch {
  state: GameState;
  localColor: PlayerColor;
  savedAt: number;
}

function readStoredMatch(): StoredMatch | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    const state = normalizeGameState(parsed?.state);
    if (
      state &&
      PLAYER_COLORS.includes(parsed.localColor) &&
      parsed?.savedAt
    ) {
      return {
        state,
        localColor: parsed.localColor,
        savedAt: parsed.savedAt,
      } as StoredMatch;
    }
  } catch {
    return null;
  }
  return null;
}

interface SeatCardProps {
  game: GameState;
  color: PlayerColor;
  localColor: PlayerColor;
  connectedColors: PlayerColor[];
  active: boolean;
  canManage: boolean;
  onChangeController: (color: PlayerColor, controller: SeatController) => void;
}

function SeatCard({
  game,
  color,
  localColor,
  connectedColors,
  active,
  canManage,
  onChangeController,
}: SeatCardProps) {
  const seat = game.seats[color];
  const isLocal = color === localColor && seat.controller === "human";
  const connected =
    seat.controller !== "human" ||
    humanSeatIsPresent(color, localColor, connectedColors);
  const team =
    game.mode === "teams" ? ` · Team ${teamOf(color)}` : "";

  return (
    <article
      className={`seat-card seat-${color}${active ? " is-active" : ""}`}
      aria-label={`${COLOR_LABELS[color]} seat`}
    >
      <div className="seat-heading">
        <span className={`color-token token-${color}`} aria-hidden="true">
          {COLOR_SYMBOLS[color]}
        </span>
        <div>
          <strong>
            {COLOR_LABELS[color]}
            {team}
          </strong>
          <span>
            {seat.controller === "computer"
              ? "Computer · Casual"
              : seat.controller === "open"
                ? "Open · Waiting"
                : isLocal
                  ? "You · Human"
                  : connected
                    ? "Human · Connected"
                    : "Human · Reconnecting"}
          </span>
        </div>
      </div>
      <div className="seat-name">{seat.name}</div>
      {canManage && color !== localColor && seat.controller !== "human" ? (
        <button
          className="text-button"
          type="button"
          onClick={() =>
            onChangeController(
              color,
              seat.controller === "computer" ? "open" : "computer",
            )
          }
        >
          {seat.controller === "computer" ? "Leave seat open" : "Add computer"}
        </button>
      ) : null}
    </article>
  );
}

export function CrossboardApp() {
  const [view, setView] = useState<View>("home");
  const [game, setGame] = useState<GameState | null>(null);
  const [localColor, setLocalColor] = useState<PlayerColor>("red");
  const [connectedColors, setConnectedColors] = useState<PlayerColor[]>([]);
  const [signalStatus, setSignalStatus] =
    useState<SignalStatus>("connecting");
  const [isNetworked, setIsNetworked] = useState(false);
  const [playerName, setPlayerName] = useState("Player");
  const [roomInput, setRoomInput] = useState("");
  const [joining, setJoining] = useState(false);
  const [selected, setSelected] = useState<Coord | null>(null);
  const [orientation, setOrientation] = useState<PlayerColor>("red");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [storedMatch, setStoredMatch] = useState<StoredMatch | null>(null);

  const gameRef = useRef<GameState | null>(null);
  const localColorRef = useRef<PlayerColor>("red");
  const meshRef = useRef<PeerMesh | null>(null);
  const connectedRef = useRef<PlayerColor[]>([]);

  const saveSnapshot = useCallback(
    (state: GameState, color = localColorRef.current) => {
      if (state.roomCode === "PRACTICE") {
        return;
      }
      try {
        const stored: StoredMatch = {
          state,
          localColor: color,
          savedAt: Date.now(),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
        setStoredMatch(stored);
      } catch {
        // The live mesh remains authoritative if local storage is unavailable.
      }
    },
    [],
  );

  const installState = useCallback(
    (state: GameState, persist = true) => {
      gameRef.current = state;
      setGame(state);
      if (persist) {
        saveSnapshot(state);
      }
    },
    [saveSnapshot],
  );

  const broadcastSnapshot = useCallback((state: GameState) => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }
    mesh.broadcast({
      type: "snapshot",
      sender: mesh.localPeerId,
      state,
    });
  }, []);

  const commitState = useCallback(
    (next: GameState, broadcast = true) => {
      installState(next);
      if (broadcast) {
        broadcastSnapshot(next);
      }
    },
    [broadcastSnapshot, installState],
  );

  const acceptRemoteSnapshot = useCallback(
    (incoming: GameState) => {
      const normalized = normalizeGameState(incoming);
      if (!normalized) {
        setNotice("A peer sent an incompatible game copy. It was ignored.");
        return;
      }
      const current = gameRef.current;
      if (!current) {
        installState(normalized);
        return;
      }
      if (normalized.stateHash === current.stateHash) {
        return;
      }

      if (shouldAdoptSnapshot(current, normalized)) {
        const forked =
          normalized.parentHash !== current.stateHash &&
          current.parentHash !== normalized.stateHash;
        if (forked) {
          setNotice("The room compared two copies and restored one shared position.");
        }
        installState(normalized);
        setSelected(null);
        if (normalized.phase !== "lobby") {
          setView("game");
        }
      }
    },
    [installState],
  );

  const startMesh = useCallback(
    async (state: GameState, color: PlayerColor): Promise<PeerMesh> => {
      const mesh = new PeerMesh(state.roomCode, color, {
        onMessage: (message: WireMessage, remotePeerId: string) => {
          if (message.type === "state-request") {
            const current = gameRef.current;
            if (current) {
              mesh.sendTo(remotePeerId, {
                type: "snapshot",
                sender: mesh.localPeerId,
                state: current,
              });
            }
            return;
          }
          if (message.type === "undo-request") {
            const current = gameRef.current;
            const requester = current
              ? undoRequesterFor(
                  current,
                  localColorRef.current,
                  connectedRef.current,
                  remotePeerId,
                  message.stateHash,
                )
              : null;
            if (!current || !requester) {
              return;
            }
            const next = undoLastTurn(current);
            if (next !== current) {
              commitState(next);
              setSelected(null);
              setView("game");
              setNotice(
                `${current.seats[requester].name} rewound the last turn.`,
              );
            }
            return;
          }
          if (message.type === "snapshot") {
            acceptRemoteSnapshot(message.state);
          }
        },
        onConnections: (colors) => {
          const previous = connectedRef.current;
          connectedRef.current = colors;
          setConnectedColors(colors);
          if (
            previous.length > colors.length &&
            gameRef.current?.phase !== "finished"
          ) {
            setNotice("A player disconnected. The room has chosen a new coordinator.");
          }
        },
        onSignalStatus: setSignalStatus,
        onNotice: setNotice,
      });
      meshRef.current = mesh;
      await mesh.start();
      return mesh;
    },
    [acceptRemoteSnapshot, commitState],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setStoredMatch(readStoredMatch());
      const storedName = localStorage.getItem("crossboard:player-name");
      if (storedName) {
        setPlayerName(storedName);
      }
      const queryRoom = new URLSearchParams(window.location.search).get("room");
      if (queryRoom) {
        setRoomInput(normalizeRoomCode(queryRoom));
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    return () => meshRef.current?.close();
  }, []);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = window.setTimeout(() => setNotice(""), 4_500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const clearSelection = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelected(null);
      }
    };
    window.addEventListener("keydown", clearSelection);
    return () => window.removeEventListener("keydown", clearSelection);
  }, []);

  const coordinator = useMemo(() => {
    if (!game) {
      return localColor;
    }
    return isNetworked
      ? electCoordinator(game, localColor, connectedColors)
      : localColor;
  }, [connectedColors, game, isNetworked, localColor]);
  const botThinking =
    !!game &&
    game.phase === "playing" &&
    game.seats[game.turn].controller === "computer";

  useEffect(() => {
    if (!game || game.phase !== "playing") {
      return;
    }
    const seat = game.seats[game.turn];
    if (seat.controller !== "computer" || coordinator !== localColor) {
      return;
    }

    const expectedStateHash = game.stateHash;
    const timer = window.setTimeout(() => {
      const current = gameRef.current;
      if (
        !current ||
        current.stateHash !== expectedStateHash ||
        current.phase !== "playing" ||
        current.seats[current.turn].controller !== "computer" ||
        electCoordinator(
          current,
          localColorRef.current,
          connectedRef.current,
        ) !== localColorRef.current
      ) {
        return;
      }
      const move = chooseComputerMove(current, current.turn);
      const next = move
        ? applyMove(current, move)
        : passTurn(current, current.turn);
      commitState(next);
    }, 520);
    return () => window.clearTimeout(timer);
  }, [commitState, coordinator, game, localColor]);

  const updateLocation = (roomCode?: string) => {
    const url = roomCode
      ? `${window.location.pathname}?room=${encodeURIComponent(roomCode)}`
      : window.location.pathname;
    window.history.replaceState({}, "", url);
  };

  const createOnlineRoom = async () => {
    localStorage.setItem("crossboard:player-name", playerName.trim() || "Player");
    const roomCode = generateRoomCode();
    const initial = createGameState(
      roomCode,
      "teams",
      playerName.trim() || "Player",
    );
    initial.seats.red.peerId = seatPeerId(roomCode, "red");
    initial.stateHash = calculateStateHash(initial);

    localColorRef.current = "red";
    setLocalColor("red");
    setOrientation("red");
    installState(initial);
    setView("lobby");
    setIsNetworked(true);
    updateLocation(roomCode);
    try {
      await startMesh(initial, "red");
      setNotice("Room ready. Share the code when you’re happy with the seats.");
    } catch {
      setSignalStatus("offline");
      setNotice("The peer handshake is unavailable. Local practice still works.");
    }
  };

  const joinRoom = async () => {
    const roomCode = normalizeRoomCode(roomInput);
    if (roomCode.replace(/-/g, "").length !== 12) {
      setNotice("Enter the 12-character room code.");
      return;
    }
    setJoining(true);
    setNotice("Looking for the room…");
    try {
      const discovered = normalizeGameState(await discoverRoom(roomCode));
      if (!discovered) {
        throw new Error("Incompatible room");
      }
      if (discovered.phase !== "lobby") {
        throw new Error("That game has already started.");
      }
      const candidates = (
        ["yellow", "blue", "green", "red"] as PlayerColor[]
      ).filter((color) => discovered.seats[color].controller === "open");
      if (!candidates.length) {
        throw new Error("That room has no open seats.");
      }

      let joined = false;
      for (const color of candidates) {
        const seats = {
          ...discovered.seats,
          [color]: {
            color,
            controller: "human" as const,
            name: playerName.trim() || COLOR_LABELS[color],
            peerId: seatPeerId(roomCode, color),
          },
        };
        const next = updateLobby(discovered, { seats }, `join-${color}`);
        gameRef.current = next;
        localColorRef.current = color;
        try {
          const mesh = await startMesh(next, color);
          meshRef.current = mesh;
          setLocalColor(color);
          setOrientation(color);
          setIsNetworked(true);
          installState(next);
          setView("lobby");
          updateLocation(roomCode);
          broadcastSnapshot(next);
          setNotice(`Joined as ${COLOR_LABELS[color]}.`);
          joined = true;
          break;
        } catch {
          meshRef.current?.close();
          meshRef.current = null;
        }
      }
      if (!joined) {
        throw new Error("The open seats were claimed just before you joined.");
      }
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "We couldn’t find that room. Check the code and try again.",
      );
    } finally {
      setJoining(false);
    }
  };

  const startPractice = (mode: GameMode) => {
    const started = createPracticeGame(mode, playerName.trim() || "You");
    meshRef.current?.close();
    meshRef.current = null;
    localColorRef.current = "red";
    setLocalColor("red");
    setOrientation("red");
    setIsNetworked(false);
    setConnectedColors([]);
    installState(started, false);
    setView("game");
    updateLocation();
  };

  const resumeStoredMatch = async () => {
    if (!storedMatch) {
      return;
    }
    const { state, localColor: storedColor } = storedMatch;
    localColorRef.current = storedColor;
    setLocalColor(storedColor);
    setOrientation(storedColor);
    installState(state);
    setView(state.phase === "lobby" ? "lobby" : "game");
    setIsNetworked(true);
    updateLocation(state.roomCode);
    try {
      await startMesh(state, storedColor);
      setNotice("Your local copy is live and comparing notes with the room.");
    } catch {
      setNotice("That seat is still active elsewhere. Close the other tab and retry.");
    }
  };

  const leaveRoom = () => {
    meshRef.current?.close();
    meshRef.current = null;
    gameRef.current = null;
    connectedRef.current = [];
    setConnectedColors([]);
    setGame(null);
    setSelected(null);
    setIsNetworked(false);
    setView("home");
    setSignalStatus("connecting");
    updateLocation();
  };

  const changeMode = (mode: GameMode) => {
    if (!game || coordinator !== localColor) {
      return;
    }
    commitState(updateLobby(game, { mode }, `mode-${mode}`));
  };

  const changeSeatController = (
    color: PlayerColor,
    controller: SeatController,
  ) => {
    if (!game || coordinator !== localColor || color === localColor) {
      return;
    }
    const seat = game.seats[color];
    if (seat.controller === "human") {
      return;
    }
    const seats = {
      ...game.seats,
      [color]: {
        color,
        controller,
        name:
          controller === "computer"
            ? `Computer ${COLOR_LABELS[color]}`
            : "Open seat",
      },
    };
    commitState(updateLobby(game, { seats }, `seat-${color}-${controller}`));
  };

  const applyFriendsVsComputersPreset = () => {
    if (!game || coordinator !== localColor) {
      return;
    }
    const opposite =
      localColor === "red"
        ? "yellow"
        : localColor === "yellow"
          ? "red"
          : localColor === "blue"
            ? "green"
            : "blue";
    const seats = { ...game.seats };
    PLAYER_COLORS.forEach((color) => {
      if (color === localColor || seats[color].controller === "human") {
        return;
      }
      const controller = color === opposite ? "open" : "computer";
      seats[color] = {
        color,
        controller,
        name:
          controller === "open"
            ? "Open seat"
            : `Computer ${COLOR_LABELS[color]}`,
      };
    });
    commitState(
      updateLobby(
        game,
        { mode: "teams", seats },
        "preset-friends-v-computers",
      ),
    );
  };

  const beginGame = () => {
    if (!game || coordinator !== localColor) {
      return;
    }
    const hasOpenSeat = PLAYER_COLORS.some(
      (color) => game.seats[color].controller === "open",
    );
    const missingHuman = PLAYER_COLORS.some(
      (color) =>
        game.seats[color].controller === "human" &&
        !humanSeatIsPresent(color, localColor, connectedColors),
    );
    if (hasOpenSeat || missingHuman) {
      setNotice(
        hasOpenSeat
          ? "Fill all four seats before starting."
          : "A human player is still reconnecting.",
      );
      return;
    }
    const started = startGame(game);
    commitState(started);
    setSelected(null);
    setView("game");
  };

  const makeMove = (from: Coord, to: Coord) => {
    const current = gameRef.current;
    if (!current) {
      return;
    }
    const next = applyMove(current, { from, to });
    if (next === current) {
      setNotice("That piece can’t move there.");
      return;
    }
    commitState(next);
    setSelected(null);
  };

  const handleSquarePress = (coord: Coord) => {
    if (!game || game.phase !== "playing" || game.turn !== localColor) {
      return;
    }
    const seat = game.seats[localColor];
    if (seat.controller !== "human") {
      return;
    }
    const piece = game.board[squareKey(coord)];
    if (selected) {
      const legal = getLegalMovesForPiece(game, selected).some((move) =>
        sameSquare(move.to, coord),
      );
      if (legal) {
        makeMove(selected, coord);
        return;
      }
      if (piece?.color === localColor) {
        setSelected(coord);
        return;
      }
      setSelected(null);
      setNotice("That piece can’t move there.");
      return;
    }
    if (piece?.color === localColor) {
      setSelected(coord);
    }
  };

  const copyInvite = async () => {
    if (!game) {
      return;
    }
    const link = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(game.roomCode)}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setNotice("Invite link copied.");
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setNotice(`Room code: ${game.roomCode}`);
    }
  };

  const rotateBoard = () => {
    const index = PLAYER_COLORS.indexOf(orientation);
    setOrientation(PLAYER_COLORS[(index + 1) % PLAYER_COLORS.length]);
    setSelected(null);
  };

  const undoTurn = () => {
    const current = gameRef.current;
    if (!current || !getUndoActionCount(current)) {
      return;
    }

    if (isNetworked && coordinator !== localColor) {
      const mesh = meshRef.current;
      if (!mesh) {
        setNotice("The room is reconnecting. Try undo again in a moment.");
        return;
      }
      mesh.sendTo(seatPeerId(current.roomCode, coordinator), {
        type: "undo-request",
        sender: mesh.localPeerId,
        stateHash: current.stateHash,
      });
      setNotice("Rewinding the shared turn…");
      return;
    }

    const next = undoLastTurn(current);
    if (next === current) {
      return;
    }
    const undoneMoves = current.history.length - next.history.length;
    commitState(next);
    setSelected(null);
    setView("game");
    setNotice(
      undoneMoves > 1
        ? `Rewound ${undoneMoves} moves, including the computer replies.`
        : "Rewound the last move.",
    );
  };

  const legalDestinations = useMemo(
    () => (game && selected ? getLegalMovesForPiece(game, selected) : []),
    [game, selected],
  );
  const undoActionCount = game ? getUndoActionCount(game) : 0;

  const humanCount = game
    ? PLAYER_COLORS.filter(
        (color) => game.seats[color].controller === "human",
      ).length
    : 0;
  const connectedHumanCount = game
    ? PLAYER_COLORS.filter(
        (color) =>
          game.seats[color].controller === "human" &&
          humanSeatIsPresent(color, localColor, connectedColors),
      ).length
    : 0;
  const connectionLabel = !isNetworked
    ? "Local practice"
    : signalStatus === "offline"
      ? "Handshake offline"
      : connectedHumanCount === humanCount
        ? humanCount > 1
          ? "All connected"
          : "Room live"
        : `${humanCount - connectedHumanCount} reconnecting`;

  if (view === "home") {
    return (
      <main className="site-shell home-shell">
        <header className="brand-bar">
          <Link className="brand" href="/" aria-label="Crossboard home">
            <span className="brand-mark" aria-hidden="true">
              ✣
            </span>
            <span>Crossboard</span>
          </Link>
          <span className="peer-badge">
            <span className="status-dot" /> Peer-to-peer rooms
          </span>
        </header>

        <section className="landing-grid">
          <div className="hero-copy">
            <p className="eyebrow">Four-player chess, without a permanent host</p>
            <h1>
              Four sides.
              <br />
              <em>One board.</em>
            </h1>
            <p className="hero-lede">
              Play every color for themselves, or team up across the board. Add
              casual computer opponents, invite friends, and keep the game alive
              when the room creator drops.
            </p>
            <div className="hero-actions">
              <button
                className="primary-button"
                type="button"
                onClick={createOnlineRoom}
              >
                Create a room <span aria-hidden="true">→</span>
              </button>
              <button
                className="secondary-button practice-button"
                type="button"
                onClick={() => startPractice("teams")}
              >
                <span>Practice teams</span>
                <small>You + Yellow vs Blue + Green</small>
              </button>
              <button
                className="secondary-button practice-button"
                type="button"
                onClick={() => startPractice("ffa")}
              >
                <span>Practice free-for-all</span>
                <small>Three computer rivals</small>
              </button>
            </div>
            <div className="promise-row" aria-label="Game features">
              <span>
                <b>01</b> Team or free-for-all
              </span>
              <span>
                <b>02</b> Casual minimax bots
              </span>
              <span>
                <b>03</b> Automatic handoff
              </span>
            </div>
          </div>

          <aside className="join-panel">
            <div className="join-panel-top">
              <span className="panel-kicker">Already invited?</span>
              <span className="live-label">
                <span className="status-dot" /> Live
              </span>
            </div>
            <label htmlFor="player-name">Your name</label>
            <input
              id="player-name"
              className="field"
              value={playerName}
              maxLength={24}
              onChange={(event) => setPlayerName(event.target.value)}
            />
            <label htmlFor="room-code">Room code</label>
            <div className="join-row">
              <input
                id="room-code"
                className="field room-field"
                placeholder="K7M4-PQ2D-X9"
                value={roomInput}
                maxLength={14}
                onChange={(event) =>
                  setRoomInput(normalizeRoomCode(event.target.value))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void joinRoom();
                  }
                }}
              />
              <button
                className="join-button"
                type="button"
                disabled={joining}
                onClick={() => void joinRoom()}
              >
                {joining ? "Finding…" : "Join"}
              </button>
            </div>
            <p className="panel-note">
              The room continues while at least one human player keeps a copy
              open.
            </p>
            <div className="mini-network" aria-hidden="true">
              <span className="network-node node-red">●</span>
              <span className="network-line line-one" />
              <span className="network-node node-blue">▲</span>
              <span className="network-line line-two" />
              <span className="network-node node-yellow">◆</span>
              <span className="network-line line-three" />
              <span className="network-node node-green">■</span>
            </div>
            {storedMatch ? (
              <button
                className="resume-card"
                type="button"
                onClick={() => void resumeStoredMatch()}
              >
                <span>
                  <b>Resume local copy</b>
                  <small>
                    Room {storedMatch.state.roomCode} · move{" "}
                    {storedMatch.state.history.length}
                  </small>
                </span>
                <span aria-hidden="true">↗</span>
              </button>
            ) : null}
          </aside>
        </section>

        <section className="rules-preview" aria-label="How Crossboard works">
          <article>
            <span>✣</span>
            <h2>A real four-way board</h2>
            <p>
              Standard piece movement on a 14×14 cross, with a quick king-capture
              ruleset built for casual games.
            </p>
          </article>
          <article>
            <span>⟲</span>
            <h2>No fragile host</h2>
            <p>
              Every browser holds the latest position. Another connected player
              takes over coordination automatically.
            </p>
          </article>
          <article>
            <span>♞</span>
            <h2>Bots that make you think</h2>
            <p>
              A bounded four-ply search plays sensible moves without pretending
              to be a grandmaster.
            </p>
          </article>
        </section>
        {notice ? <div className="toast" role="status">{notice}</div> : null}
      </main>
    );
  }

  if (!game) {
    return null;
  }

  if (view === "lobby") {
    const isCoordinator = coordinator === localColor;
    const hasOpen = PLAYER_COLORS.some(
      (color) => game.seats[color].controller === "open",
    );
    const hasMissingHuman = PLAYER_COLORS.some(
      (color) =>
        game.seats[color].controller === "human" &&
        !humanSeatIsPresent(color, localColor, connectedColors),
    );

    return (
      <main className="site-shell lobby-shell">
        <header className="brand-bar game-topbar">
          <button className="brand brand-button" type="button" onClick={leaveRoom}>
            <span className="brand-mark" aria-hidden="true">✣</span>
            <span>Crossboard</span>
          </button>
          <div className="room-meta">
            <button className="room-code-button" type="button" onClick={copyInvite}>
              Room {game.roomCode} <span>{copied ? "Copied" : "Copy invite"}</span>
            </button>
            <span className={`connection-pill status-${signalStatus}`}>
              <span className="status-dot" /> {connectionLabel}
            </span>
          </div>
        </header>

        <section className="lobby-heading">
          <div>
            <p className="eyebrow">Set the table</p>
            <h1>Build your four.</h1>
            <p>
              Opposite colors are partners in Teams. Add a computer to your
              opposite color for an instant teammate; open seats wait for an
              invite.
            </p>
          </div>
          <div className="mode-switch" aria-label="Game mode">
            <button
              type="button"
              className={game.mode === "teams" ? "active" : ""}
              disabled={!isCoordinator}
              onClick={() => changeMode("teams")}
            >
              Teams <small>2 vs 2</small>
            </button>
            <button
              type="button"
              className={game.mode === "ffa" ? "active" : ""}
              disabled={!isCoordinator}
              onClick={() => changeMode("ffa")}
            >
              Free-for-all <small>Last king</small>
            </button>
          </div>
        </section>

        <section className="lobby-layout">
          <div className="seat-cross">
            <div className="north-seat">
              <SeatCard
                game={game}
                color="yellow"
                localColor={localColor}
                connectedColors={connectedColors}
                active={false}
                canManage={isCoordinator}
                onChangeController={changeSeatController}
              />
            </div>
            <div className="west-seat">
              <SeatCard
                game={game}
                color="blue"
                localColor={localColor}
                connectedColors={connectedColors}
                active={false}
                canManage={isCoordinator}
                onChangeController={changeSeatController}
              />
            </div>
            <div className="mini-board-logo" aria-hidden="true">
              <span>♜</span><span>♞</span><span>♝</span>
              <span>♟</span><b>✣</b><span>♟</span>
              <span>♝</span><span>♞</span><span>♜</span>
            </div>
            <div className="east-seat">
              <SeatCard
                game={game}
                color="green"
                localColor={localColor}
                connectedColors={connectedColors}
                active={false}
                canManage={isCoordinator}
                onChangeController={changeSeatController}
              />
            </div>
            <div className="south-seat">
              <SeatCard
                game={game}
                color="red"
                localColor={localColor}
                connectedColors={connectedColors}
                active={false}
                canManage={isCoordinator}
                onChangeController={changeSeatController}
              />
            </div>
          </div>

          <aside className="lobby-sidebar">
            <div className="health-card">
              <div className="health-icon" aria-hidden="true">⟲</div>
              <div>
                <span>Room continuity</span>
                <strong>
                  {isCoordinator
                    ? "You’re keeping the room running"
                    : `${game.seats[coordinator].name} is coordinating`}
                </strong>
              </div>
            </div>
            <details className="plain-details">
              <summary>How this room stays open</summary>
              <p>
                Everyone keeps the current game. If the coordinator disconnects,
                another connected human takes over. Rejoining players catch up
                from the others.
              </p>
            </details>
            {isCoordinator ? (
              <button
                className="preset-button"
                type="button"
                onClick={applyFriendsVsComputersPreset}
              >
                <span>Recommended setup</span>
                <b>Two friends vs two computers</b>
              </button>
            ) : null}
            <div className="lobby-actions">
              <button
                className="primary-button"
                type="button"
                disabled={!isCoordinator || hasOpen || hasMissingHuman}
                onClick={beginGame}
              >
                Start game <span aria-hidden="true">→</span>
              </button>
              <p>
                {!isCoordinator
                  ? `Waiting for ${game.seats[coordinator].name} to start.`
                  : hasOpen
                    ? "Fill all four seats to start."
                    : hasMissingHuman
                      ? "Waiting for a player to reconnect."
                      : "Everyone is ready."}
              </p>
            </div>
          </aside>
        </section>
        {notice ? <div className="toast" role="status">{notice}</div> : null}
      </main>
    );
  }

  const activeSeat = game.seats[game.turn];
  const isMyTurn =
    game.phase === "playing" &&
    game.turn === localColor &&
    activeSeat.controller === "human";
  const boardInteractive = isMyTurn && !botThinking;
  const statusHeading =
    game.phase === "finished"
      ? describeWinner(game)
      : botThinking
        ? `Computer is thinking · ${COLOR_LABELS[game.turn]}`
        : isMyTurn
          ? `Your turn · ${COLOR_LABELS[localColor]}`
          : `${activeSeat.name}’s turn · ${COLOR_LABELS[game.turn]}`;

  return (
    <main className="game-shell">
      <header className="brand-bar game-topbar">
        <button className="brand brand-button" type="button" onClick={leaveRoom}>
          <span className="brand-mark" aria-hidden="true">✣</span>
          <span>Crossboard</span>
        </button>
        <div className="room-meta">
          {isNetworked ? (
            <button className="room-code-button" type="button" onClick={copyInvite}>
              {game.roomCode} <span>{copied ? "Copied" : "Invite"}</span>
            </button>
          ) : null}
          <span className={`connection-pill status-${signalStatus}`}>
            <span className="status-dot" /> {connectionLabel}
          </span>
          <button className="leave-button" type="button" onClick={leaveRoom}>
            Leave
          </button>
        </div>
      </header>

      <section className={`turn-banner banner-${game.turn}`} aria-live="polite">
        <div>
          <span className={`color-token token-${game.turn}`} aria-hidden="true">
            {COLOR_SYMBOLS[game.turn]}
          </span>
          <div>
            <small>Round {game.round}</small>
            <strong>{statusHeading}</strong>
          </div>
        </div>
        {isNetworked && coordinator === localColor ? (
          <span className="coordinator-note">You’re keeping turns in sync</span>
        ) : null}
      </section>

      <section className="game-layout">
        <div className="board-column">
          <div className="player-chip-row">
            {PLAYER_COLORS.map((color) => {
              const seat = game.seats[color];
              const connected =
                seat.controller !== "human" ||
                humanSeatIsPresent(color, localColor, connectedColors);
              const isTeammate =
                game.mode === "teams" &&
                teamOf(color) === teamOf(localColor);
              const playerStatus = game.eliminated.includes(color)
                ? "King captured"
                : color === localColor
                  ? game.mode === "teams"
                    ? "You · Your team"
                    : "You"
                  : seat.controller === "computer"
                    ? isTeammate
                      ? "Computer · Your teammate"
                      : game.mode === "teams"
                        ? "Computer · Opponent"
                        : "Computer"
                    : connected
                      ? isTeammate
                        ? "Connected · Your teammate"
                        : game.mode === "teams"
                          ? "Connected · Opponent"
                          : "Connected"
                      : "Reconnecting";
              return (
                <div
                  className={`player-chip chip-${color}${
                    game.turn === color ? " is-active" : ""
                  }${game.eliminated.includes(color) ? " is-eliminated" : ""}`}
                  key={color}
                >
                  <span className={`color-token token-${color}`}>
                    {COLOR_SYMBOLS[color]}
                  </span>
                  <span>
                    <b>{seat.name}</b>
                    <small>{playerStatus}</small>
                  </span>
                </div>
              );
            })}
          </div>

          <div className="board-frame">
            <GameBoard
              game={game}
              orientation={orientation}
              selected={selected}
              interactive={boardInteractive}
              onSquarePress={handleSquarePress}
            />
          </div>

          <div className="board-controls">
            <div className="board-control-actions">
              <button type="button" onClick={rotateBoard}>
                <span aria-hidden="true">↻</span> Rotate board
              </button>
              <button
                className="undo-button"
                type="button"
                disabled={!undoActionCount}
                title={
                  !undoActionCount
                    ? "Make a move before using undo"
                    : isNetworked && coordinator !== localColor
                      ? `Rewind the shared turn through ${game.seats[coordinator].name}`
                      : "Rewind the latest human move and any computer replies"
                }
                onClick={undoTurn}
              >
                <span aria-hidden="true">↶</span> Undo turn
              </button>
            </div>
            <span>
              Viewing from <b>{COLOR_LABELS[orientation]}</b>
            </span>
          </div>

          {selected && legalDestinations.length ? (
            <div className="legal-tray" aria-label="Legal moves">
              <span>Legal moves</span>
              <div>
                {legalDestinations.map((move) => (
                  <button
                    type="button"
                    key={squareKey(move.to)}
                    onClick={() => makeMove(selected, move.to)}
                  >
                    {squareName(move.to)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <aside className="game-sidebar">
          <section className="side-card">
            <div className="side-card-heading">
              <div>
                <span>Position</span>
                <strong>
                  Move {game.history.length} · {game.mode === "teams" ? "Teams" : "Free-for-all"}
                </strong>
              </div>
              <span className="sync-check" title={`State ${game.stateHash}`}>
                ✓ Synced
              </span>
            </div>
            <div className="move-history" aria-label="Move history">
              {game.history.length ? (
                game.history
                  .slice(-12)
                  .reverse()
                  .map((move, index) => (
                    <div
                      className={`history-row${index === 0 ? " latest" : ""}`}
                      key={move.id}
                    >
                      <span className={`history-color token-${move.color}`}>
                        {COLOR_SYMBOLS[move.color]}
                      </span>
                      <div>
                        <b>
                          {COLOR_LABELS[move.color]} · {PIECE_LABELS[move.piece]}
                        </b>
                        <span>
                          {move.notation}
                          {move.eliminated
                            ? ` · ${COLOR_LABELS[move.eliminated]} eliminated`
                            : ""}
                        </span>
                      </div>
                      <small>#{move.revision}</small>
                    </div>
                  ))
              ) : (
                <p className="empty-history">
                  The opening move will appear here.
                </p>
              )}
            </div>
          </section>

          <section className="side-card room-health">
            <div className="side-card-heading">
              <div>
                <span>Room health</span>
                <strong>{connectionLabel}</strong>
              </div>
              <span className={`large-status status-${signalStatus}`} />
            </div>
            <p>
              Coordinator:{" "}
              <b>
                {coordinator === localColor
                  ? "You"
                  : game.seats[coordinator].name}
              </b>
            </p>
            <p className="hash-line">
              Shared copy <code>{game.stateHash.slice(0, 8)}</code>
            </p>
          </section>

          <details className="side-card rules-card">
            <summary>Crossboard Capture v1 rules</summary>
            <ul>
              <li>Capture a king to eliminate that color.</li>
              <li>In Teams, the first enemy king captured ends the match.</li>
              <li>No castling or en passant; pawns auto-promote to queens.</li>
              <li>Moves do not stop your own king entering danger.</li>
            </ul>
          </details>

          {game.phase === "finished" ? (
            <section className="result-card">
              <span>Game complete</span>
              <h2>{describeWinner(game)}</h2>
              <p>{game.history.length} moves across {game.round} rounds.</p>
              <button className="primary-button" type="button" onClick={leaveRoom}>
                Back to home
              </button>
            </section>
          ) : null}
        </aside>
      </section>
      {notice ? <div className="toast" role="status">{notice}</div> : null}
    </main>
  );
}
