# on-cli

Headless CLI for the **ON (Orka náttúrunnar)** EV-charging app — charging sessions,
vehicles, chargers, invoices, and RFID keys without opening the mobile app.

ON is a white-label of Etrel's "Thor" app on the **Dusky** backend (`app.on.is`).
AI-agent friendly: JSON output, stable shapes, `doctor` + `schema` commands.

## Install

Needs [Bun](https://bun.sh/) ≥ 1.3.

```sh
git clone <repo> on-cli && cd on-cli
bun install
bun link               # exposes `on` on your PATH
on login --email you@example.com
```

Or run without linking: `bun src/index.ts <command>`.

## Auth

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
on keys                                     your RFID charging keys/cards
on invoices [--limit N]                     your invoices
on locations [--lat] [--lng] [--radius KM] [--available] [--free] [--limit N]
                                            find chargers near a point (public, no auth)
```

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

The API was reverse-engineered from `is.on.charge.android` v2025.7.5 via mitmproxy on an
Android emulator. See `src/lib/api.ts` for the typed client and per-endpoint notes.

## Not implemented (yet)

- Remote start/stop charging (`/api/commands/remoteStart|StopTransaction`) — request
  bodies not yet verified; left out to avoid shipping unverified mutating commands.
- Payments / saved cards (`/api/creditCards` 404s on ON's deployment; payments flow
  differently).
- Electronic-ID (OIDC) login.
- Favourite locations, coupons, helpdesk, reservations.
