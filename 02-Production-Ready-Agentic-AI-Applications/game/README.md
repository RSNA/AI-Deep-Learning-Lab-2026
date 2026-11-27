# Lab 02 game

The code of the RSNA 2026 Deep Learning Lab 02 game: a multiplayer browser game in which each
attendee directs AI at one practice. The design and the rules are in
[`docs/ENGINEERING_SPEC.md`](docs/ENGINEERING_SPEC.md). Build sessions follow [`CLAUDE.md`](CLAUDE.md).

The game content is private. This repository runs on a small demo pack in `content-demo/`, set in
two public library networks.

## Run the demo on a laptop

Node 22 is required.

```sh
npm install
npm run dev
```

- Players: http://localhost:5173 (the dev server proxies to the game server on port 3100)
- Facilitator console: http://localhost:5173/host, passcode `demo` in development
- Create a session in the facilitator console, then open the big screen from it.

`npm run build` and `npm start` run the built server, which serves the client itself. The same build
can serve a room from a laptop on a local network (`HOST=0.0.0.0 PUBLIC_URL=http://<laptop-ip>:3000`).

## Commands

| Command | Does |
| --- | --- |
| `npm run check` | Type check, lint, unit and integration tests. Must pass before every merge |
| `npm run e2e` | Browser tests on the demo pack at laptop and phone size, in the Chrome installed on the Mac |
| `npm run check:content` | Loads the pack in `CONTENT_DIR` and lists every error and warning |
| `npm run check:no-private` | Searches this folder for text of the private pack in `CONTENT_DIR` |
| `npm run test:leak` | The leak scan on the pack in `CONTENT_DIR` |
| `npm run art` | Rebuilds the pixel art from the CC0 tile sheet |

## Packages

| Package | Holds |
| --- | --- |
| `packages/content-schema` | Schemas of the pack files, the loader and its three layers of validation |
| `packages/protocol` | Everything a browser may receive, with strict schemas, and the `GameConnection` client |
| `packages/engine` | Pure, deterministic game logic, and the projection from pack to public views |
| `packages/server` | HTTP, sockets, the clock, SQLite persistence and recovery |
| `packages/client` | React views for players, hosts and the big screen, and the PixiJS reading room |

## Deploy

`scripts/provision.sh <domain>` sets up the event server once. `scripts/deploy.sh` checks, builds and
ships a release over the SSH alias `lab02-event` (options in the script header). No address, passcode
or token is in this repository.

Art and font licenses are listed in [`packages/client/ART.md`](packages/client/ART.md).
