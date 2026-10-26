import { expect, test } from "bun:test";
import { approvedStart, approvedStop } from "./charging.ts";
import type { MontaClient } from "./monta.ts";

test("control refusals never construct an API client", async () => {
	let calls = 0;
	const client = () => {
		calls++;
		throw new Error("unexpected");
	};
	await expect(approvedStart(client, 1, true, false)).rejects.toThrow("opt-in");
	await expect(approvedStart(client, 1, false, true)).rejects.toThrow("confirm");
	await expect(approvedStart(client, 0, true, true)).rejects.toThrow("ID");
	await expect(approvedStop(client, "1", false, true)).rejects.toThrow("confirm");
	await expect(approvedStop(client, "1", true, false)).rejects.toThrow("opt-in");
	await expect(approvedStop(client, "fuzzy", true, true)).rejects.toThrow("ID");
	expect(calls).toBe(0);
});
test("payment presence is not payment authorization; only free fixture starts", async () => {
	let writes = 0;
	let free = false;
	const client = {
		getChargePoint: async () => ({
			id: 1,
			available: true,
			details: { can_start: true, has_payment: true, no_cost: free },
		}),
		startCharge: async () => {
			writes++;
			return {};
		},
	} as unknown as MontaClient;
	expect((await approvedStart(() => client, 1, true, true)).reason).toBe(
		"INTERACTIVE_PAYMENT_REQUIRED",
	);
	expect(writes).toBe(0);
	free = true;
	expect((await approvedStart(() => client, 1, true, true)).command_sent).toBe(true);
	expect(writes).toBe(1);
});
test("stop only exact active stoppable session; mock never contacts Monta", async () => {
	let writes = 0;
	let active = false;
	const client = {
		getCharges: async () => ({
			data: [
				{ id_str: "90071992547409999", state: active ? "charging" : "completed", can_stop: true },
			],
		}),
		stopCharge: async (id: string) => {
			writes++;
			return { id };
		},
	} as unknown as MontaClient;
	await expect(approvedStop(() => client, "1", true, true)).rejects.toThrow("not found");
	await expect(approvedStop(() => client, "90071992547409999", true, true)).rejects.toThrow(
		"not found",
	);
	expect(writes).toBe(0);
	active = true;
	expect((await approvedStop(() => client, "90071992547409999", true, true)).command_sent).toBe(
		true,
	);
	expect(writes).toBe(1);
});

test("server-default saved card starts despite stale Apple UI setting; unrelated routes refuse", async () => {
	let writes = 0;
	const details = {
		can_start: true,
		has_payment: true,
		has_source: true,
		no_cost: false,
		payment_method: "source",
		payment_method_type: "team-wallet",
		settings: { payment: "apple" },
	};
	const client = {
		getChargePoint: async () => ({ id: 1, available: true, details }),
		startCharge: async () => {
			writes++;
			return { state: "starting" };
		},
	} as unknown as MontaClient;
	expect((await approvedStart(() => client, 1, true, true)).command_sent).toBe(true);
	expect(writes).toBe(1);
	details.payment_method = "apple";
	expect((await approvedStart(() => client, 1, true, true)).reason).toBe(
		"INTERACTIVE_PAYMENT_REQUIRED",
	);
	expect(writes).toBe(1);
	details.payment_method = "source";
	details.has_source = false;
	expect((await approvedStart(() => client, 1, true, true)).refused).toBe(true);
	expect(writes).toBe(1);
});
