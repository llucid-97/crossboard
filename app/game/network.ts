"use client";

import type { DataConnection, Peer as PeerType } from "peerjs";
import {
  mergeStateChains,
  normalizeStateChain,
  StateChain,
} from "./replication";
import {
  GameState,
  PlayerColor,
  PLAYER_COLORS,
  PlayerId,
  isPlayerId,
} from "./types";

export type WireMessage =
  | {
      type: "state-request";
      sender: string;
      playerId: PlayerId;
    }
  | {
      type: "state-chain";
      sender: string;
      chain: StateChain;
    }
  | {
      type: "chain-summary";
      sender: string;
      digest: string;
      latestStateHash: string;
      entryCount: number;
    }
  | {
      type: "ping";
      sender: string;
      sentAt: number;
    }
  | {
      type: "pong";
      sender: string;
      sentAt: number;
    }
  | {
      type: "undo-request";
      sender: string;
      playerId: PlayerId;
      stateHash: string;
    };

export type SignalStatus = "connecting" | "online" | "degraded" | "offline";

export interface MeshCallbacks {
  onMessage: (message: WireMessage, remotePeerId: string) => void;
  onConnections: (colors: PlayerColor[]) => void;
  onSignalStatus: (status: SignalStatus) => void;
  onNotice: (message: string) => void;
}

const PEER_PREFIX = "crossboard-v5";
export const CONNECTION_STALE_AFTER_MS = 9_000;
export const PEER_OPEN_TIMEOUT_MS = 6_000;
export const PEER_START_RETRY_DELAYS_MS = [0, 500, 1_200, 2_500, 5_000] as const;
export const DISCOVERY_RETRY_DELAYS_MS = [0, 400, 1_000, 2_200] as const;

