import { describe, expect, test } from "bun:test";
import { addressLine, dateOnly, dateTime, duration, kwh, money } from "./format.ts";

describe("money", () => {
	test("ISK has no decimals and thousands separators", () => {
		expect(money(1256, "ISK")).toBe("1,256 ISK");
	});
	test("EUR keeps two decimals", () => {
		expect(money(12.5, "EUR")).toBe("12.50 EUR");
	});
	test("nullish → em dash", () => {
		expect(money(null)).toBe("—");
		expect(money(undefined)).toBe("—");
	});
});

describe("kwh", () => {
	test("one decimal", () => {
		expect(kwh(12.345)).toBe("12.3 kWh");
	});
	test("nullish → em dash", () => {
		expect(kwh(null)).toBe("—");
	});
});

describe("dateTime / dateOnly", () => {
	test("formats an ISO timestamp", () => {
		// Use a UTC instant and assert the date part (TZ-independent slice).
		expect(dateOnly("2026-06-05T23:02:45Z")).toBe("2026-06-05");
	});
	test("passes through unparseable input", () => {
		expect(dateTime("not-a-date")).toBe("not-a-date");
	});
	test("nullish → em dash", () => {
		expect(dateTime(null)).toBe("—");
	});
});

describe("duration", () => {
	test("hours and minutes", () => {
		expect(duration("2026-06-05T10:00:00Z", "2026-06-05T11:23:00Z")).toBe("1h 23m");
	});
	test("minutes only", () => {
		expect(duration("2026-06-05T10:00:00Z", "2026-06-05T10:42:00Z")).toBe("42m");
	});
	test("missing or reversed → em dash", () => {
		expect(duration(undefined, "2026-06-05T10:00:00Z")).toBe("—");
		expect(duration("2026-06-05T11:00:00Z", "2026-06-05T10:00:00Z")).toBe("—");
	});
});

describe("addressLine", () => {
	test("joins street + city", () => {
		expect(
			addressLine({
				StreetName: "Sólheimar",
				HouseNumber: "23a",
				PostNumber: "104",
				CityName: "Reykjavík",
			}),
		).toBe("Sólheimar 23a, 104 Reykjavík");
	});
	test("empty → em dash", () => {
		expect(addressLine({})).toBe("—");
		expect(addressLine(undefined)).toBe("—");
	});
});
