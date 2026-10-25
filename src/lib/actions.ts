// Shared read/write operations used by BOTH the CLI commands and the MCP server.
// Each function takes a ready client and returns the curated, snake_case shape
// the CLI prints with --json. Keep request logic here (or in api.ts / monta.ts)
// so the CLI and MCP can't drift apart.

import {
	buildStopTarget,
	isRoamingSession,
	type LocationQuery,
	type OnClient,
	paged,
} from "./api.ts";
import { addressLine } from "./format.ts";
import type { ChargingCommandBody, ChargingSession, Me } from "./types.ts";

// Central Reykjavík — the default search point for `locations`.
export const DEFAULT_LAT = 64.1466;
export const DEFAULT_LNG = -21.9426;
export const DEFAULT_RADIUS_KM = 25;

export function summarizeAccount(me: Me) {
	const u = me.User;
	return {
		user_id: u?.Id,
		name: [u?.FirstName, u?.LastName].filter(Boolean).join(" ").trim() || null,
		email: u?.Email ?? null,
		kennitala: u?.ExternalCode ?? null,
		phone: u?.GSMNumber ?? null,
		country: u?.Address?.Country?.Code ?? null,
		currency: u?.Currency?.CodeShort ?? null,
		language: u?.UiCulture?.Id ?? null,
		user_type: u?.UserType?.Title ?? null,
		registered: u?.RegistrationDate ?? null,
		blocked: u?.Blocked ?? null,
	};
}

export async function getAccount(client: OnClient) {
	return summarizeAccount(await client.getMe());
}

export async function listVehicles(client: OnClient) {
	const vehicles = await client.getVehicles();
	return {
		vehicles: vehicles.map((v) => ({
			id: v.Id,
			brand: v.VehicleBrand?.Title ?? null,
			model: v.VehicleModel?.Title ?? null,
			version: v.VersionTitle ?? null,
			year_from: v.YearFrom ?? null,
			is_default: v.IsDefaultVehicle ?? false,
			battery_kwh: v.BatteryCapacity ?? null,
			range_km: v.MaximumRange ?? null,
			ac_connector: v.ACconnectorType?.Title ?? null,
			ac_max_power_kw: v.ACMaxPower ?? null,
		})),
	};
}

export function summarizeSession(s: ChargingSession) {
	return {
		id: s.Id,
		number: s.Number ?? null,
		location: s.Location?.FriendlyName ?? s.Location?.FriendlyCode ?? null,
		address: addressLine(s.Location?.Address),
		connected_from: s.ConnectedFrom ?? null,
		connected_to: s.ConnectedTo ?? null,
		charging_from: s.ChargingFrom ?? null,
		charging_to: s.ChargingTo ?? null,
		energy_kwh: s.ActiveEnergyConsumption ?? null,
		max_power_kw: s.MaxActivePower ?? null,
		cost: s.TotalCosts ?? null,
		currency: s.CurrencyCode ?? null,
		connector: s.Connector?.Type?.Title ?? null,
		green_energy: s.SuppliedByGreenEnergy ?? null,
		co2_saving_kg: s.CO2Saving ?? null,
	};
}

export async function listSessions(client: OnClient, limit = 20) {
	const page = await client.getChargingSessions();
	const all = paged(page);
	const rows = all.slice(0, Math.max(0, limit));
	return {
		total: page.PagingInfo?.NumOfRows ?? all.length,
		returned: rows.length,
		sessions: rows.map(summarizeSession),
	};
}

export async function getSession(client: OnClient, id: string | number) {
	return summarizeSession(await client.getChargingSession(id));
}

export async function liveStatus(client: OnClient) {
	const [online, periodic] = await Promise.all([client.getOnlineData(), client.getPeriodicData()]);
	return {
		current_sessions: online.CurrentSessions ?? [],
		upcoming_reservations: online.UpcomingReservations ?? [],
		coupons: online.CouponsCount ?? 0,
		pending_requests: periodic.PendingUserRequestsCount ?? online.PendingUserRequestsCount ?? 0,
		unpaid_invoices: periodic.UnpaidInvoicesCount ?? 0,
	};
}

