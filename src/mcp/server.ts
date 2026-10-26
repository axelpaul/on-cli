import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
	approvedStart,
	approvedStop,
	liveStatus,
	resolvePoint,
	startPreview,
} from "../lib/charging.ts";
import { MontaClient } from "../lib/monta.ts";
import { loadMontaAuth } from "../lib/storage.ts";

const server = new McpServer({ name: "on", version: "0.2.0" });
const result = (data: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(data) }],
});
const error = (value: unknown) => ({
	isError: true,
	content: [
		{ type: "text" as const, text: value instanceof Error ? value.message : "ON lookup failed." },
	],
});

function montaClient(): MontaClient {
	const auth = loadMontaAuth();
	if (!auth?.accessToken) throw new Error('Monta login required. Run "on monta-login" locally.');
	return new MontaClient(auth);
}

server.registerTool(
	"monta_account",
	{
		description:
			"Read the signed-in ON/Monta account. Uses a local cached session; never logs in or changes charging.",
		inputSchema: {},
	},
	async () => {
		try {
			const me = await montaClient().getMe();
			return result({ id: me.id ?? null, name: me.display_name ?? null, email: me.email ?? null });
		} catch (e) {
			return error(e);
		}
	},
);

server.registerTool(
	"monta_vehicles",
	{
		description: "Read vehicles from the signed-in ON/Monta account. Does not change charging.",
		inputSchema: {},
	},
	async () => {
		try {
			return result(await montaClient().getVehicles());
		} catch (e) {
			return error(e);
		}
	},
);

server.registerTool(
	"monta_charges",
	{
		description: "Read ON/Monta charge history. Does not change charging.",
		inputSchema: {},
	},
	async () => {
		try {
			return result(await montaClient().getCharges());
		} catch (e) {
			return error(e);
		}
	},
);

server.registerTool(
	"monta_charge_points",
	{
		description: "Read ON/Monta charge points. Does not change charging.",
		inputSchema: {},
	},
	async () => {
		try {
			return result(await montaClient().getChargePoints());
		} catch (e) {
			return error(e);
		}
	},
);

server.registerTool(
	"charging_status",
	{
		description:
			"Read active ON charging with exact session IDs, kWh and costs; never starts/stops charging.",
		inputSchema: {},
	},
	async () => {
		try {
			return result(await liveStatus(montaClient()));
		} catch (e) {
			return error(e);
		}
	},
);
server.registerTool(
	"charge_preview",
	{
		description:
			"Read charger identity, tariff, hold and payment blockers. Full ON QR codes resolve unfamiliar locations via the public ON resolver and live identity validation; plain labels use history/group lookup. Never starts a charge.",
		inputSchema: { charger: z.string() },
	},
	async ({ charger }) => {
		try {
			return result(startPreview(await resolvePoint(montaClient(), charger)));
		} catch (e) {
			return error(e);
		}
	},
);

if (process.env.ON_MCP_ENABLE_WRITES === "1") {
	server.registerTool(
		"charge_start",
		{
			description:
				"Start an exact Monta charge point after live preflight. Requires confirm=true. Free charging and the verified server-default saved-card route are supported; interactive payment routes refuse. No retry.",
			inputSchema: {
				chargePointId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
				confirm: z.boolean(),
			},
		},
		async ({ chargePointId, confirm }) => {
			try {
				return result(await approvedStart(montaClient, chargePointId, confirm, true));
			} catch (e) {
				return error(e);
			}
		},
	);
	server.registerTool(
		"charge_stop",
		{
			description:
				"Stop an exact active stoppable Monta session ID. Requires confirm=true. No retired Dusky fallback and no automatic retry.",
			inputSchema: { sessionId: z.string().regex(/^[1-9]\d*$/), confirm: z.boolean() },
		},
		async ({ sessionId, confirm }) => {
			try {
				return result(await approvedStop(montaClient, sessionId, confirm, true));
			} catch (e) {
				return error(e);
			}
		},
	);
}

export async function serve(): Promise<void> {
	await server.connect(new StdioServerTransport());
}
