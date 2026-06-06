// on login — email/password (OAuth2 password grant). Headless-friendly.
// Credentials resolve from flags → env (ON_USER / ON_PW) → interactive prompt.

import { OnClient } from "../lib/api.ts";
import { color, die, isJsonMode, printJson } from "../lib/output.ts";
import { ask } from "../lib/prompt.ts";
import { loadConfig, saveAuth } from "../lib/storage.ts";

interface LoginFlags {
	email?: string;
	password?: string;
	json?: boolean;
	pretty?: boolean;
}

export async function loginCommand(flags: LoginFlags): Promise<void> {
	const json = isJsonMode(flags);

	const email = flags.email ?? process.env.ON_USER ?? (await ask("ON email: "));
	if (!email) die("No email provided.", 64, json);
	const password = flags.password ?? process.env.ON_PW ?? (await ask("Password: ", { mask: true }));
	if (!password) die("No password provided.", 64, json);

	const client = new OnClient({ baseUrl: loadConfig().baseUrl });

	let me: { id?: number; name?: string; email?: string } = {};
	try {
		await client.login(email, password);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		// The server returns 400 on bad credentials.
		die(`Login failed: ${msg}`, 1, json);
	}

	// Enrich the stored session with a human identity (best-effort).
	try {
		const m = await client.getMe();
		const u = m.User;
		me = {
			id: u?.Id,
			name: [u?.FirstName, u?.LastName].filter(Boolean).join(" ").trim() || undefined,
			email: u?.Email ?? email,
		};
	} catch {
		me = { email };
	}

	saveAuth(client.toAuthState(me));

	if (json) {
		printJson({ step: "logged_in", user: me });
	} else {
		console.log(color.green(`✓ Logged in as ${me.name ?? me.email ?? email}.`));
	}
}
