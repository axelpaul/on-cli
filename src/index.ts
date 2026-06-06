#!/usr/bin/env bun

// on — CLI for the ON (Orka náttúrunnar) EV-charging app.

import pkg from "../package.json" with { type: "json" };
import { doctorCommand } from "./commands/doctor.ts";
import { invoicesCommand } from "./commands/invoices.ts";
import { keysCommand } from "./commands/keys.ts";
import { liveCommand } from "./commands/live.ts";
import { locationsCommand } from "./commands/locations.ts";
import { loginCommand } from "./commands/login.ts";
import { logoutCommand } from "./commands/logout.ts";
import { schemaCommand } from "./commands/schema.ts";
import { sessionsCommand } from "./commands/sessions.ts";
import { vehiclesCommand } from "./commands/vehicles.ts";
import { whoamiCommand } from "./commands/whoami.ts";
import { ApiError, AuthError } from "./lib/api.ts";
import { color, dieAuth } from "./lib/output.ts";

export const VERSION = pkg.version;

// --- arg parsing ----------------------------------------------------------

function getFlag(name: string): string | undefined {
	const argv = process.argv;
	const prefix = `--${name}=`;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a) continue;
		if (a === `--${name}`) return argv[i + 1];
		if (a.startsWith(prefix)) return a.slice(prefix.length);
	}
	return undefined;
}

function hasFlag(name: string): boolean {
	const argv = process.argv;
	const prefix = `--${name}=`;
	return argv.includes(`--${name}`) || argv.some((a) => a.startsWith(prefix));
}

const positional = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const command = positional[0];

const globalFlags = {
	json: hasFlag("json"),
	pretty: hasFlag("pretty"),
};

if (hasFlag("version") || command === "version") {
	if (globalFlags.json) console.log(JSON.stringify({ version: VERSION, name: pkg.name }));
	else console.log(`on ${VERSION}`);
	process.exit(0);
}

// --- help -----------------------------------------------------------------

interface CommandSpec {
	name: string;
	description: string;
	usage?: string;
}

const COMMANDS: CommandSpec[] = [
	{
		name: "login",
		description: "Authenticate with ON email + password (or $ON_USER / $ON_PW).",
		usage: "on login [--email <e>] [--password <p>]",
	},
	{ name: "logout", description: "Clear the local session." },
	{ name: "whoami", description: "Show the logged-in user." },
	{ name: "vehicles", description: "List the vehicles on your account." },
	{
		name: "sessions",
		description: "Charging session history. Use --id <n> for one session in full.",
		usage: "on sessions [--limit N] [--id <session_id>]",
	},
	{
		name: "live",
		description: "Current charging status: active sessions, reservations, counters.",
	},
	{ name: "keys", description: "Your ON RFID charging keys/cards." },
	{
		name: "invoices",
		description: "Your invoices (most recent first).",
		usage: "on invoices [--limit N]",
	},
	{
		name: "locations",
		description: "Find charging locations near a point (public). Defaults to Reykjavík.",
		usage: "on locations [--lat <n>] [--lng <n>] [--radius KM] [--available] [--free] [--limit N]",
	},
	{ name: "doctor", description: "Pre-flight check: auth, token expiry, API reachable." },
	{
		name: "schema",
		description: "Print the JSON response shape of a command. Agent hook.",
		usage: "on schema [<command>]",
	},
	{ name: "version", description: "Print the CLI version." },
];

function printHelp(): void {
	if (globalFlags.json) {
		console.log(
			JSON.stringify(
				{ commands: COMMANDS, global_flags: ["--json", "--pretty", "--raw"] },
				null,
				2,
			),
		);
		return;
	}
	console.log(`${color.bold("on")} — ON (Orka náttúrunnar) charging from the terminal`);
	console.log("");
	console.log("Commands:");
	for (const c of COMMANDS) {
		console.log(`  ${color.bold(c.name.padEnd(10))} ${c.description}`);
	}
	console.log("");
	console.log(
		`Global: ${color.dim("--json")} (machine output), ${color.dim("--pretty")} (force human), ${color.dim("--raw")} (raw API envelope)`,
	);
}

// --- dispatch -------------------------------------------------------------

async function main(): Promise<void> {
	if (!command || command === "help" || hasFlag("help")) {
		printHelp();
		return;
	}

	const raw = hasFlag("raw");

	switch (command) {
		case "login":
			return loginCommand({
				email: getFlag("email"),
				password: getFlag("password"),
				...globalFlags,
			});
		case "logout":
			return logoutCommand(globalFlags);
		case "whoami":
			return whoamiCommand({ raw, ...globalFlags });
		case "vehicles":
			return vehiclesCommand({ raw, ...globalFlags });
		case "sessions":
			return sessionsCommand({ id: getFlag("id"), limit: getFlag("limit"), raw, ...globalFlags });
		case "live":
			return liveCommand({ raw, ...globalFlags });
		case "keys":
			return keysCommand({ raw, ...globalFlags });
		case "invoices":
			return invoicesCommand({ limit: getFlag("limit"), raw, ...globalFlags });
		case "locations":
			return locationsCommand({
				lat: getFlag("lat"),
				lng: getFlag("lng"),
				radius: getFlag("radius"),
				available: hasFlag("available"),
				free: hasFlag("free"),
				limit: getFlag("limit"),
				raw,
				...globalFlags,
			});
		case "doctor":
			return doctorCommand(globalFlags);
		case "schema":
			return schemaCommand({ command: positional[1], ...globalFlags });
		default:
			console.error(color.red(`Unknown command: ${command}`));
			console.error(`Run ${color.bold("on help")}.`);
			process.exit(64);
	}
}

main().catch((err: unknown) => {
	if (err instanceof AuthError) dieAuth("expired", globalFlags.json);
	const msg = err instanceof Error ? err.message : String(err);
	if (globalFlags.json) {
		const status = err instanceof ApiError ? err.status : undefined;
		console.error(JSON.stringify({ error: msg, status }));
	} else {
		console.error(color.red(`Error: ${msg}`));
	}
	process.exit(1);
});
