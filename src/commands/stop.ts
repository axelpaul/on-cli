// on stop — stop the currently active charging session.
//
// Reads the live session from /api/onlineData, builds the exact
// remoteStopTransaction body the app uses, and POSTs it. Mutating: asks for
// confirmation unless --yes. `--force` uses the connector-level forceStop.

import { findActiveSession, type StopResult, stopActiveCharging } from "../lib/actions.ts";
import { AuthError } from "../lib/api.ts";
import { color, die, dieAuth, isJsonMode, printJson } from "../lib/output.ts";
import { confirm } from "../lib/prompt.ts";
import { authedClient } from "../lib/session.ts";

interface StopFlags {
	yes?: boolean;
	force?: boolean;
	json?: boolean;
	pretty?: boolean;
}

export async function stopCommand(flags: StopFlags): Promise<void> {
	const json = isJsonMode(flags);
	const client = authedClient(json);

	try {
		const active = await findActiveSession(client);
		if (!active) {
			if (json) printJson({ stopped: false, reason: "no_active_session" });
			else console.log(color.dim("No active charging session — nothing to stop."));
			return; // not an error: idempotent no-op
		}

		// Confirm before issuing a real stop.
		if (!flags.yes) {
			if (!process.stdout.isTTY) {
				die("Refusing to stop without confirmation. Re-run with --yes.", 1, json);
			}
			const proceed = await confirm(
				`Stop the active charging session at ${color.cyan(active.where)}?`,
			);
			if (!proceed) {
				if (json) printJson({ stopped: false, reason: "cancelled" });
				else console.log("Cancelled.");
				return;
			}
		}

		report(await stopActiveCharging(client, { force: flags.force }), json);
	} catch (e) {
		if (e instanceof AuthError) dieAuth("expired", json);
		throw e;
	}
}

function report(res: StopResult, json: boolean): void {
	if (json) {
		printJson(res);
		if (!res.stopped && res.reason !== "no_active_session") process.exit(1);
		return;
	}
	if (res.reason === "no_active_session") {
		console.log(color.dim("No active charging session — nothing to stop."));
		return;
	}
	if (res.stopped) {
		console.log(color.green(`✓ Stop command sent for ${res.where}.`));
		console.log(color.dim("  Charging takes a few seconds to wind down — check `on live`."));
	} else {
		console.log(
			color.red(`✗ Stop failed${res.error ? `: ${res.error}` : ` (code ${res.result_code})`}.`),
		);
		console.log(color.dim("  Try `on stop --force` to force-stop by connector."));
		process.exit(1);
	}
}
