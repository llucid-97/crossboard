"use client";

import {
  isPlayerId,
  PLAYER_ID_ALPHABET,
  PlayerId,
} from "./types";

const SESSION_IDENTITY_KEY = "crossboard:active-player:v1";
const IDENTITY_REGISTRY_KEY = "crossboard:player-identities:v1";
const MAX_KNOWN_IDENTITIES = 12;

export interface PlayerIdentity {
  id: PlayerId;
  createdAt: number;
  lastUsedAt: number;
}

export function formatPlayerId(bytes: Uint8Array): PlayerId {
  const characters = Array.from(
    bytes.slice(0, 16),
    (byte) => PLAYER_ID_ALPHABET[byte % PLAYER_ID_ALPHABET.length],
  ).join("");
  const padded = characters.padEnd(16, PLAYER_ID_ALPHABET[0]);
  return `CB-${padded.slice(0, 4)}-${padded.slice(4, 8)}-${padded.slice(
    8,
    12,
  )}-${padded.slice(12, 16)}`;
}

export function generatePlayerId(): PlayerId {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return formatPlayerId(bytes);
}

function readIdentityRegistry(): PlayerIdentity[] {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(IDENTITY_REGISTRY_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (identity): identity is PlayerIdentity =>
        !!identity &&
        typeof identity === "object" &&
        isPlayerId(identity.id) &&
        Number.isSafeInteger(identity.createdAt) &&
        Number.isSafeInteger(identity.lastUsedAt),
    );
  } catch {
    return [];
  }
}

function rememberIdentity(identity: PlayerIdentity): void {
  try {
    const registry = readIdentityRegistry().filter(
      (known) => known.id !== identity.id,
    );
    registry.push(identity);
    registry.sort((first, second) => second.lastUsedAt - first.lastUsedAt);
    localStorage.setItem(
      IDENTITY_REGISTRY_KEY,
      JSON.stringify(registry.slice(0, MAX_KNOWN_IDENTITIES)),
    );
  } catch {
    // Session storage still preserves refresh recovery when local storage fails.
  }
}

export function activatePlayerIdentity(playerId: PlayerId): PlayerIdentity {
  const now = Date.now();
  const known = readIdentityRegistry().find(
    (identity) => identity.id === playerId,
  );
  const identity: PlayerIdentity = {
    id: playerId,
    createdAt: known?.createdAt ?? now,
    lastUsedAt: now,
  };
  try {
    sessionStorage.setItem(SESSION_IDENTITY_KEY, identity.id);
  } catch {
    // The in-memory identity remains usable for this page.
  }
  rememberIdentity(identity);
  return identity;
}

export function getOrCreatePlayerIdentity(): PlayerIdentity {
  try {
    const activeId = sessionStorage.getItem(SESSION_IDENTITY_KEY);
    if (isPlayerId(activeId)) {
      return activatePlayerIdentity(activeId);
    }
  } catch {
    // Generate an in-memory identity below.
  }
  return activatePlayerIdentity(generatePlayerId());
}

export function createFreshPlayerIdentity(): PlayerIdentity {
  return activatePlayerIdentity(generatePlayerId());
}
