// on whoami — the logged-in user (live from /api/users/me).

import { AuthError } from "../lib/api.ts";
import { color, dieAuth, isJsonMode, printJson } from "../lib/output.ts";
import { authedClient } from "../lib/session.ts";

export async function whoamiCommand(flags: {
	json?: boolean;
	pretty?: boolean;
	raw?: boolean;
}): Promise<void> {
	const json = isJsonMode(flags);
	const client = authedClient(json);

	try {
		const me = await client.getMe();
		if (flags.raw) {
			printJson(me);
			return;
		}
		const u = me.User;
		const out = {
			user_id: u?.Id,
			name: [u?.FirstName, u?.LastName].filter(Boolean).join(" ").trim() || null,
			email: u?.Email ?? null,
			kennitala: u?.ExternalCode ?? null,
			phone: u?.GSMNumber ?? null,
			country: u?.Address?.Country?.Code ?? null,
			currency: u?.Currency?.CodeShort ?? null,
			language: u?.UiCulture?.Id ?? null,
			user_type: u?.UserType?.Title ?? null,
			registered: u?.RegistrationDate ?? null,
			blocked: u?.Blocked ?? null,
		};
		if (json) {
			printJson(out);
			return;
		}
		console.log(color.bold(out.name ?? "(unknown name)"));
		console.log(`  ${color.dim("email")}     ${out.email ?? "—"}`);
		console.log(`  ${color.dim("kennitala")} ${out.kennitala ?? "—"}`);
		console.log(`  ${color.dim("phone")}     ${out.phone ?? "—"}`);
		console.log(`  ${color.dim("currency")}  ${out.currency ?? "—"}`);
		console.log(`  ${color.dim("type")}      ${out.user_type ?? "—"}`);
	} catch (e) {
		if (e instanceof AuthError) dieAuth("expired", json);
		throw e;
	}
}
