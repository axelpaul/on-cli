// OnClient — typed wrapper around the ON / Etrel "Dusky" backend.
//
// Reverse-engineered from the `is.on.charge.android` app (v2025.7.5) via mitmproxy.
// Auth is a plain OAuth2 password grant against POST /DuskyWebApi/login:
//   email=…&password=…&grant_type=password  →  { access_token, refresh_token, .expires }
// Authenticated calls carry `Authorization: bearer <access_token>` (lowercase).
// Access tokens last ~1h; we refresh transparently with the refresh_token.

import type {
	AuthState,
	ChargingCommandBody,
	ChargingCommandResponse,
	ChargingSession,
	CurrentSession,
	Invoice,
	Location,
	Me,
	OnlineData,
	Paged,
	PeriodicData,
	ResultCodeResponse,
	RfidCard,
	StopResponse,
	TokenResponse,
	Vehicle,
} from "./types.ts";

export const DEFAULT_TIMEOUT_MS = 30_000;

const PROD_BASE = "https://app.on.is/DuskyWebApi";

/** Base URL: $ON_BASE_URL wins, else the stored config value, else production. */
export function defaultBaseUrl(configBase?: string): string {
	return (process.env.ON_BASE_URL || configBase || PROD_BASE).replace(/\/$/, "");
}

// The app identifies itself with this UA; the API/WAF 403s requests without it.
export const USER_AGENT =
	"is.on.charge.android v.2025.7.5 == Android-15;sdk_gphone64_x86_64;SDK:35";

export class ApiError extends Error {
	constructor(
		message: string,
		public status: number,
		public body?: unknown,
	) {
		super(message);
		this.name = "ApiError";
	}
}

export class AuthError extends ApiError {
	constructor(message = "Authentication required") {
		super(message, 401);
		this.name = "AuthError";
	}
}

export interface OnClientOptions {
	baseUrl?: string;
	accessToken?: string;
	refreshToken?: string;
	/** ISO 8601 access-token expiry; triggers a proactive refresh when near. */
	expiresAt?: string;
	timeoutMs?: number;
	/** Called whenever tokens are refreshed, so the caller can persist them. */
	onRefresh?: (state: AuthState) => void;
}

export class OnClient {
	private baseUrl: string;
	private accessToken: string | undefined;
	private refreshToken: string | undefined;
	private expiresAt: string | undefined;
	private timeoutMs: number;
	private onRefresh: ((state: AuthState) => void) | undefined;

	constructor(opts: OnClientOptions = {}) {
		this.baseUrl = (opts.baseUrl ?? defaultBaseUrl()).replace(/\/$/, "");
		this.accessToken = opts.accessToken;
		this.refreshToken = opts.refreshToken;
		this.expiresAt = opts.expiresAt;
		this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.onRefresh = opts.onRefresh;
	}

	static fromAuth(auth: AuthState | null, opts: Partial<OnClientOptions> = {}): OnClient {
		return new OnClient({
			accessToken: auth?.accessToken,
			refreshToken: auth?.refreshToken,
			expiresAt: auth?.expiresAt,
			...opts,
		});
	}

	getAccessToken(): string | undefined {
		return this.accessToken;
	}

	// --- low-level HTTP -----------------------------------------------------

	private headers(extra: Record<string, string> = {}): Record<string, string> {
		const h: Record<string, string> = {
			Accept: "application/json",
			"User-Agent": USER_AGENT,
			...extra,
		};
		if (this.accessToken) h.Authorization = `bearer ${this.accessToken}`;
		return h;
	}

	private async raw(
		method: string,
		path: string,
		opts: { body?: string; headers?: Record<string, string>; timeoutMs?: number } = {},
	): Promise<Response> {
		const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
		const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
		const signal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
		return fetch(url, {
			method,
			headers: this.headers(opts.headers),
			body: opts.body,
			redirect: "follow",
			signal,
		});
	}

