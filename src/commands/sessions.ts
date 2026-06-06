// on sessions — charging session history (most recent first).
// `on sessions --id <n>` shows a single session in full.

import { AuthError, paged } from "../lib/api.ts";
import { addressLine, dateTime, duration, kwh, money } from "../lib/format.ts";
import { color, dieAuth, isJsonMode, printJson } from "../lib/output.ts";
import { authedClient } from "../lib/session.ts";
import type { ChargingSession } from "../lib/types.ts";

interface SessionsFlags {
	id?: string;
	limit?: string;
	json?: boolean;
	pretty?: boolean;
	raw?: boolean;
}

function summarize(s: ChargingSession) {
	return {
		id: s.Id,
		number: s.Number ?? null,
		location: s.Location?.FriendlyName ?? s.Location?.FriendlyCode ?? null,
		address: addressLine(s.Location?.Address),
		connected_from: s.ConnectedFrom ?? null,
		connected_to: s.ConnectedTo ?? null,
		charging_from: s.ChargingFrom ?? null,
		charging_to: s.ChargingTo ?? null,
		energy_kwh: s.ActiveEnergyConsumption ?? null,
		max_power_kw: s.MaxActivePower ?? null,
		cost: s.TotalCosts ?? null,
		currency: s.CurrencyCode ?? null,
		connector: s.Connector?.Type?.Title ?? null,
		green_energy: s.SuppliedByGreenEnergy ?? null,
		co2_saving_kg: s.CO2Saving ?? null,
	};
}

export async function sessionsCommand(flags: SessionsFlags): Promise<void> {
	const json = isJsonMode(flags);
	const client = authedClient(json);

	try {
		if (flags.id) {
			const s = await client.getChargingSession(flags.id);
			if (flags.raw) return printJson(s);
			if (json) return printJson(summarize(s));
			return printSingle(s);
		}

		const page = await client.getChargingSessions();
		if (flags.raw) return printJson(page);
		const all = paged(page);
		const limit = flags.limit ? Math.max(0, Number.parseInt(flags.limit, 10)) : 20;
		const rows = all.slice(0, limit);

		if (json) {
			printJson({
				total: page.PagingInfo?.NumOfRows ?? all.length,
				returned: rows.length,
				sessions: rows.map(summarize),
			});
			return;
		}
		if (rows.length === 0) {
			console.log(color.dim("No charging sessions."));
			return;
		}
		for (const s of rows) {
			const loc = s.Location?.FriendlyName ?? s.Location?.FriendlyCode ?? "?";
			console.log(`${color.bold(dateTime(s.ChargingFrom ?? s.ConnectedFrom))}  ${color.cyan(loc)}`);
			console.log(
				`  ${color.dim(`#${s.Id}`)}  ${kwh(s.ActiveEnergyConsumption)}  ${duration(s.ChargingFrom, s.ChargingTo)}  ${money(s.TotalCosts, s.CurrencyCode)}${s.SuppliedByGreenEnergy ? color.green(" 🌱") : ""}`,
			);
		}
		const total = page.PagingInfo?.NumOfRows ?? all.length;
		if (total > rows.length) {
			console.log(color.dim(`\n${rows.length} of ${total} — use --limit to see more.`));
		}
	} catch (e) {
		if (e instanceof AuthError) dieAuth("expired", json);
		throw e;
	}
}

function printSingle(s: ChargingSession): void {
	const loc = s.Location?.FriendlyName ?? s.Location?.FriendlyCode ?? "?";
	console.log(color.bold(`Session #${s.Id}  —  ${loc}`));
	console.log(`  ${color.dim("address")}    ${addressLine(s.Location?.Address)}`);
	console.log(
		`  ${color.dim("connected")}  ${dateTime(s.ConnectedFrom)} → ${dateTime(s.ConnectedTo)}`,
	);
	console.log(
		`  ${color.dim("charging")}   ${dateTime(s.ChargingFrom)} → ${dateTime(s.ChargingTo)}  (${duration(s.ChargingFrom, s.ChargingTo)})`,
	);
	console.log(
		`  ${color.dim("energy")}     ${kwh(s.ActiveEnergyConsumption)}  (max ${s.MaxActivePower ?? "—"} kW)`,
	);
	console.log(`  ${color.dim("connector")}  ${s.Connector?.Type?.Title ?? "—"}`);
	console.log(`  ${color.dim("cost")}       ${money(s.TotalCosts, s.CurrencyCode)}`);
	console.log(
		`  ${color.dim("green")}      ${s.SuppliedByGreenEnergy ? "yes" : "no"}  (CO₂ saved ${s.CO2Saving ?? "—"} kg)`,
	);
}
