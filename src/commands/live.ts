import { liveStatus } from "../lib/charging.ts";
import { MontaClient } from "../lib/monta.ts";
import { die, isJsonMode, printJson } from "../lib/output.ts";
import { loadMontaAuth } from "../lib/storage.ts";
export async function liveCommand(flags: {
	json?: boolean;
	pretty?: boolean;
	raw?: boolean;
}): Promise<void> {
	const auth = loadMontaAuth();
	if (!auth?.accessToken) die('Monta login required. Run "on monta-login".', 2, isJsonMode(flags));
	const client = new MontaClient(auth!);
	printJson(flags.raw ? await client.getCharges() : await liveStatus(client));
}