	private async parse<T>(res: Response, method: string, path: string): Promise<T> {
		const text = await res.text();
		let parsed: unknown;
		if (text.length > 0) {
			try {
				parsed = JSON.parse(text);
			} catch {
				parsed = text;
			}
		}
		if (!res.ok) {
			if (res.status === 401 || res.status === 403) {
				throw new AuthError(`${method} ${path}: ${res.status}`);
			}
			throw new ApiError(
				`${method} ${path}: ${res.status} ${truncate(text, 200)}`,
				res.status,
				parsed,
			);
		}
		return parsed as T;
	}

	/** Authenticated GET with proactive + reactive token refresh. */
	private async get<T>(path: string): Promise<T> {
		await this.refreshIfNearExpiry();
		let res = await this.raw("GET", path);
		if ((res.status === 401 || res.status === 403) && this.refreshToken) {
			await this.refresh();
			res = await this.raw("GET", path);
		}
		return this.parse<T>(res, "GET", path);
	}

	/** Authenticated POST (JSON body) with the same refresh handling. */
	private async post<T>(path: string, body?: unknown): Promise<T> {
		await this.refreshIfNearExpiry();
		const send = () =>
			this.raw("POST", path, {
				headers: body !== undefined ? { "Content-Type": "application/json" } : {},
				body: body !== undefined ? JSON.stringify(body) : undefined,
			});
		let res = await send();
		if ((res.status === 401 || res.status === 403) && this.refreshToken) {
			await this.refresh();
			res = await send();
		}
		return this.parse<T>(res, "POST", path);
	}

	// --- auth ---------------------------------------------------------------

	/** Password grant. Unauthenticated; returns the raw token response. */
	async login(email: string, password: string): Promise<TokenResponse> {
		const res = await this.raw("POST", "/login", {
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ email, password, grant_type: "password" }).toString(),
		});
		const tok = await this.parse<TokenResponse>(res, "POST", "/login");
		this.applyToken(tok);
		return tok;
	}

	/** Refresh-token grant. Updates this client and fires onRefresh. */
	async refresh(): Promise<TokenResponse> {
		if (!this.refreshToken) throw new AuthError("No refresh token available");
		const res = await this.raw("POST", "/login", {
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				refresh_token: this.refreshToken,
				grant_type: "refresh_token",
			}).toString(),
		});
		if (res.status === 400 || res.status === 401) {
			throw new AuthError("Refresh token rejected");
		}
		const tok = await this.parse<TokenResponse>(res, "POST", "/login (refresh)");
		this.applyToken(tok);
		this.onRefresh?.(this.toAuthState());
		return tok;
	}

	private async refreshIfNearExpiry(): Promise<void> {
		if (!this.refreshToken || !this.expiresAt) return;
		const exp = Date.parse(this.expiresAt);
		if (!Number.isFinite(exp)) return;
		// Refresh if the token expires within the next 60s.
		if (exp - Date.now() < 60_000) {
			try {
				await this.refresh();
			} catch {
				// Fall through; the reactive 401 path will surface a clean AuthError.
			}
		}
	}

	private applyToken(tok: TokenResponse): void {
		this.accessToken = tok.access_token;
		if (tok.refresh_token) this.refreshToken = tok.refresh_token;
		this.expiresAt = tok[".expires"] ? new Date(tok[".expires"]).toISOString() : undefined;
	}

	toAuthState(user?: AuthState["user"]): AuthState {
		return {
			accessToken: this.accessToken ?? "",
			refreshToken: this.refreshToken,
			tokenType: "bearer",
			expiresAt: this.expiresAt,
			loggedInAt: new Date().toISOString(),
			user,
		};
	}

	// --- typed endpoints ----------------------------------------------------

	getMe(): Promise<Me> {
		return this.get<Me>("/api/users/me");
	}

	getVehicles(): Promise<Vehicle[]> {
		return this.get<Vehicle[]>("/api/me/user/vehicles");
	}

	getChargingSessions(): Promise<Paged<ChargingSession>> {
		return this.get<Paged<ChargingSession>>("/api/chargingSessions");
	}

	getChargingSession(id: number | string): Promise<ChargingSession> {
		return this.get<ChargingSession>(`/api/chargingSessions/${encodeURIComponent(String(id))}`);
	}

	getOnlineData(): Promise<OnlineData> {
		return this.get<OnlineData>("/api/onlineData");
	}

	// --- charging commands (mutating) ---------------------------------------
	// Verified against the decompiled DuskyPrivateService/Requester (v2025.7.5).

	startCharging(body: ChargingCommandBody): Promise<ChargingCommandResponse> {
		return this.post<ChargingCommandResponse>("/api/commands/remoteStartTransaction", body);
	}

	stopCharging(body: ChargingCommandBody): Promise<StopResponse> {
		return this.post<StopResponse>("/api/commands/remoteStopTransaction", body);
	}

	/** Force-stop by connector id. Simpler fallback when the graceful stop fails. */
	stopChargingForce(connectorId: number): Promise<ResultCodeResponse> {
		return this.post<ResultCodeResponse>(
			`/api/chargingSessions/forceStop/${encodeURIComponent(String(connectorId))}`,
		);
	}

	getPeriodicData(): Promise<PeriodicData> {
		return this.get<PeriodicData>("/api/periodicData");
	}

	getRfidCards(): Promise<RfidCard[]> {
		return this.get<RfidCard[]>("/api/identifications/rfidcards");
	}

	getInvoices(): Promise<Paged<Invoice>> {
		return this.get<Paged<Invoice>>("/api/invoices-user");
	}

	/** Public — charger locations near a point. No auth required. */
	getLocations(q: LocationQuery): Promise<Location[]> {
		const params = new URLSearchParams({
			searchLatitude: String(q.lat),
			searchLongitude: String(q.lng),
			searchRadius: String(q.radius ?? 25),
			poiTypes: "",
			connectorTypes: q.connectorTypes ?? "",
			minimumPower: String(q.minimumPower ?? 0),
			showAlsoRoaming: String(q.roaming ?? false),
			onlyCurrentlyAvailable: String(q.available ?? false),
			onlyFreeOfCharge: String(q.free ?? false),
			userLatitude: String(q.lat),
			userLongitude: String(q.lng),
		});
		return this.get<Location[]>(`/api/locations?${params.toString()}`);
	}
}

