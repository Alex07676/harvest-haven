import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientCommand, PlayerState, ServerMessage } from "@harvest-haven/shared/protocol.js";
import { getConfig, getSnapshot, getTile, isInsideWorld, loadWorld, saveWorld, updateWorldClock } from "./world.js";
import type { PersistedWorld } from "./world.js";
import { getSession, linkPlayer, loadAccounts, loginAccount, registerAccount, saveAccounts } from "./accounts.js";

const config = getConfig();
const port = Number(process.env.PORT ?? 8788);
const startedAt = Date.now();
const roomCode = process.env.ROOM_CODE ?? "MEADOW";
const sockets = new Map<WebSocket, PlayerState>();
const world = await loadWorld();
const accounts = await loadAccounts();
const crops = config.crops as Record<string, { displayName: string; sellPrice: number; growthMinutes: number }>;
const items = config.items as Record<string, { displayName: string; sellPrice: number }>;
const enemies = config.enemy as Record<string, { damage: number; drop: string; health: number }>;
const npcs = config.npc as Record<string, { dailyGift: string }>;

const httpServer = createServer(async (request, response) => {
  response.setHeader("access-control-allow-origin", process.env.WEB_ORIGIN ?? "*");
  response.setHeader("access-control-allow-headers", "content-type");
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }
  if (request.method === "POST" && (request.url === "/api/register" || request.url === "/api/login")) {
    try {
      const body = await readJson(request);
      const result = request.url === "/api/register"
        ? await registerAccount(accounts, body.username, body.password)
        : loginAccount(accounts, body.username, body.password);
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: error instanceof Error ? error.message : "Account request failed." }));
    }
    return;
  }
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
      ok: true,
      service: "harvest-haven-server",
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      players: sockets.size,
      season: snapshot().season,
    }));
    return;
  }
  if (request.url === "/api/world") {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(snapshot()));
    return;
  }
  response.writeHead(404).end("Not found");
});

const websocket = new WebSocketServer({ server: httpServer, path: "/game" });
websocket.on("connection", async (socket, request) => {
  const query = new URL(request.url ?? "/", "http://localhost").searchParams;
  const account = getSession(query.get("token"));
  if (!account) {
    send(socket, { type: "error", message: "You must log in before joining this world." });
    socket.close(1008, "Authentication required");
    return;
  }
  if ((query.get("room") ?? roomCode).toUpperCase() !== roomCode.toUpperCase()) {
    send(socket, { type: "error", message: "That room code is not valid." });
    socket.close(1008, "Invalid room");
    return;
  }
  if (sockets.size >= config.world.maxPlayers) {
    send(socket, { type: "error", message: "This world is full." });
    socket.close(1008, "World full");
    return;
  }

  const requestedSession = account.playerId;
  const returningPlayer = requestedSession ? world.players.find((candidate) => candidate.id === requestedSession) : undefined;
  if (returningPlayer) {
    const oldConnection = [...sockets.entries()].find(([, active]) => active.id === returningPlayer.id);
    if (oldConnection) {
      sockets.delete(oldConnection[0]);
      oldConnection[0].close(4000, "Session resumed elsewhere");
    }
  }
  const player: PlayerState = returningPlayer && ![...sockets.values()].some((active) => active.id === returningPlayer.id) ? returningPlayer : {
    id: randomUUID(),
    name: account.username,
    x: 8 + sockets.size * 2,
    y: 8,
    coins: config.player.startingCoins,
    stamina: config.player.maxStamina,
    health: config.player.maxHealth,
    inventory: { turnip: config.player.startingSeeds },
    friendship: {},
    relationshipStartedAt: {},
    appearance: {
      hairColor: query.get("hair")?.slice(0, 16) || "brown",
      shirtColor: query.get("shirt")?.slice(0, 16) || "orange",
      style: query.get("style")?.slice(0, 16) || "farmer",
    },
  };
  if (!world.players.some((candidate) => candidate.id === player.id)) world.players.push(player);
  linkPlayer(account, player.id);
  await saveAccounts(accounts);
  sockets.set(socket, player);
  send(socket, { type: "welcome", playerId: player.id, sessionToken: query.get("token")!, roomCode, username: account.username, snapshot: snapshot() });
  broadcast({ type: "state", snapshot: snapshot() });

  socket.on("message", (raw) => {
    try {
      handleCommand(socket, JSON.parse(raw.toString()) as ClientCommand);
    } catch {
      send(socket, { type: "error", message: "Invalid command payload." });
    }
  });

  socket.on("close", () => {
    sockets.delete(socket);
    void persist();
    broadcast({ type: "state", snapshot: snapshot() });
  });
});

setInterval(() => {
  updateWorldClock(world);
  broadcast({ type: "state", snapshot: snapshot() });
}, 1000 / config.server.snapshotRate).unref();
setInterval(() => void persist(), config.server.idleSaveMinutes * 60_000).unref();

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Harvest Haven server listening on http://0.0.0.0:${port}`);
});

