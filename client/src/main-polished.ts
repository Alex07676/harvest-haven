import "./style.css";
import type { ActionType, ClientCommand, ServerMessage, WorldSnapshot } from "@harvest-haven/shared/protocol.js";
import { createHarvestWorld, type HarvestWorld } from "./phaser-world.js";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root is missing");

app.innerHTML = `
  <section class="auth-panel" id="auth">
    <div class="brand-lockup"><span class="flag" aria-label="Swedish flag"></span><div><p class="eyebrow">A small world to call home</p><h1>Harvest Haven</h1></div></div>
    <p id="auth-message">Log in to join your shared farm.</p>
    <form id="auth-form"><label>Username<input id="username" name="username" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_]+" autocomplete="username" /></label><label>Password<input id="password" name="password" required minlength="8" type="password" autocomplete="current-password" /></label><div class="character-choices"><label>Hair<select id="hair" name="hair"><option value="brown">Brown</option><option value="gold">Gold</option><option value="copper">Copper</option><option value="black">Black</option><option value="silver">Silver</option></select></label><label>Shirt<select id="shirt" name="shirt"><option value="orange">Harvest orange</option><option value="teal">River teal</option><option value="violet">Berry violet</option></select></label><label>Style<select id="style" name="style"><option value="farmer">Farmer</option><option value="ranger">Ranger</option><option value="artist">Artist</option></select></label></div><div class="form-actions"><button class="primary" type="submit">Log in</button><button class="secondary" type="button" id="register">Create account</button></div></form>
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
    <section class="play-area"><div class="canvas-frame"><div id="world" class="world-host" role="img" aria-label="Shared farm world"></div><div class="canvas-caption" id="hud">Walk with WASD. Press E to interact.</div><div class="hotbar" id="hotbar"><button data-slot="1">1 Hoe</button><button data-slot="2">2 Seeds</button><button data-slot="3">3 Water</button><button data-slot="4">4 Harvest</button><button data-slot="5">5 Rod</button><button data-slot="6">6 Sword</button><button data-slot="7">7 Talk</button><button data-slot="8">8 Bag</button></div></div><aside class="panel"><div class="panel-heading"><span class="panel-kicker">Valley log</span><strong id="message">Walk, watch, and listen.</strong></div><div class="stats" id="stats"></div><p class="hint">WASD / arrows move · E interact · Space use tool · B buy seeds · F fish · T trade · 1–8 select hotbar</p></aside></section>
  </main>
`;

const authPanel = requireElement<HTMLElement>("auth");
const menuPanel = requireElement<HTMLElement>("menu");
const gamePanel = requireElement<HTMLElement>("game");
const authForm = requireElement<HTMLFormElement>("auth-form");
const registerButton = requireElement<HTMLButtonElement>("register");
const authMessage = requireElement<HTMLElement>("auth-message");
const detail = requireElement<HTMLElement>("menu-detail");
const worldHost = requireElement<HTMLElement>("world");
const connection = requireElement<HTMLSpanElement>("connection");
const seasonLabel = requireElement<HTMLElement>("season");
const roomLabel = requireElement<HTMLElement>("room");
const message = requireElement<HTMLElement>("message");
const stats = requireElement<HTMLElement>("stats");
const hud = requireElement<HTMLElement>("hud");

const siteHttpOrigin = window.location.origin;
const siteWebSocketOrigin = siteHttpOrigin.replace(/^http/, "ws");
const baseServerUrl = import.meta.env.VITE_GAME_SERVER_URL ?? `${siteWebSocketOrigin}/game`;
const apiBaseUrl = import.meta.env.VITE_GAME_SERVER_HTTP_URL ?? siteHttpOrigin;
const token = localStorage.getItem("harvest-haven-token");
const appearance = JSON.parse(localStorage.getItem("harvest-haven-appearance") ?? "null") as { hair: string; shirt: string; style: string } | null;
let socket: WebSocket | undefined;
let worldRenderer: HarvestWorld | undefined;
let snapshot: WorldSnapshot | undefined;
let playerId = "";

if (token) { authPanel.hidden = true; menuPanel.hidden = false; connect(token); }

document.querySelector<HTMLButtonElement>("#play")?.addEventListener("click", () => { menuPanel.hidden = true; gamePanel.hidden = false; worldRenderer ??= createHarvestWorld(worldHost, send); if (snapshot) worldRenderer.setSnapshot(snapshot, playerId); updateHud(); });
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
    localStorage.setItem("harvest-haven-appearance", JSON.stringify({ hair: form.get("hair"), shirt: form.get("shirt"), style: form.get("style") }));
    window.location.reload();
  } catch { authMessage.textContent = "The tablet server is not reachable."; }
});

