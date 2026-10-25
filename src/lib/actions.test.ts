import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSessions, startBody, stopActiveCharging } from "./actions.ts";
import type { OnClient } from "./api.ts";
import { resolveConfigDir } from "./storage.ts";

const activeSession = {
	ChargePoint: { Id: 1, FriendlyCode: "IS*ONP00001" },
	Evse: { FriendlyCode: "1000" },
	Connector: { Id: 12345, Code: "1" },
	Location: { FriendlyName: "Dæmigata 1" },
};

function fakeClient(over: Record<string, unknown>): OnClient {
	return over as unknown as OnClient;
}

describe("stopActiveCharging", () => {
	test("no-op when nothing is charging", async () => {
		const client = fakeClient({ getOnlineData: async () => ({ CurrentSessions: [] }) });
		expect(await stopActiveCharging(client)).toEqual({
			stopped: false,
			reason: "no_active_session",
		});
	});

	test("sends the app's remoteStop body", async () => {
		let sent: unknown;
		const client = fakeClient({
			getOnlineData: async () => ({ CurrentSessions: [activeSession] }),
			stopCharging: async (body: unknown) => {
				sent = body;
				return { ResultCode: 0 };
			},
		});
		const res = await stopActiveCharging(client);
		expect(res).toMatchObject({ stopped: true, method: "remoteStop", where: "Dæmigata 1" });
		expect(sent).toMatchObject({ EvseCode: "IS*ONP00001-1000-1", ConnectorId: 12345 });
	});

	test("force uses connector forceStop", async () => {
		let forced: number | undefined;
		const client = fakeClient({
			getOnlineData: async () => ({ CurrentSessions: [activeSession] }),
			stopChargingForce: async (id: number) => {
				forced = id;
				return { resultCode: 0 };
			},
		});
		expect(await stopActiveCharging(client, { force: true })).toMatchObject({
			stopped: true,
			method: "forceStop",
		});
		expect(forced).toBe(12345);
	});
});

test("startBody maps CLI flags to the command body", () => {
	expect(startBody({ evse: "IS*ONP00001-1000-1", connector: 12345 })).toEqual({
		EvseCode: "IS*ONP00001-1000-1",
		ConnectorId: 12345,
		PreauthorizationId: undefined,
		CouponId: undefined,
		SocLimits: false,
	});
});

test("listSessions applies limit and keeps total", async () => {
	const client = fakeClient({
		getChargingSessions: async () => ({
			Content: [{ Id: 1 }, { Id: 2 }, { Id: 3 }],
			PagingInfo: { NumOfRows: 10 },
		}),
	});
	const out = await listSessions(client, 2);
	expect(out.total).toBe(10);
	expect(out.sessions.map((s) => s.id)).toEqual([1, 2]);
});

describe("resolveConfigDir", () => {
	test("defaults to $XDG_CONFIG_HOME/on-cli", () => {
		const base = mkdtempSync(join(tmpdir(), "on-cli-"));
		expect(resolveConfigDir({ XDG_CONFIG_HOME: base })).toBe(join(base, "on-cli"));
	});
	test("keeps using a legacy ~/.config/on with a cached session", () => {
		const base = mkdtempSync(join(tmpdir(), "on-cli-"));
		mkdirSync(join(base, "on"));
		writeFileSync(join(base, "on", "monta-auth.json"), "{}");
		expect(resolveConfigDir({ XDG_CONFIG_HOME: base })).toBe(join(base, "on"));
	});
});
