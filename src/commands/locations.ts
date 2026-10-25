// on locations — find charging locations near a point. Public (no auth needed).
// Defaults to central Reykjavík if no coordinates are given.

import { DEFAULT_LAT, DEFAULT_LNG, DEFAULT_RADIUS_KM, findLocations } from "../lib/actions.ts";
import { color, die, isJsonMode, printJson } from "../lib/output.ts";
import { publicClient } from "../lib/session.ts";

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
	const client = publicClient();

	const lat = num(flags.lat, DEFAULT_LAT, json, "lat");
	const lng = num(flags.lng, DEFAULT_LNG, json, "lng");
	const radius = num(flags.radius, DEFAULT_RADIUS_KM, json, "radius");
	const query = { lat, lng, radius, available: flags.available, free: flags.free };

	if (flags.raw) {
		printJson(await client.getLocations(query));
		return;
	}

	const limit = flags.limit ? Number.parseInt(flags.limit, 10) || 0 : 25;
	const out = await findLocations(client, query, limit);
	const rows = out.locations;

	if (json) {
		printJson(out);
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
	if (out.count > rows.length) {
		console.log(color.dim(`\n${rows.length} of ${out.count} — use --limit to see more.`));
	}
}