function connect(authToken: string): void {
  const url = new URL(baseServerUrl);
  url.searchParams.set("room", new URLSearchParams(window.location.search).get("room") ?? "MEADOW");
  url.searchParams.set("token", authToken);
  if (appearance) { url.searchParams.set("hair", appearance.hair); url.searchParams.set("shirt", appearance.shirt); url.searchParams.set("style", appearance.style); }
  socket = new WebSocket(url);
  socket.addEventListener("open", () => { connection.textContent = "Connected"; });
  socket.addEventListener("close", () => { connection.textContent = "Disconnected"; message.textContent = "The valley connection closed."; });
  socket.addEventListener("error", () => { connection.textContent = "Unavailable"; message.textContent = "Start the tablet server or check the tunnel URL."; });
  socket.addEventListener("message", (event) => {
    const incoming = JSON.parse(event.data) as ServerMessage;
    if (incoming.type === "welcome") { playerId = incoming.playerId; roomLabel.textContent = `Room ${incoming.roomCode}`; snapshot = incoming.snapshot; }
    if (incoming.type === "state" || incoming.type === "actionResult") { snapshot = incoming.snapshot; if (incoming.type === "actionResult") message.textContent = incoming.message; }
    if (incoming.type === "error") message.textContent = incoming.message;
    if (snapshot) worldRenderer?.setSnapshot(snapshot, playerId);
    updateHud();
  });
}

function send(command: ClientCommand): void { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(command)); }
function move(inputX: -1 | 0 | 1, inputY: -1 | 0 | 1): void { send({ type: "move", inputX, inputY }); }

let selectedSlot = 1;
document.querySelectorAll<HTMLButtonElement>("[data-slot]").forEach((button) => button.addEventListener("click", () => { selectedSlot = Number(button.dataset.slot); updateHotbar(); }));
document.querySelectorAll<HTMLButtonElement>("[data-move]").forEach((button) => button.addEventListener("click", () => { const [x, y] = button.dataset.move!.split(",").map(Number); move(x as -1 | 0 | 1, y as -1 | 0 | 1); }));
window.addEventListener("keydown", (event) => {
  const directions: Record<string, [-1 | 0 | 1, -1 | 0 | 1]> = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };
  const direction = directions[event.key];
  if (direction) { event.preventDefault(); move(...direction); }
  if (/^[1-8]$/.test(event.key)) { selectedSlot = Number(event.key); updateHotbar(); }
  if (event.key === "e" || event.key === "Enter") send({ type: "action", action: "interact" });
  if (event.key === "b") send({ type: "action", action: "buySeeds" });
  if (event.key === "f") send({ type: "action", action: "fish" });
  if (event.key === "t") send({ type: "action", action: "trade" });
  if (event.key === " " ) { event.preventDefault(); useHotbar(); }
});

function useHotbar(): void { const actions: Record<number, ActionType> = { 1: "till", 2: "plant", 3: "water", 4: "harvest", 5: "fish", 6: "attack", 7: "interact", 8: "interact" }; const action = actions[selectedSlot]; if (action) send(action === "plant" ? { type: "action", action, cropId: "turnip" } : { type: "action", action }); }
function updateHotbar(): void { document.querySelectorAll<HTMLButtonElement>("[data-slot]").forEach((button) => button.classList.toggle("selected", Number(button.dataset.slot) === selectedSlot)); }

function updateHud(): void {
  if (!snapshot) return;
  const own = snapshot.players.find((player) => player.id === playerId);
  seasonLabel.textContent = `${capitalize(snapshot.season)}, day ${snapshot.seasonDay}`;
  roomLabel.textContent = `${roomLabel.textContent.split(" · ")[0]} · ${snapshot.festival ? "Festival day" : "Shared world"}`;
  stats.innerHTML = own ? `<span>♥ ${own.health}</span><span>⚡ ${own.stamina}</span><span>◈ ${own.coins}</span><span>Bag ${Object.values(own.inventory).reduce((sum, value) => sum + value, 0)}</span>` : "";
  hud.textContent = own ? `${own.name} · ${own.pet ? `Companion: ${own.pet}` : "No companion yet"}` : "Choose a place to begin.";
}
function capitalize(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }
function requireElement<T extends HTMLElement>(id: string): T { const element = document.getElementById(id); if (!element) throw new Error(`Missing UI element: ${id}`); return element as T; }