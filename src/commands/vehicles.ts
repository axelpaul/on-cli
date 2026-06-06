// on vehicles — the vehicles on your account.

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
		const vehicles = await client.getVehicles();
		if (flags.raw) {
			printJson(vehicles);
			return;
		}
		const out = vehicles.map((v) => ({
			id: v.Id,
			brand: v.VehicleBrand?.Title ?? null,
			model: v.VehicleModel?.Title ?? null,
			version: v.VersionTitle ?? null,
			year_from: v.YearFrom ?? null,
			is_default: v.IsDefaultVehicle ?? false,
			battery_kwh: v.BatteryCapacity ?? null,
			range_km: v.MaximumRange ?? null,
			ac_connector: v.ACconnectorType?.Title ?? null,
			ac_max_power_kw: v.ACMaxPower ?? null,
		}));
		if (json) {
			printJson({ vehicles: out });
			return;
		}
		if (out.length === 0) {
			console.log(color.dim("No vehicles on this account."));
			return;
		}
		for (const v of out) {
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