export async function listKeys(client: OnClient) {
	const cards = await client.getRfidCards();
	return {
		keys: cards.map((c) => ({
			id: c.Id,
			number: c.Number ?? null,
			code: c.Code ?? null,
			valid_from: c.ValidFrom ?? null,
			blocked: c.Blocked ?? false,
			expired: c.Expired ?? false,
		})),
	};
}

export async function listInvoices(client: OnClient, limit = 20) {
	const page = await client.getInvoices();
	const all = paged(page);
	const rows = all.slice(0, Math.max(0, limit)).map((i) => ({
		id: i.InvoiceId,
		number: i.DisplayNumber ?? (i.Number != null ? String(i.Number) : null),
		date: i.InsertedTime ?? null,
		amount: i.TotalAmountWithTax ?? null,
		paid_amount: i.PaidAmount ?? null,
		currency: i.CurrencyCode ?? null,
		paid: i.Paid ?? null,
		status: i.DisplayStatusTitle ?? null,
		downloadable: i.DownloadAvailable ?? false,
	}));
	return { total: page.PagingInfo?.NumOfRows ?? all.length, returned: rows.length, invoices: rows };
}

export async function findLocations(client: OnClient, q: LocationQuery, limit = 25) {
	const locations = await client.getLocations(q);
	const rows = locations.slice(0, Math.max(0, limit)).map((l) => ({
		id: l.Id,
		name: l.FriendlyName ?? l.FriendlyCode ?? null,
		address: addressLine(l.Address),
		available_evses: l.AvailableEvses ?? null,
		total_evses: l.TotalEvses ?? null,
		lat: l.GeoCoordinates?.GPSLatitude ?? null,
		lng: l.GeoCoordinates?.GPSLongitude ?? null,
		private: l.IsPrivate ?? false,
	}));
	return {
		query: { lat: q.lat, lng: q.lng, radius: q.radius ?? DEFAULT_RADIUS_KM },
		count: locations.length,
		returned: rows.length,
		locations: rows,
	};
}

// --- mutating -----------------------------------------------------------

export interface StopResult {
	stopped: boolean;
	reason?: "no_active_session";
	method?: "remoteStop" | "forceStop";
	where?: string;
	result_code?: number | null;
	error?: string | null;
}

/** Describe what `stopActiveCharging` would act on, without sending anything. */
export async function findActiveSession(client: OnClient) {
	const online = await client.getOnlineData();
	const session = online.CurrentSessions?.[0];
	if (!session) return null;
	const target = buildStopTarget(session);
	return { session, target, where: target.location ?? target.body.EvseCode };
}

/** Stop the first active charging session. Roaming sessions (or `force`) use the
 * connector-level forceStop; otherwise the app's remoteStopTransaction. */
export async function stopActiveCharging(
	client: OnClient,
	opts: { force?: boolean } = {},
): Promise<StopResult> {
	const active = await findActiveSession(client);
	if (!active) return { stopped: false, reason: "no_active_session" };
	const { session, target, where } = active;
	if (opts.force || isRoamingSession(session)) {
		if (target.connectorId == null) throw new Error("No connector id on the active session.");
		const res = await client.stopChargingForce(target.connectorId);
		return {
			stopped: res.resultCode === 0 || res.resultCode === undefined,
			method: "forceStop",
			where,
			result_code: res.resultCode ?? null,
		};
	}
	const res = await client.stopCharging(target.body);
	return {
		stopped: res.ResultCode === 0 || res.ResultCode === undefined,
		method: "remoteStop",
		where,
		result_code: res.ResultCode ?? null,
		error: res.ErrorDescription ?? null,
	};
}

export interface StartInput {
	evse: string;
	connector: number;
	preauth?: number;
	coupon?: number;
}

export function startBody(input: StartInput): ChargingCommandBody {
	return {
		EvseCode: input.evse,
		ConnectorId: input.connector,
		PreauthorizationId: input.preauth,
		CouponId: input.coupon,
		SocLimits: false,
	};
}

export async function startCharging(client: OnClient, input: StartInput) {
	const res = await client.startCharging(startBody(input));
	return {
		started: res.ResultCode === 0 || res.ResultCode === undefined,
		charging_authorization_id: res.ChargingAuthorizationId ?? null,
		result_code: res.ResultCode ?? null,
		error: res.ErrorDescription ?? null,
	};
}