function handleCommand(socket: WebSocket, command: ClientCommand): void {
  const player = sockets.get(socket);
  if (!player) return;
  if (command.type === "ping") {
    send(socket, { type: "pong", clientTime: command.clientTime, serverTime: Date.now() });
    return;
  }
  if (command.type === "move") {
    const nextX = Math.max(0, Math.min(config.world.widthTiles - 1, player.x + command.inputX));
    const nextY = Math.max(0, Math.min(config.world.heightTiles - 1, player.y + command.inputY));
    if (isInsideWorld(nextX, nextY)) {
      player.x = nextX;
      player.y = nextY;
      broadcast({ type: "state", snapshot: snapshot() });
    }
    return;
  }

  const tile = getTile(world, player.x, player.y);
  if (command.action === "till") {
    tile.tilled = true;
    tile.watered = false;
    finishAction("Soil tilled.");
  } else if (command.action === "plant") {
    const crop = command.cropId ? crops[command.cropId] : undefined;
    if (!tile.tilled || tile.crop || !crop) return send(socket, { type: "error", message: "You need an empty tilled tile and a valid seed." });
    tile.crop = { id: command.cropId!, ownerId: player.id, plantedAt: Date.now(), growthMinutes: crop.growthMinutes };
    finishAction(`Planted ${crop.displayName}.`);
  } else if (command.action === "water") {
    if (!tile.tilled || !tile.crop) return send(socket, { type: "error", message: "There is no planted crop here." });
    tile.watered = true;
    finishAction("Crop watered.");
  } else if (command.action === "harvest") {
    if (!tile.crop) return send(socket, { type: "error", message: "There is no crop here." });
    if (config.multiplayer.cropOwnership === "owner-only" && tile.crop.ownerId && tile.crop.ownerId !== player.id) return send(socket, { type: "error", message: "That crop belongs to another farmer." });
    const crop = crops[tile.crop.id];
    if (!crop || Date.now() - tile.crop.plantedAt < tile.crop.growthMinutes * 60_000) return send(socket, { type: "error", message: "That crop is still growing." });
    player.coins += crop.sellPrice;
    delete tile.crop;
    tile.watered = false;
    finishAction(`Harvested ${crop.displayName} for ${crop.sellPrice} coins.`);
  } else if (command.action === "attack") {
    const enemy = world.enemies.find((candidate) => candidate.x === player.x && candidate.y === player.y);
    if (!enemy) return send(socket, { type: "error", message: "There is no enemy here." });
    enemy.health -= config.player.attackDamage;
    if (enemy.health <= 0) {
      const enemyConfig = enemies[enemy.kind];
      if (!enemyConfig) return send(socket, { type: "error", message: "Unknown enemy data." });
      addItem(player, enemyConfig.drop, 1);
      world.enemies = world.enemies.filter((candidate) => candidate.id !== enemy.id);
      finishAction(`Defeated the ${enemy.kind} and found ${items[enemyConfig.drop]?.displayName ?? enemyConfig.drop}.`);
    } else {
      const enemyRules = enemies[enemy.kind];
      if (!enemyRules) return send(socket, { type: "error", message: "Unknown enemy data." });
      player.health = Math.max(0, player.health - enemyRules.damage);
      if (player.health === 0) {
        player.health = config.player.maxHealth;
        player.x = 8;
        player.y = 8;
        finishAction("You were knocked out and returned home.");
      } else finishAction(`You hit the ${enemy.kind}. Health: ${player.health}.`);
    }
  } else if (command.action === "fish") {
    if (!nearPlace(player, "river")) return send(socket, { type: "error", message: "Fishing is only possible beside the Silverrun River." });
    addItem(player, "fish", 1);
    finishAction("You caught a river fish.");
  } else if (command.action === "buySeeds") {
    if (!nearPlace(player, "shop")) return send(socket, { type: "error", message: "Walk to Juniper General to buy seeds." });
    const seedCost = config.crops.turnip.seedCost;
    if (player.coins < seedCost) return send(socket, { type: "error", message: `Turnip seeds cost ${seedCost} coins.` });
    player.coins -= seedCost;
    addItem(player, "turnip", 1);
    finishAction("Bought a packet of turnip seeds.");
  } else if (command.action === "interact") {
    const npc = world.npcs.find((candidate) => candidate.x === player.x && candidate.y === player.y);
    if (npc) {
      player.friendship[npc.id] = (player.friendship[npc.id] ?? 0) + 1;
      finishAction(`${npc.name}: \"The valley feels better with you here.\" Friendship ${player.friendship[npc.id]}.`);
    } else if (nearPlace(player, "shop")) finishAction("Juniper General sells seeds and supplies. Press B to buy seeds.");
    else if (nearPlace(player, "sell")) finishAction("Harvest Exchange buys gathered goods. Press T to trade.");
    else if (nearPlace(player, "river")) finishAction("Silverrun River. Press F to cast your line.");
    else finishAction("There is nothing to interact with here.");
  } else if (command.action === "cook") {
    if (!consumeItems(player, { fish: 1, berry: 1 })) return send(socket, { type: "error", message: "Cooking requires one fish and one berry." });
    addItem(player, "meal", 1);
    finishAction("Cooked a harvest stew.");
  } else if (command.action === "adoptPet") {
    if (player.pet) return send(socket, { type: "error", message: "You already have a pet." });
    if (player.coins < config.pet.adoptionCost) return send(socket, { type: "error", message: "You need more coins to adopt a pet." });
    player.coins -= config.pet.adoptionCost;
    player.pet = config.pet.name;
    finishAction(`Adopted ${config.pet.name}.`);
  } else if (command.action === "talk" || command.action === "romance") {
    const npc = world.npcs.find((candidate) => candidate.x === player.x && candidate.y === player.y) ?? world.npcs[0];
    if (!npc) return send(socket, { type: "error", message: "Nobody is here." });
    if (!npc.romanceable && command.action === "romance") return send(socket, { type: "error", message: `${npc.name} is a friend, not a romance route.` });
    player.relationshipStartedAt[npc.id] ??= Date.now();
    const relationshipStartedAt = player.relationshipStartedAt[npc.id] ?? Date.now();
    if (command.action === "romance") {
      const requiredMs = config.relationships.romanceUnlockDays * 24 * 60 * 60 * 1000;
      const friendship = player.friendship[npc.id] ?? 0;
      if (friendship < config.relationships.romanceFriendshipRequired) return send(socket, { type: "error", message: `${npc.name} needs more friendship first (${friendship}/${config.relationships.romanceFriendshipRequired}).` });
      if (Date.now() - relationshipStartedAt < requiredMs) return send(socket, { type: "error", message: "Relationships grow over several real days. Keep visiting and talking." });
    }
    player.friendship[npc.id] = (player.friendship[npc.id] ?? 0) + (command.action === "romance" ? config.relationships.romanceFriendship : config.relationships.talkFriendship);
    if (command.action === "talk") {
      const npcRules = npcs[npc.id];
      if (npcRules) addItem(player, npcRules.dailyGift, 1);
    }
    finishAction(`${npc.name} is glad to see you. Friendship: ${player.friendship[npc.id]}.`);
  } else if (command.action === "trade") {
    const tradeItem = Object.keys(player.inventory).find((item) => item !== "turnip" && (player.inventory[item] ?? 0) > 0);
    if (!tradeItem) return send(socket, { type: "error", message: "You have nothing to trade." });
    player.inventory[tradeItem] = (player.inventory[tradeItem] ?? 0) - 1;
    player.coins += items[tradeItem]?.sellPrice ?? config.trading.dailyCoins;
    finishAction(`Traded ${items[tradeItem]?.displayName ?? tradeItem}.`);
  } else if (command.action === "festival") {
    const current = snapshot();
    if (current.seasonDay !== config.server.seasonLengthDays) return send(socket, { type: "error", message: "The festival is held on the last day of the season." });
    world.festival = `${current.season}-harvest-festival`;
    player.coins += config.trading.dailyCoins;
    finishAction("The harvest festival is underway. You received a festival gift.");
  } else if (command.action === "placeHouse") {
    if (world.homes.some((home) => home.ownerId === player.id)) return send(socket, { type: "error", message: "You already own a house." });
    if (player.coins < config.housing.houseCost) return send(socket, { type: "error", message: "You need more coins to build a house." });
    player.coins -= config.housing.houseCost;
    world.homes.push({ id: randomUUID(), ownerId: player.id, x: player.x, y: player.y });
    getTile(world, player.x, player.y).building = { type: "house", ownerId: player.id };
    finishAction("Your house is ready.");
  }

  function finishAction(message: string): void {
    void persist();
    broadcast({ type: "actionResult", message, snapshot: snapshot() });
  }
}

