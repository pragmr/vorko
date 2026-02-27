# Agent guide — Vorko

This file helps AI agents (and developers) understand the codebase and work on it correctly.

---

## Project summary

**Vorko** is a virtual office web app: 2D grid, movable avatars, room chat, DMs, and **proximity-based** voice, video, and screen sharing. Media is **WebRTC P2P**; **Socket.IO** is used only for signaling. LiveKit is present (token API on server, client commented out) but **not used** for the current call flows.

---

## Repo layout

| Path | Role |
|------|------|
| `src/App.jsx` | Main app: auth, movement, Socket.IO listeners, all WebRTC (mic, camera, screen), UI state, toasts. Large file (~2200 lines). |
| `src/main.jsx` | React entry; mounts `App`. |
| `src/index.css` | Global styles (office grid, screen share overlay, controls, etc.). |
| `src/data/officeData.js` | Office layout, rooms, obstacles. |
| `src/components/Auth.jsx` | Login/register form. |
| `src/components/Character.jsx` | Single character/avatar rendering. |
| `src/components/ChatPanel.jsx` | Room chat + DMs UI. |
| `src/components/Controls.jsx` | Bottom bar: mic, camera, screen share, chat, hang up. |
| `src/components/OfficeGrid.jsx` | Grid + characters + movement/click handling. |
| `src/components/RoomInfo.jsx` | Room name / context. |
| `server.js` | Express: auth (JWT), REST API, Socket.IO (presence, chat, WebRTC signaling), LiveKit token endpoint. File store: `data/users.json`, `data/messages_*.json`. |
| `vite.config.js` | React + Vite; dev server port 3000; proxy `/api` and `/socket.io` to port 5000. |

---

## Architecture

- **Frontend**: React 18, Vite. Single-page app; state in `App.jsx` (useState/useRef).
- **Backend**: Node + Express. No DB; JSON files in `data/` for users and messages.
- **Realtime**: Socket.IO. One server (e.g. port 5000); clients join rooms by “office room” name.
- **Media**: WebRTC only. No SFU in use. Each “viewer/listener” gets a separate `RTCPeerConnection` to the “sharer/speaker/broadcaster”. ICE: `stun:stun.l.google.com:19302` only (no TURN in code).

---

## Socket.IO events (server ↔ client)

**Identity / presence**

- Server: `user-joined`, `user-left`, `users-in-room`, `presence-changed`, etc.
- Client: `join-room`, `move`, `set-presence`, etc.

**Chat**

- Room: `room-message`, `room-messages`.
- DM: `dm-message`, `dm-messages`, `dm-open`, etc.

**Screen share**

- Client → server: `start-screenshare`, `stop-screenshare`, `screenshare-subscribe`, `screenshare-unsubscribe`, `viewer-started-watching`, `viewer-stopped-watching`.
- Server → client: `screenshare-started`, `screenshare-stopped`, `screenshare-subscribe` (to sharer), `screenshare-active`, `screenshare-watchers`.
- WebRTC relay: `webrtc-offer`, `webrtc-answer`, `webrtc-ice-candidate` (relayed by server to `to`).

**Audio (proximity mic)**

- Client: `start-audio`, `stop-audio`, `audio-subscribe`, `audio-unsubscribe`.
- Server: `audio-started`, `audio-stopped`, `audio-subscribe` (to speaker).
- WebRTC relay: `audio-webrtc-offer`, `audio-webrtc-answer`, `audio-ice-candidate`.

**Video (proximity camera)**

- Client: `start-video`, `stop-video`, `video-subscribe`, `video-unsubscribe`.
- Server: `video-started`, `video-stopped`, `video-subscribe` (to broadcaster).
- WebRTC relay: `video-webrtc-offer`, `video-webrtc-answer`, `video-ice-candidate`.

**Other**

- `wave-send` / `wave-received` for “wave” notifications.

Proximity is enforced on the **server**: same room and Euclidean distance ≤ 3 tiles for subscribe.

---

## WebRTC flow (same pattern for screen, audio, video)

1. **Broadcaster/Sharer/Speaker** starts media (getUserMedia or getDisplayMedia), then notifies server (e.g. `start-screenshare`, `start-audio`, `start-video`).
2. **Viewer/Listener** in same room and within 3 tiles sends subscribe (e.g. `screenshare-subscribe`, `audio-subscribe`, `video-subscribe`).
3. Server checks proximity and forwards subscribe to the broadcaster.
4. Broadcaster creates `RTCPeerConnection`, adds track(s), creates **offer**, sends to server with `to: viewerId`; server relays to viewer.
5. Viewer sets remote description, creates **answer**, sends back; server relays to broadcaster.
6. Both sides exchange **ICE candidates** via server relay.
7. On `ontrack`, viewer attaches stream to `<video>` or `<audio>`.

Refs in `App.jsx`: `sharerPeerConnsRef` / `viewerPeerConnsRef` (screen), `speakerPeerConnsRef` / `listenerPeerConnsRef` (audio), `videoBroadcasterPCsRef` / `videoViewerPCsRef` (video).

---

## Auth

- **Register**: `POST /api/auth/register` (name, email, password, optional avatar). Passwords hashed with bcrypt.
- **Login**: `POST /api/auth/login` returns JWT. Client stores token and sends `Authorization: Bearer <token>` for protected APIs.
- **LiveKit token**: `POST /api/livekit/token` (body: room, identity, name); requires auth header. Used only if you later enable LiveKit clients.

---

## Conventions and gotchas

- **Proximity radius**: 3 tiles; defined in both `server.js` and `App.jsx` (e.g. `RADIUS = 3`). Change in both if you change behavior.
- **Socket id vs user id**: Many events use **socket id** (e.g. `sharerId`, `from`) for WebRTC and presence; user identity for auth/directory is **userId** (from JWT / users.json).
- **Large App.jsx**: Most logic lives in `App.jsx`. When adding features, prefer extracting components or hooks (e.g. `useScreenShare`, `useProximityVoice`) to keep behavior testable and doc-friendly.
- **Data persistence**: Only JSON files. No migrations; ensure `data/` exists and is writable. For production, consider a real DB.

---

## Running and testing

- **Dev**: `npm run start` (backend) + `npm run dev` (frontend). Frontend at http://localhost:3000, API at http://localhost:5000.
- **Prod-style**: `npm run build` then `npm run start`; serve from http://localhost:5000.
- **Browser**: Use a modern browser with WebRTC (Chrome, Firefox, Edge, Safari). For multi-user testing, use multiple windows or devices on the same room.

---

## When editing

1. **Socket events**: When adding or changing events, update both `server.js` and `App.jsx` (and this AGENT.md if you add new events).
2. **Proximity**: If you change radius or logic, keep server and client in sync.
3. **WebRTC**: Clean up `RTCPeerConnection`s on unsubscribe/disconnect (see existing `pc.close()` and refs in `App.jsx`).
4. **Secrets**: Do not commit real `LIVEKIT_*` or `JWT_SECRET`; use env vars and `.env` (and keep `.env` in `.gitignore`).
