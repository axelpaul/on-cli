// on logout — clear the local session.

import { isJsonMode, printJson } from "../lib/output.ts";
import { clearAuth, loadAuth } from "../lib/storage.ts";

export async function logoutCommand(flags: { json?: boolean; pretty?: boolean }): Promise<void> {
	const json = isJsonMode(flags);
	const was = loadAuth() != null;
	clearAuth();
	if (json) {
		printJson({ logged_out: was });
	} else {
		console.log(was ? "Logged out." : "No active session.");
	}
}
