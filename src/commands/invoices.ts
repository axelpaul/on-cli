// on invoices — your invoices (most recent first).

import { AuthError, paged } from "../lib/api.ts";
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
		const page = await client.getInvoices();
		if (flags.raw) {
			printJson(page);
			return;
		}
		const all = paged(page);
		const limit = flags.limit ? Math.max(0, Number.parseInt(flags.limit, 10)) : 20;
		const rows = all.slice(0, limit).map((i) => ({
			id: i.InvoiceId,
			number: i.DisplayNumber ?? (i.Number != null ? String(i.Number) : null),
			date: i.InsertedTime ?? null,
			amount: i.TotalAmountWithTax ?? null,
			paid_amount: i.PaidAmount ?? null,
			currency: i.CurrencyCode ?? null,
			paid: i.Paid ?? null,
			status: i.DisplayStatusTitle ?? null,
			downloadable: i.DownloadAvailable ?? false,
		}));

		if (json) {
			printJson({
				total: page.PagingInfo?.NumOfRows ?? all.length,
				returned: rows.length,
				invoices: rows,
			});
			return;
		}
		if (rows.length === 0) {
			console.log(color.dim("No invoices."));
			return;
		}
		for (const i of rows) {
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
