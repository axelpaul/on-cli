import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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

export async function serve(): Promise<void> {
	await server.connect(new StdioServerTransport());
}
