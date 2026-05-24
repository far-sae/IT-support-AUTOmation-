# Relay agent

A tiny cross-platform daemon that reports host metrics to your Relay API. Zero
runtime dependencies — Node 18+ standard library only.

## What it sends

Every interval (default 60 s) it POSTs to `POST /api/agent/checkin` with:

| Field | Source |
|---|---|
| `hostname`         | `os.hostname()` (overridable) |
| `os`               | Friendly label, e.g. `macOS 14.5` / `Windows 11.0.22631` / `Linux 6.5.0` |
| `cpu`              | 1-minute load average normalized to core-count (Unix) or busy-sample (Windows) |
| `ram`              | `(totalmem - freemem) / totalmem` |
| `disk`             | `df -kP /` on Unix, `Get-PSDrive` on Windows |
| `uptimeSeconds`    | `os.uptime()` |
| `pendingUpdates`   | `softwareupdate -l` on macOS, `apt-check` on Linux, 0 elsewhere |
| `agentVersion`     | Hard-coded constant for now |

The server upserts a `Device` row by `(organizationId, hostname)`, stores a
`DeviceMetric` time-series row, recomputes `healthStatus` from thresholds
(HEALTHY / WARNING / CRITICAL), stamps `lastCheckInAt`, and emits a
`device:updated` socket event so the /assets page refreshes live.

## Get a token

1. Sign in to Relay as an ADMIN.
2. Go to **Organization → Agent tokens** (admin only).
3. Click "New token", label it (e.g. `Jordan's MacBook`), copy the value — it's
   shown only once.

## Install + run

```bash
git clone <relay-repo>     # or copy just /agent
cd agent

# 1. Set the token (env, flag, or relay-agent.json)
cp relay-agent.example.json relay-agent.json
$EDITOR relay-agent.json   # paste the token

# 2. Run
node src/index.mjs

# Or as a one-shot (e.g. from cron / Task Scheduler):
node src/index.mjs --once
```

### Flags

```
--token            Enrollment token (or RELAY_ENROLLMENT_TOKEN env)
--api-url URL      Defaults to http://localhost:4000
--interval N       Seconds between check-ins (default 60)
--once             Send one check-in and exit
--hostname NAME    Override the OS hostname
--assigned-user    Free-text "owner" name (first check-in only)
--type LAPTOP|DESKTOP|MOBILE   Device type (first check-in only)
```

### Running as a service

The agent has no specific service wrapper — use whatever your OS already has:

- **systemd** (Linux):
  ```ini
  [Unit]
  Description=Relay agent
  After=network-online.target

  [Service]
  ExecStart=/usr/bin/node /opt/relay-agent/src/index.mjs
  Restart=on-failure
  EnvironmentFile=/etc/relay-agent.env

  [Install]
  WantedBy=multi-user.target
  ```
- **launchd** (macOS): a `LaunchDaemon` plist invoking `node /path/to/index.mjs`
- **Windows**: `nssm install RelayAgent "C:\Program Files\nodejs\node.exe" "C:\Path\To\index.mjs"`

## Privacy

The agent only sends what's listed above. No screen capture, no installed-app
list, no user data. The Relay API authenticates the request by the enrollment
token; that token is per-organization, so the server knows exactly which
tenant the metric belongs to without trusting the agent's word for it.
