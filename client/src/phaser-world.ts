import Phaser from "phaser";
import type { ClientCommand, PlayerState, WorldSnapshot } from "@harvest-haven/shared/protocol.js";

const TILE = 32;

export class HarvestWorld {
  private readonly game: Phaser.Game;
  private scene?: ValleyScene;

  constructor(parent: HTMLElement, send: (command: ClientCommand) => void) {
    this.game = new Phaser.Game({
      type: Phaser.CANVAS,
      parent,
      width: 768,
      height: 512,
      backgroundColor: "#8eb476",
      render: { antialias: false, pixelArt: true, roundPixels: true },
      scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: new ValleyScene(send, (scene) => { this.scene = scene; }),
    });
  }

  setSnapshot(snapshot: WorldSnapshot, playerId: string): void {
    this.scene?.setSnapshot(snapshot, playerId);
  }

  destroy(): void {
    this.game.destroy(true);
  }
}

class ValleyScene extends Phaser.Scene {
  private readonly sendCommand: (command: ClientCommand) => void;
  private readonly onReady: (scene: ValleyScene) => void;
  private terrain!: Phaser.GameObjects.Graphics;
  private decorations!: Phaser.GameObjects.Container;
  private cropSprites!: Phaser.GameObjects.Container;
  private actors!: Phaser.GameObjects.Container;
  private snapshot?: WorldSnapshot;
  private playerId = "";
  private avatarById = new Map<string, Phaser.GameObjects.Container>();

  constructor(sendCommand: (command: ClientCommand) => void, onReady: (scene: ValleyScene) => void) {
    super("valley");
    this.sendCommand = sendCommand;
    this.onReady = onReady;
  }

  create(): void {
    this.terrain = this.add.graphics();
    this.decorations = this.add.container(0, 0);
    this.cropSprites = this.add.container(0, 0);
    this.actors = this.add.container(0, 0);
    this.cameras.main.setBackgroundColor("#88ad78");
    this.onReady(this);
  }

  preload(): void {
    this.load.svg("farmer", "/assets/farmer.svg", { width: 32, height: 40 });
    this.load.svg("mara", "/assets/mara.svg", { width: 32, height: 40 });
    this.load.svg("orin", "/assets/orin.svg", { width: 32, height: 40 });
    this.load.svg("elsa", "/assets/elsa.svg", { width: 32, height: 40 });
    this.load.svg("sproutling", "/assets/sproutling.svg", { width: 32, height: 40 });
    this.load.svg("tree", "/assets/tree.svg", { width: 48, height: 56 });
    this.load.svg("house", "/assets/house.svg", { width: 64, height: 64 });
    this.load.svg("turnip", "/assets/turnip.svg", { width: 24, height: 24 });
    this.load.svg("berry", "/assets/berry.svg", { width: 24, height: 24 });
  }

  setSnapshot(snapshot: WorldSnapshot, playerId: string): void {
    this.snapshot = snapshot;
    this.playerId = playerId;
    this.drawTerrain(snapshot);
    this.drawActors(snapshot);
    const player = snapshot.players.find((candidate) => candidate.id === playerId);
    this.cameras.main.setBounds(0, 0, snapshot.width * TILE, snapshot.height * TILE);
    if (player) this.cameras.main.centerOn((player.x + 0.5) * TILE, (player.y + 0.5) * TILE);
  }

  update(): void {
    for (const actor of this.avatarById.values()) {
      actor.y += Math.sin((this.time.now + actor.x * 13) / 240) * 0.03;
    }
  }

