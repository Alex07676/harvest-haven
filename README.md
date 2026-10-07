# Harvest Haven

Harvest Haven is a cooperative farming and survival game designed for a small persistent world hosted from an Android tablet.

## Current implementation

- `config/game.config.json` is the editable gameplay configuration.
- `server/` contains an authoritative WebSocket server with persistent world state, room codes, reconnect tokens, player movement, farming, combat, fishing, cooking, pets, NPC interaction, romance, trading, festivals, housing, and save files.
- `client/` contains a canvas farm view with keyboard and touch movement, farming controls, social actions, and world-entity rendering.
- `worker/` contains the Cloudflare Worker and Static Assets wiring.
- `infra/` contains tablet and tunnel setup notes.

The gameplay systems currently use deliberately simple first-release rules. Production Cloudflare Tunnel routing, automated tablet service management, final art/audio assets, and device acceptance testing still remain.

## Multiplayer design

- **One shared farm:** all players in a room live on and improve the same persistent valley. Progress continues even when one farmer is offline.
- **Private homes and yards:** each player can build one owned home plot on the shared map. Everyone can visit and enter, but only the owner can place or change their home and yard objects.
- **Protected crops:** planted crops carry an owner ID. By default, only the farmer who planted a crop can harvest it. The rule is controlled by `multiplayer.cropOwnership` in `config/game.config.json`.
- **Shared world, personal identity:** coins, inventory, health, stamina, pets, NPC friendship, and romance progress belong to each player. The world clock, crops, resources, homes, NPCs, and festivals belong to the room.
- **Relationships:** NPC relationships are personal to each farmer. Talking and romance actions increase that farmer's friendship; another player does not inherit it. Player relationships are represented through visiting and cooperative play, with private inventories preventing accidental theft.
- **Trading:** players can trade their own gathered items for coins. Shared storage is disabled by default so resource ownership stays clear.

## Local development

For the full tablet, Cloudflare Tunnel, GitHub Actions, backup, and friend-joining procedure, read [SETUP.md](SETUP.md).

Requirements: Node.js 18.18+ and pnpm 10. Node 22 is also supported and recommended for the tablet host.

```sh
pnpm install
pnpm validate:config
pnpm dev
```

The browser runs on Vite and connects to `ws://localhost:8788/game` by default. Open the Vite URL printed in the terminal, usually `http://localhost:5173`.

To build and run the server separately:

```sh
pnpm --filter @harvest-haven/shared build
pnpm --filter @harvest-haven/server build
pnpm --filter @harvest-haven/server start
```

To use a different server URL in the browser:

```sh
VITE_GAME_SERVER_URL=wss://game.alexswe.dpdns.org/game pnpm --filter @harvest-haven/client dev
```

The server exposes `GET /health` and `GET /api/world`. Its save file is created at `server/save-data/world.json`, or at the path supplied through `WORLD_SAVE_PATH`.

The default room code is `MEADOW`. A browser can use another room code with `?room=MEADOW`; the browser stores its reconnect token locally.

## Accounts

Accounts are owned by the tablet server because it owns the authoritative world. Passwords are stored as salted `scrypt` hashes, never as plaintext. Account data is saved separately from the world at `server/save-data/accounts.json`, or at the path supplied through `ACCOUNT_SAVE_PATH`.

The browser uses these server endpoints automatically:

- `POST /api/register`
- `POST /api/login`
- `WS /game?room=MEADOW&token=...`

For a public deployment, set the browser variables so the Cloudflare-hosted site points at the tablet tunnel:

```sh
VITE_GAME_SERVER_URL=wss://game.alexswe.dpdns.org/game \
VITE_GAME_SERVER_HTTP_URL=https://game.alexswe.dpdns.org \
npx pnpm@10.12.1 --filter @harvest-haven/client build
```

## Important boundary

The editable config controls game data and balancing. It does not contain secrets, Cloudflare credentials, tunnel tokens, or deployment bindings.