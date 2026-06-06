// on locations — find charging locations near a point. Public (no auth needed).
// Defaults to central Reykjavík if no coordinates are given.

import { OnClient } from "../lib/api.ts";
import { addressLine } from "../lib/format.ts";
import { color, die, isJsonMode, printJson } from "../lib/output.ts";
import { loadConfig } from "../lib/storage.ts";

// Central Reykjavík (Hallgrímskirkja-ish) — a sensible default for an Iceland app.
const DEFAULT_LAT = 64.1466;
const DEFAULT_LNG = -21.9426;

interface LocationsFlags {
	lat?: string;
	lng?: string;
	radius?: string;
	available?: boolean;
	free?: boolean;
	limit?: string;
	json?: boolean;
	pretty?: boolean;
	raw?: boolean;
}

function num(v: string | undefined, fallback: number, json: boolean, name: string): number {
	if (v === undefined) return fallback;
	const n = Number.parseFloat(v);
	if (!Number.isFinite(n)) die(`Invalid --${name}: ${v}`, 64, json);
	return n;
}

export async function locationsCommand(flags: LocationsFlags): Promise<void> {
	const json = isJsonMode(flags);
	const client = new OnClient({ baseUrl: loadConfig().baseUrl });

	const lat = num(flags.lat, DEFAULT_LAT, json, "lat");
	const lng = num(flags.lng, DEFAULT_LNG, json, "lng");
	const radius = num(flags.radius, 25, json, "radius");

	const locations = await client.getLocations({
		lat,
		lng,
		radius,
		available: flags.available,
		free: flags.free,
	});

	if (flags.raw) {
		printJson(locations);
		return;
	}

	const limit = flags.limit ? Math.max(0, Number.parseInt(flags.limit, 10)) : 25;
	const rows = locations.slice(0, limit).map((l) => ({
		id: l.Id,
		name: l.FriendlyName ?? l.FriendlyCode ?? null,
		address: addressLine(l.Address),
		available_evses: l.AvailableEvses ?? null,
		total_evses: l.TotalEvses ?? null,
		lat: l.GeoCoordinates?.GPSLatitude ?? null,
		lng: l.GeoCoordinates?.GPSLongitude ?? null,
		private: l.IsPrivate ?? false,
	}));

	if (json) {
		printJson({
			query: { lat, lng, radius },
			count: locations.length,
			returned: rows.length,
			locations: rows,
		});
		return;
	}
	if (rows.length === 0) {
		console.log(color.dim("No charging locations found in range."));
		return;
	}
	for (const l of rows) {
		const avail =
			l.available_evses != null && l.total_evses != null
				? `${l.available_evses}/${l.total_evses} free`
				: "—";
		const tag = l.available_evses && l.available_evses > 0 ? color.green(avail) : color.dim(avail);
		console.log(`${color.bold(l.name ?? `#${l.id}`)}  ${tag}`);
		console.log(`  ${color.dim(l.address)}`);
	}
	if (locations.length > rows.length) {
		console.log(color.dim(`\n${rows.length} of ${locations.length} — use --limit to see more.`));
	}
}