  private drawTerrain(snapshot: WorldSnapshot): void {
    this.terrain.clear();
    this.decorations.removeAll(true);
    this.cropSprites.removeAll(true);
    this.terrain.fillStyle(0x9fc185, 1).fillRect(0, 0, snapshot.width * TILE, snapshot.height * TILE);
    this.drawMountainBorder(snapshot);
    this.terrain.fillStyle(0x89ae77, 1).fillRect(0, 0, snapshot.width * TILE, 8 * TILE);
    this.terrain.fillStyle(0x6f9caa, 1).fillRect(39 * TILE, 0, 8 * TILE, snapshot.height * TILE);
    this.terrain.fillStyle(0x8fb6bf, 1).fillRect(40 * TILE, 0, 5 * TILE, snapshot.height * TILE);
      this.terrain.lineStyle(2, 0xb9d2c8, 0.7);
      for (let y = 8; y < snapshot.height; y += 3) this.terrain.lineBetween(40 * TILE, y * TILE + 10, 45 * TILE, y * TILE + 4);
    this.terrain.fillStyle(0xc9ad77, 1).fillRect(0, 27 * TILE, snapshot.width * TILE, 3 * TILE);
    const town = snapshot.places.find((place) => place.kind === "town");
    if (town) {
      this.terrain.fillStyle(0xcdb47f, 1).fillRect((town.x - 4) * TILE, (town.y - 4) * TILE, 15 * TILE, 12 * TILE);
      this.terrain.lineStyle(3, 0x7d604c, 1).strokeRect((town.x - 4) * TILE + 3, (town.y - 4) * TILE + 3, 15 * TILE - 6, 12 * TILE - 6);
    }
    const shop = snapshot.places.find((place) => place.kind === "shop");
    if (shop) this.drawTownBuilding(shop.x, shop.y, 0xd2764b, "SHOP");
    const sell = snapshot.places.find((place) => place.kind === "sell");
    if (sell) this.drawTownBuilding(sell.x, sell.y, 0x5d8c83, "SELL");
    this.terrain.fillStyle(0xb88d61, 1).fillRect(8 * TILE, 8 * TILE, 22 * TILE, 18 * TILE);
    this.terrain.fillStyle(0xa57955, 1).fillRect(9 * TILE, 9 * TILE, 20 * TILE, 16 * TILE);
      this.terrain.lineStyle(3, 0x70503e, 1);
      this.terrain.strokeRect(8 * TILE + 2, 8 * TILE + 2, 22 * TILE - 4, 18 * TILE - 4);
    for (let x = 9; x < 29; x += 1) for (let y = 9; y < 25; y += 1) {
      this.terrain.fillStyle((x + y) % 2 ? 0xa97b55 : 0xb6865c, 1).fillRect(x * TILE + 2, y * TILE + 2, TILE - 4, TILE - 4);
    }
      this.drawPath(0, 28, snapshot.width, 2);
      this.drawPath(29, 0, 2, 27);
      for (let x = 4; x < snapshot.width; x += 5) this.terrain.fillStyle(0xd6b77a, 1).fillRect(x * TILE, 27 * TILE + 10, 3 * TILE, 12);
      for (let x = 8; x <= 30; x += 2) this.drawFencePost(x, 8);
      for (let x = 8; x <= 30; x += 2) this.drawFencePost(x, 26);
    for (let x = 3; x < 37; x += 6) this.drawTree(x, 4 + (x % 3));
    for (let y = 5; y < 23; y += 5) this.drawTree(50 + (y % 4), y);
    for (const [key, tile] of Object.entries(snapshot.tiles)) {
      const [x = 0, y = 0] = key.split(",").map(Number);
      if (tile.building) this.drawHouse(x, y, tile.building.ownerId === this.playerId);
      if (tile.tilled) { this.terrain.fillStyle(tile.watered ? 0x608b7a : 0x815b45, 1).fillRect(x * TILE + 3, y * TILE + 3, TILE - 6, TILE - 6); }
      if (tile.crop) { const growth = Math.min(1, (Date.now() - tile.crop.plantedAt) / (tile.crop.growthMinutes * 60_000)); this.drawCrop(x, y, growth, tile.crop.ownerId === this.playerId, tile.crop.id); }
    }
  }

  private drawActors(snapshot: WorldSnapshot): void {
    for (const actor of this.avatarById.values()) actor.destroy(true);
    this.avatarById.clear();
    for (const npc of snapshot.npcs) this.addActor(npc.x, npc.y, this.npcTint(npc.id), npc.name, false, npc.id);
    for (const enemy of snapshot.enemies) this.addActor(enemy.x, enemy.y, 0x5b3c69, enemy.kind, false);
    for (const player of snapshot.players) this.addActor(player.x, player.y, player.id === this.playerId ? 0xd27c45 : 0x35545c, player.name, true, player.id);
  }

  private addActor(x: number, y: number, color: number, label: string, player: boolean, id = `${label}-${x}-${y}`): void {
    const actor = this.add.container(x * TILE + TILE / 2, y * TILE + TILE / 2);
    const shadow = this.add.ellipse(0, 16, 21, 7, 0x28423a, 0.28);
    const texture = player ? "farmer" : label === "Mara" ? "mara" : label === "Orin" ? "orin" : label === "Elsa" ? "elsa" : label === "sproutling" ? "sproutling" : "npc";
    const sprite = this.add.image(0, -2, texture).setDisplaySize(32, 40);
    if (player && id !== this.playerId) sprite.setTint(0x80a9b4);
    if (!player && texture === "npc") sprite.setTint(color);
    actor.add([shadow, sprite]);
    if (player) actor.add(this.add.text(-24, -31, label, { color: "#fff8e8", fontFamily: "Georgia", fontSize: "10px", stroke: "#163431", strokeThickness: 3 }));
    this.actors.add(actor);
    this.avatarById.set(id, actor);
  }

