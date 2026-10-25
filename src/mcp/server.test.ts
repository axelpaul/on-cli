import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./server.ts";

const READ_TOOLS = [
	"invoices",
	"keys",
	"live",
	"locations",
	"monta_account",
	"monta_charge_points",
	"monta_charges",
	"monta_vehicles",
	"session",
	"sessions",
	"vehicles",
	"whoami",
];

async function connect(env: NodeJS.ProcessEnv): Promise<Client> {
	const [clientT, serverT] = InMemoryTransport.createLinkedPair();
	await createServer(env).connect(serverT);
	const client = new Client({ name: "on-test", version: "0.0.0" });
	await client.connect(clientT);
	return client;
}

test("read tools only, without ON_MCP_ENABLE_WRITES", async () => {
	const client = await connect({});
	const names = (await client.listTools()).tools.map((t) => t.name).sort();
	expect(names).toEqual(READ_TOOLS);
	await client.close();
});

test("write tools appear with ON_MCP_ENABLE_WRITES=1 and require confirm", async () => {
	const client = await connect({ ON_MCP_ENABLE_WRITES: "1" });
	const tools = (await client.listTools()).tools;
	expect(tools.map((t) => t.name).sort()).toEqual(
		[...READ_TOOLS, "start_charging", "stop_charging"].sort(),
	);
	const stop = tools.find((t) => t.name === "stop_charging");
	expect(stop?.inputSchema.required).toContain("confirm");
	const res = await client.callTool({ name: "stop_charging", arguments: { confirm: false } });
	expect(res.isError).toBe(true);
	await client.close();
});

test("`on serve` speaks MCP over stdio", async () => {
	const client = new Client({ name: "on-test", version: "0.0.0" });
	try {
		await client.connect(
			new StdioClientTransport({
				command: process.execPath,
				args: ["src/index.ts", "serve"],
				cwd: process.cwd(),
				env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
				stderr: "pipe",
			}),
		);
		const names = (await client.listTools()).tools.map((t) => t.name);
		expect(names).toContain("monta_charges");
		expect(names).not.toContain("stop_charging");
	} finally {
		await client.close();
	}
});
