// `on serve` — local MCP server over stdio.
//
// Every tool calls the same functions the CLI uses (src/lib/actions.ts,
// src/lib/monta.ts), so CLI and MCP output stay identical to `on <cmd> --json`.
// Writes (start/stop charging) are only registered when ON_MCP_ENABLE_WRITES=1
// and additionally require `confirm: true` in the tool input.
// Nothing here writes to stdout except the MCP protocol itself.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import pkg from "../../package.json" with { type: "json" };
import {
	DEFAULT_LAT,
	DEFAULT_LNG,
	DEFAULT_RADIUS_KM,
	findLocations,
	getAccount,
	getSession,
	listInvoices,
	listKeys,
	listSessions,
	listVehicles,
	liveStatus,
	startCharging,
	stopActiveCharging,
} from "../lib/actions.ts";
import { MontaClient } from "../lib/monta.ts";
import { publicClient, requireClient } from "../lib/session.ts";
import { loadMontaAuth } from "../lib/storage.ts";

export const WRITES_ENV = "ON_MCP_ENABLE_WRITES";

export function writesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return env[WRITES_ENV] === "1";
}

const result = (data: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(data) }],
});
const failure = (value: unknown) => ({
	isError: true,
	content: [
		{ type: "text" as const, text: value instanceof Error ? value.message : "ON request failed." },
	],
});

async function run(fn: () => Promise<unknown>) {
	try {
		return result(await fn());
	} catch (e) {
		return failure(e);
	}
}

function montaClient(): MontaClient {
	const auth = loadMontaAuth();
	if (!auth?.accessToken) throw new Error('Monta login required. Run "on monta-login" locally.');
	return new MontaClient(auth);
}

const LEGACY =
	" Uses the legacy Dusky backend (app.on.is, `on login` session); ON has moved to Monta, so this may fail — prefer the monta_* tools.";

const limit = (def: number) =>
	z.number().int().min(0).max(500).optional().describe(`Max rows to return (default ${def}).`);

