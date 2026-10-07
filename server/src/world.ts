import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { FarmTile, PlayerState, Season, WorldSnapshot } from "@harvest-haven/shared/protocol.js";

const require = createRequire(import.meta.url);
const config: typeof import("../../config/game.config.json") = require("../../config/game.config.json");
const savePath = process.env.WORLD_SAVE_PATH ?? fileURLToPath(new URL("../save-data/world.json", import.meta.url));
const seasonOrder = config.seasons as Season[];

export interface PersistedWorld {
  version: 1;
  createdAt: number;
  lastUpdatedAt: number;
  worldTimeMs: number;
  players: PlayerState[];
  tiles: Record<string, FarmTile>;
  npcs: Array<{ id: string; name: string; x: number; y: number }>;
  enemies: Array<{ id: string; kind: string; x: number; y: number; health: number }>;
  homes: Array<{ id: string; ownerId: string; x: number; y: number }>;
  festival?: string;
}

export async function loadWorld(): Promise<PersistedWorld> {
  try {
    const saved = JSON.parse(await readFile(savePath, "utf8")) as PersistedWorld;
    if (saved.version !== 1) throw new Error("Unsupported world save version");
    for (const player of saved.players) {
      player.health ??= config.player.maxHealth;
      player.stamina ??= config.player.maxStamina;
      player.inventory ??= {};
      player.friendship ??= {};
    }
    saved.npcs ??= Object.entries(config.npc).map(([id, npc]) => ({ id, name: npc.displayName, x: npc.x, y: npc.y }));
    saved.enemies ??= [{ id: "sproutling-1", kind: "sproutling", x: 22, y: 14, health: config.enemy.sproutling.health }];
    saved.homes ??= [];
    return saved;
  } catch {
    return {
      version: 1,
      createdAt: Date.now(),
      lastUpdatedAt: Date.now(),
      worldTimeMs: 0,
      players: [],
      tiles: {},
      npcs: Object.entries(config.npc).map(([id, npc]) => ({ id, name: npc.displayName, x: npc.x, y: npc.y })),
      enemies: [{ id: "sproutling-1", kind: "sproutling", x: 22, y: 14, health: config.enemy.sproutling.health }],
      homes: [],
    };
  }
}

export async function saveWorld(world: PersistedWorld): Promise<void> {
  await mkdir(dirname(savePath), { recursive: true });
  const temporaryPath = `${savePath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(world, null, 2));
  await rename(temporaryPath, savePath);
}

export function updateWorldClock(world: PersistedWorld, now = Date.now()): void {
  world.worldTimeMs += Math.max(0, now - world.lastUpdatedAt);
  world.lastUpdatedAt = now;
}

export function getSnapshot(world: PersistedWorld, connectedPlayers: PlayerState[], now = Date.now()): WorldSnapshot {
  updateWorldClock(world, now);
  const totalMinutes = world.worldTimeMs / 60_000;
  const dayIndex = Math.floor(totalMinutes / config.server.dayLengthMinutes);
  const seasonIndex = Math.floor(dayIndex / config.server.seasonLengthDays) % seasonOrder.length;
  const seasonDay = (dayIndex % config.server.seasonLengthDays) + 1;
  const dayMinute = Math.floor(totalMinutes % config.server.dayLengthMinutes);
  return {
    width: config.world.widthTiles,
    height: config.world.heightTiles,
    season: seasonOrder[seasonIndex] ?? "spring",
    seasonDay,
    dayMinute,
    players: connectedPlayers,
    tiles: world.tiles,
    npcs: world.npcs.map((npc) => ({ ...npc, friendship: connectedPlayers[0]?.friendship[npc.id] ?? 0 })),
    enemies: world.enemies,
    homes: world.homes,
    ...(world.festival ? { festival: world.festival } : {}),
  };
}

export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function getTile(world: PersistedWorld, x: number, y: number): FarmTile {
  const key = tileKey(x, y);
  world.tiles[key] ??= { tilled: false, watered: false };
  return world.tiles[key];
}

export function isInsideWorld(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < config.world.widthTiles && y < config.world.heightTiles;
}

export function getConfig() {
  return config;
}