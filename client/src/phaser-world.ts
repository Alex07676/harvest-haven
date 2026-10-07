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
    this.actors = this.add.container(0, 0);
    this.cameras.main.setBackgroundColor("#88ad78");
    this.onReady(this);
  }

  setSnapshot(snapshot: WorldSnapshot, playerId: string): void {
    this.snapshot = snapshot;
    this.playerId = playerId;
    this.drawTerrain(snapshot);
    this.drawActors(snapshot);
    const player = snapshot.players.find((candidate) => candidate.id === playerId);
    if (player) this.cameras.main.pan(player.x * TILE, player.y * TILE, 180, "Sine.easeOut");
  }

  update(): void {
    for (const actor of this.avatarById.values()) {
      actor.y += Math.sin((this.time.now + actor.x * 13) / 240) * 0.03;
    }
  }

  private drawTerrain(snapshot: WorldSnapshot): void {
    this.terrain.clear();
    this.terrain.fillStyle(0x9fc185, 1).fillRect(0, 0, snapshot.width * TILE, snapshot.height * TILE);
    this.terrain.fillStyle(0x89ae77, 1).fillRect(0, 0, snapshot.width * TILE, 8 * TILE);
    this.terrain.fillStyle(0x6f9caa, 1).fillRect(39 * TILE, 0, 8 * TILE, snapshot.height * TILE);
    this.terrain.fillStyle(0x8fb6bf, 1).fillRect(40 * TILE, 0, 5 * TILE, snapshot.height * TILE);
    this.terrain.fillStyle(0xc9ad77, 1).fillRect(0, 27 * TILE, snapshot.width * TILE, 3 * TILE);
    this.terrain.fillStyle(0xb88d61, 1).fillRect(8 * TILE, 8 * TILE, 22 * TILE, 18 * TILE);
    this.terrain.fillStyle(0xa57955, 1).fillRect(9 * TILE, 9 * TILE, 20 * TILE, 16 * TILE);
    for (let x = 9; x < 29; x += 1) for (let y = 9; y < 25; y += 1) {
      this.terrain.fillStyle((x + y) % 2 ? 0xa97b55 : 0xb6865c, 1).fillRect(x * TILE + 2, y * TILE + 2, TILE - 4, TILE - 4);
    }
    for (let x = 4; x < snapshot.width; x += 5) this.terrain.fillStyle(0xd6b77a, 1).fillRect(x * TILE, 27 * TILE + 10, 3 * TILE, 12);
    for (let x = 3; x < 37; x += 6) this.drawTree(x, 4 + (x % 3));
    for (let y = 5; y < 23; y += 5) this.drawTree(50 + (y % 4), y);
    for (const [key, tile] of Object.entries(snapshot.tiles)) {
      const [x = 0, y = 0] = key.split(",").map(Number);
      if (tile.building) this.drawHouse(x, y, tile.building.ownerId === this.playerId);
      if (tile.tilled) { this.terrain.fillStyle(tile.watered ? 0x608b7a : 0x815b45, 1).fillRect(x * TILE + 3, y * TILE + 3, TILE - 6, TILE - 6); }
      if (tile.crop) { const growth = Math.min(1, (Date.now() - tile.crop.plantedAt) / (tile.crop.growthMinutes * 60_000)); this.drawCrop(x, y, growth, tile.crop.ownerId === this.playerId); }
    }
  }

  private drawActors(snapshot: WorldSnapshot): void {
    for (const actor of this.avatarById.values()) actor.destroy(true);
    this.avatarById.clear();
    for (const npc of snapshot.npcs) this.addActor(npc.x, npc.y, 0xb34e68, npc.name, false);
    for (const enemy of snapshot.enemies) this.addActor(enemy.x, enemy.y, 0x5b3c69, enemy.kind, false);
    for (const player of snapshot.players) this.addActor(player.x, player.y, player.id === this.playerId ? 0xd27c45 : 0x35545c, player.name, true, player.id);
  }

  private addActor(x: number, y: number, color: number, label: string, player: boolean, id = `${label}-${x}-${y}`): void {
    const actor = this.add.container(x * TILE + TILE / 2, y * TILE + TILE / 2);
    const shadow = this.add.ellipse(0, 11, 21, 7, 0x28423a, 0.28);
    const body = this.add.rectangle(0, 2, 16, 20, color);
    const head = this.add.circle(0, -11, 8, 0xf0c298);
    const hair = this.add.arc(0, -14, 8, 180, 350, false, 0x3c2b2a);
    actor.add([shadow, body, head, hair]);
    if (player) actor.add(this.add.text(-24, -31, label, { color: "#fff8e8", fontFamily: "Georgia", fontSize: "10px", stroke: "#163431", strokeThickness: 3 }));
    this.actors.add(actor);
    this.avatarById.set(id, actor);
  }

  private drawTree(x: number, y: number): void {
    this.terrain.fillStyle(0x674832, 1).fillRect(x * TILE + 13, y * TILE + 14, 7, 20);
    this.terrain.fillStyle(0x2d6347, 1).fillCircle(x * TILE + 16, y * TILE + 10, 16);
    this.terrain.fillStyle(0x43805a, 1).fillCircle(x * TILE + 8, y * TILE + 13, 10);
  }

  private drawHouse(x: number, y: number, own: boolean): void {
    this.terrain.fillStyle(own ? 0xd2764b : 0x7a6257, 1).fillRect(x * TILE - 8, y * TILE - 18, 48, 42);
    this.terrain.fillStyle(0x68404b, 1).fillTriangle(x * TILE - 12, y * TILE - 18, x * TILE + 16, y * TILE - 39, x * TILE + 44, y * TILE - 18);
    this.terrain.fillStyle(0xf1d295, 1).fillRect(x * TILE + 11, y * TILE + 3, 10, 21);
  }

  private drawCrop(x: number, y: number, growth: number, own: boolean): void {
    this.terrain.lineStyle(2, own ? 0x315d45 : 0x7d6955, 1).strokeCircle(x * TILE + 16, y * TILE + 16, 5 + growth * 8);
    this.terrain.fillStyle(growth >= 1 ? 0xe9b93e : 0x39734a, 1).fillCircle(x * TILE + 16, y * TILE + 16, 3 + growth * 4);
  }
}

export function createHarvestWorld(parent: HTMLElement, send: (command: ClientCommand) => void): HarvestWorld {
  return new HarvestWorld(parent, send);
}