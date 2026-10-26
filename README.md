## Current Monta charging state and limits

[MCP setup and client configuration](MCP.md)

- `on live --json`: active Monta sessions, exact string IDs, delivered kWh, current cost, and tariff. Battery percentage stays null when Monta does not supply it. Read-only MCP `charging_status` provides the same result.
- `on start --chargepoint 'IS*ONP00066-52431-1-1' --json`: **read-only preflight**, including unfamiliar locations. Full ON QR codes resolve through ON's public `https://app.on.is/d/<QR>` page to the official Monta checkout ID; the CLI then revalidates the live connector name and ON operator. No credentials are sent to the public page. Untrusted/ambiguous links and mismatched live identities fail explicitly. Plain connector labels retain account-history/same-pole-group lookup; use the full QR for unfamiliar poles. No internal ID is guessed from the printed number.
- `on start --chargepoint 6440032 --json`: preflight by known internal ID, showing tariff including minute fees, required hold, account payment readiness, active-session blockers, and official checkout URL. MCP `charge_preview` is also read-only.
- `--yes` cannot start an already-active/unavailable connector. Free charging and the server-default saved-source route (`payment_method=source`, `payment_method_type=team-wallet`, `has_source=true`, `has_payment=true`) may start. This saved-card path was live-proved on 2026-10-21: the backend accepted a real start and reported card payment. Stale UI settings may still say Apple Pay; the server route is authoritative. Other payment routes return `INTERACTIVE_PAYMENT_REQUIRED` and the official checkout URL. No retries or reused payment authorizations.

**Remaining limits:** QR codes not recognised by ON’s public resolver, interactive Apple Pay/3-D Secure automation, and legacy location commands. Monta stop has not been live-tested. Accepted start requests must be followed by read-only session verification; `starting` is not proof of energy delivery.



# on-cli

Headless CLI for the **ON (Orka náttúrunnar)** EV-charging app — charging sessions,
vehicles, chargers, invoices, and RFID keys without opening the mobile app.

**Status (October 2026):** ON's current app uses Monta. The original CLI commands
still target the retired Dusky backend and are not reliable. A separate,
read-only Monta path is available as `monta-login`, `monta-account`,
`monta-vehicles`, `monta-charges`, and `monta-charge-points`, plus matching MCP
tools. Charging controls have **not** been migrated. The Monta session does not
yet auto-refresh.

AI-agent friendly: JSON output and a local stdio MCP server.

## Install

Needs [Bun](https://bun.sh/) ≥ 1.3.

```sh
git clone <repo> on-cli && cd on-cli
bun install
bun link               # exposes `on` on your PATH
on monta-login --email you@example.com
```

Or run without linking: `bun src/index.ts <command>`.

## Auth

The current Monta path uses the same email/password as the ON app. It requires
a separate login from the retired Dusky commands:

```sh
on monta-login --email you@example.com
on monta-account --json
on monta-vehicles --json
on monta-charges --json
on monta-charge-points --json
on serve  # stdio MCP: the four corresponding Monta read tools
```

The Monta access token is cached separately at `~/.config/on/monta-auth.json`
with mode `0600`. Automatic refresh and token expiry handling are not yet
implemented; re-run `monta-login` if the server rejects the session. Each login
may generate a new-device security email from ON.

The following commands document the **retired Dusky path** and are retained
only for historical reference until migration is complete:

Plain email + password (OAuth2 password grant). No browser, works over SSH.

```sh
on login                       # interactive (prompts for email + password)
on login --email you@x.is      # prompts only for password
ON_USER=you@x.is ON_PW=secret on login   # fully non-interactive (CI / agents)
on whoami
on logout
```

The session (access + refresh token) is cached at `~/.config/on/auth.json` (mode `0600`).
Access tokens last ~1h; the CLI **auto-refreshes** with the stored refresh token, so you
rarely need to log in again. Re-run `on login` only if `doctor` reports the token was
rejected.

> Electronic-ID (rafræn skilríki) login also exists in the app but is not implemented
> here — email/password is all the CLI needs. If your ON account has no password set,
> set one in the app first.

## Commands

```
on whoami                                  the logged-in user
on vehicles                                vehicles on your account
on sessions [--limit N] [--id <id>]        charging history (or one session in full)
on live                                     active sessions, reservations, counters
on stop [--connector <id>] [--force] [--yes] stop an active charging session (mutating)
on start --evse <code> --connector <id> [--yes]   start charging (mutating)
on keys                                     your RFID charging keys/cards
on invoices [--limit N]                     your invoices
on locations [--lat] [--lng] [--radius KM] [--available] [--free] [--limit N]
                                            find chargers near a point (public, no auth)
```

### Stopping / starting a charge

`on stop` reads your active session from the API, so you don't pass any
arguments — it figures out the EVSE/connector itself:

```sh
on stop                 # confirms, then stops the session you're charging on
on stop --yes           # no prompt (for scripts/agents; only if exactly one session is active)
on stop --connector 7890574 --yes  # explicitly select one if more than one is active
on stop --force         # force-stop by connector (explicit fallback only)
on stop --json          # → {"stopped":true,"method":"remoteStop","where":"…","result_code":0}
```

If nothing is charging, `on stop` is a harmless no-op (`{"stopped":false,"reason":"no_active_session"}`). If more than one session is active, it refuses to guess; select the intended connector with `--connector`.

`on start` needs to identify the charger you're plugged into (you can't auto-detect
that), so pass its EvseCode + connector id:

