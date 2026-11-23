# AGENTS.md

## Project layout

Comms is a browser voice chat project. The Ktor server manages one in-memory signaling room. The React client currently renders a placeholder. Stage 1 will add peer-to-peer audio over WebRTC.

- `backend/src/main/kotlin/dev/comms/Application.kt` starts the server and registers `GET /health` and the `/ws` WebSocket route.
- `backend/src/main/kotlin/dev/comms/SignalingRoom.kt` manages membership, validates messages and routes signals.
- `frontend/src/main.tsx` mounts the React application. Edit the root component in `frontend/src/App.tsx` to change the page.
- `frontend/vite.config.ts` proxies `/ws` to the backend at `127.0.0.1:8080`.

## Development and checks

| Working directory | Requirements | Commands |
| --- | --- | --- |
| `backend/` | JDK 25 | Run tests with `./gradlew test`. Start the server with `./gradlew run`. |
| `frontend/` | Node.js 22.12+ and npm | Install dependencies with `npm install`. Type-check and build with `npm run build`. Start Vite with `npm run dev`. |

In Windows PowerShell, use `.\gradlew.bat test` and `.\gradlew.bat run`. Use `npm.cmd` if PowerShell blocks `npm.ps1`.

The running server returns `OK` at `http://127.0.0.1:8080/health`. The local UI is at `http://localhost:5173`.

For protocol changes, run `./gradlew test` from `backend/` and `npm run build` from `frontend/`. Server-side signaling tests live in `backend/src/test/kotlin/dev/comms/SignalingTest.kt`. Keep the message format in sync with the specification and any client handlers.

## Signaling and voice

- Queue each participant's `welcome` before routing signals to them. Derive `from` from the sender's WebSocket session and deliver each `signal` to its intended peer.
- When implementing voice, have the newcomer send one offer to each peer listed in `welcome`. Buffer early ICE candidates until the remote description is set. On disconnect, stop microphone tracks and close peer connections.
- Once the voice client is available, verify two-way audio in two localhost tabs. Join from a third tab, close it and confirm the first two remain connected. Check that a participant can disconnect and rejoin without reloading, and that denying microphone access displays an error without joining the room.

## Git & Workflow

- Branch naming: `<type>/<short-description>` in kebab-case (e.g., `feat/add-user-auth`, `fix/login-redirect`).
- Allowed types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`.
- Never commit or push directly to `main`.
