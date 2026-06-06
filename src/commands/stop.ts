// on stop — stop the currently active charging session.
//
// Reads the live session from /api/onlineData, builds the exact
// remoteStopTransaction body the app uses, and POSTs it. Mutating: asks for
// confirmation unless --yes. `--force` uses the connector-level forceStop.

import { AuthError, buildStopTarget, isRoamingSession } from "../lib/api.ts";
import { color, die, dieAuth, isJsonMode, printJson } from "../lib/output.ts";
import { confirm } from "../lib/prompt.ts";
import { authedClient } from "../lib/session.ts";
import type { StopResponse } from "../lib/types.ts";

interface StopFlags {
	yes?: boolean;
	force?: boolean;
	json?: boolean;
	pretty?: boolean;
}

function ok(r: StopResponse): boolean {
	// Dusky convention: ResultCode 0 == success.
	return r.ResultCode === 0 || r.ResultCode === undefined;
}

export async function stopCommand(flags: StopFlags): Promise<void> {
	const json = isJsonMode(flags);
	const client = authedClient(json);

	let online: Awaited<ReturnType<typeof client.getOnlineData>>;
	try {
		online = await client.getOnlineData();
	} catch (e) {
		if (e instanceof AuthError) dieAuth("expired", json);
		throw e;
	}

	const sessions = online.CurrentSessions ?? [];
	const session = sessions[0];
	if (!session) {
		if (json) printJson({ stopped: false, reason: "no_active_session" });
		else console.log(color.dim("No active charging session — nothing to stop."));
		return; // not an error: idempotent no-op
	}

	const target = buildStopTarget(session);
	const where = target.location ?? target.body.EvseCode;

	// Confirm before issuing a real stop.
	if (!flags.yes) {
		if (!process.stdout.isTTY) {
			die("Refusing to stop without confirmation. Re-run with --yes.", 1, json);
		}
		const proceed = await confirm(`Stop the active charging session at ${color.cyan(where)}?`);
		if (!proceed) {
			if (json) printJson({ stopped: false, reason: "cancelled" });
			else console.log("Cancelled.");
			return;
		}
	}

	try {
		// Roaming sessions can't use remoteStopTransaction; force-stop by connector.
		if (flags.force || isRoamingSession(session)) {
			if (target.connectorId == null) die("No connector id on the active session.", 1, json);
			const res = await client.stopChargingForce(target.connectorId);
			const success = res.resultCode === 0 || res.resultCode === undefined;
			report(success, { method: "forceStop", where, result_code: res.resultCode }, json);
			return;
		}
		const res = await client.stopCharging(target.body);
		report(
			ok(res),
			{
				method: "remoteStop",
				where,
				result_code: res.ResultCode,
				error: res.ErrorDescription ?? null,
			},
			json,
		);
	} catch (e) {
		if (e instanceof AuthError) dieAuth("expired", json);
		throw e;
	}
}

function report(success: boolean, detail: Record<string, unknown>, json: boolean): void {
	if (json) {
		printJson({ stopped: success, ...detail });
		if (!success) process.exit(1);
		return;
	}
	if (success) {
		console.log(color.green(`✓ Stop command sent for ${detail.where}.`));
		console.log(color.dim("  Charging takes a few seconds to wind down — check `on live`."));
	} else {
		console.log(
			color.red(
				`✗ Stop failed${detail.error ? `: ${detail.error}` : ` (code ${detail.result_code})`}.`,
			),
		);
		console.log(color.dim("  Try `on stop --force` to force-stop by connector."));
		process.exit(1);
	}
}
