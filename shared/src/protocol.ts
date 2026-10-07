export type Season = "spring" | "summer" | "fall" | "winter";

export type ActionType = "till" | "plant" | "water" | "harvest" | "attack" | "fish" | "cook" | "adoptPet" | "romance" | "trade" | "festival" | "placeHouse" | "talk";

export interface PlayerState {
  id: string;
  name: string;
  x: number;
  y: number;
  coins: number;
  stamina: number;
  health: number;
  inventory: Record<string, number>;
  pet?: string;
  friendship: Record<string, number>;
}

export interface FarmTile {
  tilled: boolean;
  watered: boolean;
  crop?: {
    id: string;
    ownerId?: string;
    plantedAt: number;
    growthMinutes: number;
  };
  building?: { type: "house" | "yard"; ownerId: string };
}

export interface WorldSnapshot {
  width: number;
  height: number;
  season: Season;
  seasonDay: number;
  dayMinute: number;
  players: PlayerState[];
  tiles: Record<string, FarmTile>;
  npcs: Array<{ id: string; name: string; x: number; y: number; friendship: number }>;
  enemies: Array<{ id: string; kind: string; x: number; y: number; health: number }>;
  homes: Array<{ id: string; ownerId: string; x: number; y: number }>;
  festival?: string;
}

export type ClientCommand =
  | { type: "ping"; clientTime: number }
  | { type: "move"; inputX: -1 | 0 | 1; inputY: -1 | 0 | 1 }
  | { type: "action"; action: ActionType; cropId?: string };

export type ServerMessage =
  | { type: "welcome"; playerId: string; sessionToken: string; roomCode: string; username: string; snapshot: WorldSnapshot }
  | { type: "state"; snapshot: WorldSnapshot }
  | { type: "actionResult"; message: string; snapshot: WorldSnapshot }
  | { type: "pong"; clientTime: number; serverTime: number }
  | { type: "error"; message: string };