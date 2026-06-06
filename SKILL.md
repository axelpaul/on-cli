---
name: on
description: "ON (Orka náttúrunnar) EV-charging CLI. Use whenever the user asks about their ON charging — recent charging sessions, how much a session cost or how many kWh it drew, their EV / vehicle on the account, where to charge (find nearby chargers, what's available right now), their RFID charging keys, or their ON invoices / unpaid bills. ON is an Icelandic charging network; the app is is.on.charge.android (a white-label of Etrel Thor on the Dusky backend at app.on.is). Headless, agent-friendly (JSON output, stable shapes, doctor + schema commands), read-only."
homepage: https://github.com/axelpaul/on-cli
metadata:
  {
    "openclaw":
      {
        "emoji": "🚗⚡",
        "requires": { "bins": ["on", "bun"] },
        "install":
          [
            {
              "id": "git",
              "kind": "manual",
              "label": "Clone + bun link",
              "steps":
                [
                  "git clone https://github.com/axelpaul/on-cli ~/code/on-cli",
                  "cd ~/code/on-cli && bun install && bun link",
                ],
            },
          ],
      },
  }
---

# on

Headless CLI for the **ON (Orka náttúrunnar)** Icelandic EV-charging app
(`is.on.charge.android`, a white-label of Etrel "Thor" on the Dusky API at `app.on.is`).

## What this is good for

Use it when the user wants anything about their ON charging from a script/agent context:

- **"How much did my last charge cost?"** / **"How many kWh?"** — `on sessions`.
- **"Show my charging history."** — `on sessions --limit 20`.
- **"Am I charging right now?"** — `on live`.
- **"What car is on my account?"** — `on vehicles`.
- **"Where can I charge near me / what's free right now?"** — `on locations --available`.
- **"Do I have unpaid invoices?"** — `on invoices`.
- **"What are my charging keys?"** — `on keys`.

## Before doing anything

```bash
on doctor --json
```

`status` is `ok` / `warn` / `fail`. On `fail` ("Not logged in"), the user must run
`on login` themselves (it needs their ON email + password). **Do not run `on login`
autonomously unless `$ON_USER` and `$ON_PW` are already set in the environment** — never
ask for or hardcode a password.

The CLI auto-refreshes the access token, so a cached session keeps working for a long
time without re-login.

## Discovering response shapes

```bash
on schema sessions --json     # full shape for one command
on schema --json              # all commands
on help --json                # command catalog
```

Shapes are hand-curated and match the real `--json` output — treat them as the contract.

## Quick start

```bash
on doctor --json
on sessions --json --limit 5
on sessions --id 26761589 --json     # one session in full
on live --json                       # charging now? reservations? unpaid count?
on vehicles --json
on locations --json --available      # chargers free right now (near Reykjavík by default)
on locations --lat 65.68 --lng -18.09 --radius 50 --json   # near Akureyri
on invoices --json --limit 10
on keys --json
```

## Output conventions

- **JSON when stdout is piped**, human-readable in a TTY. Force with `--json` / `--pretty`.
- **Errors are JSON when `--json`**: `{ "error": "...", "code": "...", "status": 401 }`.
- **Exit codes**: `0` ok · `1` runtime/network · `2` auth required (run `on login`) · `64` bad usage.
- **All data commands accept `--raw`** — dumps the upstream Dusky response unchanged.

## The data model

- The account (`on whoami`) has a payer, a currency (ISK), and one or more **vehicles**.
- A **charging session** happened at a **location** (a charging site with N EVSEs), via a
  **connector**; it records `energy_kwh`, `cost`, `currency`, green-energy flag, CO₂ saved,
  and connected/charging time ranges. `on sessions` lists them newest-first (paged: the
  `total` field is the full count; `--limit` controls how many are returned).
- **Locations** come from a public endpoint — `on locations` works even when logged out.
  `available_evses`/`total_evses` show live availability.
- Field naming upstream is **PascalCase**; the CLI normalizes the curated output to
  `snake_case` (use `--raw` to see the original).

Money: ISK has no decimals. Energy is in kWh. Timestamps are ISO 8601 (UTC).

## What NOT to do

- **Don't run `on login` interactively in an autonomous loop** — it needs a password.
  Only run it non-interactively when `$ON_USER`/`$ON_PW` are already set.
- **Don't print or store `~/.config/on/auth.json`** — it holds the bearer + refresh token.
- **Don't poll `on live` more than ~once a minute.**

## Not implemented

Remote start/stop charging, payments/saved cards, electronic-ID login, favourites,
coupons, reservations, helpdesk. The CLI is read-only today.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Session expired. Run "on login"` (exit 2) | Token rejected and refresh failed | `on login` (user; needs password) |
| `403` on a command | Missing/blocked User-Agent | The CLI sets the app UA automatically; if you see this, the API/WAF changed |
| `on invoices`/`sessions` returns `total` ≫ `returned` | Output is capped by `--limit` (default 20) | Pass a higher `--limit` |
| `on locations` empty | No chargers in `--radius` | Widen `--radius` or check `--lat/--lng` |