function addItem(player: PlayerState, item: string, quantity: number): void {
  player.inventory[item] = (player.inventory[item] ?? 0) + quantity;
}

function consumeItems(player: PlayerState, required: Record<string, number>): boolean {
  if (Object.entries(required).some(([item, quantity]) => (player.inventory[item] ?? 0) < quantity)) return false;
  for (const [item, quantity] of Object.entries(required)) player.inventory[item] = (player.inventory[item] ?? 0) - quantity;
  return true;
}

function nearPlace(player: PlayerState, kind: string): boolean {
  return config.places.some((place) => place.kind === kind && Math.abs(place.x - player.x) <= (place.width ?? 2) && Math.abs(place.y - player.y) <= (place.height ?? 2));
}

function snapshot() {
  return getSnapshot(world, [...sockets.values()]);
}

function broadcast(message: ServerMessage): void {
  for (const socket of sockets.keys()) send(socket, message);
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

async function persist(): Promise<void> {
  await saveWorld(world satisfies PersistedWorld);
}

async function readJson(request: import("node:http").IncomingMessage): Promise<{ username: string; password: string }> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { username?: unknown; password?: unknown };
  if (typeof body.username !== "string" || typeof body.password !== "string") throw new Error("Username and password are required.");
  return { username: body.username, password: body.password };
}