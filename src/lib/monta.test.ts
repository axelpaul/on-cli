import { afterEach, expect, test } from "bun:test";
import { extractAccessToken, MontaClient, MontaError } from "./monta.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

test("extractAccessToken accepts nested Monta token fields", () => {
	expect(extractAccessToken({ token: { access_token: "secret" } })).toBe("secret");
	expect(extractAccessToken({ token: { accessToken: "secret" } })).toBe("secret");
	expect(extractAccessToken({ token: { other: "secret" } })).toBeUndefined();
});

test("login sends Monta headers and does not expose the token in output", async () => {
	let request: Request | undefined;
	globalThis.fetch = (async (input, init) => {
		request = new Request(String(input), init as RequestInit);
		return Response.json({ token: { access_token: "secret" } });
	}) as typeof fetch;
	const client = new MontaClient({ uuid: "test-device" });
	const auth = await client.login("example@example.com", "password");
	expect(auth.accessToken).toBe("secret");
	expect(request?.url).toBe("https://api.monta.app/api/v1/auth/login");
	expect(request?.headers.get("Operator")).toBe("on");
	expect(request?.headers.get("UUID")).toBe("test-device");
	expect(await request?.text()).toBe(
		JSON.stringify({ email: "example@example.com", password: "password" }),
	);
});

test("authenticated account read uses the cached bearer token", async () => {
	let authorization: string | null = null;
	globalThis.fetch = (async (input, init) => {
		const request = new Request(String(input), init as RequestInit);
		authorization = request.headers.get("Authorization");
		return Response.json({ id: 123, display_name: "Example" });
	}) as typeof fetch;
	const me = await new MontaClient({ accessToken: "secret", uuid: "test-device" }).getMe();
	expect(String(authorization)).toBe("Bearer secret");
	expect(me.id).toBe(123);
});

test("charging reads use observed GET paths without mutations", async () => {
	const requests: Request[] = [];
	globalThis.fetch = (async (input, init) => {
		requests.push(new Request(String(input), init as RequestInit));
		return Response.json({ data: [] });
	}) as typeof fetch;
	const client = new MontaClient({ accessToken: "secret", uuid: "test-device" });
	await client.getCharges();
	await client.getChargePoints();
	expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
		"/api/v1/charges",
		"/api/v1/charge_points",
	]);
	expect(requests.every((request) => request.method === "GET")).toBe(true);
});

test("errors include status, not response body", async () => {
	globalThis.fetch = (async () =>
		new Response("private body", { status: 403 })) as unknown as typeof fetch;
	await expect(new MontaClient().login("example@example.com", "password")).rejects.toThrow(
		MontaError,
	);
});
