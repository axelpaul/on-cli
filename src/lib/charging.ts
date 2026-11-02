import type { MontaClient } from "./monta.ts";

export type JsonObject = Record<string, any>;
export function record(value: unknown): JsonObject {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Unexpected Monta response: expected object");
	return value as JsonObject;
}
export function chargeItems(value: unknown): JsonObject[] {
	const envelope = record(value);
	if (!Array.isArray(envelope.data))
		throw new Error("Unexpected Monta charge list; refusing to infer no active sessions");
	return envelope.data.map(record);
}
export function isActiveCharge(c: JsonObject): boolean {
	// The API can leave show_active=true on a completed startup failure.
	if (["completed", "failed", "cancelled", "canceled"].includes(c.state)) return false;
	return (
		c.show_active === true ||
		["starting", "charging", "stopping", "reserved", "scheduled", "releasing"].includes(c.state)
	);
}
export function summarizeCharge(c: JsonObject): JsonObject {
	const point = c.charge_point ?? {};
	return {
		id: c.id_str ?? (Number.isSafeInteger(c.id) ? String(c.id) : null),
		state: c.state,
		charge_point_id: point.id ?? null,
		name: point.name ?? null,
		address: point.address ?? null,
		started_at: c.charging_at ?? c.starting_at ?? null,
		kwh: c.kwh ?? null,
		cost_isk: c.price ?? null,
		soc_percent: c.soc ?? null,
		can_stop: c.can_stop === true,
		pricing: c.pricing?.breakdown ?? [],
		payment_method: c.payment_method_type ?? null,
	};
}
export async function liveStatus(client: MontaClient): Promise<JsonObject> {
	const charges = chargeItems(await client.getCharges());
	return {
		backend: "monta",
		checked_at: new Date().toISOString(),
		current_sessions: charges.filter(isActiveCharge).map(summarizeCharge),
		scope: "latest account charge page",
	};
}

/** Parse the label as a name, NEVER treat printed numbers as internal IDs. */
export function onLabel(input: string): string {
	const q = input.trim().toUpperCase();
	const qr = /^IS\*ONP\d+-(\d+)-(\d+)-(\d+)$/.exec(q);
	if (qr) {
		if (qr[2] !== qr[3])
			throw new Error("QR has differing EVSE and connector labels; manual resolution required");
		return `ON ${qr[1]}-${qr[2]}`;
	}
	const label = /^(?:ON\s+|E)?(\d+)-(\d+)$/.exec(q);
	if (label) return `ON ${label[1]}-${label[2]}`;
	throw new Error("Supply the complete ON QR or connector label, e.g. ON 3253-5");
}
function normalizeOnName(name: unknown): string {
	return typeof name === "string" ? name.toUpperCase().replace(/\s+/g, "") : "";
}
export async function resolvePoint(client: MontaClient, query: string): Promise<JsonObject> {
	if (/^\d+$/.test(query)) return record(await client.getChargePoint(Number(query)));
	const name = onLabel(query);
	if (/^IS\*ONP/i.test(query.trim())) {
		const id = await client.resolveOnQrId(query);
		const point = record(await client.getChargePoint(id));
		if (
			point.id !== id ||
			normalizeOnName(point.name) !== normalizeOnName(name) ||
			!["Orka náttúrunnar", "ON Power"].includes(point.operator_name)
		)
			throw new Error("Live charger identity does not match the QR label");
		return point;
	}
	const history = chargeItems(await client.getCharges())
		.map((c) => c.charge_point)
		.filter((p) => p && ["Orka náttúrunnar", "ON Power"].includes(p.operator_name));
	const matches = history.filter((p) => p.name?.toUpperCase() === name);
	// The app's charge-point list supports exact group filtering. A previously
	// visited connector identifies a group, not the unvisited connector's ID.
	// Only inspect groups with the same printed pole prefix; verify live detail below.
	if (!matches.length) {
		const polePrefix = name.slice(0, name.lastIndexOf("-") + 1);
		const groupIds = [
			...new Set(
				history
					.filter((p) => p.name?.toUpperCase().startsWith(polePrefix))
					.map((p) => p.charge_point_group_id)
					.filter((id) => Number.isSafeInteger(id) && id > 0),
			),
		];
		for (const groupId of groupIds) {
			const listing = record(await client.getChargePoints(groupId));
			if (listing.meta?.pagination?.has_more === true)
				throw new Error("Incomplete charger group listing; no start request sent");
			matches.push(
				...chargeItems(listing).filter(
					(p) => p.charge_point_group_id === groupId && p.name?.toUpperCase() === name,
				),
			);
		}
	}
	const ids = [...new Set(matches.map((p) => p.id))];
	if (ids.length !== 1 || !Number.isSafeInteger(ids[0]) || ids[0] <= 0)
		throw new Error(
			`Cannot uniquely resolve ${name} from account history or verified charger groups. No start request sent. Unknown/new locations still require public discovery.`,
		);
	const point = record(await client.getChargePoint(ids[0]));
	if (
		point.name?.toUpperCase() !== name ||
		!["Orka náttúrunnar", "ON Power"].includes(point.operator_name)
	)
		throw new Error("Live charger identity does not match the label");
	return point;
}
export function startBlockers(point: JsonObject): string[] {
	const d = record(point.details);
	const blockers: string[] = [];
	if (point.active_charge && isActiveCharge(record(point.active_charge)))
		blockers.push("ACTIVE_CHARGE_EXISTS");
	if (point.available !== true || d.can_start !== true)
		blockers.push(d.can_start_reason ?? "CHARGER_NOT_READY");
	if (
		d.no_cost !== true &&
		d.has_payment !== true &&
		d.team_has_fund !== true &&
		d.has_source !== true
	)
		blockers.push("PAYMENT_REQUIRED");
	return [...new Set(blockers)];
}
/** Server-default saved-card path live-proved on ON 3253-2, 2026-10-21.
 * UI settings may still say apple; details.payment_method is the server payment route.
 * Do not synthesize Stripe intents or reuse Apple Pay authorizations.
 */
