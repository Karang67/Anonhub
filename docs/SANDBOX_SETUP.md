# Self-Hosted Open-Source Sandboxes (Piston & Judge0) for AnonHub

## Overview
Because **AnonHub** enables real-time collaborative coding across multiple users editing simultaneously, hosting your own sandboxed execution engine eliminates daily third-party API rate limits and gives you zero-latency, private, and secure code compilation.

---

## 🏛️ Real-Time Collaborative Architecture

```
[Peer A (Runs Code)]        [Peer B (Observing)]
        │                            │
        │ 1. socket.emit('run code') │
        ▼                            │
 ┌───────────────┐                   │
 │ AnonHub       │                   │
 │ Node.js       │                   │
 │ Backend       │                   │
 └───┬───────┬───┘                   │
     │       │                       │
     │ 2. Broadcast 'code execution started'
     │       └───────────────────────▶ (Peer B sees "⏳ @User is running...")
     │                               │
     │ 3. Forward code               │
     ▼                               │
 ┌──────────────────────┐            │
 │ Self-Hosted Sandbox  │            │
 │ (Piston / Judge0)    │            │
 └───────────┬──────────┘            │
             │ 4. Return stdout/err  │
             ▼                       │
 ┌──────────────────────┐            │
 │ AnonHub Backend      │            │
 └───────────┬──────────┘            │
             │                       │
             │ 5. Broadcast 'code execution result'
             ├───────────────────────┴───▶ (Peers A & B see stdout, stats & badge)
```

1. **Trigger**: Any collaborator in the workspace clicks the **Run** button.
2. **Workspace Snapshot**: The backend accepts the current file buffer or pulls the latest shared state from the workspace room.
3. **Execution**: The backend dispatches the job to the self-hosted **Piston** container (or Judge0).
4. **Broadcast**: Execution start and result (stdout, stderr, exit code, execution time, and engine badge) are broadcast simultaneously over **Socket.IO** to all connected peers in that workspace room.
5. **Simultaneous Display**: Everyone in the room sees the terminal shell update in real-time with an execution badge indicating who ran the code and which engine executed it.

---

## 🚀 Quick Start: Self-Hosting Piston with Docker

We provide a dedicated [`docker-compose.sandbox.yml`](../docker-compose.sandbox.yml).

### 1. Spin up the Sandbox Engine
From the repository root:
```bash
docker compose -f docker-compose.sandbox.yml up -d
```

This starts:
- **`anonhub-piston`**: The isolated cgroup code sandbox engine on port `2000`.
- **`anonhub-piston-init`**: Automatically installs `python`, `nodejs`, `gcc` (C/C++), and `openjdk` (Java).

### 2. Verify Piston Runtimes
Check that languages are installed and ready:
```bash
curl http://localhost:2000/api/v2/runtimes
```

To install additional languages at any time:
```bash
docker exec -it anonhub-piston piston-cli install rust go bash php ruby
```

---

## ⚙️ Environment Configuration (`.env`)

Add the following to your backend `.env`:

```env
# Sandbox Provider ('auto' | 'piston' | 'judge0' | 'local')
SANDBOX_PROVIDER=auto

# Self-Hosted Piston URL (default port 2000)
PISTON_URL=http://localhost:2000

# Optional Self-Hosted Judge0 URL (if using Judge0)
JUDGE0_URL=http://localhost:2358

# Maximum execution timeout in milliseconds
CODE_EXECUTION_TIMEOUT_MS=8000
```

### Fallback Guarantee
AnonHub includes an **automatic multi-tier fallback**:
1. **Piston**: Primary engine if `PISTON_URL` is accessible.
2. **Judge0**: Secondary sandbox if configured.
3. **Local Sandboxed Child-Process Runner**: Zero-dependency built-in runner so AnonHub continues running code even without Docker or external networks.

---

## 🧪 Testing Execution

You can test execution directly from Node.js or terminal:
```bash
curl -X POST http://localhost:10000/api/compile \
  -H "Content-Type: application/json" \
  -d '{"language":"python","code":"print(\"Hello from AnonHub Sandbox!\")"}'
```
