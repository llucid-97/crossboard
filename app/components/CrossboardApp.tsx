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
  assignPlayerIdentity,
  calculateStateHash,
  createGameState,
  createPracticeGame,
  describeWinner,
  gameKindOf,
  getAllLegalMoves,
  getLegalMovesForPiece,
  getUndoActionCount,
  normalizeGameState,
  passTurn,
  playerAppearance,
  sameSquare,
  squareKey,
  squareName,
  startGame,
  teamOf,
  undoLastTurn,
  updateLobby,
} from "../game/engine";
import { checkersRulesForPreset } from "../game/checkers";
import {
  createFreshPlayerIdentity,
  getOrCreatePlayerIdentity,
  PlayerIdentity,
} from "../game/identity";
import {
  discoverRoom,
  coordinatorOwnsState,
  electCoordinator,
  PeerMesh,
  playerSeatFor,
  seatPeerId,
  SignalStatus,
  undoRequesterFor,
  WireMessage,
} from "../game/network";
import {
  appendStateChain,
  createStateChain,
  latestStateChainEntry,
  mergeStateChains,
  normalizeStateChain,
  StateChain,
  stateChainDigest,
  stateChainMatchesSummary,
  stateChainSummary,
} from "../game/replication";
import {
  configureFriendsVsComputers,
  runLobbyCommand,
} from "../game/lobby";
import {
  COLOR_LABELS,
  COLOR_SYMBOLS,
  CheckersPreset,
  CheckersRules,
  Coord,
  GameKind,
  GameMode,
  GameState,
  PIECE_LABELS,
  PlayerColor,
  PLAYER_COLORS,
  POSITION_LABELS,
  SeatController,
  TeamId,
  TEAM_LABELS,
} from "../game/types";
import { GameBoard } from "./GameBoard";

type View = "home" | "lobby" | "game";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const STORAGE_PREFIX = "crossboard:last-match:v2:";
const LEGACY_STORAGE_KEY = "crossboard:last-match";

function storedMatchKey(playerId: string): string {
  return `${STORAGE_PREFIX}${playerId}`;
}

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

function displaySeatName(game: GameState, color: PlayerColor): string {
  const seat = game.seats[color];
  if (seat.controller !== "computer") {
    return seat.name;
  }
  const appearance = playerAppearance(
    color,
    game.mode,
    game.teamAssignments,
  );
  return `Computer ${appearance.label}`;
}

interface StoredMatch {
  chain: StateChain;
  localColor: PlayerColor;
  playerId: string;
  savedAt: number;
}

function readStoredMatch(playerId: string): StoredMatch | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const parsed = JSON.parse(
      localStorage.getItem(storedMatchKey(playerId)) ?? "null",
    );
    const chain = normalizeStateChain(parsed?.chain);
    if (
      chain &&
      parsed?.playerId === playerId &&
      PLAYER_COLORS.includes(parsed.localColor) &&
      parsed?.savedAt
    ) {
      return {
        chain,
        localColor: parsed.localColor,
        playerId,
        savedAt: parsed.savedAt,
      } as StoredMatch;
    }
  } catch {
    // Try the pre-chain local snapshot below.
  }
  try {
    const legacy = JSON.parse(
      localStorage.getItem(LEGACY_STORAGE_KEY) ?? "null",
    );
    const state = normalizeGameState(legacy?.state);
    const localColor = legacy?.localColor;
    if (
      !state ||
      !PLAYER_COLORS.includes(localColor) ||
      state.seats[localColor as PlayerColor].controller !== "human"
    ) {
      return null;
    }
    const claimed = assignPlayerIdentity(
      state,
      localColor as PlayerColor,
      playerId,
    );
    const savedAt = Number.isSafeInteger(legacy?.savedAt)
      ? legacy.savedAt
      : Date.now();
    const stored: StoredMatch = {
      chain: createStateChain(claimed, playerId, savedAt),
      localColor,
      playerId,
      savedAt,
    };
    localStorage.setItem(storedMatchKey(playerId), JSON.stringify(stored));
    return stored;
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
  allowOpenSeats: boolean;
  onChangeController: (color: PlayerColor, controller: SeatController) => void;
  onChangeTeam: (color: PlayerColor, team: TeamId) => void;
}

