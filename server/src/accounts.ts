import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const accountPath = process.env.ACCOUNT_SAVE_PATH ?? fileURLToPath(new URL("../save-data/accounts.json", import.meta.url));
const sessions = new Map<string, Account>();

interface Account {
  id: string;
  username: string;
  salt: string;
  passwordHash: string;
  playerId?: string;
}

interface AccountFile {
  version: 1;
  accounts: Account[];
}

export interface PublicAccount {
  id: string;
  username: string;
  playerId?: string;
}

export async function loadAccounts(): Promise<AccountFile> {
  try {
    const file = JSON.parse(await readFile(accountPath, "utf8")) as AccountFile;
    if (file.version !== 1 || !Array.isArray(file.accounts)) throw new Error("Invalid account file");
    return file;
  } catch {
    return { version: 1, accounts: [] };
  }
}

export async function saveAccounts(file: AccountFile): Promise<void> {
  await mkdir(dirname(accountPath), { recursive: true });
  const temporaryPath = `${accountPath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(file, null, 2));
  await rename(temporaryPath, accountPath);
}

export async function registerAccount(file: AccountFile, username: string, password: string): Promise<{ account: PublicAccount; token: string }> {
  const normalizedUsername = normalizeUsername(username);
  validateCredentials(normalizedUsername, password);
  if (file.accounts.some((account) => account.username === normalizedUsername)) throw new Error("That username is already registered.");
  const salt = randomBytes(16).toString("hex");
  const account: Account = { id: randomUUID(), username: normalizedUsername, salt, passwordHash: hashPassword(password, salt) };
  file.accounts.push(account);
  await saveAccounts(file);
  return createSession(account);
}

export function loginAccount(file: AccountFile, username: string, password: string): { account: PublicAccount; token: string } {
  const account = file.accounts.find((candidate) => candidate.username === normalizeUsername(username));
  if (!account || !safePasswordMatch(password, account)) throw new Error("Username or password is incorrect.");
  return createSession(account);
}

export function getSession(token: string | null): Account | undefined {
  return token ? sessions.get(token) : undefined;
}

export function linkPlayer(account: Account, playerId: string): void {
  account.playerId = playerId;
}

export function toPublicAccount(account: Account): PublicAccount {
  return { id: account.id, username: account.username, ...(account.playerId ? { playerId: account.playerId } : {}) };
}

function createSession(account: Account): { account: PublicAccount; token: string } {
  const token = randomUUID();
  sessions.set(token, account);
  return { account: toPublicAccount(account), token };
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function validateCredentials(username: string, password: string): void {
  if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error("Username must be 3-24 letters, numbers, or underscores.");
  if (password.length < 8 || password.length > 128) throw new Error("Password must be 8-128 characters.");
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

function safePasswordMatch(password: string, account: Account): boolean {
  const actual = Buffer.from(hashPassword(password, account.salt), "hex");
  const expected = Buffer.from(account.passwordHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}