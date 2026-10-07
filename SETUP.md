# Harvest Haven setup guide

This guide gets the current game running locally, on the Galaxy Tab A9+, and publicly through Cloudflare and GitHub Actions.

## 1. What runs where

- **Galaxy Tab A9+:** authoritative game server, accounts, world saves, farming, multiplayer, and WebSocket connections.
- **Cloudflare Workers/Static Assets:** browser website at `game.alexswe.dpdns.org` and Worker health endpoint.
- **Cloudflare Tunnel:** secure public route from `play.alexswe.dpdns.org` to the tablet server.
- **GitHub Actions:** builds the website and deploys it to Cloudflare when `main` changes.

The tablet must be powered, online, and allowed to run in the background. The website can be globally hosted while the live world remains on the tablet.

## 2. Local test on a computer

Install Node.js 18.18 or newer and pnpm 10. Node 22 is recommended.

```sh
cd /path/to/harvest-haven
npx pnpm@10.12.1 install
npx pnpm@10.12.1 validate:config
npx pnpm@10.12.1 build
npx pnpm@10.12.1 dev
```

Open `http://localhost:5173`.

Create an account in the menu. The local server stores:

```text
server/save-data/accounts.json
server/save-data/world.json
```

The default room is `MEADOW`. To use a different room code during a development run:

```text
http://localhost:5173/?room=MEADOW
```

The `dev` command starts both Vite and the tablet-style server. Stop it with `Ctrl+C`.

## 3. Prepare the Galaxy Tab A9+

Install Termux from a trusted current source, then run:

```sh
pkg update && pkg upgrade
pkg install git nodejs-lts
npm install --global pnpm@10.12.1
termux-wake-lock
```

Clone and build the game:

```sh
cd ~
git clone https://github.com/YOUR_GITHUB_USER/YOUR_REPOSITORY.git harvest-haven
cd ~/harvest-haven
pnpm install --frozen-lockfile
pnpm validate:config
pnpm build
```

Start the authoritative server:

```sh
cd ~/harvest-haven
export ROOM_CODE=MEADOW
export WORLD_SAVE_PATH=$HOME/harvest-haven-data/world.json
export ACCOUNT_SAVE_PATH=$HOME/harvest-haven-data/accounts.json
mkdir -p "$HOME/harvest-haven-data"
nohup pnpm --filter @harvest-haven/server start > "$HOME/harvest-haven-data/server.log" 2>&1 &
echo $! > "$HOME/harvest-haven-data/server.pid"
```

Check it locally on the tablet:

```sh
curl http://127.0.0.1:8788/health
```

Stop it:

```sh
kill "$(cat "$HOME/harvest-haven-data/server.pid")"
```

View logs:

```sh
tail -f "$HOME/harvest-haven-data/server.log"
```

For reliable operation, configure Android battery settings to allow Termux unrestricted background activity. Consumer Android may still stop background processes; check the log after sleeping or rebooting the tablet.

## 4. Back up the world and accounts

Stop the server before copying saves:

```sh
kill "$(cat "$HOME/harvest-haven-data/server.pid")" 2>/dev/null || true
backup="$HOME/harvest-haven-backups/$(date +%Y-%m-%d)"
mkdir -p "$backup"
cp "$HOME/harvest-haven-data/world.json" "$backup/world.json"
cp "$HOME/harvest-haven-data/accounts.json" "$backup/accounts.json"
```

Never commit `accounts.json`, password data, tunnel credentials, or save files to GitHub.

## 5. Create the Cloudflare Tunnel

You need a domain whose DNS is managed by Cloudflare. Install `cloudflared` on the tablet using the current Termux package if available:

```sh
pkg install cloudflared
```

If your Termux repository does not provide it, install the current ARM64 `cloudflared` release from Cloudflare’s official release page and put the executable on your `PATH`.

Authenticate and create a tunnel:

```sh
cloudflared tunnel login
cloudflared tunnel create harvest-haven
cloudflared tunnel route dns harvest-haven play.alexswe.dpdns.org
```

Create the tunnel configuration. Replace the credential filename with the one printed by `tunnel create`:

```sh
mkdir -p "$HOME/.cloudflared"
cat > "$HOME/.cloudflared/config.yml" <<'EOF'
tunnel: YOUR_TUNNEL_ID
credentials-file: /data/data/com.termux/files/home/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: play.alexswe.dpdns.org
    service: http://127.0.0.1:8788
  - service: http_status:404
EOF
```

Start the tunnel:

```sh
cloudflared tunnel run harvest-haven
```

Leave this process running. It exposes both the HTTP account endpoints and the WebSocket endpoint through `play.alexswe.dpdns.org`. The website itself is hosted at `game.alexswe.dpdns.org`.

## 6. Connect the website to the tablet

The browser build needs two public URLs:

```text
VITE_GAME_SERVER_URL=wss://play.alexswe.dpdns.org/game
VITE_GAME_SERVER_HTTP_URL=https://play.alexswe.dpdns.org
```

For a local public-build test, run:

```sh
VITE_GAME_SERVER_URL=wss://play.alexswe.dpdns.org/game \
VITE_GAME_SERVER_HTTP_URL=https://play.alexswe.dpdns.org \
npx pnpm@10.12.1 --filter @harvest-haven/client build
```

## 7. Configure GitHub to deploy Cloudflare

Create a Cloudflare API token with the minimum permissions needed to deploy the Worker, and copy the Cloudflare account ID. In the GitHub repository settings, add these **Actions secrets**:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

Add these **Actions variables**:

```text
VITE_GAME_SERVER_URL = wss://play.alexswe.dpdns.org/game
VITE_GAME_SERVER_HTTP_URL = https://play.alexswe.dpdns.org
```

Push to `main`:

```sh
git add .
git commit -m "Deploy Harvest Haven"
git push origin main
```

GitHub Actions installs dependencies, validates the config, builds the packages, builds the client with the two public tablet URLs, and deploys the static site through Wrangler.

## 8. Friends joining

1. Start the tablet server.
2. Start the Cloudflare Tunnel.
3. Open the deployed website.
4. Each friend creates an account.
5. Everyone joins room `MEADOW`.
6. Share the website URL, not the tablet’s local IP.

The shared farm is persistent. Players can visit each other’s houses, but crops are owner-protected. Account and world data remain on the tablet.

## 9. Updating the game

```sh
cd ~/harvest-haven
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
kill "$(cat "$HOME/harvest-haven-data/server.pid")" 2>/dev/null || true
export ROOM_CODE=MEADOW
export WORLD_SAVE_PATH=$HOME/harvest-haven-data/world.json
export ACCOUNT_SAVE_PATH=$HOME/harvest-haven-data/accounts.json
nohup pnpm --filter @harvest-haven/server start > "$HOME/harvest-haven-data/server.log" 2>&1 &
echo $! > "$HOME/harvest-haven-data/server.pid"
```

The world and account files are outside the repository, so updates do not overwrite them.

## 10. Troubleshooting

- **Website says tablet unavailable:** check `curl http://127.0.0.1:8788/health` on the tablet, then check `cloudflared` logs.
- **Login fails publicly:** verify `VITE_GAME_SERVER_HTTP_URL` uses `https://` and the tunnel hostname resolves.
- **WebSocket fails publicly:** verify `VITE_GAME_SERVER_URL` uses `wss://` and ends in `/game`.
- **Friends cannot join:** confirm everyone uses the same room code and the tablet has internet access.
- **World disappeared:** stop the server and restore `world.json` from a backup before restarting.
- **Accounts disappeared:** restore `accounts.json` together with the matching world backup.