function cleanRoomCode(roomCode: string): string {
  return roomCode.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function seatPeerId(roomCode: string, color: PlayerColor): string {
  return `${PEER_PREFIX}-${cleanRoomCode(roomCode)}-${color}`;
}

export function colorFromPeerId(peerId: string): PlayerColor | null {
  const color = PLAYER_COLORS.find((candidate) =>
    peerId.endsWith(`-${candidate}`),
  );
  return color ?? null;
}

function isWireMessage(value: unknown): value is WireMessage {
  if (!value || typeof value !== "object" || !("type" in value)) {
    return false;
  }
  const type = (value as { type?: string }).type;
  if (type === "undo-request") {
    const request = value as {
      stateHash?: unknown;
      playerId?: unknown;
    };
    return (
      typeof request.stateHash === "string" &&
      isPlayerId(request.playerId)
    );
  }
  if (type === "state-request") {
    return isPlayerId((value as { playerId?: unknown }).playerId);
  }
  if (type === "chain-summary") {
    const summary = value as {
      digest?: unknown;
      latestStateHash?: unknown;
      entryCount?: unknown;
    };
    return (
      typeof summary.digest === "string" &&
      typeof summary.latestStateHash === "string" &&
      Number.isSafeInteger(summary.entryCount) &&
      Number(summary.entryCount) > 0
    );
  }
  if (type === "ping" || type === "pong") {
    return Number.isSafeInteger((value as { sentAt?: unknown }).sentAt);
  }
  return type === "state-chain";
}

export function connectionIsStale(
  lastSeenAt: number,
  now = Date.now(),
): boolean {
  return now - lastSeenAt > CONNECTION_STALE_AFTER_MS;
}

export class PeerMesh {
  private peer: PeerType | null = null;
  private readonly connections = new Map<string, DataConnection>();
  private readonly lastSeenAt = new Map<string, number>();
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(
    readonly roomCode: string,
    readonly localColor: PlayerColor,
    readonly playerId: PlayerId,
    private readonly callbacks: MeshCallbacks,
  ) {}

  get localPeerId(): string {
    return seatPeerId(this.roomCode, this.localColor);
  }

  async start(): Promise<void> {
    const { Peer } = await import("peerjs");
    this.closed = false;
    this.callbacks.onSignalStatus("connecting");

    let lastError: unknown = new Error("Room handshake unavailable");
    for (
      let attempt = 0;
      attempt < PEER_START_RETRY_DELAYS_MS.length;
      attempt += 1
    ) {
      const delay = PEER_START_RETRY_DELAYS_MS[attempt];
      if (delay) {
        await new Promise<void>((resolve) =>
          window.setTimeout(resolve, delay),
        );
      }
      if (this.closed) {
        throw new Error("Peer mesh closed");
      }
      try {
        await this.openPeer(
          new Peer(this.localPeerId, {
            debug: 0,
            pingInterval: 5_000,
          }),
        );
        return;
      } catch (error) {
        lastError = error;
        const failedPeer = this.peer;
        this.peer = null;
        failedPeer?.destroy();
        if (
          (error as { type?: string } | null)?.type === "unavailable-id"
        ) {
          throw error;
        }
        if (attempt < PEER_START_RETRY_DELAYS_MS.length - 1) {
          this.callbacks.onSignalStatus("degraded");
          this.callbacks.onNotice(
            "The room handshake is busy. Retrying automatically…",
          );
        }
      }
    }
    throw lastError;
  }

  private openPeer(peer: PeerType): Promise<void> {
    this.peer = peer;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(
            Object.assign(
              new Error("Room handshake timed out"),
              { type: "network" },
            ),
          );
        }
      }, PEER_OPEN_TIMEOUT_MS);

      peer.on("connection", (connection) => {
        if (this.peer === peer && !this.closed) {
          this.attach(connection);
        } else {
          connection.close();
        }
      });

      peer.on("open", () => {
        if (this.peer !== peer || this.closed) {
          return;
        }
        this.callbacks.onSignalStatus("online");
        this.ensureMaintenance();
        this.maintainConnectivity();
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          resolve();
        }
      });

      peer.on("disconnected", () => {
        if (this.peer !== peer || this.closed) {
          return;
        }
        this.callbacks.onSignalStatus("degraded");
        this.ensureMaintenance();
      });

      peer.on("error", (error) => {
        if (error.type === "peer-unavailable") {
          return;
        }
        if (this.peer !== peer || this.closed) {
          return;
        }
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          reject(error);
          return;
        }
        this.callbacks.onSignalStatus("degraded");
        this.callbacks.onNotice(
          error.type === "unavailable-id"
            ? "That seat was claimed by another player."
            : "The room handshake is reconnecting.",
        );
      });

      peer.on("close", () => {
        if (this.peer === peer && !this.closed) {
          this.callbacks.onSignalStatus("offline");
        }
      });
    });
  }

  private ensureMaintenance(): void {
    if (this.maintenanceTimer) {
      return;
    }
    this.maintenanceTimer = setInterval(
      () => this.maintainConnectivity(),
      1_500,
    );
  }

  private maintainConnectivity(): void {
    if (this.closed) {
      return;
    }
    const peer = this.peer;
    if (peer?.disconnected && !peer.destroyed) {
      try {
        peer.reconnect();
      } catch {
        this.callbacks.onSignalStatus("offline");
      }
    }
    if (peer?.open) {
      this.connectToEarlierSeats();
    }

    const now = Date.now();
    let connectionsChanged = false;
    for (const [peerId, connection] of this.connections) {
      const lastSeen = this.lastSeenAt.get(peerId) ?? now;
      if (!connection.open && !connectionIsStale(lastSeen, now)) {
        continue;
      }
      if (!connection.open || connectionIsStale(lastSeen, now)) {
        connection.close();
        if (this.connections.get(peerId) === connection) {
          this.connections.delete(peerId);
          this.lastSeenAt.delete(peerId);
          connectionsChanged = true;
        }
        continue;
      }
      this.sendConnection(connection, {
        type: "ping",
        sender: this.localPeerId,
        sentAt: now,
      });
    }
    if (connectionsChanged) {
      this.emitConnections();
    }
  }

  reconnectNow(): void {
    this.maintainConnectivity();
  }

  private connectToEarlierSeats(): void {
    if (!this.peer?.open) {
      return;
    }
    const localIndex = PLAYER_COLORS.indexOf(this.localColor);
    PLAYER_COLORS.slice(0, localIndex).forEach((color) => {
      const peerId = seatPeerId(this.roomCode, color);
      const existing = this.connections.get(peerId);
      if (existing?.open) {
        return;
      }
      const connection = this.peer?.connect(peerId, {
        label: "crossboard-state",
        metadata: {
          room: cleanRoomCode(this.roomCode),
          color: this.localColor,
          playerId: this.playerId,
          role: "player",
        },
        serialization: "json",
      });
      if (connection) {
        this.attach(connection);
      }
    });
  }

  private attach(connection: DataConnection): void {
    const current = this.connections.get(connection.peer);
    if (current && current !== connection) {
      connection.close();
      return;
    }
    this.connections.set(connection.peer, connection);
    this.lastSeenAt.set(connection.peer, Date.now());

    const register = () => {
      const duplicate = this.connections.get(connection.peer);
      if (duplicate !== connection) {
        connection.close();
        return;
      }
      this.lastSeenAt.set(connection.peer, Date.now());
      this.emitConnections();
      this.sendTo(connection.peer, {
        type: "state-request",
        sender: this.localPeerId,
        playerId: this.playerId,
      });
    };

    if (connection.open) {
      register();
    } else {
      connection.on("open", register);
    }

    connection.on("data", (data) => {
      if (isWireMessage(data)) {
        this.lastSeenAt.set(connection.peer, Date.now());
        if (data.type === "ping") {
          this.sendTo(connection.peer, {
            type: "pong",
            sender: this.localPeerId,
            sentAt: data.sentAt,
          });
          return;
        }
        if (data.type === "pong") {
          return;
        }
        this.callbacks.onMessage(data, connection.peer);
      }
    });

    connection.on("close", () => {
      if (this.connections.get(connection.peer) === connection) {
        this.connections.delete(connection.peer);
        this.lastSeenAt.delete(connection.peer);
        this.emitConnections();
      }
    });

    connection.on("error", () => {
      connection.close();
      if (this.connections.get(connection.peer) === connection) {
        this.connections.delete(connection.peer);
        this.lastSeenAt.delete(connection.peer);
        this.emitConnections();
      }
    });
  }

  private emitConnections(): void {
    const colors = [...this.connections.entries()]
      .filter(([, connection]) => connection.open)
      .map(([peerId]) => colorFromPeerId(peerId))
      .filter((color): color is PlayerColor => color !== null);
    this.callbacks.onConnections([...new Set(colors)]);
  }

  sendTo(remotePeerId: string, message: WireMessage): void {
    const connection = this.connections.get(remotePeerId);
    if (connection?.open) {
      this.sendConnection(connection, message);
    }
  }

  broadcast(message: WireMessage): void {
    for (const connection of this.connections.values()) {
      if (connection.open) {
        this.sendConnection(connection, message);
      }
    }
  }

  private sendConnection(
    connection: DataConnection,
    message: WireMessage,
  ): void {
    try {
      void connection.send(message);
    } catch {
      connection.close();
      if (this.connections.get(connection.peer) === connection) {
        this.connections.delete(connection.peer);
        this.lastSeenAt.delete(connection.peer);
        this.emitConnections();
      }
    }
  }

  close(): void {
    this.closed = true;
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }
    for (const connection of this.connections.values()) {
      connection.close();
    }
    this.connections.clear();
    this.lastSeenAt.clear();
    this.peer?.destroy();
    this.peer = null;
  }
}

