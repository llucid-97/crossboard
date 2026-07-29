"use client";

import type { DataConnection, Peer as PeerType } from "peerjs";
import { GameState, PlayerColor, PLAYER_COLORS } from "./types";

export type WireMessage =
  | {
      type: "state-request";
      sender: string;
    }
  | {
      type: "snapshot";
      sender: string;
      state: GameState;
    }
  | {
      type: "ping";
      sender: string;
      revision: number;
    };

export type SignalStatus = "connecting" | "online" | "degraded" | "offline";

export interface MeshCallbacks {
  onMessage: (message: WireMessage, remotePeerId: string) => void;
  onConnections: (colors: PlayerColor[]) => void;
  onSignalStatus: (status: SignalStatus) => void;
  onNotice: (message: string) => void;
}

const PEER_PREFIX = "crossboard-v1";

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
  return type === "state-request" || type === "snapshot" || type === "ping";
}

export class PeerMesh {
  private peer: PeerType | null = null;
  private readonly connections = new Map<string, DataConnection>();
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly roomCode: string,
    readonly localColor: PlayerColor,
    private readonly callbacks: MeshCallbacks,
  ) {}

  get localPeerId(): string {
    return seatPeerId(this.roomCode, this.localColor);
  }

  async start(): Promise<void> {
    const { Peer } = await import("peerjs");
    this.callbacks.onSignalStatus("connecting");

    await new Promise<void>((resolve, reject) => {
      const peer = new Peer(this.localPeerId, {
        debug: 0,
        pingInterval: 5_000,
      });
      this.peer = peer;
      let settled = false;

      peer.on("open", () => {
        settled = true;
        this.callbacks.onSignalStatus("online");
        peer.on("connection", (connection) => this.attach(connection));
        this.connectToEarlierSeats();
        this.reconnectTimer = setInterval(() => this.connectToEarlierSeats(), 4_000);
        resolve();
      });

      peer.on("disconnected", () => {
        this.callbacks.onSignalStatus("degraded");
        if (!peer.destroyed) {
          window.setTimeout(() => {
            try {
              if (peer.disconnected) {
                peer.reconnect();
              }
            } catch {
              this.callbacks.onSignalStatus("offline");
            }
          }, 1_000);
        }
      });

      peer.on("error", (error) => {
        if (error.type === "peer-unavailable") {
          return;
        }
        if (!settled) {
          settled = true;
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
        this.callbacks.onSignalStatus("offline");
      });
    });
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
    if (current && current !== connection && current.open) {
      connection.close();
      return;
    }

    const register = () => {
      const duplicate = this.connections.get(connection.peer);
      if (duplicate && duplicate !== connection && duplicate.open) {
        connection.close();
        return;
      }
      this.connections.set(connection.peer, connection);
      this.emitConnections();
      this.sendTo(connection.peer, {
        type: "state-request",
        sender: this.localPeerId,
      });
    };

    if (connection.open) {
      register();
    } else {
      connection.on("open", register);
    }

    connection.on("data", (data) => {
      if (isWireMessage(data)) {
        this.callbacks.onMessage(data, connection.peer);
      }
    });

    connection.on("close", () => {
      if (this.connections.get(connection.peer) === connection) {
        this.connections.delete(connection.peer);
        this.emitConnections();
      }
    });

    connection.on("error", () => {
      if (this.connections.get(connection.peer) === connection) {
        this.connections.delete(connection.peer);
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
      void connection.send(message);
    }
  }

  broadcast(message: WireMessage): void {
    for (const connection of this.connections.values()) {
      if (connection.open) {
        void connection.send(message);
      }
    }
  }

  close(): void {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const connection of this.connections.values()) {
      connection.close();
    }
    this.connections.clear();
    this.peer?.destroy();
    this.peer = null;
  }
}

export async function discoverRoom(
  roomCode: string,
  timeoutMs = 7_000,
): Promise<GameState> {
  const { Peer } = await import("peerjs");
  return new Promise<GameState>((resolve, reject) => {
    const peer = new Peer({ debug: 0 });
    const connections: DataConnection[] = [];
    let finished = false;

    const finish = (state?: GameState, error?: Error) => {
      if (finished) {
        return;
      }
      finished = true;
      window.clearTimeout(timeout);
      connections.forEach((connection) => connection.close());
      peer.destroy();
      if (state) {
        resolve(state);
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
          } satisfies WireMessage);
        });
        connection.on("data", (data) => {
          if (
            isWireMessage(data) &&
            data.type === "snapshot" &&
            data.state.roomCode.toUpperCase() === roomCode.toUpperCase()
          ) {
            finish(data.state);
          }
        });
      });
    });

    peer.on("error", (error) => {
      if (error.type !== "peer-unavailable") {
        finish(undefined, new Error("Could not reach the room handshake."));
      }
    });
  });
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

export function shouldAdoptSnapshot(
  current: GameState,
  incoming: GameState,
): boolean {
  if (incoming.stateHash === current.stateHash) {
    return false;
  }

  const currentChain = [
    ...current.lineage,
    { revision: current.revision, stateHash: current.stateHash },
  ];
  const incomingChain = [
    ...incoming.lineage,
    { revision: incoming.revision, stateHash: incoming.stateHash },
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
    return incomingChild.stateHash.localeCompare(currentChild.stateHash) < 0;
  }

  // Two copies with no retained common ancestor fail closed to a stable
  // tie-breaker instead of trusting arrival order or a claimed revision.
  return incoming.stateHash.localeCompare(current.stateHash) < 0;
}
