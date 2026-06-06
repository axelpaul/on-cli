// on start — start a charging session at a given EVSE/connector.
//
// Needs the EvseCode and connector id of the charger you're plugged into. You
// get these from the charger (QR / label) or from a prior session's identifiers.
// Mutating: asks for confirmation unless --yes.
//
// EvseCode format (non-roaming ON): `${chargePointFriendlyCode}-${evseFriendlyCode}-${connectorCode}`.

import { AuthError } from "../lib/api.ts";
import { color, die, dieAuth, isJsonMode, printJson } from "../lib/output.ts";
import { confirm } from "../lib/prompt.ts";
import { authedClient } from "../lib/session.ts";
import type { ChargingCommandBody } from "../lib/types.ts";

interface StartFlags {
	evse?: string;
	connector?: string;
	chargepoint?: string;
	preauth?: string;
	coupon?: string;
	yes?: boolean;
	json?: boolean;
	pretty?: boolean;
}

function intFlag(v: string | undefined, name: string, json: boolean): number | undefined {
	if (v === undefined) return undefined;
	const n = Number.parseInt(v, 10);
	if (!Number.isFinite(n)) die(`Invalid --${name}: ${v}`, 64, json);
	return n;
}

export async function startCommand(flags: StartFlags): Promise<void> {
	const json = isJsonMode(flags);

	if (!flags.evse) {
		die("Missing --evse <EvseCode>. (Format: chargePointCode-evseCode-connectorCode.)", 64, json);
	}
	const connector = intFlag(flags.connector, "connector", json);
	if (connector === undefined) die("Missing --connector <id>.", 64, json);

	const body: ChargingCommandBody = {
		EvseCode: flags.evse,
		ConnectorId: connector,
		PreauthorizationId: intFlag(flags.preauth, "preauth", json),
		CouponId: intFlag(flags.coupon, "coupon", json),
		SocLimits: false,
	};

	const client = authedClient(json);

	if (!flags.yes) {
		if (!process.stdout.isTTY)
			die("Refusing to start without confirmation. Re-run with --yes.", 1, json);
		const proceed = await confirm(
			`Start charging at ${color.cyan(flags.evse)} (connector ${connector})?`,
		);
		if (!proceed) {
			if (json) printJson({ started: false, reason: "cancelled" });
			else console.log("Cancelled.");
			return;
		}
	}

	try {
		const res = await client.startCharging(body);
		const success = res.ResultCode === 0 || res.ResultCode === undefined;
		if (json) {
			printJson({
				started: success,
				charging_authorization_id: res.ChargingAuthorizationId ?? null,
				result_code: res.ResultCode ?? null,
				error: res.ErrorDescription ?? null,
			});
			if (!success) process.exit(1);
			return;
		}
		if (success) {
			console.log(color.green(`✓ Start command sent for ${flags.evse}.`));
			console.log(color.dim("  Check `on live` in a few seconds."));
		} else {
			console.log(
				color.red(
					`✗ Start failed${res.ErrorDescription ? `: ${res.ErrorDescription}` : ` (code ${res.ResultCode})`}.`,
				),
			);
			process.exit(1);
		}
	} catch (e) {
		if (e instanceof AuthError) dieAuth("expired", json);
		throw e;
	}
}
