// Auth + config persistence with 0600 perms.
// Location: $XDG_CONFIG_HOME/on-cli/ (default ~/.config/on-cli/). Older installs
// used ~/.config/on/; that directory is still used if it exists and the new one doesn't.

import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AuthState, UserConfig } from "./types.ts";

export function resolveConfigDir(env: NodeJS.ProcessEnv = process.env): string {
	const base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
	const dir = join(base, "on-cli");
	const legacy = join(base, "on");
	if (!existsSync(dir) && existsSync(join(legacy, "auth.json"))) return legacy;
	if (!existsSync(dir) && existsSync(join(legacy, "monta-auth.json"))) return legacy;
	return dir;
}

const CONFIG_DIR = resolveConfigDir();
const AUTH_PATH = join(CONFIG_DIR, "auth.json");
const MONTA_AUTH_PATH = join(CONFIG_DIR, "monta-auth.json");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

function ensureDir(): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
	}
}

/** Atomic, 0600-permissioned write: write to a sibling .tmp file, then rename.
 * A crash mid-write leaves the previous file intact rather than truncated. */
function writeSecure(path: string, data: unknown): void {
	ensureDir();
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
	chmodSync(tmp, 0o600); // mode option is ignored if tmp pre-existed
	renameSync(tmp, path);
}

function readJson<T>(path: string): T | null {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return null;
	}
}

export function saveAuth(state: AuthState): void {
	writeSecure(AUTH_PATH, state);
}

export function loadAuth(): AuthState | null {
	return readJson<AuthState>(AUTH_PATH);
}

export interface MontaAuthState {
	accessToken: string;
	uuid: string;
	loggedInAt: string;
}

/** Kept separate from the retired Dusky auth cache. */
export function saveMontaAuth(state: MontaAuthState): void {
	writeSecure(MONTA_AUTH_PATH, state);
}

export function loadMontaAuth(): MontaAuthState | null {
	return readJson<MontaAuthState>(MONTA_AUTH_PATH);
}

export function clearAuth(): void {
	if (existsSync(AUTH_PATH)) unlinkSync(AUTH_PATH);
}

export function saveConfig(cfg: UserConfig): void {
	writeSecure(CONFIG_PATH, cfg);
}

export function loadConfig(): UserConfig {
	return readJson<UserConfig>(CONFIG_PATH) ?? {};
}

export const paths = {
	dir: CONFIG_DIR,
	auth: AUTH_PATH,
	montaAuth: MONTA_AUTH_PATH,
	config: CONFIG_PATH,
};