class RetryableHandshakeError extends Error {}

async function discoverRoomOnce(
  roomCode: string,
  playerId: PlayerId,
  timeoutMs: number,
): Promise<StateChain> {
  const { Peer } = await import("peerjs");
  return new Promise<StateChain>((resolve, reject) => {
    const peer = new Peer({ debug: 0 });
    const connections: DataConnection[] = [];
    let finished = false;
    let mergedChain: StateChain | null = null;
    let settleTimer: number | null = null;

    const finish = (chain?: StateChain, error?: Error) => {
      if (finished) {
        return;
      }
      finished = true;
      window.clearTimeout(timeout);
      if (settleTimer) {
        window.clearTimeout(settleTimer);
      }
      connections.forEach((connection) => connection.close());
      peer.destroy();
      if (chain) {
        resolve(chain);
      } else {
        reject(error ?? new Error("Room not found"));
      }
    };

    const timeout = window.setTimeout(
      () => finish(undefined, new Error("Room not found")),
      timeoutMs,
    );

    peer.on("open", (observerId) => {
      PLAYER_COLORS.forEach((color) => {
        const connection = peer.connect(seatPeerId(roomCode, color), {
          label: "crossboard-discovery",
          metadata: {
            room: cleanRoomCode(roomCode),
            role: "observer",
          },
          serialization: "json",
        });
        connections.push(connection);
        connection.on("open", () => {
          void connection.send({
            type: "state-request",
            sender: observerId,
            playerId,
          } satisfies WireMessage);
        });
        connection.on("data", (data) => {
          if (
            isWireMessage(data) &&
            data.type === "state-chain"
          ) {
            const normalized = normalizeStateChain(data.chain);
            if (
              !normalized ||
              normalized.roomCode.toUpperCase() !== roomCode.toUpperCase()
            ) {
              return;
            }
            mergedChain = mergedChain
              ? mergeStateChains(mergedChain, normalized)
              : normalized;
            if (settleTimer) {
              window.clearTimeout(settleTimer);
            }
            // Give every live seat a short window to answer. This avoids
            // choosing whichever peer happened to respond first.
            settleTimer = window.setTimeout(
              () => finish(mergedChain ?? undefined),
              650,
            );
          }
        });
      });
    });

    peer.on("error", (error) => {
      if (error.type !== "peer-unavailable") {
        finish(
          undefined,
          new RetryableHandshakeError(
            "Could not reach the room handshake.",
          ),
        );
      }
    });
  });
}