export function startPaymentSupported(point: JsonObject): boolean {
	const d = record(point.details);
	return (
		d.no_cost === true ||
		(d.payment_method === "source" &&
			d.payment_method_type === "team-wallet" &&
			d.has_source === true &&
			d.has_payment === true)
	);
}

export function startPreview(point: JsonObject): JsonObject {
	const d = record(point.details);
	return {
		backend: "monta",
		dry_run: true,
		charge_point: { id: point.id, name: point.name, address: point.address, state: point.state },
		pricing: point.pricings?.user?.breakdown ?? point.pricings?.public?.breakdown ?? [],
		reserve_isk: d.reserve_price ?? null,
		blockers: startBlockers(point),
		payment: {
			no_cost: d.no_cost === true,
			has_payment: d.has_payment === true,
			has_saved_source: d.has_source === true,
			wallet_funded: d.team_has_fund === true,
			selected: d.settings?.payment ?? null,
			server_method: d.payment_method ?? null,
			server_type: d.payment_method_type ?? null,
			unattended_supported: startPaymentSupported(point),
		},
		checkout_url: d.web_app_url ?? null,
		execution_verified: false,
	};
}

/** Explicit write boundary shared by MCP adapters; factory remains lazy on refusal. */
export async function approvedStart(
	makeClient: () => MontaClient,
	id: number,
	confirm: boolean,
	enabled: boolean,
): Promise<JsonObject> {
	if (!enabled || confirm !== true)
		throw new Error("Charging writes require opt-in and confirm=true");
	if (!Number.isSafeInteger(id) || id <= 0)
		throw new Error("Exact positive charge point ID required");
	const client = makeClient();
	const point = record(await client.getChargePoint(id));
	if (point.id !== id) throw new Error("Charge point identity mismatch");
	const blockers = startBlockers(point);
	if (blockers.length)
		return { ...startPreview(point), refused: true, reason: blockers.join(", ") };
	if (!startPaymentSupported(point))
		return { ...startPreview(point), refused: true, reason: "INTERACTIVE_PAYMENT_REQUIRED" };
	return {
		backend: "monta",
		command_sent: true,
		charging_verified: false,
		result: await client.startCharge(id),
	};
}

export async function approvedStop(
	makeClient: () => MontaClient,
	sessionId: string,
	confirm: boolean,
	enabled: boolean,
): Promise<JsonObject> {
	if (!enabled || confirm !== true)
		throw new Error("Charging writes require opt-in and confirm=true");
	if (!/^[1-9]\d*$/.test(sessionId)) throw new Error("Exact positive session ID required");
	const client = makeClient();
	const matches = chargeItems(await client.getCharges()).filter(
		(c) => (c.id_str ?? (Number.isSafeInteger(c.id) ? String(c.id) : null)) === sessionId,
	);
	const session = matches[0];
	if (matches.length !== 1 || !session || !isActiveCharge(session) || session.can_stop !== true)
		throw new Error(
			"Exact active stoppable session not found in current account page; no stop sent",
		);
	return {
		backend: "monta",
		command_sent: true,
		stopped_verified: false,
		result: await client.stopCharge(sessionId),
	};
}
