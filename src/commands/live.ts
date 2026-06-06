// on live — current charging status: active sessions, upcoming reservations,
// and the account's pending-request / unpaid-invoice / coupon counters.
// Combines /api/onlineData + /api/periodicData into one agent-friendly snapshot.

import { AuthError } from "../lib/api.ts";
import { color, dieAuth, isJsonMode, printJson } from "../lib/output.ts";
import { authedClient } from "../lib/session.ts";

export async function liveCommand(flags: {
	json?: boolean;
	pretty?: boolean;
	raw?: boolean;
}): Promise<void> {
	const json = isJsonMode(flags);
	const client = authedClient(json);

	try {
		const [online, periodic] = await Promise.all([
			client.getOnlineData(),
			client.getPeriodicData(),
		]);
		if (flags.raw) {
			printJson({ onlineData: online, periodicData: periodic });
			return;
		}
		const out = {
			current_sessions: online.CurrentSessions ?? [],
			upcoming_reservations: online.UpcomingReservations ?? [],
			coupons: online.CouponsCount ?? 0,
			pending_requests: periodic.PendingUserRequestsCount ?? online.PendingUserRequestsCount ?? 0,
			unpaid_invoices: periodic.UnpaidInvoicesCount ?? 0,
		};
		if (json) {
			printJson(out);
			return;
		}
		const active = out.current_sessions.length;
		console.log(
			active > 0
				? color.green(`● ${active} active charging session${active === 1 ? "" : "s"}`)
				: color.dim("○ No active charging session"),
		);
		console.log(`  ${color.dim("reservations")} ${out.upcoming_reservations.length}`);
		console.log(`  ${color.dim("coupons")}      ${out.coupons}`);
		console.log(`  ${color.dim("unpaid")}       ${out.unpaid_invoices} invoice(s)`);
		if (out.pending_requests > 0) {
			console.log(color.yellow(`  ${out.pending_requests} pending request(s)`));
		}
	} catch (e) {
		if (e instanceof AuthError) dieAuth("expired", json);
		throw e;
	}
}
