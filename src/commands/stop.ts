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
	/** Select one active session when an account has more than one. */
	connector?: string;
	json?: boolean;
	pretty?: boolean;
}

function connectorIdFlag(value: string | undefined, json: boolean): number | undefined {
	if (value === undefined) return undefined;
	if (!/^\d+$/.test(value)) die(`Invalid --connector: ${value}`, 64, json);
	return Number(value);
}

function ok(r: StopResponse): boolean {
	// Dusky convention: ResultCode 0 == success.
	return r.ResultCode === 0 || r.ResultCode === undefined;
}

export async function stopCommand(flags: StopFlags): Promise<void> {
	const json = isJsonMode(flags);
	// Validate before consulting the account, so a bad selector never looks
	// indistinguishable from a harmless no-active-session result.
	const requestedConnector = connectorIdFlag(flags.connector, json);
	const client = authedClient(json);

	let online: Awaited<ReturnType<typeof client.getOnlineData>>;
	try {
		online = await client.getOnlineData();
	} catch (e) {
		if (e instanceof AuthError) dieAuth("expired", json);
		throw e;
	}

	const sessions = online.CurrentSessions ?? [];
	let session: (typeof sessions)[number] | undefined;
	if (requestedConnector !== undefined) {
		session = sessions.find((candidate) => candidate.Connector?.Id === requestedConnector);
		if (!session) {
			die(
				`No active session found for connector ${requestedConnector}. Check \`on live\` and retry.`,
				1,
				json,
			);
		}
	} else if (sessions.length === 1) {
		session = sessions[0];
	} else if (sessions.length > 1) {
		die(
			`Found ${sessions.length} active charging sessions. Refusing to choose one; re-run with --connector <id>.`,
			1,
			json,
		);
	}
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
		// Force stop is a deliberate fallback. It is more abrupt than the
		// app-native normal/roaming remote-stop commands.
		if (flags.force) {
			if (target.connectorId == null) die("No connector id on the active session.", 1, json);
			const res = await client.stopChargingForce(target.connectorId);
			const success = res.resultCode === 0 || res.resultCode === undefined;
			report(success, { method: "forceStop", where, result_code: res.resultCode }, json);
			return;
		}
		if (isRoamingSession(session)) {
			if (target.roamingPlatformId == null) {
				die(
					"Active roaming session is missing its platform id; retry with --force only if intended.",
					1,
					json,
				);
			}
			const res = await client.stopChargingRoaming({
				EvseCode: target.body.EvseCode,
				RoamingPlatformId: target.roamingPlatformId,
			});
			report(
				ok(res),
				{
					method: "remoteStopRoaming",
					where,
					result_code: res.ResultCode,
					error: res.ErrorDescription ?? null,
				},
				json,
			);
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
