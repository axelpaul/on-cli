// Pure formatting helpers. Kept side-effect free so they're easy to unit test.

/** Format a number as money with a currency code, e.g. (1256, "ISK") → "1,256 ISK". */
export function money(amount: number | undefined | null, currency = "ISK"): string {
	if (amount == null || !Number.isFinite(amount)) return "—";
	const decimals = currency === "ISK" ? 0 : 2;
	const n = amount.toLocaleString("en-US", {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals,
	});
	return `${n} ${currency}`;
}

/** kWh with one decimal, e.g. 12.345 → "12.3 kWh". */
export function kwh(v: number | undefined | null): string {
	if (v == null || !Number.isFinite(v)) return "—";
	return `${v.toFixed(1)} kWh`;
}

/** Render an ISO/parseable timestamp as "YYYY-MM-DD HH:MM" (local), or "—". */
export function dateTime(s: string | undefined | null): string {
	if (!s) return "—";
	const t = Date.parse(s);
	if (!Number.isFinite(t)) return s;
	const d = new Date(t);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Just the date portion: "YYYY-MM-DD". */
export function dateOnly(s: string | undefined | null): string {
	const dt = dateTime(s);
	return dt === "—" ? dt : dt.slice(0, 10);
}

/** Duration between two timestamps as "1h 23m", or "—" if either is missing. */
export function duration(from?: string | null, to?: string | null): string {
	if (!from || !to) return "—";
	const a = Date.parse(from);
	const b = Date.parse(to);
	if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return "—";
	const mins = Math.round((b - a) / 60000);
	const h = Math.floor(mins / 60);
	const m = mins % 60;
	return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Join non-empty address parts into a one-liner. */
export function addressLine(addr?: {
	StreetName?: string;
	HouseNumber?: string;
	PostNumber?: string;
	CityName?: string;
}): string {
	if (!addr) return "—";
	const street = [addr.StreetName, addr.HouseNumber].filter(Boolean).join(" ");
	const city = [addr.PostNumber, addr.CityName].filter(Boolean).join(" ");
	return [street, city].filter(Boolean).join(", ") || "—";
}
