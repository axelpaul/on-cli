import { afterEach, expect, test } from "bun:test";
import { extractAccessToken, MontaClient, MontaError, onQrCheckoutId } from "./monta.ts";

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
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		request = new Request(String(input), init as RequestInit);
		return Response.json({ token: { access_token: "secret" } });
	}) as unknown as typeof fetch;
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
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(String(input), init as RequestInit);
		authorization = request.headers.get("Authorization");
		return Response.json({ id: 123, display_name: "Example" });
	}) as unknown as typeof fetch;
	const me = await new MontaClient({ accessToken: "secret", uuid: "test-device" }).getMe();
	expect(String(authorization)).toBe("Bearer secret");
	expect(me.id).toBe(123);
});

test("charging reads use observed GET paths without mutations", async () => {
	const requests: Request[] = [];
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		requests.push(new Request(String(input), init as RequestInit));
		return Response.json({ data: [] });
	}) as unknown as typeof fetch;
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

test("Monta start uses the consumer contract and required headers exactly once", async () => {
	const requests: Request[] = [];
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		requests.push(new Request(String(input), init as RequestInit));
		return Response.json({ id: 99, state: "starting" });
	}) as unknown as typeof fetch;
	const client = new MontaClient({ accessToken: "secret", uuid: "test-device" });
	await client.startCharge(123);
	expect(requests).toHaveLength(1);
	const r = requests[0]!;
	expect(r.method).toBe("POST");
	expect(new URL(r.url).pathname).toBe("/api/v1/charges/start");
	expect(await r.json()).toEqual({ charge_point_id: 123 });
	for (const h of [
		"Meta",
		"Timezone",
		"Accept-Language",
		"UUID",
		"Operator",
		"Application",
		"Authorization",
	])
		expect(r.headers.get(h)).toBeTruthy();
});

test("invalid IDs cannot send a charging request", async () => {
	let calls = 0;
	globalThis.fetch = (async () => {
		calls++;
		return Response.json({});
	}) as unknown as typeof fetch;
	const client = new MontaClient({ accessToken: "secret" });
	for (const id of [0, -1, NaN, 1.5, Infinity])
		await expect(client.startCharge(id)).rejects.toThrow("Invalid Monta");
	expect(calls).toBe(0);
});

test("start errors and timeouts are never retried", async () => {
	let calls = 0;
	globalThis.fetch = (async () => {
		calls++;
		throw new Error("timeout");
	}) as unknown as typeof fetch;
	await expect(new MontaClient({ accessToken: "secret" }).startCharge(123)).rejects.toThrow(
		"timeout",
	);
	expect(calls).toBe(1);
});

test("charger lookup is a GET on the consumer API", async () => {
	let request: Request | undefined;
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		request = new Request(String(input), init as RequestInit);
		return Response.json({ id: 123 });
	}) as unknown as typeof fetch;
	await new MontaClient({ accessToken: "secret" }).getChargePoint(123);
	expect(request?.method).toBe("GET");
	expect(request?.url).toBe("https://api.monta.app/api/v1/charge_points/123");
});

test("stop preserves the exact 64-bit string ID and sends a single consumer request", async () => {
	const requests: Request[] = [];
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		requests.push(new Request(String(input), init));
		return Response.json({ state: "stopping" });
	}) as unknown as typeof fetch;
	const client = new MontaClient({ accessToken: "secret" });
	await client.stopCharge("899043696223233671");
	expect(requests).toHaveLength(1);
	expect(requests[0]?.url).toBe("https://api.monta.app/api/v1/charges/899043696223233671/stop");
	expect(requests[0]?.method).toBe("POST");
	await expect(client.stopCharge("../other")).rejects.toThrow("Invalid exact");
	expect(requests).toHaveLength(1);
});

const checkout = (cp: string, host = "https://web-app.monta.app") =>
	`<a href="${host}?cp=${cp}&amp;operator=on&amp;application=on">Start charging</a>`;
test("public ON QR lookup is bounded unauthenticated GET and never follows checkout", async () => {
	const requests: Request[] = [];
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		requests.push(new Request(String(input), init));
		expect(init?.redirect).toBe("error");
		expect(init?.credentials).toBe("omit");
		expect(init?.signal).toBeInstanceOf(AbortSignal);
		return new Response(checkout("6443187"), {
			headers: { "Content-Type": "text/html; charset=utf-8" },
		});
	}) as unknown as typeof fetch;
	expect(
		await new MontaClient({ accessToken: "secret" }).resolveOnQrId("IS*ONP00066-52431-1-1"),
	).toBe(6443187);
	expect(requests).toHaveLength(1);
	expect(requests[0]?.url).toBe("https://app.on.is/d/IS*ONP00066-52431-1-1");
	expect(requests[0]?.method).toBe("GET");
	expect(requests[0]?.headers.get("Authorization")).toBeNull();
	expect(requests[0]?.headers.get("Cookie")).toBeNull();
	expect(requests[0]?.headers.get("UUID")).toBeNull();
});
test("public QR rejects malformed input before fetching", async () => {
	let calls = 0;
	globalThis.fetch = (async () => {
		calls++;
		return new Response("");
	}) as unknown as typeof fetch;
	const client = new MontaClient();
	for (const qr of [
		"https://evil.test",
		"IS*ONP00066-52431-1-1/other",
		"52431",
		`IS*ONP${"1".repeat(130)}-1-1-1`,
	])
		await expect(client.resolveOnQrId(qr)).rejects.toThrow("Invalid complete");
	expect(calls).toBe(0);
});
test("public QR requires a unique allowlisted branded checkout ID", () => {
	expect(onQrCheckoutId(checkout("6443187") + checkout("6443187"))).toBe(6443187);
	for (const html of [
		checkout("6443187", "https://evil.test"),
		checkout("6443187", "https://web-app.monta.app.evil.test"),
		checkout("6443187", "http://web-app.monta.app"),
		checkout("6443187").replace("operator=on", "operator=other"),
		checkout("6443187").replace("application=on", "application=other"),
		checkout("6443187") + checkout("6440034"),
		checkout("6443187&amp;cp=999"),
		checkout("9007199254740993"),
		checkout("-1"),
		checkout("0"),
		`<script>"https://web-app.monta.app?cp=6443187&operator=on&application=on"</script>`,
	])
		expect(() => onQrCheckoutId(html)).toThrow("uniquely resolve");
});
test("public QR rejects oversized, missing, non-HTML and failed responses", async () => {
	const client = new MontaClient();
	for (const response of [
		new Response("not found", { status: 404 }),
		new Response(checkout("6443187"), { headers: { "Content-Type": "application/json" } }),
		new Response("x".repeat(1_000_001), { headers: { "Content-Type": "text/html" } }),
		new Response("missing checkout", { headers: { "Content-Type": "text/html" } }),
	]) {
		globalThis.fetch = (async () => response) as unknown as typeof fetch;
		await expect(client.resolveOnQrId("IS*ONP00066-52431-1-1")).rejects.toThrow();
	}
});
