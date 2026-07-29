# Crossboard

Crossboard is a casual four-player chess game for the browser. It supports
free-for-all games, opposite-seat teams, open invite seats, and computer
opponents. Human players exchange moves directly over WebRTC; no player's
machine needs to remain a permanent host.

## What is included

- A responsive 14×14 cross board with four 16-piece armies.
- **Free-for-all:** capture a king to eliminate that color; last king wins.
- **Teams:** Red + Yellow versus Blue + Green; the first enemy king captured
  ends the match.
- A deterministic, beam-limited four-ply minimax bot tuned for casual play.
- PeerJS room discovery and a full browser-to-browser state mesh.
- Hash-chained snapshots, deterministic fork resolution, local recovery copies,
  and automatic coordinator election.
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

## How rooms stay online

The deployed site serves the app, while PeerJS Cloud performs the initial
WebRTC handshake. Moves and snapshots then travel directly among the connected
browsers. Every human has the current position, and the lowest connected human
seat coordinates lobby controls and computer turns. If that browser leaves, the
next human seat takes over.

The app also saves a recovery copy in each player's browser. If every human
closes the room, another device cannot resurrect it without a small persistence
service; that is a deliberate limitation of the serverless first version.
PeerJS's default STUN setup can also fail on some restrictive or symmetric-NAT
networks. A managed TURN relay is the next production networking upgrade.

Room codes contain 60 bits of randomness. Treat possession of the room code as
room access in this casual version.

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
GitHub Pages. The game logic, casual minimax computer players, and recovery
snapshots all run in each browser. PeerJS supplies multiplayer discovery and
WebRTC signalling; the game itself needs no application server or database.
