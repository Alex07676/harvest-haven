import "./style.css";
import type { ActionType, ClientCommand, ServerMessage, WorldSnapshot } from "@harvest-haven/shared/protocol.js";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root is missing");

app.innerHTML = `
  <section class="auth-panel" id="auth">
    <div class="brand-lockup"><span class="flag" aria-label="Swedish flag"></span><div><p class="eyebrow">A small world to call home</p><h1>Harvest Haven</h1></div></div>
    <p id="auth-message">Log in to join your shared farm.</p>
    <form id="auth-form"><label>Username<input id="username" name="username" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_]+" autocomplete="username" /></label><label>Password<input id="password" name="password" required minlength="8" type="password" autocomplete="current-password" /></label><div class="form-actions"><button class="primary" type="submit">Log in</button><button class="secondary" type="button" id="register">Create account</button></div></form>
  </section>
  <section class="menu-screen" id="menu" hidden>
    <div class="menu-card">
      <div class="brand-lockup"><span class="flag" aria-label="Swedish flag"></span><div><p class="eyebrow">Persistent co-op survival</p><h1>Harvest Haven</h1></div></div>
      <p class="menu-tagline">Grow something good together.</p>
      <div class="menu-actions"><button class="primary menu-button" id="play">Enter the valley</button><button class="secondary menu-button" id="help">How the valley works</button><button class="secondary menu-button" id="credits">Credits</button><button class="quiet menu-button" id="signout">Sign out</button></div>
      <div class="menu-detail" id="menu-detail" hidden></div>
      <footer><span>Made by Alex Ferneborg, with the use of AI.</span><span>Contact me with this email: contact@alexswe.dpdns.org</span></footer>
    </div>
  </section>
  <main class="game-shell" id="game" hidden>
    <header class="topbar"><div class="brand-small"><span class="flag" aria-hidden="true"></span><div><p class="eyebrow">Harvest Haven</p><h1>The shared valley</h1></div></div><div class="world-meta"><strong id="season">Spring, day 1</strong><span id="room">Room MEADOW</span><span id="connection">Connecting...</span></div><button class="icon-button" id="back-menu" title="Open menu">Menu</button></header>
    <section class="play-area"><div class="canvas-frame"><canvas id="world" width="768" height="512" aria-label="Shared farm world"></canvas><div class="canvas-caption" id="hud">Choose a place to begin.</div></div><aside class="panel"><div class="panel-heading"><span class="panel-kicker">Your day</span><strong id="message">Explore the valley.</strong></div><div class="stats" id="stats"></div><div class="action-group"><span class="group-label">Farm</span><div class="actions"><button data-action="till">Till</button><button data-action="plant" data-crop="turnip">Plant</button><button data-action="water">Water</button><button data-action="harvest">Harvest</button></div></div><div class="action-group"><span class="group-label">Life</span><div class="actions"><button data-action="fish">Fish</button><button data-action="cook">Cook</button><button data-action="attack">Attack</button><button data-action="talk">Talk</button><button data-action="romance">Romance</button><button data-action="trade">Trade</button><button data-action="adoptPet">Adopt pet</button><button data-action="placeHouse">Build home</button><button data-action="festival">Festival</button></div></div><div class="touch-pad" aria-label="Touch movement"><button data-move="0,-1">Up</button><div><button data-move="-1,0">Left</button><button data-move="1,0">Right</button></div><button data-move="0,1">Down</button></div><p class="hint">Move with WASD or the touch pad. Your crops are yours; visit other homes, but respect their plots.</p></aside></section>
  </main>
`;

const authPanel = requireElement<HTMLElement>("auth");
const menuPanel = requireElement<HTMLElement>("menu");
const gamePanel = requireElement<HTMLElement>("game");
const authForm = requireElement<HTMLFormElement>("auth-form");
const registerButton = requireElement<HTMLButtonElement>("register");
const authMessage = requireElement<HTMLElement>("auth-message");
const detail = requireElement<HTMLElement>("menu-detail");
const canvas = requireElement<HTMLCanvasElement>("world");
const context = canvas.getContext("2d");
if (!context) throw new Error("Canvas rendering is unavailable");
const renderContext: CanvasRenderingContext2D = context;
const connection = requireElement<HTMLSpanElement>("connection");
const seasonLabel = requireElement<HTMLElement>("season");
const roomLabel = requireElement<HTMLElement>("room");
const message = requireElement<HTMLElement>("message");
const stats = requireElement<HTMLElement>("stats");
const hud = requireElement<HTMLElement>("hud");

