// on schema — print the JSON response shape for a command.
//
// Agents call `on schema sessions --json` once to learn the shape they'll get
// back from `on sessions --json`. Hand-curated — this is the contract.

import { color, die, isJsonMode, printJson } from "../lib/output.ts";

interface SchemaFlags {
	json?: boolean;
	pretty?: boolean;
	command?: string;
}

interface CommandSchema {
	command: string;
	mutating: boolean;
	requires_auth: boolean;
	shape: unknown;
}

const SCHEMAS: Record<string, CommandSchema> = {
	whoami: {
		command: "whoami",
		mutating: false,
		requires_auth: true,
		shape: {
			user_id: "number",
			name: "string | null",
			email: "string | null",
			kennitala: "string | null",
			phone: "string | null",
			country: "string | null",
			currency: "string | null",
			language: "string | null",
			user_type: "string | null",
			registered: "string (ISO) | null",
			blocked: "boolean | null",
		},
	},
	vehicles: {
		command: "vehicles",
		mutating: false,
		requires_auth: true,
		shape: {
			vehicles: [
				{
					id: "number",
					brand: "string | null",
					model: "string | null",
					version: "string | null",
					year_from: "number | null",
					is_default: "boolean",
					battery_kwh: "number | null",
					range_km: "number | null",
					ac_connector: "string | null",
					ac_max_power_kw: "number | null",
				},
			],
		},
	},
	sessions: {
		command: "sessions",
		mutating: false,
		requires_auth: true,
		shape: {
			total: "number",
			returned: "number",
			sessions: [
				{
					id: "number",
					number: "number | null",
					location: "string | null",
					address: "string",
					connected_from: "string (ISO) | null",
					connected_to: "string (ISO) | null",
					charging_from: "string (ISO) | null",
					charging_to: "string (ISO) | null",
					energy_kwh: "number | null",
					max_power_kw: "number | null",
					cost: "number | null",
					currency: "string | null",
					connector: "string | null",
					green_energy: "boolean | null",
					co2_saving_kg: "number | null",
				},
			],
		},
	},
	live: {
		command: "live",
		mutating: false,
		requires_auth: true,
		shape: {
			current_sessions: "object[]  (empty when not charging)",
			upcoming_reservations: "object[]",
			coupons: "number",
			pending_requests: "number",
			unpaid_invoices: "number",
		},
	},
	stop: {
		command: "stop",
		mutating: true,
		requires_auth: true,
		shape: {
			stopped: "boolean",
			method: "'remoteStop' | 'forceStop'",
			where: "string  (location or EvseCode)",
			result_code: "number | null  (0 = success)",
			error: "string | null",
			reason: "'no_active_session' | 'cancelled'  (only when stopped=false without an attempt)",
		},
	},
	start: {
		command: "start",
		mutating: true,
		requires_auth: true,
		shape: {
			started: "boolean",
			charging_authorization_id: "number | null",
			result_code: "number | null  (0 = success)",
			error: "string | null",
		},
	},
	keys: {
		command: "keys",
		mutating: false,
		requires_auth: true,
		shape: {
			keys: [
				{
					id: "number",
					number: "string | null",
					code: "string | null",
					valid_from: "string (ISO) | null",
					blocked: "boolean",
					expired: "boolean",
				},
			],
		},
	},
	invoices: {
		command: "invoices",
		mutating: false,
		requires_auth: true,
		shape: {
			total: "number",
			returned: "number",
			invoices: [
				{
					id: "number",
					number: "string | null",
					date: "string (ISO) | null",
					amount: "number | null",
					paid_amount: "number | null",
					currency: "string | null",
					paid: "boolean | null",
					status: "string | null",
					downloadable: "boolean",
				},
			],
		},
	},
	locations: {
		command: "locations",
		mutating: false,
		requires_auth: false,
		shape: {
			query: { lat: "number", lng: "number", radius: "number" },
			count: "number",
			returned: "number",
			locations: [
				{
					id: "number",
					name: "string | null",
					address: "string",
					available_evses: "number | null",
					total_evses: "number | null",
					lat: "number | null",
					lng: "number | null",
					private: "boolean",
				},
			],
		},
	},
	doctor: {
		command: "doctor",
		mutating: false,
		requires_auth: false,
		shape: {
			status: "'ok' | 'warn' | 'fail'",
			checks: [{ name: "string", status: "'ok' | 'warn' | 'fail'", detail: "string" }],
		},
	},
};

export async function schemaCommand(flags: SchemaFlags): Promise<void> {
	const json = isJsonMode(flags);

	if (!flags.command) {
		if (json) {
			printJson({ commands: Object.values(SCHEMAS) });
		} else {
			console.log(color.bold("Schemas available:"));
			for (const name of Object.keys(SCHEMAS)) console.log(`  ${name}`);
			console.log("");
			console.log(color.dim("Run `on schema <command> --json` for the full shape."));
		}
		return;
	}

	const schema = SCHEMAS[flags.command];
	if (!schema) {
		die(`No schema for "${flags.command}". Known: ${Object.keys(SCHEMAS).join(", ")}`, 64, json);
	}
	if (json) {
		printJson(schema);
		return;
	}
	console.log(color.bold(`on ${schema.command}`));
	console.log(`  ${color.dim("mutating")}      ${schema.mutating}`);
	console.log(`  ${color.dim("requires_auth")} ${schema.requires_auth}`);
	console.log("");
	console.log(color.dim("Shape:"));
	console.log(JSON.stringify(schema.shape, null, 2));
}
