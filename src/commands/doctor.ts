// on doctor — pre-flight health check. Agents (and humans) should run this
// before issuing data commands to confirm the CLI is ready.

import { AuthError, OnClient } from "../lib/api.ts";
import { color, isJsonMode, printJson } from "../lib/output.ts";
import { loadAuth, loadConfig, saveAuth } from "../lib/storage.ts";

type CheckStatus = "ok" | "warn" | "fail";
interface Check {
	name: string;
	status: CheckStatus;
	detail?: string;
}

export async function doctorCommand(flags: { json?: boolean; pretty?: boolean }): Promise<void> {
	const json = isJsonMode(flags);
	const checks: Check[] = [];

	const auth = loadAuth();
	if (!auth?.accessToken) {
		checks.push({ name: "auth", status: "fail", detail: "Not logged in. Run `on login`." });
		return report(checks, json);
	}
	checks.push({
		name: "auth",
		status: "ok",
		detail: `Token cached, user: ${auth.user?.name ?? auth.user?.email ?? "?"}`,
	});

	// Token expiry vs the cached `.expires`.
	if (auth.expiresAt) {
		const exp = Date.parse(auth.expiresAt);
		if (Number.isFinite(exp)) {
			const mins = Math.round((exp - Date.now()) / 60000);
			if (mins < 0 && !auth.refreshToken) {
				checks.push({
					name: "token_expiry",
					status: "warn",
					detail: `Expired ${-mins}m ago; no refresh token — re-login may be needed.`,
				});
			} else if (mins < 0) {
				checks.push({
					name: "token_expiry",
					status: "ok",
					detail: "Access token expired but a refresh token is available (auto-refresh).",
				});
			} else {
				checks.push({
					name: "token_expiry",
					status: "ok",
					detail: `~${mins}m remaining${auth.refreshToken ? " (auto-refresh on)" : ""}.`,
				});
			}
		}
	} else {
		checks.push({ name: "token_expiry", status: "warn", detail: "No expiry recorded." });
	}

	// Live reachability via /api/users/me (cheap, exercises auto-refresh).
	const client = OnClient.fromAuth(auth, {
		baseUrl: loadConfig().baseUrl,
		onRefresh: (next) => saveAuth({ ...next, user: next.user ?? auth.user }),
	});
	try {
		const me = await client.getMe();
		const name = [me.User?.FirstName, me.User?.LastName].filter(Boolean).join(" ").trim();
		checks.push({
			name: "api_reachable",
			status: "ok",
			detail: `GET /api/users/me ok${name ? ` as ${name}` : ""}`,
		});
	} catch (e) {
		if (e instanceof AuthError) {
			checks.push({
				name: "api_reachable",
				status: "fail",
				detail: "Server rejected the token (401). Run `on login`.",
			});
		} else {
			checks.push({
				name: "api_reachable",
				status: "fail",
				detail: e instanceof Error ? e.message : String(e),
			});
		}
	}

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
