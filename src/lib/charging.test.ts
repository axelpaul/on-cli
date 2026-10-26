import { expect, test } from "bun:test";
import {
	chargeItems,
	isActiveCharge,
	liveStatus,
	onLabel,
	resolvePoint,
	startBlockers,
	startPreview,
	summarizeCharge,
} from "./charging.ts";
import type { MontaClient } from "./monta.ts";

const point = () => ({
	id: 6440032,
	name: "ON 3253-5",
	operator_name: "Orka náttúrunnar",
	available: true,
	state: "available",
	details: {
		can_start: true,
		no_cost: false,
		has_payment: false,
		has_source: false,
		team_has_fund: false,
		reserve_price: 4000,
		web_app_url: "https://web-app.monta.app?cp=6440032",
		settings: { payment: "apple" },
	},
	pricings: {
		user: {
			breakdown: [
				{ type: "fixed_kwh", current_fixed_price: 33 },
				{ type: "fee", current_fixed_price: 0.5 },
			],
		},
	},
});
test("full QR resolves a connector name, never a numeric internal ID", () => {
	expect(onLabel("IS*ONP00091-3253-5-5")).toBe("ON 3253-5");
	expect(onLabel("E3253-5")).toBe("ON 3253-5");
	expect(() => onLabel("IS*ONP00091-3253-5-6")).toThrow("differing");
	expect(() => onLabel("E3253")).toThrow();
});
test("history-backed resolution verifies the live name and operator", async () => {
	const client = {
		getCharges: async () => ({ data: [{ charge_point: point() }] }),
		getChargePoint: async (id: number) => {
			expect(id).toBe(6440032);
			return point();
		},
	} as unknown as MontaClient;
	expect((await resolvePoint(client, "ON 3253-5")).id).toBe(6440032);
	client.getChargePoint = async () => ({ ...point(), name: "Wrong connector" });
	await expect(resolvePoint(client, "ON 3253-5")).rejects.toThrow("identity");
});
test("unfamiliar connector label is an explicit failure, not a guessed ID", async () => {
	const client = { getCharges: async () => ({ data: [] }) } as unknown as MontaClient;
	await expect(resolvePoint(client, "ON 3253-5")).rejects.toThrow("Cannot uniquely resolve");
});
test("preflight exposes hold, minute fees and Apple Pay payment gap", () => {
	const preview = startPreview(point());
	expect(preview.blockers).toContain("PAYMENT_REQUIRED");
	expect(preview.reserve_isk).toBe(4000);
	expect(preview.pricing[1].current_fixed_price).toBe(0.5);
	expect(preview.checkout_url).toContain("cp=6440032");
});
test("a running charge blocks a duplicate start", () => {
	const p = { ...point(), active_charge: { state: "charging", show_active: true } };
	expect(startBlockers(p)).toContain("ACTIVE_CHARGE_EXISTS");
});
test("live status preserves exact string IDs and does not fabricate battery state", async () => {
	const charge = {
		id: 899043696223233700,
		id_str: "899043696223233671",
		state: "charging",
		kwh: 1.5,
		price: 52,
		soc: null,
		show_active: true,
		charge_point: point(),
	};
	const client = {
		getCharges: async () => ({ data: [charge, { state: "completed", show_active: false }] }),
	} as unknown as MontaClient;
	const live = await liveStatus(client);
	expect(live.current_sessions).toHaveLength(1);
	expect(live.current_sessions[0].id).toBe("899043696223233671");
	expect(live.current_sessions[0].soc_percent).toBeNull();
	expect(summarizeCharge({ id: 899043696223233700 }).id).toBeNull();
});
test("malformed charge data fails instead of reporting no active charge", () => {
	expect(() => chargeItems({})).toThrow("refusing to infer");
});

test("unvisited connector resolves through verified same-pole history group", async () => {
	const requested = {
		...point(),
		id: 6440034,
		name: "ON 3253-2",
		operator_name: "ON Power",
		charge_point_group_id: 1563258,
	};
	const client = {
		getCharges: async () => ({
			data: [{ charge_point: { ...point(), charge_point_group_id: 1563258 } }],
		}),
		getChargePoints: async (groupId: number) => {
			expect(groupId).toBe(1563258);
			return { data: [requested], meta: { pagination: { has_more: false } } };
		},
		getChargePoint: async (id: number) => {
			expect(id).toBe(6440034);
			return requested;
		},
	} as unknown as MontaClient;
	expect((await resolvePoint(client, "ON 3253-2")).id).toBe(6440034);
	client.getChargePoint = async () => ({ ...requested, operator_name: "Other operator" });
	await expect(resolvePoint(client, "ON 3253-2")).rejects.toThrow("identity");
});
test("group resolution rejects ambiguous IDs and incomplete listings", async () => {
	const requested = { ...point(), name: "ON 3253-2", charge_point_group_id: 1563258 };
	const client = {
		getCharges: async () => ({
			data: [{ charge_point: { ...point(), charge_point_group_id: 1563258 } }],
		}),
		getChargePoints: async () => ({ data: [requested, { ...requested, id: 42 }] }),
	} as unknown as MontaClient;
	await expect(resolvePoint(client, "ON 3253-2")).rejects.toThrow("Cannot uniquely resolve");
	client.getChargePoints = async () => ({
		data: [requested],
		meta: { pagination: { has_more: true } },
	});
	await expect(resolvePoint(client, "ON 3253-2")).rejects.toThrow("Incomplete");
});

test("same-name points outside the verified group are not accepted", async () => {
	const client = {
		getCharges: async () => ({
			data: [{ charge_point: { ...point(), charge_point_group_id: 1563258 } }],
		}),
		getChargePoints: async () => ({
			data: [{ ...point(), name: "ON 3253-2", charge_point_group_id: 999 }],
		}),
		getChargePoint: async () => {
			throw new Error("must not inspect unverified connector");
		},
	} as unknown as MontaClient;
	await expect(resolvePoint(client, "ON 3253-2")).rejects.toThrow("Cannot uniquely resolve");
});

test("terminal startup failure overrides stale show_active", () => {
	expect(
		isActiveCharge({
			state: "completed",
			show_active: true,
			failed_reason: "StartTransactionTimeout",
		}),
	).toBe(false);
});

test("unfamiliar full QR resolves publicly without reading account history", async () => {
	const requested = { ...point(), id: 6443187, name: "ON52431-1", operator_name: "ON Power" };
	const client = {
		resolveOnQrId: async (qr: string) => {
			expect(qr).toBe("IS*ONP00066-52431-1-1");
			return 6443187;
		},
		getCharges: async () => {
			throw new Error("must not require history");
		},
		getChargePoint: async (id: number) => {
			expect(id).toBe(6443187);
			return requested;
		},
	} as unknown as MontaClient;
	expect((await resolvePoint(client, "IS*ONP00066-52431-1-1")).id).toBe(6443187);
	for (const change of [{ id: 999 }, { name: "ON 52431-2" }, { operator_name: "Other operator" }]) {
		client.getChargePoint = async () => ({ ...requested, ...change });
		await expect(resolvePoint(client, "IS*ONP00066-52431-1-1")).rejects.toThrow("identity");
	}
});
test("public QR failure does not fall back to inferred history", async () => {
	const client = {
		resolveOnQrId: async () => {
			throw new Error("public lookup unavailable");
		},
		getCharges: async () => {
			throw new Error("must not fallback");
		},
	} as unknown as MontaClient;
	await expect(resolvePoint(client, "IS*ONP00066-52431-1-1")).rejects.toThrow(
		"public lookup unavailable",
	);
});
