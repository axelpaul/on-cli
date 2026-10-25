// on sessions — charging session history (most recent first).
// `on sessions --id <n>` shows a single session in full.

import { getSession, listSessions } from "../lib/actions.ts";
import { AuthError } from "../lib/api.ts";
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

export async function sessionsCommand(flags: SessionsFlags): Promise<void> {
	const json = isJsonMode(flags);
	const client = authedClient(json);

	try {
		if (flags.id) {
			if (flags.raw) return printJson(await client.getChargingSession(flags.id));
			if (json) return printJson(await getSession(client, flags.id));
			return printSingle(await client.getChargingSession(flags.id));
		}

		if (flags.raw) return printJson(await client.getChargingSessions());
		const limit = flags.limit ? Number.parseInt(flags.limit, 10) || 0 : 20;
		const out = await listSessions(client, limit);

		if (json) {
			printJson(out);
			return;
		}
		if (out.sessions.length === 0) {
			console.log(color.dim("No charging sessions."));
			return;
		}
		for (const s of out.sessions) {
			console.log(
				`${color.bold(dateTime(s.charging_from ?? s.connected_from))}  ${color.cyan(s.location ?? "?")}`,
			);
			console.log(
				`  ${color.dim(`#${s.id}`)}  ${kwh(s.energy_kwh)}  ${duration(s.charging_from, s.charging_to)}  ${money(s.cost, s.currency ?? undefined)}${s.green_energy ? color.green(" 🌱") : ""}`,
			);
		}
		if (out.total > out.returned) {
			console.log(color.dim(`\n${out.returned} of ${out.total} — use --limit to see more.`));
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
