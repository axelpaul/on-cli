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

	async getChargePoints(): Promise<unknown> {
		if (!this.accessToken) throw new MontaError("Monta login required", 401);
		return this.request("/api/v1/charge_points");
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
