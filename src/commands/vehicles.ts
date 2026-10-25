// on vehicles — the vehicles on your account.

import { listVehicles } from "../lib/actions.ts";
import { AuthError } from "../lib/api.ts";
import { color, dieAuth, isJsonMode, printJson } from "../lib/output.ts";
import { authedClient } from "../lib/session.ts";

export async function vehiclesCommand(flags: {
	json?: boolean;
	pretty?: boolean;
	raw?: boolean;
}): Promise<void> {
	const json = isJsonMode(flags);
	const client = authedClient(json);

	try {
		if (flags.raw) {
			printJson(await client.getVehicles());
			return;
		}
		const out = await listVehicles(client);
		if (json) {
			printJson(out);
			return;
		}
		if (out.vehicles.length === 0) {
			console.log(color.dim("No vehicles on this account."));
			return;
		}
		for (const v of out.vehicles) {
			const star = v.is_default ? color.yellow(" ★") : "";
			console.log(`${color.bold(`${v.brand ?? "?"} ${v.model ?? ""}`.trim())}${star}`);
			console.log(
				`  ${color.dim("id")} ${v.id}  ${color.dim("battery")} ${v.battery_kwh ?? "—"} kWh  ${color.dim("range")} ${v.range_km ?? "—"} km  ${color.dim("AC")} ${v.ac_connector ?? "—"}`,
			);
		}
	} catch (e) {
		if (e instanceof AuthError) dieAuth("expired", json);
		throw e;
	}
}