export function createServer(env: NodeJS.ProcessEnv = process.env): McpServer {
	const server = new McpServer({ name: "on", version: pkg.version });

	// --- Monta (current ON backend), read-only ------------------------------

	server.registerTool(
		"monta_account",
		{
			description:
				"Read the signed-in ON/Monta account (id, name, email). Needs a cached `on monta-login` session.",
			inputSchema: {},
		},
		() =>
			run(async () => {
				const me = await montaClient().getMe();
				return { id: me.id ?? null, name: me.display_name ?? null, email: me.email ?? null };
			}),
	);
	server.registerTool(
		"monta_vehicles",
		{
			description: "Read vehicles from the signed-in ON/Monta account (raw Monta JSON).",
			inputSchema: {},
		},
		() => run(() => montaClient().getVehicles()),
	);
	server.registerTool(
		"monta_charges",
		{ description: "Read ON/Monta charge history (raw Monta JSON).", inputSchema: {} },
		() => run(() => montaClient().getCharges()),
	);
	server.registerTool(
		"monta_charge_points",
		{
			description: "Read ON/Monta charge points linked to the account (raw Monta JSON).",
			inputSchema: {},
		},
		() => run(() => montaClient().getChargePoints()),
	);

	// --- Legacy Dusky backend, read-only -------------------------------------

	server.registerTool(
		"whoami",
		{
			description: `The logged-in ON user (same as \`on whoami --json\`).${LEGACY}`,
			inputSchema: {},
		},
		() => run(() => getAccount(requireClient())),
	);
	server.registerTool(
		"vehicles",
		{
			description: `Vehicles on the ON account (\`on vehicles --json\`).${LEGACY}`,
			inputSchema: {},
		},
		() => run(() => listVehicles(requireClient())),
	);
	server.registerTool(
		"sessions",
		{
			description: `Charging session history, newest first (\`on sessions --json\`).${LEGACY}`,
			inputSchema: { limit: limit(20) },
		},
		({ limit }) => run(() => listSessions(requireClient(), limit ?? 20)),
	);
	server.registerTool(
		"session",
		{
			description: `One charging session by id (\`on sessions --id <id> --json\`).${LEGACY}`,
			inputSchema: { id: z.string().min(1).describe("Charging session id.") },
		},
		({ id }) => run(() => getSession(requireClient(), id)),
	);
	server.registerTool(
		"live",
		{
			description: `Current charging status: active sessions, reservations, coupons, unpaid-invoice count (\`on live --json\`).${LEGACY}`,
			inputSchema: {},
		},
		() => run(() => liveStatus(requireClient())),
	);
	server.registerTool(
		"keys",
		{
			description: `RFID charging keys/cards on the account (\`on keys --json\`).${LEGACY}`,
			inputSchema: {},
		},
		() => run(() => listKeys(requireClient())),
	);
	server.registerTool(
		"invoices",
		{
			description: `Invoices, most recent first (\`on invoices --json\`).${LEGACY}`,
			inputSchema: { limit: limit(20) },
		},
		({ limit }) => run(() => listInvoices(requireClient(), limit ?? 20)),
	);
	server.registerTool(
		"locations",
		{
			description: `Find charging locations near a point; no login needed. Defaults to central Reykjavík (\`on locations --json\`).${LEGACY}`,
			inputSchema: {
				lat: z.number().min(-90).max(90).optional().describe(`Latitude (default ${DEFAULT_LAT}).`),
				lng: z
					.number()
					.min(-180)
					.max(180)
					.optional()
					.describe(`Longitude (default ${DEFAULT_LNG}).`),
				radius: z
					.number()
					.positive()
					.optional()
					.describe(`Search radius in km (default ${DEFAULT_RADIUS_KM}).`),
				available: z.boolean().optional().describe("Only locations with a free EVSE right now."),
				free: z.boolean().optional().describe("Only free-of-charge locations."),
				limit: limit(25),
			},
		},
		({ lat, lng, radius, available, free, limit }) =>
			run(() =>
				findLocations(
					publicClient(),
					{
						lat: lat ?? DEFAULT_LAT,
						lng: lng ?? DEFAULT_LNG,
						radius: radius ?? DEFAULT_RADIUS_KM,
						available,
						free,
					},
					limit ?? 25,
				),
			),
	);

	// --- Writes (opt-in) ------------------------------------------------------

	if (writesEnabled(env)) {
		const confirm = z
			.literal(true)
			.describe("Must be true. Only set after the user explicitly asked for this action.");

		server.registerTool(
			"stop_charging",
			{
				description: `MUTATING: stop the active charging session (\`on stop --yes\`). No-op if nothing is charging. Set force=true for a connector-level force stop (used automatically for roaming sessions).${LEGACY}`,
				inputSchema: {
					force: z.boolean().optional().describe("Force-stop by connector (`--force`)."),
					confirm,
				},
			},
			({ force }) => run(() => stopActiveCharging(requireClient(), { force })),
		);
		server.registerTool(
			"start_charging",
			{
				description: `MUTATING: start charging at a specific EVSE/connector (\`on start --yes\`). Only use when the user gave the charger's EVSE code and connector id.${LEGACY}`,
				inputSchema: {
					evse: z
						.string()
						.min(1)
						.describe("EvseCode, format chargePointCode-evseCode-connectorCode."),
					connector: z.number().int().describe("Connector id."),
					preauth: z.number().int().optional().describe("Pre-authorization id (`--preauth`)."),
					coupon: z.number().int().optional().describe("Coupon id (`--coupon`)."),
					confirm,
				},
			},
			({ evse, connector, preauth, coupon }) =>
				run(() => startCharging(requireClient(), { evse, connector, preauth, coupon })),
		);
	}

	return server;
}

export async function serve(): Promise<void> {
	await createServer().connect(new StdioServerTransport());
}