export async function discoverRoom(
  roomCode: string,
  playerId: PlayerId,
  timeoutMs = 7_000,
): Promise<StateChain> {
  let lastError: unknown = new Error("Room not found");
  for (
    let attempt = 0;
    attempt < DISCOVERY_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    const delay = DISCOVERY_RETRY_DELAYS_MS[attempt];
    if (delay) {
      await new Promise<void>((resolve) =>
        window.setTimeout(resolve, delay),
      );
    }
    try {
      return await discoverRoomOnce(roomCode, playerId, timeoutMs);
    } catch (error) {
      lastError = error;
      if (!(error instanceof RetryableHandshakeError)) {
        throw error;
      }
    }
  }
  throw lastError;
}

export function electCoordinator(
  state: GameState,
  localColor: PlayerColor,
  connectedColors: PlayerColor[],
): PlayerColor {
  const present = new Set<PlayerColor>([localColor, ...connectedColors]);
  const elected = PLAYER_COLORS.find(
    (color) =>
      present.has(color) &&
      state.seats[color].controller === "human" &&
      !state.eliminated.includes(color),
  );
  return elected ?? localColor;
}

export function playerSeatFor(
  state: GameState,
  playerId: PlayerId,
): PlayerColor | null {
  return (
    PLAYER_COLORS.find(
      (color) =>
        state.seats[color].controller === "human" &&
        state.seats[color].playerId === playerId,
    ) ?? null
  );
}

export function coordinatorOwnsState(
  state: GameState,
  expectedStateHash: string,
  localColor: PlayerColor,
  connectedColors: PlayerColor[],
): boolean {
  return (
    state.stateHash === expectedStateHash &&
    electCoordinator(state, localColor, connectedColors) === localColor
  );
}

export function undoRequesterFor(
  state: GameState,
  localColor: PlayerColor,
  connectedColors: PlayerColor[],
  remotePeerId: string,
  requesterPlayerId: PlayerId,
  baseStateHash: string,
): PlayerColor | null {
  const requester = colorFromPeerId(remotePeerId);
  if (
    state.phase === "lobby" ||
    state.stateHash !== baseStateHash ||
    !requester ||
    seatPeerId(state.roomCode, requester) !== remotePeerId ||
    state.seats[requester].controller !== "human" ||
    state.seats[requester].playerId !== requesterPlayerId ||
    electCoordinator(state, localColor, connectedColors) !== localColor
  ) {
    return null;
  }
  return requester;
}

export function shouldAdoptSnapshot(
  current: GameState,
  incoming: GameState,
): boolean {
  if (incoming.stateHash === current.stateHash) {
    return false;
  }

  const currentChain = [
    ...current.lineage,
    {
      revision: current.revision,
      stateHash: current.stateHash,
      lastActionId: current.lastActionId,
    },
  ];
  const incomingChain = [
    ...incoming.lineage,
    {
      revision: incoming.revision,
      stateHash: incoming.stateHash,
      lastActionId: incoming.lastActionId,
    },
  ];

  if (incomingChain.some((entry) => entry.stateHash === current.stateHash)) {
    return true;
  }
  if (currentChain.some((entry) => entry.stateHash === incoming.stateHash)) {
    return false;
  }

  const currentIndex = new Map(
    currentChain.map((entry, index) => [entry.stateHash, index]),
  );
  let sharedIncomingIndex = -1;
  let sharedCurrentIndex = -1;
  for (let index = incomingChain.length - 1; index >= 0; index -= 1) {
    const match = currentIndex.get(incomingChain[index].stateHash);
    if (match !== undefined) {
      sharedIncomingIndex = index;
      sharedCurrentIndex = match;
      break;
    }
  }

  if (sharedIncomingIndex >= 0 && sharedCurrentIndex >= 0) {
    const incomingChild = incomingChain[sharedIncomingIndex + 1];
    const currentChild = currentChain[sharedCurrentIndex + 1];
    if (!incomingChild) {
      return false;
    }
    if (!currentChild) {
      return true;
    }
    const incomingIsUndo = incomingChild.lastActionId?.startsWith("undo-");
    const currentIsUndo = currentChild.lastActionId?.startsWith("undo-");
    if (incomingIsUndo !== currentIsUndo) {
      return !!incomingIsUndo;
    }
    return incomingChild.stateHash.localeCompare(currentChild.stateHash) < 0;
  }

  // Two copies with no retained common ancestor fail closed to a stable
  // tie-breaker instead of trusting arrival order or a claimed revision.
  return incoming.stateHash.localeCompare(current.stateHash) < 0;
}
