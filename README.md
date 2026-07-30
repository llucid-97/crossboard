# Crossboard

Crossboard is a casual four-player chess and checkers collection for the
browser. It supports free-for-all games, configurable Warm/Cool teams, open
invite seats, and computer opponents. Human players exchange moves directly over
WebRTC; no player's machine needs to remain a permanent host.

## What is included

- A game menu for four-player Chess and four-player Checkers.
- A responsive 14×14 cross board with four chess armies or four sets of twelve
  checkers.
- **Free-for-all:** survive as the last active color.
- **Teams:** Red + Yellow versus Blue + Green by default, with every seat
  assignable to either side. Checkers teammates block one another and cannot
  capture each other.
- American, International, and House checkers presets, plus switches for flying
  kings, backward captures, mandatory captures, longest capture, and continuing
  after crowning.
- A deterministic, beam-limited four-ply minimax bot tuned for casual play.
- One-click Teams practice with a computer teammate, or free-for-all practice
  against three computer rivals.
- PeerJS room discovery and a full browser-to-browser state mesh.
- Timestamped recovery chains on every player's device, deterministic chain
  merging, persistent seat-recovery codes, and automatic coordinator election.
- Shared undo that rewinds the latest human decision and any computer replies.
- Touch/click movement, keyboard-friendly squares, legal-move hints, move
  history, reconnect notices, and mobile legal-move controls.

## Crossboard Capture v1

Crossboard deliberately uses a quick king-capture variant:

- Standard rook, bishop, queen, knight, king, and pawn movement.
- Pawns can move two squares from their starting line and automatically promote
  to queens on their rank-eleven line.
- No castling or en passant.
- The game does not prohibit a move that leaves a king in danger. Capture is the
  deciding action.

These rules make four-player games easier to follow and keep the computer search
small enough to run entirely in the browser.

## Crossboard Checkers v1

Each color begins with twelve men on the dark squares of its three-row home arm.
Men move toward the opposite arm, captures can chain with the same piece, and a
man crowns on the far edge. A color is eliminated when it has no pieces or no
legal move.

The room coordinator can choose a familiar preset or mix individual variation
rules. In Teams, every same-side piece counts as a friendly blocker, so a
capture can never jump or remove a teammate.

The International preset defers captured-piece removal until a complete jump
sequence ends and only activates a new king after that turn, matching the FMJD
multiple-capture rules. Those timing mechanics remain attached when another
International option is customized. House rules can still crown and continue
immediately.

## How rooms stay online

The deployed site serves the app, while PeerJS Cloud performs the initial
WebRTC handshake. Timestamped checkpoints then travel directly among the
connected browsers. Every human stores a bounded recovery chain, and the lowest
connected human seat coordinates lobby controls and computer turns. If that
browser leaves, the next human seat takes over. Online undo requests also pass
through that coordinator, which publishes the rewound position as another
checkpoint.

When a player reconnects, the browser asks every reachable seat for its chain,
merges all distinct checkpoints, and resumes the position with the latest
logical timestamp. A readable player code stays in that tab's persistent
session storage and is also recorded in the local identity registry. Refreshing
the tab therefore reclaims the same human seat instead of joining as a new
player. A new tab receives a separate code so two people can still test or play
from one browser.

The current room/save protocol is schema v4 over the v5 peer mesh. Verified
schema-v1, schema-v2, and schema-v3 recovery states migrate locally before
joining it.

Peers exchange compact chain summaries every 1.5 seconds, heartbeat live data
channels, retire links that remain silent for ninety seconds, and keep retrying
signalling with backoff. The longer stale-link window tolerates browser timer
throttling in background tabs without repeatedly replacing a healthy channel.
Network, focus, and tab-visibility events also trigger an immediate reconnect
attempt. A temporary signalling outage therefore pauses reconnection without
discarding either player's local chain.

If every human closes the room, a player can reopen the locally saved chain on
the same browser, but a completely different device cannot resurrect it without
a small persistence service; that remains a deliberate limitation of the
serverless version.
PeerJS's default STUN setup can also fail on some restrictive or symmetric-NAT
networks. A managed TURN relay is the next production networking upgrade.

Room codes contain 60 bits of randomness. Treat possession of a player recovery
code as control of that player's seat; these codes are convenient bearer
identifiers, not account authentication.

## Development

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
npm test
```

Useful commands:

- `npm run build` creates the production worker and client assets.
- `npm run build:pages` creates the static GitHub Pages bundle in `out/`.
- `npm run lint` checks the application source.
- `npm run test:game` runs the rules, AI determinism, hashing, and coordinator
  election tests.

## Hosting

Crossboard is published at
[llucid-97.github.io/crossboard](https://llucid-97.github.io/crossboard/).
Every push to `main` creates a static Next.js export and deploys it through
GitHub Pages. Both rules engines, casual minimax computer players, and
timestamped recovery chains run in each browser. PeerJS supplies multiplayer
discovery and WebRTC signalling; the games need no application server or
database.
