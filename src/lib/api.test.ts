import { describe, expect, test } from "bun:test";
import { defaultBaseUrl, paged, USER_AGENT } from "./api.ts";

describe("defaultBaseUrl", () => {
	test("falls back to production", () => {
		const prev = process.env.ON_BASE_URL;
		delete process.env.ON_BASE_URL;
		expect(defaultBaseUrl()).toBe("https://app.on.is/DuskyWebApi");
		if (prev !== undefined) process.env.ON_BASE_URL = prev;
	});
	test("honors config override and strips trailing slash", () => {
		const prev = process.env.ON_BASE_URL;
		delete process.env.ON_BASE_URL;
		expect(defaultBaseUrl("https://example.test/api/")).toBe("https://example.test/api");
		if (prev !== undefined) process.env.ON_BASE_URL = prev;
	});
	test("ON_BASE_URL env wins", () => {
		const prev = process.env.ON_BASE_URL;
		process.env.ON_BASE_URL = "https://env.test/x";
		expect(defaultBaseUrl("https://config.test")).toBe("https://env.test/x");
		if (prev === undefined) delete process.env.ON_BASE_URL;
		else process.env.ON_BASE_URL = prev;
	});
});

describe("paged", () => {
	test("extracts Content array", () => {
		expect(paged({ Content: [1, 2, 3] })).toEqual([1, 2, 3]);
	});
	test("handles missing/empty envelopes", () => {
		expect(paged(undefined)).toEqual([]);
		expect(paged({ Content: [] })).toEqual([]);
	});
});

describe("USER_AGENT", () => {
	test("matches the app's UA (required by the WAF)", () => {
		expect(USER_AGENT).toContain("is.on.charge.android");
	});
});
