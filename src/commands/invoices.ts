// on invoices — your invoices (most recent first).

import { listInvoices } from "../lib/actions.ts";
import { AuthError } from "../lib/api.ts";
import { dateOnly, money } from "../lib/format.ts";
import { color, dieAuth, isJsonMode, printJson } from "../lib/output.ts";
import { authedClient } from "../lib/session.ts";

export async function invoicesCommand(flags: {
	limit?: string;
	json?: boolean;
	pretty?: boolean;
	raw?: boolean;
}): Promise<void> {
	const json = isJsonMode(flags);
	const client = authedClient(json);

	try {
		if (flags.raw) {
			printJson(await client.getInvoices());
			return;
		}
		const limit = flags.limit ? Number.parseInt(flags.limit, 10) || 0 : 20;
		const out = await listInvoices(client, limit);
		if (json) {
			printJson(out);
			return;
		}
		if (out.invoices.length === 0) {
			console.log(color.dim("No invoices."));
			return;
		}
		for (const i of out.invoices) {
			const state = i.paid ? color.green("paid") : color.yellow(i.status ?? "unpaid");
			console.log(
				`${color.bold(dateOnly(i.date))}  ${color.dim(`#${i.number ?? i.id}`)}  ${money(i.amount, i.currency ?? "ISK")}  ${state}`,
			);
		}
	} catch (e) {
		if (e instanceof AuthError) dieAuth("expired", json);
		throw e;
	}
}
