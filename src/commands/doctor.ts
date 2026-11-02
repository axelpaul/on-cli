// on doctor — pre-flight health check. Agents (and humans) should run this
// before issuing data commands to confirm the CLI is ready.

import { MontaClient } from "../lib/monta.ts";
import { color, isJsonMode, printJson } from "../lib/output.ts";
import { loadMontaAuth } from "../lib/storage.ts";

type CheckStatus = "ok" | "warn" | "fail";
interface Check {
	name: string;
	status: CheckStatus;
	detail?: string;
}

export async function doctorCommand(flags: { json?: boolean; pretty?: boolean }): Promise<void> {
	const json = isJsonMode(flags);
	const checks: Check[] = [];

	const auth = loadMontaAuth();
	if (!auth?.accessToken) {
		checks.push({
			name: "monta_auth",
			status: "fail",
			detail: "No cached Monta session. Run on monta-login locally.",
		});
		return report(checks, json);
	}
	try {
		await new MontaClient(auth).getMe();
		checks.push({
			name: "monta_auth_api",
			status: "ok",
			detail: "Cached session accepted by current API; no login attempted.",
		});
	} catch (e) {
		checks.push({
			name: "monta_auth_api",
			status: "fail",
			detail: e instanceof Error ? e.message : "Read failed",
		});
	}
	checks.push({
		name: "paid_start",
		status: "warn",
		detail:
			"Server-default saved-source/card start live-proved 2026-10-21. Other routes, including direct Apple Pay, still need interactive authorization.",
	});
	checks.push({
		name: "public_discovery",
		status: "warn",
		detail:
			"Full ON QR codes support unfamiliar locations via ON’s public resolver and live identity checks. Plain labels require account history or a known pole group. Public resolver availability is checked when used.",
	});

	report(checks, json);
}

function report(checks: Check[], json: boolean): void {
	const overall: CheckStatus = checks.some((c) => c.status === "fail")
		? "fail"
		: checks.some((c) => c.status === "warn")
			? "warn"
			: "ok";

	if (json) {
		printJson({ status: overall, checks });
		if (overall === "fail") process.exit(2);
		return;
	}

	const icon: Record<CheckStatus, string> = {
		ok: color.green("✓"),
		warn: color.yellow("!"),
		fail: color.red("✗"),
	};
	for (const c of checks) {
		console.log(`  ${icon[c.status]} ${color.bold(c.name)}  ${color.dim(c.detail ?? "")}`);
	}
	console.log("");
	if (overall === "ok") console.log(color.green("All checks passed."));
	else if (overall === "warn") console.log(color.yellow("Some checks have warnings."));
	else {
		console.log(color.red("Checks failed."));
		process.exit(2);
	}
}
