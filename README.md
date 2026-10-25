# on-cli

Command-line tool and MCP server for the **ON (Orka náttúrunnar)** EV-charging network in Iceland: charging sessions, vehicles, chargers, invoices, RFID keys, and start/stop charging.

> Unofficial — not affiliated with Orka náttúrunnar (ON) or Monta.

**Status (October 2026):** ON's current app runs on Monta. This CLI has two paths:

- **Monta (current):** `monta-login`, `monta-account`, `monta-vehicles`, `monta-charges`, `monta-charge-points`. Read-only. The Monta session does not auto-refresh yet.
- **Dusky (legacy, `app.on.is`):** `login`, `whoami`, `vehicles`, `sessions`, `live`, `keys`, `invoices`, `locations`, `start`, `stop`. This backend was reverse-engineered from the 2025 app and is being retired, so these commands may fail. Charging controls have **not** been migrated to Monta yet.

## Install

Needs [Bun](https://bun.sh) ≥ 1.1.

```sh
bun add -g github:axelpaul/on-cli      # install
bun add -g github:axelpaul/on-cli      # update (re-run; pulls the latest default branch)
bun remove -g on-cli                   # uninstall
```

This puts `on` in `~/.bun/bin`. Check with `on --version`.

No Bun? Download a prebuilt binary (`on-linux-x64`, `on-darwin-arm64`, `on-windows-x64.exe`, …) from the [Releases page](https://github.com/axelpaul/on-cli/releases), verify it against `SHA256SUMS`, make it executable and put it on your PATH as `on`.

> **Name clash:** `on` is a very short, generic name. If something else on your PATH (or a shell alias/function) is already called `on`, call this one by its full path (`~/.bun/bin/on`) or add an alias such as `alias onis="$HOME/.bun/bin/on"`. `type -a on` shows what you have.

## Authentication

Both paths use the email and password of your ON app account. Credentials are never stored, only the resulting tokens.

**Monta (current):**

```sh
on monta-login --email you@example.com        # prompts for the password
ON_MONTA_USER=you@example.com ON_MONTA_PW=… on monta-login   # non-interactive
```

The Monta token is cached in `monta-auth.json` (mode `0600`, see [Configuration](#configuration)). It is not refreshed automatically; re-run `monta-login` if requests start failing with HTTP 401. Each login may trigger a "new device" security email from ON.

**Dusky (legacy):** plain OAuth2 password grant, no browser needed.

```sh
on login                                 # prompts for email + password
on login --email you@example.com         # prompts only for the password
ON_USER=you@example.com ON_PW=… on login # non-interactive
on whoami
on logout
```

The access + refresh token is cached in `auth.json` (mode `0600`). Access tokens last about an hour and are refreshed automatically with the refresh token.

Electronic ID (rafræn skilríki) login exists in the app but is not implemented. If your ON account has no password, set one in the app first.

## CLI usage

```
on monta-account                            account on the Monta backend
on monta-vehicles                           vehicles (raw Monta JSON)
on monta-charges                            charge history (raw Monta JSON)
on monta-charge-points                      charge points (raw Monta JSON)

on whoami                                   the logged-in user (legacy)
on vehicles                                 vehicles on your account
on sessions [--limit N] [--id <id>]         charging history, or one session in full
on live                                     active sessions, reservations, counters
on keys                                     your RFID charging keys/cards
on invoices [--limit N]                     your invoices
on locations [--lat] [--lng] [--radius KM] [--available] [--free] [--limit N]
                                            chargers near a point (no login needed)
on stop [--force] [--yes]                   stop the active charging session (mutating)
on start --evse <code> --connector <id> [--preauth <id>] [--coupon <id>] [--yes]
                                            start charging (mutating)

on doctor                                   pre-flight check: auth, token expiry, API reachable
on schema [<command>]                       JSON response shape of a command
on serve                                    MCP server over stdio
on --version | --help
```

Examples:

```sh
on monta-charges --json | jq '.'
on sessions --limit 5                       # last 5 charging sessions
on sessions --id 12345                      # one session in full
on locations --available                    # chargers free right now near Reykjavík
on locations --lat 65.68 --lng -18.09 --radius 50   # near Akureyri
on invoices --json | jq '.invoices[] | select(.paid==false)'
```

### Stopping and starting a charge

`on stop` reads your active session from the API and figures out the EVSE/connector itself:

```sh
on stop                 # asks for confirmation, then stops the session you're charging on
on stop --yes           # no prompt (scripts/agents)
on stop --force         # force-stop by connector (fallback; used automatically for roaming)
on stop --json          # {"stopped":true,"method":"remoteStop","where":"…","result_code":0}
```

If nothing is charging, `on stop` is a harmless no-op: `{"stopped":false,"reason":"no_active_session"}`.

`on start` can't detect which charger you're plugged into, so pass its EvseCode (`chargePointCode-evseCode-connectorCode`, from the charger label/QR) and connector id:

```sh
on start --evse "IS*ONP00001-1000-1" --connector 12345 --yes
```

Both commands are **mutating** and ask for confirmation unless `--yes`; without a TTY they refuse unless `--yes` is given. Success is `ResultCode == 0`; on failure the server's error is shown.

### Output, flags and exit codes

JSON is printed when stdout is piped or with `--json`; human-readable output in a terminal.

| Flag | Meaning |
|---|---|
| `--json` | Machine-readable output (default when stdout is piped). |
| `--pretty` | Force human output even when piped. |
| `--raw` | Dump the raw API response unchanged (legacy commands). |

| Exit code | Meaning |
|---|---|
| 0 | OK |
| 1 | Runtime / network error |
| 2 | Auth required or expired |
| 64 | Bad usage (missing/invalid flags) |

`on schema --json` and `on help --json` describe the command surface for agents. [`SKILL.md`](SKILL.md) documents trigger conditions and the data model for agent use.

## MCP server

`on serve` starts a local MCP server over stdio. Every tool calls the same code as the CLI command named in the table and returns the same JSON as `--json`. Run the matching login command in a terminal first; the server never logs in by itself.

| Tool | Access | Description |
|---|---|---|
| `monta_account` | read | Monta account: id, name, email (`on monta-account`) |
| `monta_vehicles` | read | Vehicles, raw Monta JSON (`on monta-vehicles`) |
| `monta_charges` | read | Charge history, raw Monta JSON (`on monta-charges`) |
| `monta_charge_points` | read | Charge points, raw Monta JSON (`on monta-charge-points`) |
| `whoami` | read | Logged-in user (`on whoami`), legacy |
| `vehicles` | read | Vehicles on the account (`on vehicles`), legacy |
| `sessions` | read | Charging history, `limit` (`on sessions`), legacy |
| `session` | read | One session by `id` (`on sessions --id`), legacy |
| `live` | read | Active sessions, reservations, counters (`on live`), legacy |
| `keys` | read | RFID keys/cards (`on keys`), legacy |
| `invoices` | read | Invoices, `limit` (`on invoices`), legacy |
| `locations` | read | Chargers near `lat`/`lng`/`radius`, `available`, `free`, `limit`; no login (`on locations`), legacy |
| `stop_charging` | write | Stop the active session, optional `force` (`on stop --yes`), legacy |
| `start_charging` | write | Start at `evse` + `connector`, optional `preauth`/`coupon` (`on start --yes`), legacy |

"Legacy" tools use the Dusky backend and may fail now that ON has moved to Monta.

Not exposed: `login`/`monta-login`/`logout` (need a password or change local state; run them in a terminal), `doctor` and `schema` (CLI diagnostics; MCP tools carry their own schemas and return auth errors directly).

**Write tools** are hidden unless the server is started with `ON_MCP_ENABLE_WRITES=1`, and each call must also pass `"confirm": true`.

Claude Code:

```sh
claude mcp add on -- on serve
claude mcp add on -e ON_MCP_ENABLE_WRITES=1 -- on serve    # with start/stop charging
```

Claude Desktop, Cursor and other JSON-configured clients:

```json
{
  "mcpServers": {
    "on": {
      "command": "on",
      "args": ["serve"],
      "env": { "ON_MCP_ENABLE_WRITES": "1" }
    }
  }
}
```

Leave out `env` for read-only. GUI apps often don't have `~/.bun/bin` on their PATH; if the server fails to start, use the absolute path from `which on` as `command`.

## Configuration

| Variable | Description |
|---|---|
| `ON_MONTA_USER` / `ON_MONTA_PW` | Email/password for non-interactive `on monta-login`. |
| `ON_USER` / `ON_PW` | Email/password for non-interactive `on login` (legacy). |
| `ON_BASE_URL` | Override the legacy Dusky API base URL (default `https://app.on.is/DuskyWebApi`). |
| `ON_MCP_ENABLE_WRITES` | Set to `1` to expose `start_charging`/`stop_charging` in `on serve`. |
| `XDG_CONFIG_HOME` | Base config directory (default `~/.config`). |
| `NO_COLOR` | Disable coloured output. |

Files live in `$XDG_CONFIG_HOME/on-cli/` (default `~/.config/on-cli/`), all mode `0600`:

- `monta-auth.json` — Monta access token and device UUID
- `auth.json` — legacy Dusky access + refresh token
- `config.json` — optional `{"baseUrl": "…"}` override

Versions before 0.3.0 used `~/.config/on/`; if that directory holds a session and the new one doesn't exist yet, it keeps being used.

## Development

```sh
bun install
bun run check       # biome lint + tsc + bun test
bun src/index.ts <command>
bun run build       # standalone binary at dist/on
```

Layout: `src/lib/api.ts` (Dusky client), `src/lib/monta.ts` (Monta client), `src/lib/actions.ts` (shared operations used by both the CLI and MCP), `src/commands/` (CLI output), `src/mcp/server.ts` (MCP tools).

Releases: pushing a `v*` tag runs `.github/workflows/release.yml`, which builds binaries for Linux, macOS and Windows (x64/arm64) and attaches them with `SHA256SUMS` to a GitHub release.

API notes:

- The Dusky API was reverse-engineered from `is.on.charge.android` v2025.7.5. It requires the app's User-Agent (the WAF returns 403 otherwise). `on stop` rebuilds the app's `remoteStopTransaction` body: EvseCode `chargePointCode-evseCode-connectorCode` (non-roaming) or the EVSE code alone (roaming, which uses connector force-stop).
- The Monta request path (`api.monta.app`, `Operator: on` headers) was checked against the 2026 app; see `src/lib/monta.ts`. Monta error messages deliberately omit response bodies.

Not implemented: payments/saved cards (`/api/creditCards` 404s on ON's deployment), electronic-ID login, favourites, coupons, reservations, helpdesk, Monta token refresh, Monta charging controls.
