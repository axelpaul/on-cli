// on whoami — the logged-in user (live from /api/users/me).

import { summarizeAccount } from "../lib/actions.ts";
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
		const out = summarizeAccount(me);
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
