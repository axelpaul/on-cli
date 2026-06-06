// Shared helper for authenticated commands: load auth, build a client that
// persists refreshed tokens, and bail cleanly when not logged in.

import { OnClient } from "./api.ts";
import { dieAuth } from "./output.ts";
import { loadAuth, loadConfig, saveAuth } from "./storage.ts";

/** Returns a ready OnClient or exits(2) if there's no stored session.
 * The client auto-persists tokens whenever it refreshes them. */
export function authedClient(json: boolean): OnClient {
	const auth = loadAuth();
	if (!auth?.accessToken) dieAuth("not_logged_in", json);
	const cfg = loadConfig();
	return OnClient.fromAuth(auth, {
		baseUrl: cfg.baseUrl,
		onRefresh: (next) => {
			// Preserve the cached user identity across refreshes.
			saveAuth({ ...next, user: next.user ?? auth.user });
		},
	});
}