```sh
on start --evse "IS*ONP00091-3253-1" --connector 7890574 --yes
```

Both are **mutating** and ask for confirmation unless `--yes`. A normal ON session uses `remoteStopTransaction`; a roaming session uses the app-native `remoteStopRoaming`. `--force` uses the connector-level fallback only when explicitly requested. Success is
`ResultCode == 0`; on failure the CLI surfaces the server's error and (for stop)
suggests `--force`.

### Global flags

| Flag | Meaning |
|---|---|
| `--json` | Machine-readable output (always-on when stdout is piped). |
| `--pretty` | Force human output even when piped. |
| `--raw` | Dump the raw API response unchanged (debugging). |

### Examples

```sh
on sessions --limit 5                       # last 5 charging sessions
on sessions --id 26761589                   # one session, full detail
on locations --available                    # free-right-now chargers near Reykjavík
on locations --lat 65.68 --lng -18.09 --radius 50   # near Akureyri
on invoices --json | jq '.invoices[] | select(.paid==false)'
```

## Agent-friendly

JSON is the primary interface. Stable shapes, predictable exit codes, and dedicated
discovery commands:

```sh
on doctor --json     # pre-flight: auth state, token expiry, server reachable
on schema --json     # response-shape catalog for all commands
on schema sessions   # shape for one command
on help --json       # command list
on version
```

| Exit code | Meaning |
|---|---|
| 0 | OK |
| 1 | Runtime / network error |
| 2 | Auth required or expired (run `on login`) |
| 64 | Bad usage (missing/invalid flags) |

A `SKILL.md` at the repo root documents the trigger conditions, data model, and command
surface for [OpenClaw](https://github.com/openclaw/openclaw) / agent use.

## Environments

Defaults to production (`https://app.on.is/DuskyWebApi`). Override with `ON_BASE_URL` or a
`baseUrl` in `~/.config/on/config.json`.

## Development

```sh
bun run check       # biome + tsc
bun test            # unit tests for pure helpers
bun run build       # standalone binary at ./on
```

The original Dusky API was reverse-engineered from `is.on.charge.android`
v2025.7.5. The current Monta request path was checked against the Play-installed
2026 app; see `src/lib/monta.ts`. Do not use the old charging commands against
the current service.

## Not implemented (yet)

- Payments / saved cards (`/api/creditCards` 404s on ON's deployment; payments flow
  differently).
- Electronic-ID (OIDC) login.
- Favourite locations, coupons, helpdesk, reservations.

MCP Monta start/stop adapters are available under explicit startup opt-in and
per-call confirmation. The server-default saved-card start route is live-proved;
interactive payment and payment-method setup are not automated. See [MCP.md](MCP.md) for exact-ID and verification limits.

Charging verification note (2026-10-21): the saved-source start request was accepted and identified card payment, but that physical session ended with StartTransactionTimeout and 0 kWh. This verifies request acceptance, not end-to-end energy delivery. A user-requested retry was blocked by the connector remaining busy; no second start was sent.

## Unfamiliar QR lookup — 2026-10-22

ON’s public QR route resolves a full printed code, including its network prefix.
For example, `IS*ONP00066-52431-1-1` resolves to **ON 52431-1, Nauthólsvegur 52**.
Lookup/preview never starts a charge. Starting still requires `--yes` and a
fresh availability/payment preflight. This feature was verified with read-only
lookups; no charging mutation was used during its implementation.