function SeatCard({
  game,
  color,
  localColor,
  connectedColors,
  active,
  canManage,
  allowOpenSeats,
  onChangeController,
  onChangeTeam,
}: SeatCardProps) {
  const seat = game.seats[color];
  const appearance = playerAppearance(
    color,
    game.mode,
    game.teamAssignments,
  );
  const isLocal = color === localColor && seat.controller === "human";
  const connected =
    seat.controller !== "human" ||
    humanSeatIsPresent(color, localColor, connectedColors);
  const team =
    appearance.team === null ? null : TEAM_LABELS[appearance.team];
  const seatName = displaySeatName(game, color);

  return (
    <article
      className={`seat-card seat-${color}${active ? " is-active" : ""}`}
      aria-label={`${POSITION_LABELS[color]} seat`}
    >
      <div className="seat-heading">
        <span
          className={`color-token token-${color} ${appearance.paletteClass}`}
          aria-hidden="true"
        >
          {COLOR_SYMBOLS[color]}
        </span>
        <div>
          <strong>
            {POSITION_LABELS[color]} · {appearance.label}
          </strong>
          <span>
            {team ? `${team} team · ` : ""}
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
      <div className="seat-name">{seatName}</div>
      {game.mode === "teams" ? (
        <div
          className="team-picker"
          role="group"
          aria-label={`${POSITION_LABELS[color]} team`}
        >
          {(["warm", "cool"] as const).map((candidate) => (
            <button
              type="button"
              className={
                teamOf(color, game.teamAssignments) === candidate
                  ? `active team-${candidate}`
                  : `team-${candidate}`
              }
              aria-pressed={
                teamOf(color, game.teamAssignments) === candidate
              }
              disabled={!canManage}
              onClick={() => onChangeTeam(color, candidate)}
              key={candidate}
            >
              <span aria-hidden="true" />
              {TEAM_LABELS[candidate]}
            </button>
          ))}
        </div>
      ) : null}
      {canManage &&
      color !== localColor &&
      seat.controller !== "human" &&
      (allowOpenSeats || seat.controller === "open") ? (
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
  const [selectedGame, setSelectedGame] = useState<GameKind>("chess");
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
  const [identity, setIdentity] = useState<PlayerIdentity | null>(null);
  const [chainEntryCount, setChainEntryCount] = useState(0);
  const [lastChainTime, setLastChainTime] = useState<number | null>(null);

  const gameRef = useRef<GameState | null>(null);
  const chainRef = useRef<StateChain | null>(null);
  const identityRef = useRef<PlayerIdentity | null>(null);
  const localColorRef = useRef<PlayerColor>("red");
  const meshRef = useRef<PeerMesh | null>(null);
  const connectedRef = useRef<PlayerColor[]>([]);

  const saveChain = useCallback(
    (chain: StateChain, color = localColorRef.current) => {
      const activeIdentity = identityRef.current;
      const latest = latestStateChainEntry(chain);
      if (!activeIdentity || latest.state.roomCode === "PRACTICE") {
        return;
      }
      try {
        const stored: StoredMatch = {
          chain,
          localColor: color,
          playerId: activeIdentity.id,
          savedAt: latest.timestamp.wallTime,
        };
        localStorage.setItem(
          storedMatchKey(activeIdentity.id),
          JSON.stringify(stored),
        );
        setStoredMatch(stored);
      } catch {
        // The live mesh remains authoritative if local storage is unavailable.
      }
    },
    [],
  );

  const installGameState = useCallback((state: GameState) => {
    gameRef.current = state;
    setGame(state);
  }, []);

  const installChain = useCallback(
    (chain: StateChain, persist = true) => {
      const latest = latestStateChainEntry(chain);
      chainRef.current = chain;
      setChainEntryCount(chain.entries.length);
      setLastChainTime(latest.timestamp.wallTime);
      const state = latest.state;
      gameRef.current = state;
      setGame(state);
      if (persist) {
        saveChain(chain);
      }
    },
    [saveChain],
  );

  const broadcastChain = useCallback((chain: StateChain) => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }
    mesh.broadcast({
      type: "state-chain",
      sender: mesh.localPeerId,
      chain,
    });
  }, []);

  const commitState = useCallback(
    (next: GameState, broadcast = true) => {
      if (next.roomCode === "PRACTICE") {
        installGameState(next);
        return;
      }
      const activeIdentity = identityRef.current;
      if (!activeIdentity) {
        return;
      }
      const currentChain =
        chainRef.current ??
        createStateChain(
          gameRef.current ?? next,
          activeIdentity.id,
        );
      const nextChain = appendStateChain(
        currentChain,
        next,
        activeIdentity.id,
      );
      installChain(nextChain);
      if (broadcast) {
        broadcastChain(nextChain);
      }
    },
    [broadcastChain, installChain, installGameState],
  );

  const acceptRemoteChain = useCallback(
    (
      incoming: StateChain,
    ): { merged: StateChain; incomingDigest: string } | null => {
      const normalized = normalizeStateChain(incoming);
      if (!normalized) {
        setNotice("A peer sent an incompatible recovery chain. It was ignored.");
        return null;
      }
      const current = chainRef.current;
      const incomingDigest = stateChainDigest(normalized);
      const merged = current
        ? mergeStateChains(current, normalized)
        : normalized;
      const previousHead = current
        ? latestStateChainEntry(current)
        : null;
      const nextHead = latestStateChainEntry(merged);
      const chainChanged =
        !current || stateChainDigest(current) !== stateChainDigest(merged);
      if (chainChanged) {
        installChain(merged);
      }
      if (
        previousHead &&
        previousHead.state.stateHash !== nextHead.state.stateHash
      ) {
        setNotice(
          "Recovery chains synchronized. The room restored the newest timestamped position.",
        );
        setSelected(null);
      }
      setSelectedGame(gameKindOf(nextHead.state));
      if (nextHead.state.phase !== "lobby") {
        setView("game");
      }
      return { merged, incomingDigest };
    },
    [installChain],
  );

  const startMesh = useCallback(
    async (chain: StateChain, color: PlayerColor): Promise<PeerMesh> => {
      const activeIdentity = identityRef.current;
      if (!activeIdentity) {
        throw new Error("Player identity is not ready");
      }
      const state = latestStateChainEntry(chain).state;
      const mesh = new PeerMesh(
        state.roomCode,
        color,
        activeIdentity.id,
        {
          onMessage: (message: WireMessage, remotePeerId: string) => {
            if (message.type === "state-request") {
              const current = chainRef.current;
              if (current) {
                mesh.sendTo(remotePeerId, {
                  type: "state-chain",
                  sender: mesh.localPeerId,
                  chain: current,
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
                    message.playerId,
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
            if (message.type === "chain-summary") {
              const current = chainRef.current;
              if (current && !stateChainMatchesSummary(current, message)) {
                mesh.sendTo(remotePeerId, {
                  type: "state-chain",
                  sender: mesh.localPeerId,
                  chain: current,
                });
              }
              return;
            }
            if (message.type === "state-chain") {
              const result = acceptRemoteChain(message.chain);
              if (
                result &&
                stateChainDigest(result.merged) !== result.incomingDigest
              ) {
                mesh.sendTo(remotePeerId, {
                  type: "state-chain",
                  sender: mesh.localPeerId,
                  chain: result.merged,
                });
              }
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
              setNotice(
                "A player disconnected. The room state is saved and reconnection will keep retrying.",
              );
            }
          },
          onSignalStatus: setSignalStatus,
          onNotice: setNotice,
        },
      );
      meshRef.current = mesh;
      await mesh.start();
      return mesh;
    },
    [acceptRemoteChain, commitState],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const activeIdentity = getOrCreatePlayerIdentity();
      identityRef.current = activeIdentity;
      setIdentity(activeIdentity);
      setStoredMatch(readStoredMatch(activeIdentity.id));
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
    if (!isNetworked) {
      return;
    }
    const shareSummary = () => {
      const mesh = meshRef.current;
      const chain = chainRef.current;
      if (!mesh || !chain) {
        return;
      }
      const summary = stateChainSummary(chain);
      mesh.broadcast({
        type: "chain-summary",
        sender: mesh.localPeerId,
        ...summary,
      });
    };
    shareSummary();
    const timer = window.setInterval(shareSummary, 1_500);
    return () => window.clearInterval(timer);
  }, [isNetworked]);

  useEffect(() => {
    if (!isNetworked) {
      return;
    }
    const reconnect = () => meshRef.current?.reconnectNow();
    const reconnectWhenVisible = () => {
      if (document.visibilityState === "visible") {
        reconnect();
      }
    };
    window.addEventListener("online", reconnect);
    window.addEventListener("focus", reconnect);
    document.addEventListener("visibilitychange", reconnectWhenVisible);
    return () => {
      window.removeEventListener("online", reconnect);
      window.removeEventListener("focus", reconnect);
      document.removeEventListener(
        "visibilitychange",
        reconnectWhenVisible,
      );
    };
  }, [isNetworked]);

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
    if (
      !game ||
      gameKindOf(game) !== "checkers" ||
      game.phase !== "playing" ||
      coordinator !== localColor ||
      getAllLegalMoves(game, game.turn).length
    ) {
      return;
    }
    const expectedStateHash = game.stateHash;
    const timer = window.setTimeout(() => {
      const current = gameRef.current;
      if (
        !current ||
        !coordinatorOwnsState(
          current,
          expectedStateHash,
          localColorRef.current,
          connectedRef.current,
        ) ||
        gameKindOf(current) !== "checkers" ||
        current.phase !== "playing" ||
        getAllLegalMoves(current, current.turn).length
      ) {
        return;
      }
      const eliminatedColor = current.turn;
      commitState(passTurn(current, eliminatedColor));
      setNotice(
        `${COLOR_LABELS[eliminatedColor]} has no legal move and is out.`,
      );
    }, 420);
    return () => window.clearTimeout(timer);
  }, [commitState, coordinator, game, localColor]);

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
        !coordinatorOwnsState(
          current,
          expectedStateHash,
          localColorRef.current,
          connectedRef.current,
        ) ||
        current.phase !== "playing" ||
        current.seats[current.turn].controller !== "computer"
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

  const useFreshIdentity = () => {
    if (view !== "home") {
      return;
    }
    const freshIdentity = createFreshPlayerIdentity();
    identityRef.current = freshIdentity;
    setIdentity(freshIdentity);
    setStoredMatch(readStoredMatch(freshIdentity.id));
    setNotice("This tab now has a new recovery code.");
  };

  const createOnlineRoom = async (kind: GameKind = selectedGame) => {
    const activeIdentity = identityRef.current;
    if (!activeIdentity) {
      setNotice("Your player code is still loading.");
      return;
    }
    localStorage.setItem("crossboard:player-name", playerName.trim() || "Player");
    const roomCode = generateRoomCode();
    const initial = createGameState(
      roomCode,
      "teams",
      playerName.trim() || "Player",
      kind,
      activeIdentity.id,
    );
    initial.seats.red.peerId = seatPeerId(roomCode, "red");
    initial.stateHash = calculateStateHash(initial);
    const chain = createStateChain(initial, activeIdentity.id);

    localColorRef.current = "red";
    setLocalColor("red");
    setOrientation("red");
    setSelectedGame(kind);
    installChain(chain);
    setView("lobby");
    setIsNetworked(true);
    updateLocation(roomCode);
    try {
      await startMesh(chain, "red");
      setNotice("Room ready. Share the code when you’re happy with the seats.");
    } catch {
      meshRef.current?.close();
      meshRef.current = null;
      setSignalStatus("offline");
      setNotice("The peer handshake is unavailable. Local practice still works.");
    }
  };

  const joinRoom = async () => {
    const activeIdentity = identityRef.current;
    if (!activeIdentity) {
      setNotice("Your player code is still loading.");
      return;
    }
    const roomCode = normalizeRoomCode(roomInput);
    if (roomCode.replace(/-/g, "").length !== 12) {
      setNotice("Enter the 12-character room code.");
      return;
    }
    setJoining(true);
    setNotice("Looking for the room…");
    try {
      const discovered = normalizeStateChain(
        await discoverRoom(roomCode, activeIdentity.id),
      );
      if (!discovered) {
        throw new Error("Incompatible room");
      }
      const localCopy =
        storedMatch?.playerId === activeIdentity.id &&
        storedMatch.chain.roomCode === discovered.roomCode
          ? storedMatch.chain
          : null;
      const synchronized = localCopy
        ? mergeStateChains(discovered, localCopy)
        : discovered;
      const synchronizedState = latestStateChainEntry(synchronized).state;
      const reclaimedColor = playerSeatFor(
        synchronizedState,
        activeIdentity.id,
      );
      if (!reclaimedColor && synchronizedState.phase !== "lobby") {
        throw new Error("That game has already started.");
      }
      const candidates = reclaimedColor
        ? [reclaimedColor]
        : (["yellow", "blue", "green", "red"] as PlayerColor[]).filter(
            (color) =>
              synchronizedState.seats[color].controller === "open",
          );
      if (!candidates.length) {
        throw new Error("That room has no open seats.");
      }

      let joined = false;
      for (const color of candidates) {
        const rejoining =
          synchronizedState.seats[color].playerId === activeIdentity.id;
        const next = rejoining
          ? synchronizedState
          : updateLobby(
              synchronizedState,
              {
                seats: {
                  ...synchronizedState.seats,
                  [color]: {
                    color,
                    controller: "human" as const,
                    name: playerName.trim() || COLOR_LABELS[color],
                    peerId: seatPeerId(roomCode, color),
                    playerId: activeIdentity.id,
                  },
                },
              },
              `join-${color}`,
            );
        const nextChain = rejoining
          ? synchronized
          : appendStateChain(
              synchronized,
              next,
              activeIdentity.id,
            );
        gameRef.current = next;
        chainRef.current = nextChain;
        localColorRef.current = color;
        try {
          const mesh = await startMesh(nextChain, color);
          meshRef.current = mesh;
          setLocalColor(color);
          setOrientation(color);
          setSelectedGame(gameKindOf(next));
          setIsNetworked(true);
          installChain(nextChain);
          setView(next.phase === "lobby" ? "lobby" : "game");
          updateLocation(roomCode);
          broadcastChain(nextChain);
          setNotice(
            rejoining
              ? `Welcome back. Your ${COLOR_LABELS[color]} seat and recovery chain are restored.`
              : `Joined as ${COLOR_LABELS[color]}.`,
          );
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

  const startPractice = (
    mode: GameMode,
    kind: GameKind = selectedGame,
  ) => {
    const started = createPracticeGame(
      mode,
      playerName.trim() || "You",
      kind,
    );
    meshRef.current?.close();
    meshRef.current = null;
    chainRef.current = null;
    setChainEntryCount(0);
    setLastChainTime(null);
    localColorRef.current = "red";
    setLocalColor("red");
    setOrientation("red");
    setSelectedGame(kind);
    setIsNetworked(false);
    setSignalStatus("online");
    setConnectedColors([]);
    installGameState(
      kind === "checkers"
        ? updateLobby(
            createGameState(
              "PRACTICE",
              mode,
              playerName.trim() || "You",
              kind,
            ),
            { mode, seats: started.seats },
            `practice-${kind}-${mode}`,
          )
        : started,
    );
    setView(kind === "checkers" ? "lobby" : "game");
    if (kind === "checkers") {
      setNotice("Choose your checkers variation, then start when ready.");
    }
    updateLocation();
  };

  const resumeStoredMatch = async () => {
    const activeIdentity = identityRef.current;
    if (!storedMatch || !activeIdentity) {
      return;
    }
    let synchronizedChain = storedMatch.chain;
    setNotice("Checking every available recovery chain…");
    try {
      const remoteChain = normalizeStateChain(
        await discoverRoom(
          synchronizedChain.roomCode,
          activeIdentity.id,
          2_500,
        ),
      );
      if (remoteChain) {
        synchronizedChain = mergeStateChains(
          synchronizedChain,
          remoteChain,
        );
      }
    } catch {
      // A lone returning player can still restore the locally saved chain.
    }
    const state = latestStateChainEntry(synchronizedChain).state;
    const recoveredColor = playerSeatFor(state, activeIdentity.id);
    if (!recoveredColor) {
      setNotice("That saved seat belongs to a different player code.");
      return;
    }
    localColorRef.current = recoveredColor;
    setLocalColor(recoveredColor);
    setOrientation(recoveredColor);
    setSelectedGame(gameKindOf(state));
    installChain(synchronizedChain);
    setView(state.phase === "lobby" ? "lobby" : "game");
    setIsNetworked(true);
    updateLocation(state.roomCode);
    try {
      await startMesh(synchronizedChain, recoveredColor);
      broadcastChain(synchronizedChain);
      setNotice(
        `Welcome back. Your ${COLOR_LABELS[recoveredColor]} seat and newest recovery checkpoint are restored.`,
      );
    } catch {
      meshRef.current?.close();
      meshRef.current = null;
      setNotice(
        "That seat is still active elsewhere. Close the other tab and retry.",
      );
    }
  };

  const leaveRoom = () => {
    meshRef.current?.close();
    meshRef.current = null;
    gameRef.current = null;
    chainRef.current = null;
    connectedRef.current = [];
    setConnectedColors([]);
    setGame(null);
    setChainEntryCount(0);
    setLastChainTime(null);
    setSelected(null);
    setIsNetworked(false);
    setView("home");
    setSignalStatus("connecting");
    updateLocation();
  };

  const commitLobbyMutation = (
    command: (current: GameState) => GameState,
  ) =>
    runLobbyCommand(gameRef, commitState, (current) => {
      if (
        electCoordinator(
          current,
          localColorRef.current,
          connectedRef.current,
        ) !== localColorRef.current
      ) {
        return current;
      }
      return command(current);
    });

  const changeMode = (mode: GameMode) => {
    commitLobbyMutation((current) =>
      updateLobby(current, { mode }, `mode-${mode}`),
    );
  };

  const changeTeamAssignment = (color: PlayerColor, team: TeamId) => {
    commitLobbyMutation((current) => {
      if (current.mode !== "teams") {
        return current;
      }
      const currentTeam = teamOf(color, current.teamAssignments);
      if (currentTeam === team) {
        return current;
      }
      const currentTeamSize = PLAYER_COLORS.filter(
        (candidate) =>
          teamOf(candidate, current.teamAssignments) === currentTeam,
      ).length;
      if (currentTeamSize <= 1) {
        setNotice("Each side needs at least one seat.");
        return current;
      }
      return updateLobby(
        current,
        {
          teamAssignments: {
            ...current.teamAssignments,
            [color]: team,
          },
        },
        `team-${color}-${team}`,
      );
    });
  };

  const changeCheckersPreset = (
    preset: Exclude<CheckersPreset, "custom">,
  ) => {
    commitLobbyMutation((current) =>
      gameKindOf(current) === "checkers"
        ? updateLobby(
            current,
            { checkersRules: checkersRulesForPreset(preset) },
            `checkers-preset-${preset}`,
          )
        : current,
    );
  };

  const changeCheckersRule = (
    rule: keyof Omit<CheckersRules, "preset">,
    enabled: boolean,
  ) => {
    commitLobbyMutation((current) => {
      if (gameKindOf(current) !== "checkers") {
        return current;
      }
      const checkersRules: CheckersRules = {
        ...current.checkersRules,
        preset: "custom",
        [rule]: enabled,
      };
      if (rule === "mandatoryCapture" && !enabled) {
        checkersRules.maximumCapture = false;
      }
      return updateLobby(
        current,
        { checkersRules },
        `checkers-rule-${rule}-${enabled ? "on" : "off"}`,
      );
    });
  };

  const changeSeatController = (
    color: PlayerColor,
    controller: SeatController,
  ) => {
    commitLobbyMutation((current) => {
      const local = localColorRef.current;
      const seat = current.seats[color];
      if (
        color === local ||
        seat.controller === "human" ||
        (!isNetworked && controller === "open")
      ) {
        return current;
      }
      const seats = {
        ...current.seats,
        [color]: {
          color,
          controller,
          name:
            controller === "computer"
              ? `Computer ${COLOR_LABELS[color]}`
              : "Open seat",
        },
      };
      return updateLobby(
        current,
        { seats },
        `seat-${color}-${controller}`,
      );
    });
  };

  const applyFriendsVsComputersPreset = () => {
    commitLobbyMutation((current) =>
      configureFriendsVsComputers(
        current,
        localColorRef.current,
        isNetworked,
      ),
    );
  };

  const beginGame = () => {
    const started = commitLobbyMutation((current) => {
      const local = localColorRef.current;
      const connected = connectedRef.current;
      const hasOpenSeat = PLAYER_COLORS.some(
        (color) => current.seats[color].controller === "open",
      );
      const missingHuman = PLAYER_COLORS.some(
        (color) =>
          current.seats[color].controller === "human" &&
          !humanSeatIsPresent(color, local, connected),
      );
      const hasInvalidTeams =
        current.mode === "teams" &&
        new Set(
          PLAYER_COLORS.map((color) =>
            teamOf(color, current.teamAssignments),
          ),
        ).size < 2;
      if (hasOpenSeat || missingHuman || hasInvalidTeams) {
        setNotice(
          hasOpenSeat
            ? "Fill all four seats before starting."
            : missingHuman
              ? "A human player is still reconnecting."
              : "Put at least one seat on each team.",
        );
        return current;
      }
      return startGame(current);
    });
    if (started?.phase === "playing") {
      setSelected(null);
      setView("game");
    }
  };

  const activeSelection =
    game?.continuationFrom &&
    game.turn === localColor &&
    game.seats[localColor].controller === "human"
      ? game.continuationFrom
      : selected;

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
    setSelected(next.continuationFrom);
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
    if (activeSelection) {
      const legal = getLegalMovesForPiece(game, activeSelection).some((move) =>
        sameSquare(move.to, coord),
      );
      if (legal) {
        makeMove(activeSelection, coord);
        return;
      }
      if (piece?.color === localColor) {
        const moves = getLegalMovesForPiece(game, coord);
        if (moves.length) {
          setSelected(coord);
        } else if (gameKindOf(game) === "checkers") {
          setNotice(
            game.continuationFrom
              ? "Keep jumping with the same checker."
              : "Another checker has the required capture.",
          );
        }
        return;
      }
      setSelected(null);
      setNotice("That piece can’t move there.");
      return;
    }
    if (piece?.color === localColor) {
      const moves = getLegalMovesForPiece(game, coord);
      if (moves.length) {
        setSelected(coord);
      } else if (gameKindOf(game) === "checkers") {
        setNotice(
          game.continuationFrom
            ? "Keep jumping with the same checker."
            : "That checker has no legal move right now.",
        );
      }
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

    const currentCoordinator = electCoordinator(
      current,
      localColorRef.current,
      connectedRef.current,
    );
    if (isNetworked && currentCoordinator !== localColorRef.current) {
      const mesh = meshRef.current;
      if (!mesh) {
        setNotice("The room is reconnecting. Try undo again in a moment.");
        return;
      }
      mesh.sendTo(seatPeerId(current.roomCode, currentCoordinator), {
        type: "undo-request",
        sender: mesh.localPeerId,
        playerId: mesh.playerId,
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
    () =>
      game && activeSelection
        ? getLegalMovesForPiece(game, activeSelection)
        : [],
    [activeSelection, game],
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
  const storedState = storedMatch
    ? latestStateChainEntry(storedMatch.chain).state
    : null;
  const lastChainLabel = lastChainTime
    ? new Date(lastChainTime).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;

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
            <p className="eyebrow">The four-player board-game menu</p>
            <h1>
              Pick your
              <br />
              <em>game.</em>
            </h1>
            <p className="hero-lede">
              Chess or checkers, every color for themselves or custom
              Warm-versus-Cool teams. Add casual computer opponents, invite
              friends, and keep
              playing when the room creator drops.
            </p>
            <div className="game-menu" aria-label="Choose a game">
              <button
                className={`game-choice${selectedGame === "chess" ? " active" : ""}`}
                type="button"
                aria-pressed={selectedGame === "chess"}
                onClick={() => setSelectedGame("chess")}
              >
                <span className="game-choice-art chess-art" aria-hidden="true">
                  ♞
                </span>
                <span>
                  <small>Crossboard Capture</small>
                  <strong>Four-player chess</strong>
                  <em>Quick king-capture rules</em>
                </span>
                <b aria-hidden="true">↗</b>
              </button>
              <button
                className={`game-choice${selectedGame === "checkers" ? " active" : ""}`}
                type="button"
                aria-pressed={selectedGame === "checkers"}
                onClick={() => setSelectedGame("checkers")}
              >
                <span className="game-choice-art checkers-art" aria-hidden="true">
                  <i />
                  <i />
                </span>
                <span>
                  <small>Crossboard Checkers</small>
                  <strong>Four-player checkers</strong>
                  <em>Chains, crowns, and variants</em>
                </span>
                <b aria-hidden="true">↗</b>
              </button>
            </div>
            <div className="hero-actions">
              <button
                className="primary-button"
                type="button"
                disabled={!identity}
                onClick={() => void createOnlineRoom(selectedGame)}
              >
                Create {selectedGame === "chess" ? "chess" : "checkers"} room{" "}
                <span aria-hidden="true">→</span>
              </button>
              {selectedGame === "chess" ? (
                <>
                  <button
                    className="secondary-button practice-button"
                    type="button"
                    onClick={() => startPractice("teams", "chess")}
                  >
                    <span>Practice teams</span>
                    <small>You + Yellow vs Blue + Green</small>
                  </button>
                  <button
                    className="secondary-button practice-button"
                    type="button"
                    onClick={() => startPractice("ffa", "chess")}
                  >
                    <span>Practice free-for-all</span>
                    <small>Three computer rivals</small>
                  </button>
                </>
              ) : (
                <button
                  className="secondary-button practice-button"
                  type="button"
                  onClick={() => startPractice("ffa", "checkers")}
                >
                  <span>Set up checkers practice</span>
                  <small>Choose teams and variation before play</small>
                </button>
              )}
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
            <div className="identity-card" data-testid="player-identity">
              <span>
                <small>Your refresh recovery code</small>
                <strong data-testid="player-id">
                  {identity?.id ?? "Creating code…"}
                </strong>
              </span>
              <button
                className="text-button"
                type="button"
                disabled={!identity}
                onClick={useFreshIdentity}
              >
                New code
              </button>
            </div>
            <p className="identity-note">
              This tab remembers the code after a refresh, so an active game
              can return you to the same seat.
            </p>
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
                disabled={joining || !identity}
                onClick={() => void joinRoom()}
              >
                {joining ? "Finding…" : "Join"}
              </button>
            </div>
            <p className="panel-note">
              Invite links carry the room and its game. Every player keeps a
              timestamped recovery chain and shares it again after reconnecting.
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
            {storedMatch && storedState ? (
              <button
                className="resume-card"
                type="button"
                onClick={() => void resumeStoredMatch()}
              >
                <span>
                  <b>Resume local copy</b>
                  <small>
                    Room {storedState.roomCode} ·{" "}
                    {storedMatch.chain.entries.length} checkpoints · move{" "}
                    {storedState.history.length}
                  </small>
                </span>
                <span aria-hidden="true">↗</span>
              </button>
            ) : null}
          </aside>
        </section>

        <section className="rules-preview" aria-label="How Crossboard works">
          <article>
            <span>{selectedGame === "chess" ? "♞" : "●"}</span>
            <h2>
              {selectedGame === "chess"
                ? "Fast four-way chess"
                : "Checkers with options"}
            </h2>
            <p>
              {selectedGame === "chess"
                ? "Standard piece movement on a 14×14 cross with a quick king-capture finish."
                : "Toggle flying kings, backward captures, forced jumps, longest chains, and crowning behavior."}
            </p>
          </article>
          <article>
            <span>⟲</span>
            <h2>No fragile host</h2>
            <p>
              Every browser stores a timestamped position chain. Reconnecting
              players merge their copies, restore the newest checkpoint, and
              reclaim their original seat.
            </p>
          </article>
          <article>
            <span>✣</span>
            <h2>Teams or free-for-all</h2>
            <p>
              Assign each seat to the Warm or Cool team, with casual computer
              players ready for any empty seat.
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
    const isCheckers = gameKindOf(game) === "checkers";
    const hasOpen = PLAYER_COLORS.some(
      (color) => game.seats[color].controller === "open",
    );
    const hasMissingHuman = PLAYER_COLORS.some(
      (color) =>
        game.seats[color].controller === "human" &&
        !humanSeatIsPresent(color, localColor, connectedColors),
    );
    const warmCount = PLAYER_COLORS.filter(
      (color) => teamOf(color, game.teamAssignments) === "warm",
    ).length;
    const coolCount = PLAYER_COLORS.length - warmCount;
    const hasInvalidTeams =
      game.mode === "teams" && (warmCount === 0 || coolCount === 0);

    return (
      <main className="site-shell lobby-shell">
        <header className="brand-bar game-topbar">
          <button className="brand brand-button" type="button" onClick={leaveRoom}>
            <span className="brand-mark" aria-hidden="true">✣</span>
            <span>Crossboard</span>
          </button>
          <div className="room-meta">
            {isNetworked ? (
              <button className="room-code-button" type="button" onClick={copyInvite}>
                Room {game.roomCode}{" "}
                <span>{copied ? "Copied" : "Copy invite"}</span>
              </button>
            ) : (
              <span className="room-code-button">Local setup</span>
            )}
            <span className={`connection-pill status-${signalStatus}`}>
              <span className="status-dot" /> {connectionLabel}
            </span>
          </div>
        </header>

        <section className="lobby-heading">
          <div>
            <p className="eyebrow">
              {isCheckers ? "Four-player checkers" : "Crossboard Capture"}
            </p>
            <h1>Build your four.</h1>
            <p>
              Assign every seat to Warm or Cool in Teams
              {isCheckers ? "; teammates can’t capture each other" : ""}.
              Computers are ready immediately; open seats wait for an invite.
            </p>
          </div>
          <div className="lobby-mode-panel">
            <div className="mode-switch" aria-label="Game mode">
              <button
                type="button"
                className={game.mode === "teams" ? "active" : ""}
                disabled={!isCoordinator}
                onClick={() => changeMode("teams")}
              >
                Teams <small>Choose sides</small>
              </button>
              <button
                type="button"
                className={game.mode === "ffa" ? "active" : ""}
                disabled={!isCoordinator}
                onClick={() => changeMode("ffa")}
              >
                Free-for-all{" "}
                <small>{isCheckers ? "Last color" : "Last king"}</small>
              </button>
            </div>
            {game.mode === "teams" ? (
              <p className="team-counts" aria-label="Team sizes">
                <span className="warm-count">Warm {warmCount}</span>
                <span className="cool-count">Cool {coolCount}</span>
              </p>
            ) : null}
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
                allowOpenSeats={isNetworked}
                onChangeController={changeSeatController}
                onChangeTeam={changeTeamAssignment}
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
                allowOpenSeats={isNetworked}
                onChangeController={changeSeatController}
                onChangeTeam={changeTeamAssignment}
              />
            </div>
            <div
              className={`mini-board-logo${isCheckers ? " checker-logo" : ""}`}
              aria-hidden="true"
            >
              {isCheckers ? (
                <>
                  <span>●</span><span>○</span><span>●</span>
                  <span>○</span><b>♛</b><span>○</span>
                  <span>●</span><span>○</span><span>●</span>
                </>
              ) : (
                <>
                  <span>♜</span><span>♞</span><span>♝</span>
                  <span>♟</span><b>✣</b><span>♟</span>
                  <span>♝</span><span>♞</span><span>♜</span>
                </>
              )}
            </div>
            <div className="east-seat">
              <SeatCard
                game={game}
                color="green"
                localColor={localColor}
                connectedColors={connectedColors}
                active={false}
                canManage={isCoordinator}
                allowOpenSeats={isNetworked}
                onChangeController={changeSeatController}
                onChangeTeam={changeTeamAssignment}
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
                allowOpenSeats={isNetworked}
                onChangeController={changeSeatController}
                onChangeTeam={changeTeamAssignment}
              />
            </div>
          </div>

          <aside className="lobby-sidebar">
            {isCheckers ? (
              <section className="checkers-options" aria-label="Checkers rules">
                <div className="options-heading">
                  <div>
                    <span>Checkers variation</span>
                    <strong>
                      {game.checkersRules.preset === "custom"
                        ? "Custom rules"
                        : `${game.checkersRules.preset[0].toUpperCase()}${game.checkersRules.preset.slice(1)}`}
                    </strong>
                  </div>
                  <span>{isCoordinator ? "You choose" : "Room setting"}</span>
                </div>
                <div className="preset-tabs" aria-label="Rules preset">
                  {(["american", "international", "house"] as const).map(
                    (preset) => (
                      <button
                        type="button"
                        className={
                          game.checkersRules.preset === preset ? "active" : ""
                        }
                        disabled={!isCoordinator}
                        onClick={() => changeCheckersPreset(preset)}
                        key={preset}
                      >
                        {preset === "american"
                          ? "American"
                          : preset === "international"
                            ? "International"
                            : "House"}
                      </button>
                    ),
                  )}
                </div>
                <div className="rule-toggle-list">
                  {(
                    [
                      [
                        "flyingKings",
                        "Flying kings",
                        "Kings slide and capture across open diagonals.",
                      ],
                      [
                        "backwardCaptures",
                        "Backward captures",
                        "Uncrowned pieces may jump in every direction.",
                      ],
                      [
                        "mandatoryCapture",
                        "Must capture",
                        "A jump takes priority over an ordinary move.",
                      ],
                      [
                        "maximumCapture",
                        "Longest chain",
                        "Only a route with the most available jumps is legal.",
                      ],
                      [
                        "continueAfterCrowning",
                        "Crown and continue",
                        "A newly crowned king may finish its capture chain.",
                      ],
                    ] as const
                  ).map(([rule, label, help]) => (
                    <label className="rule-toggle" key={rule}>
                      <input
                        type="checkbox"
                        checked={game.checkersRules[rule]}
                        disabled={
                          !isCoordinator ||
                          (rule === "maximumCapture" &&
                            !game.checkersRules.mandatoryCapture) ||
                          (rule === "continueAfterCrowning" &&
                            game.checkersRules.deferredPromotion)
                        }
                        onChange={(event) =>
                          changeCheckersRule(rule, event.target.checked)
                        }
                      />
                      <span>
                        <b>{label}</b>
                        <small>{help}</small>
                      </span>
                    </label>
                  ))}
                </div>
                <div className="sequence-timing-note">
                  <strong>Sequence timing</strong>
                  <span>
                    Captures{" "}
                    {game.checkersRules.deferredCaptureRemoval
                      ? "leave the board after the full chain"
                      : "leave the board after each jump"}
                    ; promotion{" "}
                    {game.checkersRules.deferredPromotion
                      ? "activates when the turn ends"
                      : "activates on reaching the far edge"}.
                  </span>
                </div>
              </section>
            ) : null}
            <div className="health-card">
              <div className="health-icon" aria-hidden="true">⟲</div>
              <div>
                <span>
                  {isNetworked ? "Room continuity" : "Local practice"}
                </span>
                <strong>
                  {isNetworked
                    ? isCoordinator
                      ? "You’re keeping the room running"
                      : `${game.seats[coordinator].name} is coordinating`
                    : "Computers run in this browser"}
                </strong>
                {isNetworked ? (
                  <small>
                    {chainEntryCount} timestamped checkpoints
                    {lastChainLabel ? ` · newest ${lastChainLabel}` : ""}
                  </small>
                ) : null}
              </div>
            </div>
            {isNetworked ? (
              <details className="plain-details">
                <summary>How this room stays open</summary>
                <p>
                  Everyone stores the room’s timestamped recovery chain. If the
                  coordinator disconnects, another connected human takes over.
                  Rejoining players merge every available copy, restore the
                  newest checkpoint, and reclaim their seat with their player
                  code. Silent links are retired automatically, and every
                  browser keeps retrying in the background when the network
                  returns.
                </p>
              </details>
            ) : null}
            {isCoordinator ? (
              <button
                className="preset-button"
                type="button"
                onClick={applyFriendsVsComputersPreset}
              >
                <span>Recommended setup</span>
                <b>
                  {isNetworked
                    ? "Two friends vs two computers"
                    : "You + a computer vs two computers"}
                </b>
              </button>
            ) : null}
            <div className="lobby-actions">
              <button
                className="primary-button"
                type="button"
                disabled={
                  !isCoordinator ||
                  hasOpen ||
                  hasMissingHuman ||
                  hasInvalidTeams
                }
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
                      : hasInvalidTeams
                        ? "Put at least one seat on each team."
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
  const isCheckers = gameKindOf(game) === "checkers";
  const isMyTurn =
    game.phase === "playing" &&
    game.turn === localColor &&
    activeSeat.controller === "human";
  const boardInteractive = isMyTurn && !botThinking;
  const turnAppearance = playerAppearance(
    game.turn,
    game.mode,
    game.teamAssignments,
  );
  const statusHeading =
    game.phase === "finished"
      ? describeWinner(game)
      : botThinking
        ? `${isCheckers && game.continuationFrom ? "Computer is chaining jumps" : "Computer is thinking"} · ${turnAppearance.label}`
        : isMyTurn
          ? `${isCheckers && game.continuationFrom ? "Keep jumping" : "Your turn"} · ${turnAppearance.label}`
          : `${displaySeatName(game, game.turn)}’s turn · ${turnAppearance.label}`;

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

      <section
        className={`turn-banner banner-${game.turn} ${turnAppearance.paletteClass}`}
        aria-live="polite"
      >
        <div>
          <span
            className={`color-token token-${game.turn} ${turnAppearance.paletteClass}`}
            aria-hidden="true"
          >
            {COLOR_SYMBOLS[game.turn]}
          </span>
          <div>
            <small>Round {game.round}</small>
            <strong>{statusHeading}</strong>
          </div>
        </div>
        {isNetworked && coordinator === localColor ? (
          <span className="coordinator-note">
            You’re keeping {chainEntryCount} checkpoints in sync
          </span>
        ) : null}
      </section>

      <section className="game-layout">
        <div className="board-column">
          <div className="player-chip-row">
            {PLAYER_COLORS.map((color) => {
              const seat = game.seats[color];
              const appearance = playerAppearance(
                color,
                game.mode,
                game.teamAssignments,
              );
              const connected =
                seat.controller !== "human" ||
                humanSeatIsPresent(color, localColor, connectedColors);
              return (
                <div
                  className={`player-chip chip-${color}${
                    game.turn === color ? " is-active" : ""
                  }${game.eliminated.includes(color) ? " is-eliminated" : ""}`}
                  key={color}
                >
                  <span
                    className={`color-token token-${color} ${appearance.paletteClass}`}
                  >
                    {COLOR_SYMBOLS[color]}
                  </span>
                  <span>
                    <b>{displaySeatName(game, color)}</b>
                    <small>
                      {game.eliminated.includes(color)
                        ? isCheckers
                          ? "No pieces or moves"
                          : "King captured"
                        : `${appearance.label}${
                            appearance.team
                              ? ` · ${TEAM_LABELS[appearance.team]}`
                              : ""
                          } · ${
                            seat.controller === "computer"
                              ? "Computer"
                              : color === localColor
                                ? "You"
                                : connected
                                  ? "Connected"
                                  : "Reconnecting"
                          }`}
                    </small>
                  </span>
                </div>
              );
            })}
          </div>

          <div className="board-frame">
            <GameBoard
              game={game}
              orientation={orientation}
              selected={activeSelection}
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
                      : "Rewind the latest human turn and any computer replies"
                }
                onClick={undoTurn}
              >
                <span aria-hidden="true">↶</span> Undo turn
              </button>
            </div>
            <span>
              Viewing from <b>{POSITION_LABELS[orientation]}</b>
            </span>
          </div>

          {activeSelection && legalDestinations.length ? (
            <div className="legal-tray" aria-label="Legal moves">
              <span>Legal moves</span>
              <div>
                {legalDestinations.map((move) => (
                  <button
                    type="button"
                    key={squareKey(move.to)}
                    onClick={() => makeMove(activeSelection, move.to)}
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
                  {isCheckers ? "Jump" : "Move"} {game.history.length} ·{" "}
                  {game.mode === "teams" ? "Teams" : "Free-for-all"}
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
                  .map((move, index) => {
                    const appearance = playerAppearance(
                      move.color,
                      game.mode,
                      game.teamAssignments,
                    );
                    const eliminatedColors =
                      move.eliminatedColors ??
                      (move.eliminated ? [move.eliminated] : []);
                    const eliminatedLabels = eliminatedColors
                      .map(
                        (color) =>
                          playerAppearance(
                            color,
                            game.mode,
                            game.teamAssignments,
                          ).label,
                      )
                      .join(" + ");
                    return (
                      <div
                        className={`history-row${index === 0 ? " latest" : ""}`}
                        key={move.id}
                      >
                        <span
                          className={`history-color token-${move.color} ${appearance.paletteClass}`}
                        >
                          {COLOR_SYMBOLS[move.color]}
                        </span>
                        <div>
                          <b>
                            {appearance.label} · {PIECE_LABELS[move.piece]}
                          </b>
                          <span>
                            {move.notation}
                            {eliminatedLabels
                              ? ` · ${eliminatedLabels} eliminated`
                              : ""}
                          </span>
                        </div>
                        <small>#{move.revision}</small>
                      </div>
                    );
                  })
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
            {isNetworked ? (
              <p className="hash-line" data-testid="recovery-chain-status">
                Recovery chain <b>{chainEntryCount}</b>
                {lastChainLabel ? ` · newest ${lastChainLabel}` : ""}
              </p>
            ) : null}
          </section>

          {isCheckers ? (
            <details className="side-card rules-card">
              <summary>Checkers rules · {game.checkersRules.preset}</summary>
              <ul>
                <li>
                  {game.mode === "teams"
                    ? "Warm teammates and Cool teammates block one another and can’t be captured."
                    : "Every other color can be captured in free-for-all."}
                </li>
                <li>
                  {game.checkersRules.flyingKings
                    ? "Kings fly along open diagonals."
                    : "Kings move one diagonal square at a time."}
                </li>
                <li>
                  {game.checkersRules.backwardCaptures
                    ? "Men may capture backward."
                    : "Men capture forward only."}
                </li>
                <li>
                  {game.checkersRules.mandatoryCapture
                    ? game.checkersRules.maximumCapture
                      ? "Captures are mandatory, and the longest chain wins."
                      : "Captures are mandatory when available."
                    : "Captures are optional."}
                </li>
                <li>
                  A color is out when it has no pieces or no legal move.
                </li>
                {game.checkersRules.deferredCaptureRemoval ||
                game.checkersRules.deferredPromotion ? (
                  <li>
                    {game.checkersRules.deferredCaptureRemoval
                      ? "Captured pieces stay as blockers until the jump sequence ends. "
                      : ""}
                    {game.checkersRules.deferredPromotion
                      ? "A new king activates after that turn."
                      : ""}
                  </li>
                ) : null}
              </ul>
            </details>
          ) : (
            <details className="side-card rules-card">
              <summary>Crossboard Capture v1 rules</summary>
              <ul>
                <li>Capture a king to eliminate that color.</li>
                <li>In Teams, the first enemy king captured ends the match.</li>
                <li>No castling or en passant; pawns auto-promote to queens.</li>
                <li>Moves do not stop your own king entering danger.</li>
              </ul>
            </details>
          )}

          {game.phase === "finished" ? (
            <section className="result-card">
              <span>Game complete</span>
              <h2>{describeWinner(game)}</h2>
              <p>
                {game.history.length} {isCheckers ? "steps" : "moves"} across{" "}
                {game.round} rounds.
              </p>
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
