import { MontaClient } from "../lib/monta.ts";
import { color, die, isJsonMode, printJson } from "../lib/output.ts";
import { ask } from "../lib/prompt.ts";
import { loadMontaAuth, saveMontaAuth } from "../lib/storage.ts";

interface Flags {
	json?: boolean;
	pretty?: boolean;
}

export async function montaLoginCommand(flags: Flags & { email?: string }): Promise<void> {
	const json = isJsonMode(flags);
	const email = flags.email ?? process.env.ON_MONTA_USER ?? (await ask("Monta email: "));
	if (!email) die("No email provided.", 64, json);
	const password = process.env.ON_MONTA_PW ?? (await ask("Monta password: ", { mask: true }));
	if (!password) die("No password provided.", 64, json);
	const client = new MontaClient(loadMontaAuth() ?? undefined);
	const auth = await client.login(email, password);
	saveMontaAuth(auth);
	if (json) printJson({ step: "logged_in", backend: "monta" });
	else console.log(color.green("✓ Logged into ON's Monta backend."));
}

function authedMonta(json: boolean): MontaClient {
	const auth = loadMontaAuth();
	if (!auth?.accessToken) die('Monta login required. Run "on monta-login".', 2, json);
	return new MontaClient(auth);
}

export async function montaAccountCommand(flags: Flags): Promise<void> {
	const json = isJsonMode(flags);
	const me = await authedMonta(json).getMe();
	const account = {
		id: me.id ?? null,
		name: me.display_name ?? null,
		email: me.email ?? null,
	};
	if (json) printJson(account);
	else console.log(`${account.name ?? "ON account"} (${account.email ?? "email unavailable"})`);
}

export async function montaVehiclesCommand(flags: Flags): Promise<void> {
	const vehicles = await authedMonta(isJsonMode(flags)).getVehicles();
	printJson(vehicles);
}

export async function montaChargesCommand(flags: Flags): Promise<void> {
	printJson(await authedMonta(isJsonMode(flags)).getCharges());
}

export async function montaChargePointsCommand(flags: Flags & { id?: string }): Promise<void> {
	const client = authedMonta(isJsonMode(flags));
	if (flags.id !== undefined) {
		const id = Number(flags.id);
		if (!Number.isSafeInteger(id) || id <= 0)
			die("Invalid --id <Monta charge-point ID>", 64, isJsonMode(flags));
		printJson(await client.getChargePoint(id));
	} else printJson(await client.getChargePoints());
}
