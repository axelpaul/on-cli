// API response shapes for the ON / Etrel "Dusky" backend.
// Best-effort, captured from live responses (2026-06) — refined as we see more.
// The upstream API uses PascalCase field names; we keep them verbatim.

/** Token response from POST /DuskyWebApi/login (password or refresh_token grant). */
export interface TokenResponse {
	access_token: string;
	token_type: string; // "bearer"
	expires_in: number; // seconds (often a huge value; trust ".expires" instead)
	refresh_token?: string;
	".issued"?: string;
	".expires"?: string; // RFC1123 — the real access-token expiry (~1h)
}

/** Persisted auth state in ~/.config/on/auth.json (0600). */
export interface AuthState {
	accessToken: string;
	refreshToken?: string;
	tokenType: string;
	/** ISO 8601 — when the access token expires (from `.expires`). */
	expiresAt?: string;
	loggedInAt: string; // ISO
	user?: { id?: number; name?: string; email?: string };
}

export interface UserConfig {
	/** Override the API base (defaults to https://app.on.is/DuskyWebApi). */
	baseUrl?: string;
}

// --- users/me -------------------------------------------------------------

export interface Me {
	Id: number;
	IsExternalIdentityProviderLogin?: boolean;
	User?: MeUser;
	[k: string]: unknown;
}

export interface MeUser {
	Id: number;
	FirstName?: string;
	LastName?: string;
	Email?: string;
	IsCompany?: boolean;
	ExternalCode?: string; // kennitala
	GSMNumber?: string;
	Address?: Address;
	Currency?: { CodeShort?: string; NumberOfDecimals?: number };
	UiCulture?: { Id?: string };
	UserType?: { Id?: number; Title?: string };
	RegistrationDate?: string;
	Blocked?: boolean;
	[k: string]: unknown;
}

export interface Address {
	Country?: { Id?: number; Code?: string; ISO2Code?: string; Title?: string };
	CityName?: string;
	PostNumber?: string;
	StreetName?: string;
	HouseNumber?: string;
}

// --- vehicles -------------------------------------------------------------

export interface Vehicle {
	Id: number;
	VehicleBrand?: { Id?: number; Title?: string };
	VehicleModel?: { Id?: number; Title?: string };
	VersionTitle?: string;
	VersionId?: number;
	YearFrom?: number;
	IsDefaultVehicle?: boolean;
	MaximumRange?: number;
	BatteryCapacity?: number;
	ACconnectorType?: { Id?: number; Title?: string };
	ACMaxPower?: number;
	StandardsCompatibility?: Record<string, boolean>;
	[k: string]: unknown;
}

// --- charging sessions ----------------------------------------------------

export interface Paged<T> {
	PagingInfo?: { NumOfRows?: number; PageCount?: number };
	Content: T[];
}

export interface ChargingSession {
	Id: number;
	Number?: number;
	Year?: number;
	ConnectedFrom?: string;
	ConnectedTo?: string;
	ChargingFrom?: string;
	ChargingTo?: string;
	MaxActivePower?: number;
	ActiveEnergyConsumption?: number; // kWh
	Location?: SessionLocation;
	ChargePoint?: { Id?: number; FriendlyCode?: string };
	ChargingType?: { Id?: number; Title?: string };
	Evse?: { Id?: number; FriendlyCode?: string };
	Connector?: { Id?: number; Type?: { Id?: number; Title?: string } };
	TotalCosts?: number;
	CurrencyCode?: string;
	RoamingEvseCode?: string;
	UsedCoupon?: boolean;
	SuppliedByGreenEnergy?: boolean;
	CO2Saving?: number;
	[k: string]: unknown;
}

export interface SessionLocation {
	Id?: number;
	FriendlyCode?: string;
	FriendlyName?: string;
	Address?: Address;
	Access?: { GPSLongitude?: number; GPSLatitude?: number };
	[k: string]: unknown;
}

// --- live / online + periodic --------------------------------------------

export interface OnlineData {
	PendingUserRequestsCount?: number;
	CurrentSessions?: unknown[];
	UpcomingReservations?: unknown[];
	CouponsCount?: number;
	[k: string]: unknown;
}

export interface PeriodicData {
	PendingUserRequestsCount?: number;
	UnpaidInvoicesCount?: number;
	[k: string]: unknown;
}

// --- RFID identifications ("ON keys") -------------------------------------

export interface RfidCard {
	Id: number;
	Number?: string;
	Code?: string;
	ValidFrom?: string;
	Blocked?: boolean;
	Expired?: boolean;
	[k: string]: unknown;
}

// --- invoices -------------------------------------------------------------

export interface Invoice {
	InvoiceId: number;
	Number?: number;
	Year?: number;
	DisplayNumber?: string;
	TotalAmountWithTax?: number;
	PaidAmount?: number;
	CurrencyCode?: string;
	InsertedTime?: string;
	Paid?: boolean;
	DisplayStatusTitle?: string;
	DownloadAvailable?: boolean;
	[k: string]: unknown;
}

// --- locations (public) ---------------------------------------------------

export interface Location {
	Id: number;
	FriendlyName?: string;
	FriendlyCode?: string;
	Address?: Address;
	GeoCoordinates?: { GPSLongitude?: number; GPSLatitude?: number };
	Status?: number;
	AvailableEvses?: number;
	TotalEvses?: number;
	IsPrivate?: boolean;
	Type?: number;
	[k: string]: unknown;
}