export interface LocationQuery {
	lat: number;
	lng: number;
	radius?: number;
	connectorTypes?: string;
	minimumPower?: number;
	roaming?: boolean;
	available?: boolean;
	free?: boolean;
}

function truncate(s: string, n: number): string {
	return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function paged<T>(p: Paged<T> | undefined): T[] {
	return p && Array.isArray(p.Content) ? p.Content : [];
}

/** True when a session is roaming (RoamingActor has an Id and platform ≠ 5).
 * Mirrors CurrentSessionScheme.isRoaming() from the app. */
export function isRoamingSession(s: CurrentSession): boolean {
	const actor = s.RoamingActor;
	if (!actor || actor.Id == null) return false;
	const platformId = actor.RoamingPlatform?.Id;
	return platformId == null || platformId !== 5;
}

export interface StopTarget {
	body: ChargingCommandBody;
	roaming: boolean;
	connectorId?: number;
	location?: string;
}

/** Build the exact remoteStopTransaction body from a live CurrentSession,
 * replicating the app's EvseCode construction:
 *   non-roaming: `${ChargePoint.FriendlyCode}-${Evse.FriendlyCode}-${Connector.Code}`
 *   roaming:     `${Evse.FriendlyCode}`
 * Throws if the session is missing the identifiers needed to stop it. */
export function buildStopTarget(s: CurrentSession): StopTarget {
	const roaming = isRoamingSession(s);
	const cpCode = s.ChargePoint?.FriendlyCode;
	const evseCode = s.Evse?.FriendlyCode;
	const connCode = s.Connector?.Code;
	const chargePointId = s.ChargePoint?.Id;
	const connectorId = s.Connector?.Id;

	const EvseCode = roaming
		? evseCode
		: cpCode != null && evseCode != null && connCode != null
			? `${cpCode}-${evseCode}-${connCode}`
			: undefined;

	if (!EvseCode) {
		throw new ApiError(
			"Active session is missing EVSE identifiers; cannot build a stop command.",
			0,
			s,
		);
	}

	return {
		body: { EvseCode, ChargePointId: chargePointId, ConnectorId: connectorId, SocLimits: false },
		roaming,
		connectorId,
		location: s.Location?.FriendlyName,
	};
}
