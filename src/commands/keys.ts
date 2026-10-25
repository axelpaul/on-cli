// on keys — your ON RFID charging keys/cards (identifications).

import { listKeys } from "../lib/actions.ts";
import { AuthError } from "../lib/api.ts";
import { dateOnly } from "../lib/format.ts";
import { color, dieAuth, isJsonMode, printJson } from "../lib/output.ts";
import { authedClient } from "../lib/session.ts";

export async function keysCommand(flags: {
	json?: boolean;
	pretty?: boolean;
	raw?: boolean;
}): Promise<void> {
	const json = isJsonMode(flags);
	const client = authedClient(json);

	try {
		if (flags.raw) {
			printJson(await client.getRfidCards());
			return;
		}
		const out = await listKeys(client);
		if (json) {
			printJson(out);
			return;
		}
		if (out.keys.length === 0) {
			console.log(color.dim("No RFID keys on this account."));
			return;
		}
		for (const c of out.keys) {
			const flags2 = [
				c.blocked ? color.red("blocked") : null,
				c.expired ? color.dim("expired") : null,
			]
				.filter(Boolean)
				.join(" ");
			console.log(
				`${color.bold(c.number ?? `#${c.id}`)}  ${color.dim(`since ${dateOnly(c.valid_from)}`)} ${flags2}`,
			);
		}
	} catch (e) {
		if (e instanceof AuthError) dieAuth("expired", json);
		throw e;
	}
}
