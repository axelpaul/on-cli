// Shared helper for authenticated commands: load auth, build a client that
// persists refreshed tokens, and bail cleanly when not logged in.

import { AuthError, OnClient } from "./api.ts";
import { dieAuth } from "./output.ts";
import { loadAuth, loadConfig, saveAuth } from "./storage.ts";

/** A client built from the cached Dusky session, or null when not logged in.
 * The client auto-persists tokens whenever it refreshes them. */
export function storedClient(): OnClient | null {
	const auth = loadAuth();
	if (!auth?.accessToken) return null;
	const cfg = loadConfig();
	return OnClient.fromAuth(auth, {
		baseUrl: cfg.baseUrl,
		onRefresh: (next) => {
			// Preserve the cached user identity across refreshes.
			saveAuth({ ...next, user: next.user ?? auth.user });
		},
	});
}

/** Like storedClient(), but throws AuthError instead of returning null (MCP). */
export function requireClient(): OnClient {
	const client = storedClient();
	if (!client) throw new AuthError('Not logged in. Run "on login" in a terminal first.');
	return client;
}

/** CLI variant: returns a ready OnClient or exits(2) if there's no stored session. */
export function authedClient(json: boolean): OnClient {
	return storedClient() ?? dieAuth("not_logged_in", json);
}

/** Public (unauthenticated) client honouring the configured base URL. */
export function publicClient(): OnClient {
	return new OnClient({ baseUrl: loadConfig().baseUrl });
}