const baseServerUrl = import.meta.env.VITE_GAME_SERVER_URL ?? "ws://localhost:8788/game";
const apiBaseUrl = import.meta.env.VITE_GAME_SERVER_HTTP_URL ?? "http://localhost:8788";
const token = localStorage.getItem("harvest-haven-token");
let socket: WebSocket | undefined;
let snapshot: WorldSnapshot | undefined;
let playerId = "";

if (token) { authPanel.hidden = true; menuPanel.hidden = false; connect(token); }

document.querySelector<HTMLButtonElement>("#play")?.addEventListener("click", () => { menuPanel.hidden = true; gamePanel.hidden = false; render(); });
document.querySelector<HTMLButtonElement>("#back-menu")?.addEventListener("click", () => { gamePanel.hidden = true; menuPanel.hidden = false; });
document.querySelector<HTMLButtonElement>("#help")?.addEventListener("click", () => {
  detail.hidden = false;
  detail.innerHTML = `<strong>One shared valley</strong><p>Everyone lives on the same persistent farm. Each farmer gets a private home and yard, but friends can visit. Crops are protected by their owner. NPC friendships are personal, and player relationships grow through shared play and visits.</p>`;
});
document.querySelector<HTMLButtonElement>("#credits")?.addEventListener("click", () => {
  detail.hidden = false;
  detail.innerHTML = `<strong>Made by Alex Ferneborg, with the use of AI.</strong><p>Contact me with this email: contact@alexswe.dpdns.org</p>`;
});
document.querySelector<HTMLButtonElement>("#signout")?.addEventListener("click", () => { localStorage.removeItem("harvest-haven-token"); window.location.reload(); });

