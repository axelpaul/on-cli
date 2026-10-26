import { randomUUID } from "node:crypto";
import type { MontaAuthState } from "./storage.ts";

const BASE_URL = "https://api.monta.app";

export class MontaError extends Error {
	constructor(
		message: string,
		public status: number,
	) {
		super(message);
		this.name = "MontaError";
	}
}

/** The current ON app uses Monta's consumer API, not the retired Dusky API. */
export class MontaClient {
	readonly uuid: string;
	private accessToken?: string;

	constructor(auth?: Partial<MontaAuthState>) {
		this.uuid = auth?.uuid ?? randomUUID();
		this.accessToken = auth?.accessToken;
	}

	private async request(path: string, options: RequestInit = {}): Promise<unknown> {
		const headers = new Headers(options.headers);
		headers.set("Accept", "application/json");
		headers.set("Operator", "on");
		headers.set("Application", "on");
		headers.set("Meta", "web;production;0.3.0;linux;on-cli");
		headers.set("UUID", this.uuid);
		headers.set("Timezone", "Atlantic/Reykjavik");
		headers.set("Accept-Language", "en");
		headers.set("User-Agent", "on-cli/0.3.0");
		if (this.accessToken) headers.set("Authorization", `Bearer ${this.accessToken}`);
		const response = await fetch(`${BASE_URL}${path}`, {
			...options,
			headers,
			signal: AbortSignal.timeout(20_000),
		});
		if (!response.ok) {
			// Never include response bodies: auth/security responses may contain private data.
			throw new MontaError(
				`${options.method ?? "GET"} ${path}: HTTP ${response.status}`,
				response.status,
			);
		}
		return response.json();
	}

	async login(email: string, password: string): Promise<MontaAuthState> {
		const result = await this.request("/api/v1/auth/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email, password }),
		});
		const accessToken = extractAccessToken(result);
		if (!accessToken) throw new MontaError("Login succeeded, but no access token was found", 0);
		this.accessToken = accessToken;
		return { accessToken, uuid: this.uuid, loggedInAt: new Date().toISOString() };
	}

	async getMe(): Promise<Record<string, unknown>> {
		if (!this.accessToken) throw new MontaError("Monta login required", 401);
		return (await this.request("/api/v1/users/me")) as Record<string, unknown>;
	}

	async getVehicles(): Promise<unknown> {
		if (!this.accessToken) throw new MontaError("Monta login required", 401);
		return this.request("/api/v1/vehicles");
	}

	async getCharges(): Promise<unknown> {
		if (!this.accessToken) throw new MontaError("Monta login required", 401);
		return this.request("/api/v1/charges");
	}

	async getChargePoint(id: number): Promise<unknown> {
		assertChargePointId(id);
		if (!this.accessToken) throw new MontaError("Monta login required", 401);
		return this.request(`/api/v1/charge_points/${id}`);
	}

	/** Public ON deep-link page resolves printed EVSE IDs without account history. */
	async resolveOnQrId(input: string): Promise<number> {
		const qr = input.trim().toUpperCase();
		if (qr.length > 128 || !/^IS\*ONP\d+-\d+-\d+-\d+$/.test(qr))
			throw new MontaError("Invalid complete ON QR identifier", 0);
		// Do not forward account credentials/cookies to the public page, follow
		// redirects, execute scripts, or visit the returned checkout URL.
		const response = await fetch(`https://app.on.is/d/${encodeURIComponent(qr)}`, {
			headers: { Accept: "text/html" },
			credentials: "omit",
			redirect: "error",
			signal: AbortSignal.timeout(20_000),
		});
		if (!response.ok)
			throw new MontaError(`ON public QR lookup: HTTP ${response.status}`, response.status);
		if (!response.headers.get("content-type")?.toLowerCase().includes("text/html"))
			throw new MontaError("Unexpected ON public QR lookup content type", 0);
		const reader = response.body?.getReader();
		if (!reader) throw new MontaError("Empty ON public QR lookup response", 0);
		const decoder = new TextDecoder();
		let html = "";
		let size = 0;
		try {
			while (true) {
				const chunk = await reader.read();
				if (chunk.done) break;
				size += chunk.value.byteLength;
				if (size > 1_000_000) {
					await reader.cancel();
					throw new MontaError("ON public QR lookup response too large", 0);
				}
				html += decoder.decode(chunk.value, { stream: true });
			}
			html += decoder.decode();
		} finally {
			reader.releaseLock();
		}
		return onQrCheckoutId(html);
	}

	async startCharge(id: number): Promise<unknown> {
		assertChargePointId(id);
		if (!this.accessToken) throw new MontaError("Monta login required", 401);
		return this.request("/api/v1/charges/start", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ charge_point_id: id }),
		});
	}

	async stopCharge(sessionId: string): Promise<unknown> {
		if (!/^\d+$/.test(sessionId)) throw new MontaError("Invalid exact session ID", 0);
		if (!this.accessToken) throw new MontaError("Monta login required", 401);
		return this.request(`/api/v1/charges/${sessionId}/stop`, { method: "POST" });
	}

	async getChargePoints(groupId?: number): Promise<unknown> {
		if (!this.accessToken) throw new MontaError("Monta login required", 401);
		if (groupId !== undefined) assertChargePointId(groupId);
		return this.request(
			`/api/v1/charge_points${groupId === undefined ? "" : `?charge_point_group_id=${groupId}`}`,
		);
	}
}

export function extractAccessToken(result: unknown): string | undefined {
	if (!result || typeof result !== "object") return undefined;
	const top = result as Record<string, unknown>;
	const token = top.token;
	if (typeof token === "string") return token;
	if (!token || typeof token !== "object") return undefined;
	const nested = token as Record<string, unknown>;
	for (const key of ["access_token", "accessToken", "access", "token", "jwt"]) {
		if (typeof nested[key] === "string" && nested[key]) return nested[key] as string;
	}
	return undefined;
}

function assertChargePointId(id: number): void {
	if (!Number.isSafeInteger(id) || id <= 0)
		throw new MontaError("Invalid Monta charge-point ID", 0);
}

/** Parse only ON-branded official checkout anchors, never page scripts or numbers. */
export function onQrCheckoutId(html: string): number {
	const ids = new Set<number>();
	for (const match of html.matchAll(/<a\b[^>]*\shref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
		const href = match[1]!.replace(/&amp;|&#0*38;|&#x0*26;/gi, "&");
		let url: URL;
		try {
			url = new URL(href);
		} catch {
			continue;
		}
		if (
			url.origin !== "https://web-app.monta.app" ||
			url.username ||
			url.password ||
			url.pathname !== "/"
		)
			continue;
		if (
			url.searchParams.getAll("cp").length !== 1 ||
			url.searchParams.getAll("operator").length !== 1 ||
			url.searchParams.getAll("application").length !== 1 ||
			url.searchParams.get("operator") !== "on" ||
			url.searchParams.get("application") !== "on"
		)
			continue;
		const cp = url.searchParams.get("cp")!;
		const id = Number(cp);
		if (!/^[1-9]\d*$/.test(cp) || !Number.isSafeInteger(id)) continue;
		ids.add(id);
	}
	if (ids.size !== 1)
		throw new MontaError("Cannot uniquely resolve ON QR from official checkout link", 0);
	return [...ids][0]!;
}