  private drawTree(x: number, y: number): void {
    this.decorations.add(this.add.image(x * TILE + 16, y * TILE + 16, "tree"));
  }

  private drawHouse(x: number, y: number, own: boolean): void {
    const house = this.add.image(x * TILE + 16, y * TILE + 4, "house").setDisplaySize(48, 48);
    if (!own) house.setTint(0xc0b2a2);
    this.decorations.add(house);
  }

  private drawCrop(x: number, y: number, growth: number, own: boolean, id: string): void {
    const crop = this.add.image(x * TILE + 16, y * TILE + 16, id === "berry" ? "berry" : "turnip").setScale(0.35 + growth * 0.65);
    crop.setAlpha(own ? 1 : 0.55);
    this.cropSprites.add(crop);
  }

  private drawTownBuilding(x: number, y: number, color: number, sign: string): void {
    this.terrain.fillStyle(color, 1).fillRect(x * TILE - 18, y * TILE - 22, 68, 52);
    this.terrain.fillStyle(0x68404b, 1).fillTriangle(x * TILE - 22, y * TILE - 22, x * TILE + 16, y * TILE - 48, x * TILE + 54, y * TILE - 22);
    this.terrain.fillStyle(0xf1d295, 1).fillRect(x * TILE + 8, y * TILE + 4, 12, 26);
    this.terrain.fillStyle(0x263a38, 1).fillRect(x * TILE - 12, y * TILE - 13, 56, 10);
    this.terrain.fillStyle(0xf8df9a, 1).fillRect(x * TILE - 4, y * TILE - 11, 40, 6);
    this.terrain.fillStyle(0x263a38, 1).fillRect(x * TILE - 4, y * TILE - 10, 1, 4);
  }

  private npcTint(id: string): number {
    const colors: Record<string, number> = { mara: 0xd0a34b, elin: 0xc46d49, signe: 0x9160a7, freja: 0x34333e, liv: 0xb8b4b2, astrid: 0x754b36 };
    return colors[id] ?? 0xb34e68;
  }

  private drawMountainBorder(snapshot: WorldSnapshot): void {
    const mountain = 0x52635c;
    const snow = 0xc4d1bd;
    for (let x = 0; x < snapshot.width; x += 4) {
      this.terrain.fillStyle(mountain, 1).fillTriangle(x * TILE, 0, (x + 2) * TILE, 42, (x + 4) * TILE, 0);
      this.terrain.fillStyle(snow, 1).fillTriangle((x + 2) * TILE, 42, (x + 1.35) * TILE, 15, (x + 2.65) * TILE, 15);
      const bottom = snapshot.height * TILE;
      this.terrain.fillStyle(mountain, 1).fillTriangle(x * TILE, bottom, (x + 2) * TILE, bottom - 42, (x + 4) * TILE, bottom);
    }
    for (let y = 0; y < snapshot.height; y += 4) {
      this.terrain.fillStyle(mountain, 1).fillTriangle(0, y * TILE, 42, (y + 2) * TILE, 0, (y + 4) * TILE);
      this.terrain.fillStyle(mountain, 1).fillTriangle(snapshot.width * TILE, y * TILE, snapshot.width * TILE - 42, (y + 2) * TILE, snapshot.width * TILE, (y + 4) * TILE);
    }
  }

  private drawPath(x: number, y: number, width: number, height: number): void {
    this.terrain.fillStyle(0xd6b77a, 1).fillRect(x * TILE, y * TILE, width * TILE, height * TILE);
    this.terrain.lineStyle(1, 0xe8d194, 0.6);
    for (let i = 0; i < width * height; i += 1) {
      const px = x * TILE + (i % width) * TILE + 5;
      const py = y * TILE + Math.floor(i / width) * TILE + 8;
      this.terrain.strokeRect(px, py, TILE - 10, TILE - 14);
    }
  }

  private drawFencePost(x: number, y: number): void {
    this.terrain.fillStyle(0x8a6044, 1).fillRect(x * TILE + 12, y * TILE - 5, 7, 17);
    this.terrain.fillStyle(0xb88658, 1).fillRect(x * TILE + 5, y * TILE, 21, 4);
  }
}

export function createHarvestWorld(parent: HTMLElement, send: (command: ClientCommand) => void): HarvestWorld {
  return new HarvestWorld(parent, send);
}