let registerMode = false;
registerButton.addEventListener("click", () => { registerMode = !registerMode; registerButton.textContent = registerMode ? "Use login" : "Create account"; authForm.querySelector<HTMLButtonElement>("button[type=submit]")!.textContent = registerMode ? "Create account" : "Log in"; });
authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(authForm);
  try {
    const response = await fetch(`${apiBaseUrl}${registerMode ? "/api/register" : "/api/login"}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: form.get("username"), password: form.get("password") }) });
    const body = await response.json() as { token?: string; error?: string };
    if (!response.ok || !body.token) { authMessage.textContent = body.error ?? "Account request failed."; return; }
    localStorage.setItem("harvest-haven-token", body.token);
    window.location.reload();
  } catch { authMessage.textContent = "The tablet server is not reachable."; }
});

function connect(authToken: string): void {
  const url = new URL(baseServerUrl);
  url.searchParams.set("room", new URLSearchParams(window.location.search).get("room") ?? "MEADOW");
  url.searchParams.set("token", authToken);
  socket = new WebSocket(url);
  socket.addEventListener("open", () => { connection.textContent = "Connected"; });
  socket.addEventListener("close", () => { connection.textContent = "Disconnected"; message.textContent = "The valley connection closed."; });
  socket.addEventListener("error", () => { connection.textContent = "Unavailable"; message.textContent = "Start the tablet server or check the tunnel URL."; });
  socket.addEventListener("message", (event) => {
    const incoming = JSON.parse(event.data) as ServerMessage;
    if (incoming.type === "welcome") { playerId = incoming.playerId; roomLabel.textContent = `Room ${incoming.roomCode}`; snapshot = incoming.snapshot; }
    if (incoming.type === "state" || incoming.type === "actionResult") { snapshot = incoming.snapshot; if (incoming.type === "actionResult") message.textContent = incoming.message; }
    if (incoming.type === "error") message.textContent = incoming.message;
    render();
  });
}

function send(command: ClientCommand): void { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(command)); }
function move(inputX: -1 | 0 | 1, inputY: -1 | 0 | 1): void { send({ type: "move", inputX, inputY }); }

document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => button.addEventListener("click", () => {
  const action = button.dataset.action as ActionType;
  send(action === "plant" ? { type: "action", action, cropId: button.dataset.crop ?? "turnip" } : { type: "action", action });
}));
document.querySelectorAll<HTMLButtonElement>("[data-move]").forEach((button) => button.addEventListener("click", () => {
  const [x, y] = button.dataset.move!.split(",").map(Number);
  move(x as -1 | 0 | 1, y as -1 | 0 | 1);
}));
window.addEventListener("keydown", (event) => {
  const directions: Record<string, [-1 | 0 | 1, -1 | 0 | 1]> = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };
  const direction = directions[event.key];
  if (direction) { event.preventDefault(); move(...direction); }
});

function render(): void {
  if (!snapshot) return;
  const own = snapshot.players.find((player) => player.id === playerId);
  const tileSize = 32;
  const viewWidth = Math.floor(canvas.width / tileSize);
  const viewHeight = Math.floor(canvas.height / tileSize);
  const cameraX = Math.max(0, Math.min(snapshot.width - viewWidth, (own?.x ?? 8) - Math.floor(viewWidth / 2)));
  const cameraY = Math.max(0, Math.min(snapshot.height - viewHeight, (own?.y ?? 8) - Math.floor(viewHeight / 2)));
  renderContext.fillStyle = "#91b477"; renderContext.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < viewHeight; y += 1) for (let x = 0; x < viewWidth; x += 1) { renderContext.fillStyle = (x + y + cameraX + cameraY) % 2 ? "#a8c68f" : "#9fc084"; renderContext.fillRect(x * tileSize, y * tileSize, tileSize, tileSize); }
  for (const [key, tile] of Object.entries(snapshot.tiles)) {
    const [worldX = 0, worldY = 0] = key.split(",").map(Number); const x = worldX - cameraX; const y = worldY - cameraY; if (x < 0 || y < 0 || x >= viewWidth || y >= viewHeight) continue;
    if (tile.tilled) { renderContext.fillStyle = tile.watered ? "#668d7b" : "#8b6449"; renderContext.fillRect(x * tileSize, y * tileSize, tileSize, tileSize); }
    if (tile.crop) { const grown = Math.min(1, (Date.now() - tile.crop.plantedAt) / (tile.crop.growthMinutes * 60_000)); renderContext.fillStyle = grown >= 1 ? "#e6b83f" : "#387047"; renderContext.beginPath(); renderContext.arc((x + .5) * tileSize, (y + .5) * tileSize, tileSize * (.16 + grown * .23), 0, Math.PI * 2); renderContext.fill(); }
  }
  for (const home of snapshot.homes) drawBlock(home.x - cameraX, home.y - cameraY, "#8b5e3c");
  for (const npc of snapshot.npcs) drawCircle(npc.x - cameraX, npc.y - cameraY, "#b44d6a");
  for (const enemy of snapshot.enemies) drawBlock(enemy.x - cameraX, enemy.y - cameraY, "#5e3b67");
  for (const player of snapshot.players) drawBlock(player.x - cameraX, player.y - cameraY, player.id === playerId ? "#d27e45" : "#34545a");
  seasonLabel.textContent = `${capitalize(snapshot.season)}, day ${snapshot.seasonDay}`; roomLabel.textContent = `Room ${roomLabel.textContent.replace("Room ", "")} · ${snapshot.festival ? "Festival day" : "Shared world"}`;
  stats.innerHTML = own ? `<span>♥ ${own.health}</span><span>⚡ ${own.stamina}</span><span>◈ ${own.coins}</span><span>Bag ${Object.values(own.inventory).reduce((sum, value) => sum + value, 0)}</span>` : "";
  hud.textContent = own ? `${own.name} · ${own.pet ? `Companion: ${own.pet}` : "No companion yet"}` : "Choose a place to begin.";
}
function drawBlock(x: number, y: number, color: string): void { if (x < -1 || y < -1 || x > 24 || y > 16) return; renderContext.fillStyle = color; renderContext.fillRect(x * 32 + 7, y * 32 + 5, 18, 22); }
function drawCircle(x: number, y: number, color: string): void { if (x < -1 || y < -1 || x > 24 || y > 16) return; renderContext.fillStyle = color; renderContext.beginPath(); renderContext.arc((x + .5) * 32, (y + .5) * 32, 9, 0, Math.PI * 2); renderContext.fill(); }
function capitalize(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }
function requireElement<T extends HTMLElement>(id: string): T { const element = document.getElementById(id); if (!element) throw new Error(`Missing UI element: ${id}`); return element as T; }