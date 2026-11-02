// Monta consumer start. Preview by default; never retry a charge mutation.
import {
	resolvePoint,
	startBlockers,
	startPaymentSupported,
	startPreview,
} from "../lib/charging.ts";
import { MontaClient } from "../lib/monta.ts";
import { die, isJsonMode, printJson } from "../lib/output.ts";
import { loadMontaAuth } from "../lib/storage.ts";

interface StartFlags {
	chargepoint?: string;
	evse?: string;
	connector?: string;
	preauth?: string;
	coupon?: string;
	yes?: boolean;
	json?: boolean;
	pretty?: boolean;
}

export async function startCommand(flags: StartFlags): Promise<void> {
	const json = isJsonMode(flags);
	if (flags.evse || flags.connector || flags.preauth || flags.coupon)
		die(
			"Retired Dusky flags are not supported. Use --chargepoint <Monta ID>; pole labels are not Monta IDs.",
			64,
			json,
		);
	if (!flags.chargepoint)
		die("Missing --chargepoint <Monta ID or full ON QR/connector label>", 64, json);
	const auth = loadMontaAuth();
	if (!auth?.accessToken) die('Monta login required. Run "on monta-login".', 2, json);
	const client = new MontaClient(auth!);
	const point = await resolvePoint(client, flags.chargepoint!);
	const preview = startPreview(point);
	if (!flags.yes) {
		printJson(preview);
		return;
	}
	const blockers = startBlockers(point);
	if (blockers.length) {
		printJson({ ...preview, refused: true, reason: blockers.join(", ") });
		process.exitCode = 1;
		return;
	}
	// Use only the live-proved server-default saved-source path or free charging.
	if (!startPaymentSupported(point)) {
		printJson({
			...preview,
			refused: true,
			reason: "INTERACTIVE_PAYMENT_REQUIRED",
			message:
				"Use checkout_url; this payment route requires interactive authorization. No request was sent.",
		});
		process.exitCode = 1;
		return;
	}
	const result = await client.startCharge(point.id);
	printJson({
		backend: "monta",
		command_sent: true,
		charging_verified: false,
		result,
		next: "Verify the session with on monta-charges --json; do not repeat start if the response is ambiguous.",
	});
}
