# Vorko

A **virtual office** with movable characters and real-time collaboration: room chat, DMs, proximity-based voice, video, and screen sharing.

---

## What it does

- **2D office map** — Move your character on a grid; see others in the same room.
- **Room chat** — Messages visible to everyone in the current room.
- **Direct messages (DMs)** — Private chat with any user.
- **Proximity voice** — Mic on/off; only nearby users (within 3 tiles) hear you. WebRTC P2P.
- **Proximity video** — Camera on/off; only nearby users see your video. WebRTC P2P.
- **Screen share** — Share your screen; only nearby users can subscribe. WebRTC P2P.
- **Presence** — Available / Busy / Do not disturb; optional wave notifications.
- **User directory** — List registered users; open profile or start a DM.

Media (audio, video, screen) uses **WebRTC** with **Socket.IO** for signaling only. LiveKit is installed but not used for these flows.

---

## Tech stack

| Layer        | Tech |
|-------------|------|
| Frontend    | React 18, Vite |
| Backend    | Node.js, Express |
| Realtime   | Socket.IO |
| Media      | WebRTC (getUserMedia, getDisplayMedia, RTCPeerConnection) |
| Auth       | JWT (login/register), JSON file store for users/messages |

---

## Prerequisites

- **Node.js** (v18+ recommended)
- **npm** (or yarn/pnpm)

---

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Run the app

**Option A — Development (frontend + backend)**

- Terminal 1 — backend (API + Socket.IO):

  ```bash
  npm run start
  ```

  Server runs at **http://localhost:5000**.

- Terminal 2 — frontend (Vite):

  ```bash
  npm run dev
  ```

  App runs at **http://localhost:3000**. Vite proxies `/api` and `/socket.io` to port 5000.

**Option B — Production-style (single server)**

```bash
npm run build
npm run start
```

Then open **http://localhost:5000**. The Express server serves the built app from `dist/`.

### 3. Use the app

1. Open the app in your browser.
2. **Register** or **log in** (email + password).
3. Move with **arrow keys** or **WASD** (or click to walk).
4. Use the bottom bar: **mic**, **camera**, **screen share**, **chat**, **hang up** (turns off mic/camera/screen).
5. Get close to other users (within 3 tiles) to hear/see them or watch their screen share.

---

## Scripts

| Command           | Description |
|------------------|-------------|
| `npm run dev`    | Start Vite dev server (port 3000, proxies to 5000) |
| `npm run build`  | Build frontend to `dist/` |
| `npm run preview`| Preview production build (Vite) |
| `npm run start`  | Start Express server (port 5000, serves API + Socket.IO + optional static) |

---

## Project layout

```
vorko/
├── public/           # Static assets
├── src/
│   ├── main.jsx     # Entry point
│   ├── App.jsx      # Main app: auth, movement, Socket.IO, WebRTC (mic/video/screen), UI
│   ├── index.css    # Global styles
│   ├── data/
│   │   └── officeData.js   # Office layout / rooms
│   └── components/
│       ├── Auth.jsx
│       ├── Character.jsx
│       ├── ChatPanel.jsx
│       ├── Controls.jsx
│       ├── OfficeGrid.jsx
│       └── RoomInfo.jsx
├── data/            # Runtime JSON store (users, room messages, DMs) — created by server
├── server.js        # Express + Socket.IO + WebRTC signaling + auth + LiveKit token API
├── vite.config.js
└── package.json
```

---

## Environment (optional)

You can override defaults with env vars:

| Variable              | Purpose |
|-----------------------|---------|
| `PORT`                | Server port (default `5000`) |
| `JWT_SECRET`          | Secret for JWT auth (default dev value; change in production) |
| `LIVEKIT_URL`         | LiveKit URL (used only for `/api/livekit/token`) |
| `LIVEKIT_API_KEY`     | LiveKit API key |
| `LIVEKIT_API_SECRET`  | LiveKit API secret |

---

## How media works (high level)

- **Signaling**: Socket.IO (start/stop, subscribe/unsubscribe, SDP offer/answer, ICE candidates).
- **Media**: WebRTC peer-to-peer (one `RTCPeerConnection` per viewer/listener).
- **Proximity**: Server only allows subscribe when both users are in the **same room** and within **3 tiles** distance.
- **ICE**: Client uses `stun:stun.l.google.com:19302`. No TURN in default setup; add TURN for strict NATs if needed.

---

## License

MIT.
