import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Room as LiveKitRoom, createLocalScreenTracks, RemoteTrack, RemoteTrackPublication, Track } from 'livekit-client';
import { io } from 'socket.io-client';
import Auth from './components/Auth';
import OfficeGrid from './components/OfficeGrid';
import Character from './components/Character';
import Controls from './components/Controls';
import ChatPanel from './components/ChatPanel';
import RoomInfo from './components/RoomInfo';
import { officeLayout, officeObjects } from './data/officeData';

function App() {
  const [socket, setSocket] = useState(null);
  const [user, setUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [roomMessages, setRoomMessages] = useState([]);
  const [dmMessages, setDmMessages] = useState({}); // { [peerUserId]: Message[] }
  const [currentRoom, setCurrentRoom] = useState('main-office');
  const [isConnected, setIsConnected] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [account, setAccount] = useState(null);
  const [presence, setPresence] = useState('available'); // 'available' | 'busy' | 'dnd'
  const [directory, setDirectory] = useState([]); // all registered users
  const [dmPeerId, setDmPeerId] = useState(null);
  const [unreadByUserId, setUnreadByUserId] = useState({});
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  // Movement state
  const [autoPath, setAutoPath] = useState([]); // array of {x,y} to walk to
  const [isWalking, setIsWalking] = useState(false);
  
  // Screen share and LiveKit state
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const localScreenTracksRef = useRef([]); // Local screen share tracks
  const localScreenStreamRef = useRef(null); // Local screen share MediaStream (created from tracks for preview)
  const lkScreenShareRoomRef = useRef(null); // LiveKit Room for screen sharing
  const [activeSharerIds, setActiveSharerIds] = useState([]); // socket ids in my room currently sharing
  const [screenTiles, setScreenTiles] = useState({}); // { [sharerId]: { left, top, width, height, visible, title, ended } }
  const viewerStreamsRef = useRef(new Map()); // as viewer: sharerSocketId -> MediaStream
  const subscribedRemoteScreenTracksRef = useRef(new Map()); // Track remote screen track subscriptions
  const [fullScreenSharerId, setFullScreenSharerId] = useState(null);
  const [fsControlsVisible, setFsControlsVisible] = useState(true);
  const fsHideTimerRef = useRef(null);
  const [watchersBySharerId, setWatchersBySharerId] = useState({}); // { [sharerId]: [{id,name,avatar}] }
  const [fsViewersExpanded, setFsViewersExpanded] = useState(false);
  const [fsMultiView, setFsMultiView] = useState(false);
  const [minimizedSharerIds, setMinimizedSharerIds] = useState([]);
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => localStorage.getItem('notify_enabled') === '1');
  const [appNotifs, setAppNotifs] = useState([]); // [{id, type: 'dm'|'wave', fromUserId, fromSocketId, fromName, fromAvatar, text, timestamp, read}]
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const notifMenuRef = useRef(null);
  const notifUnread = useMemo(() => appNotifs.filter(n => !n.read).length, [appNotifs]);
  const [profileModalUserId, setProfileModalUserId] = useState(null);
  // LiveKit audio (unused for proximity mic)
  // const lkRoomRef = useRef(null);
  // const [isAudioConnected, setIsAudioConnected] = useState(false);
  // Proximity voice (mic via WebRTC P2P)
  const [isMicOn, setIsMicOn] = useState(false);
  const localMicStreamRef = useRef(null);
  const speakerPeerConnsRef = useRef(new Map()); // as speaker: listenerSocketId -> RTCPeerConnection
  const listenerPeerConnsRef = useRef(new Map()); // as listener: speakerSocketId -> RTCPeerConnection
  const [activeSpeakerIds, setActiveSpeakerIds] = useState([]);
  // Proximity camera video (P2P)
  const [isCamOn, setIsCamOn] = useState(false);
  const localCamStreamRef = useRef(null);
  const videoBroadcasterPCsRef = useRef(new Map()); // as broadcaster: viewerSocketId -> RTCPeerConnection
  const videoViewerPCsRef = useRef(new Map()); // as viewer: broadcasterSocketId -> RTCPeerConnection
  const [activeBroadcasterIds, setActiveBroadcasterIds] = useState([]);

  function playNotificationSound() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 880; // A5
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
      o.connect(g); g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.2);
      // chain a second quick chirp
      setTimeout(() => {
        try {
          const o2 = ctx.createOscillator();
          const g2 = ctx.createGain();
          o2.type = 'triangle';
          o2.frequency.value = 660; // E5
          g2.gain.setValueAtTime(0.0001, ctx.currentTime);
          g2.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
          g2.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
          o2.connect(g2); g2.connect(ctx.destination);
          o2.start();
          o2.stop(ctx.currentTime + 0.18);
        } catch {}
      }, 120);
    } catch {}
  }

  function showBrowserNotification(title, body) {
    try {
      if (typeof Notification === 'undefined') return;
      if (Notification.permission !== 'granted') return;
      const n = new Notification(title, { body });
      setTimeout(() => { try { n.close(); } catch {} }, 6000);
    } catch {}
  }

  const addMinimizedSharer = (id) => setMinimizedSharerIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  const removeMinimizedSharer = (id) => setMinimizedSharerIds((prev) => prev.filter(x => x !== id));

  function ensureNotificationPermission() {
    if (typeof Notification === 'undefined') {
      addToast('Notifications are not supported in this browser.', 'error');
      return false;
    }
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') {
      addToast('Notifications are blocked. Enable them in browser settings.', 'error');
      return false;
    }
    Notification.requestPermission().then((perm) => {
      if (perm === 'granted') {
        setNotificationsEnabled(true);
        localStorage.setItem('notify_enabled', '1');
        addToast('Message notifications enabled.', 'info');
      } else {
        addToast('Notification permission declined.', 'error');
      }
    });
    return false;
  }

  function showMessageNotification({ fromName, fromAvatar, text, peerUserId }) {
    try {
      if (typeof Notification === 'undefined') return;
      if (Notification.permission !== 'granted') return;
      const title = fromName || 'New message';
      const body = String(text || '').slice(0, 140);
      const n = new Notification(title, { body });
      n.onclick = () => {
        try { window.focus(); } catch {}
        try { window.__openDm?.(peerUserId); } catch {}
        try { n.close(); } catch {}
      };
      setTimeout(() => { try { n.close(); } catch {} }, 6000);
    } catch {}
  }

  function pushAppNotification({ type = 'dm', fromUserId, fromSocketId, fromName, fromAvatar, text, timestamp }) {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    setAppNotifs(prev => [{ id, type, fromUserId, fromSocketId, fromName, fromAvatar, text, timestamp: timestamp || new Date().toISOString(), read: false }, ...prev].slice(0, 100));
  }

  function dismissNotif(id) {
    setAppNotifs(prev => prev.filter(n => n.id !== id));
  }

  function openDmFromNotif(n) {
    try {
      setIsChatOpen(true);
      const otherId = n.fromUserId;
      setDmPeerId(otherId);
      loadDmHistory(otherId);
      setUnreadByUserId(prev => ({ ...prev, [otherId]: 0 }));
      setAppNotifs(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
      setIsNotifOpen(false);
    } catch {}
  }
  const [toasts, setToasts] = useState([]);
  const addToast = (text, type = 'info', ttlMs = 2800) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => setToasts((prev) => prev.filter(t => t.id !== id)), ttlMs);
  };

  const PROXIMITY_RADIUS = 3; // tiles
  const MAX_VIDEO_SUBSCRIPTIONS = 12; // cap concurrent video PCs to keep UI stable

  // Nearby users within radius (sorted by distance)
  const { nearbyUsers, nearestPeer } = useMemo(() => {
    if (!user) return { nearbyUsers: [], nearestPeer: null };
    const sameRoom = users.filter(u => u.room === user.room);
    let minD = Infinity;
    let nearest = null;
    const within = [];
    for (const u of sameRoom) {
      const dx = (u.position?.x || 0) - (user.position?.x || 0);
      const dy = (u.position?.y || 0) - (user.position?.y || 0);
      const d = Math.hypot(dx, dy);
      if (d <= PROXIMITY_RADIUS) within.push({ ...u, _distance: d });
      if (d < minD) { minD = d; nearest = u; }
    }
    within.sort((a, b) => a._distance - b._distance);
    return {
      nearbyUsers: within,
      nearestPeer: minD <= PROXIMITY_RADIUS ? nearest : null,
    };
  }, [users, user]);

  // Determine which sharers are within proximity to view
  const eligibleSharerIds = useMemo(() => {
    if (!user) return [];
    const set = new Set();
    for (const sharerId of activeSharerIds) {
      const u = users.find(x => x.id === sharerId && x.room === user.room);
      if (!u) continue;
      const dx = (u.position?.x || 0) - (user.position?.x || 0);
      const dy = (u.position?.y || 0) - (user.position?.y || 0);
      const d = Math.hypot(dx, dy);
      if (d <= PROXIMITY_RADIUS) set.add(sharerId);
    }
    return Array.from(set);
  }, [activeSharerIds, users, user]);

  // Determine which camera broadcasters are within proximity to view
  const eligibleVideoIds = useMemo(() => {
    if (!user) return [];
    const set = new Set();
    for (const bid of activeBroadcasterIds || []) {
      const u = users.find(x => x.id === bid && x.room === user.room);
      if (!u) continue;
      const dx = (u.position?.x || 0) - (user.position?.x || 0);
      const dy = (u.position?.y || 0) - (user.position?.y || 0);
      const d = Math.hypot(dx, dy);
      if (d <= PROXIMITY_RADIUS) set.add(bid);
    }
    return Array.from(set);
  }, [activeBroadcasterIds, users, user]);

  const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

  function ensureScreenTile(sharerId, title) {
    setScreenTiles(prev => {
      if (prev[sharerId]) return prev;
      // Default larger dock size and positioned near top center
      const width = 560;
      const height = 340;
      const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1280;
      const left = Math.max(12, Math.round((viewportW - width) / 2));
      const top = 96;
      return { ...prev, [sharerId]: { left, top, width, height, visible: true, title: title || 'Screen', ended: false } };
    });
  }

  function updateScreenTile(sharerId, partial) {
    setScreenTiles(prev => ({ ...prev, [sharerId]: { ...(prev[sharerId] || {}), ...partial } }));
  }

  function removeScreenTile(sharerId) {
    setScreenTiles(prev => {
      const next = { ...prev };
      delete next[sharerId];
      return next;
    });
  }

  // Video tiles (camera) state and helpers
  const [videoTiles, setVideoTiles] = useState({}); // { [broadcasterId]: { left, top, width, height, visible, title, ended } }
  const videoViewerStreamsRef = useRef(new Map()); // as viewer: broadcasterSocketId -> MediaStream
  const [fullScreenVideoId, setFullScreenVideoId] = useState(null);
  const [videoMinimizedIds, setVideoMinimizedIds] = useState([]);
  const addMinimizedVideo = (id) => setVideoMinimizedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  const removeMinimizedVideo = (id) => setVideoMinimizedIds((prev) => prev.filter(x => x !== id));

  function ensureVideoTile(broadcasterId, title) {
    setVideoTiles(prev => {
      if (prev[broadcasterId]) return prev;
      const width = 420;
      const height = 260;
      const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1280;
      const left = Math.max(12, Math.round((viewportW - width) / 2));
      const top = 120;
      return { ...prev, [broadcasterId]: { left, top, width, height, visible: true, title: title || 'Camera', ended: false } };
    });
  }

  function updateVideoTile(broadcasterId, partial) {
    setVideoTiles(prev => ({ ...prev, [broadcasterId]: { ...(prev[broadcasterId] || {}), ...partial } }));
  }

  function removeVideoTile(broadcasterId) {
    setVideoTiles(prev => {
      const next = { ...prev };
      delete next[broadcasterId];
      return next;
    });
  }

  function dockVideoTileToAnchor(broadcasterId) {
    try {
      const el = document.getElementById(`nearby-card-${broadcasterId}`);
      const width = 420;
      const height = 260;
      if (el) {
        const rect = el.getBoundingClientRect();
        const left = Math.max(8, Math.round(rect.left + (rect.width / 2) - (width / 2)));
        const top = Math.max(8, Math.round(rect.top + (rect.height / 2) - (height / 2)));
        ensureVideoTile(broadcasterId, (users.find(u => u.id === broadcasterId)?.name) || 'Camera');
        updateVideoTile(broadcasterId, { left, top, width, height, visible: true });
        return;
      }
    } catch {}
    ensureVideoTile(broadcasterId, (users.find(u => u.id === broadcasterId)?.name) || 'Camera');
  }

  function dockScreenTileToTop(sharerId) {
    const width = 560;
    const height = 340;
    const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const left = Math.max(12, Math.round((viewportW - width) / 2));
    const top = 96; // below top bars
    ensureScreenTile(sharerId, (users.find(u => u.id === sharerId)?.name) || 'Screen');
    updateScreenTile(sharerId, { left, top, width, height, visible: true });
  }

  function dockScreenTileToAnchor(sharerId) {
    try {
      const el = document.getElementById(`nearby-card-${sharerId}`);
      const width = 560;
      const height = 340;
      if (el) {
        const rect = el.getBoundingClientRect();
        const left = Math.max(8, Math.round(rect.left + (rect.width / 2) - (width / 2)));
        const top = Math.max(8, Math.round(rect.top + (rect.height / 2) - (height / 2)));
        ensureScreenTile(sharerId, (users.find(u => u.id === sharerId)?.name) || 'Screen');
        updateScreenTile(sharerId, { left, top, width, height, visible: true });
        return;
      }
    } catch {}
    dockScreenTileToTop(sharerId);
  }

  // Helper function to setup LiveKit room event handlers
  function setupLiveKitRoomHandlers(room) {
    if (!room) return;

    // Remove existing handlers first to avoid duplicates
    room.removeAllListeners('trackPublished');
    room.removeAllListeners('trackSubscribed');
    room.removeAllListeners('trackUnsubscribed');
    room.removeAllListeners('participantConnected');
    room.removeAllListeners('participantDisconnected');

    // Handle remote tracks being published
    room.on('trackPublished', async (publication, participant) => {
      // Subscribe to screen share tracks automatically
      if (publication.kind === 'video' && publication.source === Track.Source.ScreenShare) {
        const sharerId = participant.identity;
        if (sharerId && sharerId !== socket.id && !publication.isSubscribed) {
          try {
            await publication.setSubscribed(true);
          } catch (e) {
            console.error('Error subscribing to published track:', e);
          }
        }
      }
    });

    // Handle track subscription
    room.on('trackSubscribed', (track, publication, participant) => {
      if (track.kind === 'video' && track.source === Track.Source.ScreenShare) {
        const sharerId = participant.identity;
        if (!sharerId || sharerId === socket.id) return; // Skip own tracks

        // Create MediaStream from track's mediaStreamTrack
        const mediaStreamTrack = track.mediaStreamTrack;
        if (!mediaStreamTrack) {
          console.error('No mediaStreamTrack in subscribed track');
          return;
        }
        
        const stream = new MediaStream([mediaStreamTrack]);
        viewerStreamsRef.current.set(sharerId, stream);
        subscribedRemoteScreenTracksRef.current.set(sharerId, { track, publication, participant });

        // Attach to video element using track's attach method for better compatibility
        ensureScreenTile(sharerId, (users.find(u => u.id === sharerId)?.name) || 'Screen');
        
        // Attach track to element using LiveKit's attach method
        const attachToElement = async (element, retries = 0) => {
          if (!element || !(element instanceof HTMLVideoElement)) return false;
          
          try {
            // Wait for track to be ready with retries
            if (!track.mediaStreamTrack) {
              if (retries < 10) {
                setTimeout(() => attachToElement(element, retries + 1), 100);
                return false;
              }
              console.warn('Track mediaStreamTrack not available after retries');
              return false;
            }

            // Wait for track to be live
            if (track.mediaStreamTrack.readyState !== 'live') {
              if (retries < 20) {
                setTimeout(() => attachToElement(element, retries + 1), 100);
                return false;
              }
              console.warn('Track not live after retries, attempting attach anyway');
            }

            // Use LiveKit's attach method for proper track attachment
            track.attach(element);
            
            // Also set srcObject as fallback for better compatibility
            if (element.srcObject !== stream) {
              element.srcObject = stream;
            }
            
            // Wait a bit for track to initialize, then play
            await new Promise(resolve => setTimeout(resolve, 100));
            await element.play();
            
            // Auto-open full-screen on first frame if not already
            if (!fullScreenSharerId) {
              setFullScreenSharerId(sharerId);
            }
            // Notify server I'm watching
            try { socket.emit('viewer-started-watching', { sharerId }); } catch {}
            return true;
          } catch (e) {
            console.error('Error attaching track to element:', e);
            // Fallback to srcObject only
            if (retries < 3) {
              setTimeout(() => attachToElement(element, retries + 1), 200);
              return false;
            }
            try {
              element.srcObject = stream;
              await element.play();
              return true;
            } catch (e2) {
              console.error('Fallback attachment failed:', e2);
              return false;
            }
          }
        };

        // Try to attach with retries
        const tryAttach = async () => {
          let retryCount = 0;
          const maxRetries = 10;
          while (retryCount < maxRetries) {
            const videoEl = document.getElementById(`screen-video-${sharerId}`);
            if (videoEl) {
              const attached = await attachToElement(videoEl, 0);
              if (attached) {
                return true;
              }
            }
            retryCount++;
            await new Promise(resolve => setTimeout(resolve, 150));
          }
          return false;
        };

        // Try immediate attach (fire and forget async)
        (async () => {
          await tryAttach();
        })();
      }
    });

    // Handle track unsubscription
    room.on('trackUnsubscribed', (track, publication, participant) => {
      if (track.kind === 'video' && track.source === Track.Source.ScreenShare) {
        const sharerId = participant.identity;
        if (sharerId && sharerId !== socket.id) {
          // Detach track from element
          const videoEl = document.getElementById(`screen-video-${sharerId}`);
          if (videoEl) {
            try {
              track.detach(videoEl);
              videoEl.srcObject = null;
            } catch {}
          }
          subscribedRemoteScreenTracksRef.current.delete(sharerId);
          viewerStreamsRef.current.delete(sharerId);
        }
      }
    });

    // Handle new participant connecting
    room.on('participantConnected', async (participant) => {
      const sharerId = participant.identity;
      if (!sharerId || sharerId === socket.id) return;

      // Subscribe to any existing screen share tracks from this participant
      for (const publication of participant.trackPublications.values()) {
        if (publication.kind === 'video' && publication.source === Track.Source.ScreenShare && !publication.isSubscribed) {
          try {
            await publication.setSubscribed(true);
          } catch (e) {
            console.error('Error subscribing to participant track:', e);
          }
        }
      }
    });

    // Handle participant leaving
    room.on('participantDisconnected', (participant) => {
      const sharerId = participant.identity;
      if (sharerId && sharerId !== socket.id) {
        // Detach all tracks from this participant
        const trackSub = subscribedRemoteScreenTracksRef.current.get(sharerId);
        if (trackSub && trackSub.track) {
          const videoEl = document.getElementById(`screen-video-${sharerId}`);
          if (videoEl) {
            try {
              trackSub.track.detach(videoEl);
              videoEl.srcObject = null;
            } catch {}
          }
        }
        subscribedRemoteScreenTracksRef.current.delete(sharerId);
        viewerStreamsRef.current.delete(sharerId);
        updateScreenTile(sharerId, { ended: true });
      }
    });
  }

  async function toggleScreenShare() {
    if (isSharingScreen) {
      // Stop screen sharing
      try {
        // Unpublish tracks from LiveKit room
        const room = lkScreenShareRoomRef.current;
        if (room && room.state === 'connected') {
          for (const track of localScreenTracksRef.current) {
            try {
              await room.localParticipant.unpublishTrack(track);
              track.stop();
            } catch {}
          }
          // Don't disconnect the room here - keep it connected for viewing others' shares
        } else {
          // Fallback: stop tracks directly
          for (const track of localScreenTracksRef.current) {
            try { track.stop(); } catch {}
          }
        }
        localScreenTracksRef.current = [];
        localScreenStreamRef.current = null;
        setIsSharingScreen(false);
        try { socket?.emit('stop-screenshare'); } catch {}
      } catch (e) {
        console.error('Error stopping screen share:', e);
        setIsSharingScreen(false);
      }
      return;
    }

    try {
      // Ensure we have a LiveKit room connection (should be handled by useEffect, but ensure it exists)
      let room = lkScreenShareRoomRef.current;
      if (!room || room.state !== 'connected') {
        // Wait a bit for room to connect, or connect now
        const token = localStorage.getItem('token');
        if (!token) {
          addToast('Authentication required.', 'error');
          return;
        }

        const roomName = `screenshare-${currentRoom}`;
        const tokenRes = await fetch('/api/livekit/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            room: roomName,
            identity: socket?.id || user?.id || 'user',
            name: user?.name || account?.name || 'User'
          })
        });

        if (!tokenRes.ok) {
          throw new Error('Failed to get LiveKit token');
        }

        const { token: lkToken, url: lkUrl } = await tokenRes.json();
        room = new LiveKitRoom();
        
        // Setup event handlers BEFORE connecting
        setupLiveKitRoomHandlers(room);
        
        await room.connect(lkUrl, lkToken);
        lkScreenShareRoomRef.current = room;
      } else {
        // Room already exists, ensure handlers are set up
        setupLiveKitRoomHandlers(room);
      }

      // Create local screen tracks using LiveKit
      const tracks = await createLocalScreenTracks({
        video: {
          displaySurface: 'monitor',
          frameRate: 30,
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });

      localScreenTracksRef.current = tracks;

      // Create MediaStream from tracks for local preview
      const mediaStreamTracks = tracks.map(t => t.mediaStreamTrack).filter(Boolean);
      if (mediaStreamTracks.length > 0) {
        localScreenStreamRef.current = new MediaStream(mediaStreamTracks);
      }

      // Publish tracks to room
      for (const track of tracks) {
        try {
          await room.localParticipant.publishTrack(track, { source: Track.Source.ScreenShare });
        } catch (e) {
          console.error('Error publishing track:', e);
        }
      }

      // Handle track ended (user stops via browser)
      for (const track of tracks) {
        track.on('ended', async () => {
          setIsSharingScreen(false);
          try { socket?.emit('stop-screenshare'); } catch {}
          // Unpublish tracks
          const room = lkScreenShareRoomRef.current;
          if (room && room.state === 'connected') {
            try {
              for (const t of localScreenTracksRef.current) {
                await room.localParticipant.unpublishTrack(t);
                t.stop();
              }
            } catch {}
          }
          localScreenTracksRef.current = [];
          localScreenStreamRef.current = null;
        });
      }

      setIsSharingScreen(true);
      socket?.emit('start-screenshare');
    } catch (e) {
      console.error('Screen share error:', e);
      if (e && (e.name === 'NotAllowedError' || e.name === 'AbortError')) {
        addToast('Screen capture permission denied. You can try again.', 'error');
      } else {
        addToast('Failed to start screen share.', 'error');
      }
      setIsSharingScreen(false);
      // Cleanup on error
      for (const track of localScreenTracksRef.current) {
        try { track.stop(); } catch {}
      }
      localScreenTracksRef.current = [];
      localScreenStreamRef.current = null;
    }
  }

  // Mic: start/stop and proximity auto-subscribe
  async function toggleMic() {
    if (isMicOn) {
      try { localMicStreamRef.current?.getTracks()?.forEach(t => t.stop()); } catch {}
      localMicStreamRef.current = null;
      setIsMicOn(false);
      try { socket?.emit('stop-audio'); } catch {}
      // Close all listener peer connections
      for (const [, pc] of speakerPeerConnsRef.current) {
        try { pc.close(); } catch {}
      }
      speakerPeerConnsRef.current.clear();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      localMicStreamRef.current = stream;
      setIsMicOn(true);
      socket?.emit('start-audio');
    } catch (e) {
      addToast('Mic permission denied or unavailable.', 'error');
      setIsMicOn(false);
      localMicStreamRef.current = null;
    }
  }

  // Camera: start/stop
  async function toggleCamera() {
    if (isCamOn) {
      try { localCamStreamRef.current?.getTracks()?.forEach(t => t.stop()); } catch {}
      localCamStreamRef.current = null;
      setIsCamOn(false);
      try { socket?.emit('stop-video'); } catch {}
      for (const [, pc] of videoBroadcasterPCsRef.current) {
        try { pc.close(); } catch {}
      }
      videoBroadcasterPCsRef.current.clear();
      // remove self preview
      try { videoViewerStreamsRef.current.delete(user?.id); } catch {}
      removeVideoTile(user?.id);
      if (fullScreenVideoId === user?.id) setFullScreenVideoId(null);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 } }, audio: false });
      localCamStreamRef.current = stream;
      setIsCamOn(true);
      socket?.emit('start-video');
      // set up self preview tile
      if (user?.id) {
        videoViewerStreamsRef.current.set(user.id, stream);
        ensureVideoTile(user.id, user.name || 'Camera');
        if (!fullScreenVideoId) setFullScreenVideoId(user.id);
      }
    } catch (e) {
      addToast('Camera permission denied or unavailable.', 'error');
      setIsCamOn(false);
      localCamStreamRef.current = null;
    }
  }

  // Quick end button: turn off mic, camera, and screen share (Meet-style hang up)
  function endAllMedia() {
    try {
      if (isMicOn) toggleMic();
    } catch {}
    try {
      if (isCamOn) toggleCamera();
    } catch {}
    try {
      if (isSharingScreen) toggleScreenShare();
    } catch {}
  }

  // Fetch account profile when token exists (name, avatar)
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setAccount(null);
      return;
    }
    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('unauthorized');
        return res.json();
      })
      .then(({ user }) => {
        setAccount(user);
        if (user?.name) localStorage.setItem('user_name', user.name);
        if (user?.avatar) localStorage.setItem('user_avatar', user.avatar);
      })
      .catch(() => {
        // token invalid; force logout
        localStorage.removeItem('token');
        localStorage.removeItem('user_name');
        localStorage.removeItem('user_avatar');
        setAccount(null);
      });
  }, []);

  // Load user directory
  useEffect(() => {
    fetch('/api/users')
      .then(res => res.json())
      .then(({ users }) => setDirectory(users || []))
      .catch(() => setDirectory([]));
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setSocket(null);
      return;
    }
    const newSocket = io(window.location.origin, {
      auth: { token }
    });
    setSocket(newSocket);

    newSocket.on('connect', () => {
      setIsConnected(true);
      console.log('Connected to server');
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
      console.log('Disconnected from server');
    });

    return () => {
      newSocket.close();
    };
  }, []);

  // Socket: presence and movement handlers
  useEffect(() => {
    if (!socket) return;
    const onJoined = (newUser) => setUsers(prev => [...prev.filter(u => u.id !== newUser.id), newUser]);
    const onLeft = (userId) => setUsers(prev => prev.filter(u => u.id !== userId));
    const onMoved = (userData) => setUsers(prev => prev.map(u => u.id === userData.id ? { ...u, position: userData.position, room: userData.room, presence: userData.presence || u.presence } : u));
    const onPresenceChanged = ({ id, presence }) => setUsers(prev => prev.map(u => u.id === id ? { ...u, presence: presence || 'available' } : u));
    const onRoomUsers = (roomUsers) => setUsers(roomUsers.filter(u => u.id !== socket.id));

    socket.on('user-joined', onJoined);
    socket.on('user-left', onLeft);
    socket.on('user-moved', onMoved);
    socket.on('room-users', onRoomUsers);
    socket.on('presence-changed', onPresenceChanged);

    return () => {
      socket.off('user-joined', onJoined);
      socket.off('user-left', onLeft);
      socket.off('user-moved', onMoved);
      socket.off('room-users', onRoomUsers);
      socket.off('presence-changed', onPresenceChanged);
    };
  }, [socket]);

  // Socket: screen share presence signaling (who is sharing - LiveKit handles actual streaming)
  useEffect(() => {
    if (!socket) return;

    const onActive = ({ sharerIds }) => {
      setActiveSharerIds(Array.isArray(sharerIds) ? sharerIds : []);
    };
    const onStarted = ({ sharerId }) => {
      setActiveSharerIds(prev => Array.from(new Set([...prev, sharerId])));
    };
    const onStopped = ({ sharerId }) => {
      setActiveSharerIds(prev => prev.filter(id => id !== sharerId));
      // As viewer: remove LiveKit subscription
      const trackSub = subscribedRemoteScreenTracksRef.current.get(sharerId);
      if (trackSub) {
        try {
          if (trackSub.publication) {
            trackSub.publication.setSubscribed(false);
          }
          if (trackSub.track) {
            trackSub.track.detach();
          }
        } catch {}
        subscribedRemoteScreenTracksRef.current.delete(sharerId);
      }
      viewerStreamsRef.current.delete(sharerId);
      updateScreenTile(sharerId, { ended: true });
    };

    const onWatchers = ({ sharerId, watchers }) => {
      setWatchersBySharerId(prev => ({ ...prev, [sharerId]: Array.isArray(watchers) ? watchers : [] }));
    };

    socket.on('screenshare-active', onActive);
    socket.on('screenshare-started', onStarted);
    socket.on('screenshare-stopped', onStopped);
    socket.on('screenshare-watchers', onWatchers);

    return () => {
      socket.off('screenshare-active', onActive);
      socket.off('screenshare-started', onStarted);
      socket.off('screenshare-stopped', onStopped);
      socket.off('screenshare-watchers', onWatchers);
    };
  }, [socket]);

  // LiveKit: Connect to screen share room and handle remote track subscriptions
  useEffect(() => {
    if (!socket || !user || !currentRoom) return;

    let room = lkScreenShareRoomRef.current;
    let isConnecting = false;

    async function connectToScreenShareRoom() {
      if (room && room.state === 'connected') return; // Already connected
      if (isConnecting) return;
      isConnecting = true;

      try {
        const token = localStorage.getItem('token');
        if (!token) return;

        const roomName = `screenshare-${currentRoom}`;
        
        // Get LiveKit access token
        const tokenRes = await fetch('/api/livekit/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            room: roomName,
            identity: socket.id || user.id || 'user',
            name: user.name || account?.name || 'User'
          })
        });

        if (!tokenRes.ok) {
          console.error('Failed to get LiveKit token for screen share room');
          isConnecting = false;
          return;
        }

        const { token: lkToken, url: lkUrl } = await tokenRes.json();

        // Disconnect existing room if any
        if (room) {
          try {
            await room.disconnect();
          } catch {}
        }

        // Create and connect to LiveKit room
        const newRoom = new LiveKitRoom();
        
        // Setup event handlers BEFORE connecting
        setupLiveKitRoomHandlers(newRoom);
        
        await newRoom.connect(lkUrl, lkToken);
        lkScreenShareRoomRef.current = newRoom;
        isConnecting = false;

        // Subscribe to existing screen share tracks after connection
        // Wait a bit for connection to fully establish
        setTimeout(async () => {
          if (!newRoom || newRoom.state !== 'connected') return;
          
          for (const participant of newRoom.remoteParticipants.values()) {
            for (const publication of participant.trackPublications.values()) {
              if (publication.kind === 'video' && publication.source === Track.Source.ScreenShare) {
                const sharerId = participant.identity;
                if (sharerId && sharerId !== socket.id && !publication.isSubscribed) {
                  try {
                    await publication.setSubscribed(true);
                  } catch (e) {
                    console.error('Error subscribing to existing track:', e);
                  }
                }
              }
            }
          }
        }, 500);
      } catch (e) {
        console.error('Error connecting to LiveKit screen share room:', e);
        isConnecting = false;
      }
    }

    connectToScreenShareRoom();

    // Also ensure handlers are set up if room already exists
    if (room && room.state === 'connected') {
      setupLiveKitRoomHandlers(room);
    }

    // Cleanup on unmount or room change
    return () => {
      // Don't disconnect here - keep room connected for viewing others' shares
      // Only cleanup handlers if needed
    };
  }, [socket, user, currentRoom, isSharingScreen, users, account]);

  // Socket: mic signaling (mirror of screen share but audio-only)
  useEffect(() => {
    if (!socket) return;

    const onActive = ({ speakerIds }) => {
      setActiveSpeakerIds(Array.isArray(speakerIds) ? speakerIds : []);
    };
    const onStarted = ({ speakerId }) => {
      setActiveSpeakerIds(prev => Array.from(new Set([...prev, speakerId])));
    };
    const onStopped = ({ speakerId }) => {
      setActiveSpeakerIds(prev => prev.filter(id => id !== speakerId));
      const pc = listenerPeerConnsRef.current.get(speakerId);
      if (pc) {
        try { pc.close(); } catch {}
        listenerPeerConnsRef.current.delete(speakerId);
      }
      const el = document.getElementById(`prox-audio-${speakerId}`);
      if (el && el.parentElement) {
        try { el.srcObject = null; el.remove(); } catch {}
      }
    };

    const onSubscribe = async ({ from }) => {
      // I am speaker, listener requests subscription
      if (!isMicOn || !localMicStreamRef.current) return;
      if (speakerPeerConnsRef.current.has(from)) {
        try { speakerPeerConnsRef.current.get(from).close(); } catch {}
        speakerPeerConnsRef.current.delete(from);
      }
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      speakerPeerConnsRef.current.set(from, pc);
      for (const track of localMicStreamRef.current.getTracks()) {
        try { track.contentHint = 'speech'; } catch {}
        pc.addTrack(track, localMicStreamRef.current);
      }
      pc.onicecandidate = (ev) => {
        if (ev.candidate) socket.emit('audio-ice-candidate', { to: from, candidate: ev.candidate });
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
          try { pc.close(); } catch {}
          speakerPeerConnsRef.current.delete(from);
        }
      };
      try {
        const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
        await pc.setLocalDescription(offer);
        socket.emit('audio-webrtc-offer', { to: from, sdp: pc.localDescription });
      } catch (e) {
        try { pc.close(); } catch {}
        speakerPeerConnsRef.current.delete(from);
      }
    };

    const onUnsubscribe = ({ from }) => {
      const pc = speakerPeerConnsRef.current.get(from);
      if (pc) {
        try { pc.close(); } catch {}
        speakerPeerConnsRef.current.delete(from);
      }
    };

    const onOffer = async ({ from, sdp }) => {
      if (listenerPeerConnsRef.current.size >= 32 && !listenerPeerConnsRef.current.has(from)) {
        // soft cap to keep UI and audio stable
        return;
      }
      // I am listener receiving offer from speaker
      let pc = listenerPeerConnsRef.current.get(from);
      if (pc) {
        try { pc.close(); } catch {}
        listenerPeerConnsRef.current.delete(from);
      }
      pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      listenerPeerConnsRef.current.set(from, pc);
      pc.onicecandidate = (ev) => {
        if (ev.candidate) socket.emit('audio-ice-candidate', { to: from, candidate: ev.candidate });
      };
      pc.ontrack = (ev) => {
        const [stream] = ev.streams;
        // Attach to hidden audio element
        const elId = `prox-audio-${from}`;
        let el = document.getElementById(elId);
        if (!el) {
          el = document.createElement('audio');
          el.id = elId;
          el.autoplay = true;
          el.playsInline = true;
          el.style.display = 'none';
          document.body.appendChild(el);
        }
        try { el.srcObject = stream; el.play?.().catch(() => {}); } catch {}
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
          try { pc.close(); } catch {}
          listenerPeerConnsRef.current.delete(from);
        }
      };
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('audio-webrtc-answer', { to: from, sdp: pc.localDescription });
      } catch (e) {
        try { pc.close(); } catch {}
        listenerPeerConnsRef.current.delete(from);
      }
    };

    const onAnswer = async ({ from, sdp }) => {
      const pc = speakerPeerConnsRef.current.get(from);
      if (!pc) return;
      try { await pc.setRemoteDescription(new RTCSessionDescription(sdp)); } catch {}
    };

    const onIce = async ({ from, candidate }) => {
      let pc = speakerPeerConnsRef.current.get(from);
      if (!pc) pc = listenerPeerConnsRef.current.get(from);
      if (!pc) return;
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
    };

    socket.on('audio-active', onActive);
    socket.on('audio-started', onStarted);
    socket.on('audio-stopped', onStopped);
    socket.on('audio-subscribe', onSubscribe);
    socket.on('audio-unsubscribe', onUnsubscribe);
    socket.on('audio-webrtc-offer', onOffer);
    socket.on('audio-webrtc-answer', onAnswer);
    socket.on('audio-ice-candidate', onIce);

    return () => {
      socket.off('audio-active', onActive);
      socket.off('audio-started', onStarted);
      socket.off('audio-stopped', onStopped);
      socket.off('audio-subscribe', onSubscribe);
      socket.off('audio-unsubscribe', onUnsubscribe);
      socket.off('audio-webrtc-offer', onOffer);
      socket.off('audio-webrtc-answer', onAnswer);
      socket.off('audio-ice-candidate', onIce);
    };
  }, [socket, users, isMicOn]);

  // Socket: camera signaling (video-only)
  useEffect(() => {
    if (!socket) return;

    const onActive = ({ broadcasterIds }) => {
      setActiveBroadcasterIds(Array.isArray(broadcasterIds) ? broadcasterIds : []);
    };
    const onStarted = ({ broadcasterId }) => {
      setActiveBroadcasterIds(prev => Array.from(new Set([...prev, broadcasterId])));
    };
    const onStopped = ({ broadcasterId }) => {
      setActiveBroadcasterIds(prev => prev.filter(id => id !== broadcasterId));
      const pc = videoViewerPCsRef.current.get(broadcasterId);
      if (pc) { try { pc.close(); } catch {} videoViewerPCsRef.current.delete(broadcasterId); }
      const el = document.getElementById(`prox-video-${broadcasterId}`);
      if (el && el.parentElement) {
        try { el.srcObject = null; el.remove(); } catch {}
      }
    };

    const onSubscribe = async ({ from }) => {
      // I am broadcaster, viewer requests subscription
      if (!isCamOn || !localCamStreamRef.current) return;
      if (videoBroadcasterPCsRef.current.has(from)) {
        try { videoBroadcasterPCsRef.current.get(from).close(); } catch {}
        videoBroadcasterPCsRef.current.delete(from);
      }
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      videoBroadcasterPCsRef.current.set(from, pc);
      for (const track of localCamStreamRef.current.getTracks()) {
        try { track.contentHint = track.kind === 'video' ? 'motion' : undefined; } catch {}
        pc.addTrack(track, localCamStreamRef.current);
      }
      pc.onicecandidate = (ev) => { if (ev.candidate) socket.emit('video-ice-candidate', { to: from, candidate: ev.candidate }); };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
          try { pc.close(); } catch {}
          videoBroadcasterPCsRef.current.delete(from);
        }
      };
      try {
        const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
        await pc.setLocalDescription(offer);
        socket.emit('video-webrtc-offer', { to: from, sdp: pc.localDescription });
      } catch (e) {
        try { pc.close(); } catch {}
        videoBroadcasterPCsRef.current.delete(from);
      }
    };

    const onUnsubscribe = ({ from }) => {
      const pc = videoBroadcasterPCsRef.current.get(from);
      if (pc) { try { pc.close(); } catch {} videoBroadcasterPCsRef.current.delete(from); }
    };

    const onOffer = async ({ from, sdp }) => {
      // I am viewer. Guard cap.
      if (videoViewerPCsRef.current.size >= MAX_VIDEO_SUBSCRIPTIONS && !videoViewerPCsRef.current.has(from)) {
        return;
      }
      let pc = videoViewerPCsRef.current.get(from);
      if (pc) { try { pc.close(); } catch {} videoViewerPCsRef.current.delete(from); }
      pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      videoViewerPCsRef.current.set(from, pc);
      pc.onicecandidate = (ev) => { if (ev.candidate) socket.emit('video-ice-candidate', { to: from, candidate: ev.candidate }); };
      pc.ontrack = (ev) => {
        const [stream] = ev.streams;
        videoViewerStreamsRef.current.set(from, stream);
        ensureVideoTile(from, (users.find(u => u.id === from)?.name) || 'Camera');
        const tryAttach = () => {
          const el = document.getElementById(`video-inline-${from}`);
          if (el && el instanceof HTMLVideoElement) {
            try { el.srcObject = stream; el.play?.().catch(() => {}); } catch {}
            if (!fullScreenVideoId) setFullScreenVideoId(from);
            return true;
          }
          return false;
        };
        if (!tryAttach()) setTimeout(() => { tryAttach(); }, 50);
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
          try { pc.close(); } catch {}
          videoViewerPCsRef.current.delete(from);
        }
      };
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('video-webrtc-answer', { to: from, sdp: pc.localDescription });
      } catch (e) {
        try { pc.close(); } catch {}
        videoViewerPCsRef.current.delete(from);
      }
    };

    const onAnswer = async ({ from, sdp }) => {
      const pc = videoBroadcasterPCsRef.current.get(from);
      if (!pc) return;
      try { await pc.setRemoteDescription(new RTCSessionDescription(sdp)); } catch {}
    };

    const onIce = async ({ from, candidate }) => {
      let pc = videoBroadcasterPCsRef.current.get(from);
      if (!pc) pc = videoViewerPCsRef.current.get(from);
      if (!pc) return;
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
    };

    socket.on('video-active', onActive);
    socket.on('video-started', onStarted);
    socket.on('video-stopped', onStopped);
    socket.on('video-subscribe', onSubscribe);
    socket.on('video-unsubscribe', onUnsubscribe);
    socket.on('video-webrtc-offer', onOffer);
    socket.on('video-webrtc-answer', onAnswer);
    socket.on('video-ice-candidate', onIce);

    return () => {
      socket.off('video-active', onActive);
      socket.off('video-started', onStarted);
      socket.off('video-stopped', onStopped);
      socket.off('video-subscribe', onSubscribe);
      socket.off('video-unsubscribe', onUnsubscribe);
      socket.off('video-webrtc-offer', onOffer);
      socket.off('video-webrtc-answer', onAnswer);
      socket.off('video-ice-candidate', onIce);
    };
  }, [socket, users, isCamOn]);

  // Proximity-based auto subscribe/unsubscribe for screen share (LiveKit handles subscriptions automatically)
  useEffect(() => {
    if (!socket || !user) return;
    const room = lkScreenShareRoomRef.current;
    if (!room || room.state !== 'connected') return;

    const subscribedSharers = new Set(subscribedRemoteScreenTracksRef.current.keys());
    
    // Subscribe to newly eligible sharers via LiveKit
    for (const sharerId of eligibleSharerIds) {
      if (!subscribedSharers.has(sharerId)) {
        // Find participant by identity (socket ID)
        const participant = Array.from(room.remoteParticipants.values()).find(
          p => p.identity === sharerId
        );
        if (participant) {
          // Find screen share track publication
          for (const publication of participant.trackPublications.values()) {
            if (publication.kind === 'video' && publication.source === Track.Source.ScreenShare) {
              // Subscribe if not already subscribed
              if (!publication.isSubscribed) {
                publication.setSubscribed(true).catch((e) => {
                  console.error('Error subscribing to proximity sharer:', e);
                });
              }
              // Prepare tile immediately for smooth appear
              ensureScreenTile(sharerId, (users.find(u => u.id === sharerId)?.name) || 'Screen');
              break;
            }
          }
        }
      }
    }
    
    // Unsubscribe from those no longer eligible
    for (const sharerId of subscribedSharers) {
      if (!eligibleSharerIds.includes(sharerId)) {
        const trackSub = subscribedRemoteScreenTracksRef.current.get(sharerId);
        if (trackSub && trackSub.publication) {
          trackSub.publication.setSubscribed(false).catch(() => {});
        }
        // Detach track from video element
        if (trackSub && trackSub.track) {
          const videoEl = document.getElementById(`screen-video-${sharerId}`);
          if (videoEl) {
            try {
              trackSub.track.detach(videoEl);
              videoEl.srcObject = null;
            } catch {}
          }
        }
        subscribedRemoteScreenTracksRef.current.delete(sharerId);
        viewerStreamsRef.current.delete(sharerId);
        removeScreenTile(sharerId);
        try { socket.emit('viewer-stopped-watching', { sharerId }); } catch {}
        if (fullScreenSharerId === sharerId) {
          // if current full-screen left range, switch to another eligible or exit
          const next = eligibleSharerIds.find(id => id !== sharerId) || null;
          setFullScreenSharerId(next || null);
        }
      }
    }
  }, [eligibleSharerIds, socket, user, users]);

  // Proximity-based auto subscribe/unsubscribe for mic
  useEffect(() => {
    if (!socket || !user) return;
    const set = new Set(activeSpeakerIds);
    const subscribed = new Set(Array.from(listenerPeerConnsRef.current.keys()));

    // Determine which speakers are within radius
    const eligible = [];
    for (const speakerId of set) {
      const u = users.find(x => x.id === speakerId && x.room === user.room);
      if (!u) continue;
      const dx = (u.position?.x || 0) - (user.position?.x || 0);
      const dy = (u.position?.y || 0) - (user.position?.y || 0);
      const d = Math.hypot(dx, dy);
      if (d <= PROXIMITY_RADIUS) eligible.push(speakerId);
    }

    // Subscribe to new eligible speakers
    for (const speakerId of eligible) {
      if (!subscribed.has(speakerId)) {
        try { socket.emit('audio-subscribe', { speakerId }); } catch {}
      }
    }

    // Unsubscribe from those no longer eligible
    for (const speakerId of subscribed) {
      if (!eligible.includes(speakerId)) {
        try { socket.emit('audio-unsubscribe', { speakerId }); } catch {}
        const pc = listenerPeerConnsRef.current.get(speakerId);
        if (pc) { try { pc.close(); } catch {} }
        listenerPeerConnsRef.current.delete(speakerId);
      }
    }
  }, [socket, activeSpeakerIds, users, user]);

  // Proximity-based auto subscribe/unsubscribe for camera (with cap)
  useEffect(() => {
    if (!socket || !user) return;
    const set = new Set(activeBroadcasterIds);
    const subscribed = new Set(Array.from(videoViewerPCsRef.current.keys()));

    const eligible = [];
    for (const broadcasterId of set) {
      const u = users.find(x => x.id === broadcasterId && x.room === user.room);
      if (!u) continue;
      const dx = (u.position?.x || 0) - (user.position?.x || 0);
      const dy = (u.position?.y || 0) - (user.position?.y || 0);
      const d = Math.hypot(dx, dy);
      if (d <= PROXIMITY_RADIUS) eligible.push(broadcasterId);
    }

    // Prioritize nearest broadcasters and cap
    const prioritized = eligible
      .map(id => {
        const u = users.find(x => x.id === id);
        const dx = (u?.position?.x || 0) - (user.position?.x || 0);
        const dy = (u?.position?.y || 0) - (user.position?.y || 0);
        return { id, d: Math.hypot(dx, dy) };
      })
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_VIDEO_SUBSCRIPTIONS)
      .map(x => x.id);

    for (const broadcasterId of eligible) {
      if (!subscribed.has(broadcasterId) && prioritized.includes(broadcasterId)) {
        try { socket.emit('video-subscribe', { broadcasterId }); } catch {}
      }
    }

    for (const broadcasterId of subscribed) {
      if (!prioritized.includes(broadcasterId)) {
        try { socket.emit('video-unsubscribe', { broadcasterId }); } catch {}
        const pc = videoViewerPCsRef.current.get(broadcasterId);
        if (pc) { try { pc.close(); } catch {} }
        videoViewerPCsRef.current.delete(broadcasterId);
        const el = document.getElementById(`prox-video-${broadcasterId}`);
        if (el && el.parentElement) {
          try { el.srcObject = null; el.remove(); } catch {}
        }
      }
    }
  }, [socket, activeBroadcasterIds, users, user]);

  // Room messages listener disabled in DM-first UI

  // Socket: direct messages
  useEffect(() => {
    if (!socket) return;
    const onDirect = (message) => {
      setDmMessages((prev) => {
        const myId = account?.id;
        const otherId = message.fromUserId === myId ? message.toUserId : message.fromUserId;
        const thread = prev[otherId] || [];
        return { ...prev, [otherId]: [...thread, message] };
      });
      const myId = account?.id;
      const otherId = message.fromUserId === myId ? message.toUserId : message.fromUserId;
      const isActiveThread = otherId === dmPeerId;
      if (!isActiveThread || document.visibilityState !== 'visible') {
        setUnreadByUserId((prev) => ({ ...prev, [otherId]: (prev[otherId] || 0) + 1 }));
        // App in-app notification
        pushAppNotification({ fromUserId: message.fromUserId, fromName: message.fromName, fromAvatar: message.fromAvatar, text: message.message, timestamp: message.timestamp });
        if (notificationsEnabled) {
          showMessageNotification({
            fromName: message.fromName,
            fromAvatar: message.fromAvatar,
            text: message.message,
            peerUserId: otherId
          });
        }
        playNotificationSound();
      }
    };
    socket.on('new-direct-message', onDirect);
    const onWave = ({ from }) => {
      const title = `${from?.name || 'Someone'} waved at you`;
      const text = '👋 Wave';
      addToast(`${from?.name || 'Someone'} waved at you 👋`, 'info');
      pushAppNotification({ type: 'wave', fromUserId: directory.find(d => d.id === from?.id)?.id || null, fromSocketId: from?.id, fromName: from?.name, fromAvatar: from?.avatar, text, timestamp: new Date().toISOString() });
      // browser notification
      if (notificationsEnabled) {
        showBrowserNotification(title, text);
      }
      playNotificationSound();
    };
    socket.on('wave-received', onWave);
    return () => {
      socket.off('new-direct-message', onDirect);
      socket.off('wave-received', onWave);
    };
  }, [socket, account?.id, dmPeerId, notificationsEnabled]);

  // Auto-select first user from directory if none selected
  useEffect(() => {
    if (!dmPeerId && directory.length > 0) {
      const first = directory.find(u => u.id !== account?.id) || directory[0];
      if (first?.id) {
        setDmPeerId(first.id);
        loadDmHistory(first.id);
      }
    }
  }, [directory, account?.id]);

  // Room history prefetch disabled in DM-first UI

  // Close user menu on outside click
  useEffect(() => {
    function onDocClick(e) {
      if (isUserMenuOpen && userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setIsUserMenuOpen(false);
      }
      if (isNotifOpen && notifMenuRef.current && !notifMenuRef.current.contains(e.target)) {
        setIsNotifOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [isUserMenuOpen, isNotifOpen]);

  const loadDmHistory = (peerUserId) => {
    const token = localStorage.getItem('token');
    if (!token || !peerUserId) return;
    fetch(`/api/chat/dm/${encodeURIComponent(peerUserId)}?limit=200`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.json())
      .then(({ messages }) => setDmMessages(prev => ({ ...prev, [peerUserId]: messages || [] })))
      .catch(() => setDmMessages(prev => ({ ...prev, [peerUserId]: [] })));
  };

  const handleJoinOffice = (userData) => {
    if (socket) {
      const chosenAvatar = userData.avatar || account?.avatar || localStorage.getItem('user_avatar') || '👨';
      const displayName = userData.name || account?.name || localStorage.getItem('user_name') || 'Guest';
      const user = {
        ...userData,
        name: displayName,
        avatar: chosenAvatar,
        id: socket.id,
        position: { x: 15, y: 12 }, // Adjusted for 30x25 grid
        room: currentRoom,
        presence
      };
      // persist avatar for future sessions
      localStorage.setItem('user_avatar', chosenAvatar);
      setUser(user);
      socket.emit('join-office', user);
    }
  };

  const handleMove = (newPosition) => {
    if (socket && user) {
      const updatedUser = { ...user, position: newPosition };
      setUser(updatedUser);
      socket.emit('user-move', {
        position: newPosition,
        room: currentRoom,
        presence
      });
    }
  };

  // Cancel auto-walk if user presses arrow keys
  const cancelAutoWalk = () => {
    setAutoPath([]);
    // brief walking animation pulse for manual move
    setIsWalking(true);
    setTimeout(() => setIsWalking(false), 200);
  };

  // Step through auto path at a steady pace
  useEffect(() => {
    if (!user) return;
    if (!autoPath || autoPath.length === 0) { setIsWalking(false); return; }
    setIsWalking(true);
    const next = autoPath[0];
    // Move one tile towards next step (already discrete)
    const timer = setTimeout(() => {
      handleMove(next);
      setAutoPath((prev) => prev.slice(1));
    }, 120);
    return () => clearTimeout(timer);
  }, [autoPath, user]);

  // Build a simple straight/Manhattan path avoiding walls (no A*)
  function isWalkable(x, y) {
    try {
      const tile = officeLayout[currentRoom]?.grid?.[y]?.[x];
      return tile && tile !== 'W';
    } catch {
      return false;
    }
  }

  function computePath(from, to) {
    const path = [];
    let cx = from.x;
    let cy = from.y;
    const guard = 1000;
    let steps = 0;
    const dx = Math.sign(to.x - cx);
    const dy = Math.sign(to.y - cy);
    // Greedy axis-first walk with wall checks
    while ((cx !== to.x || cy !== to.y) && steps < guard) {
      steps++;
      let nx = cx;
      let ny = cy;
      const tryX = cx !== to.x ? cx + Math.sign(to.x - cx) : cx;
      const tryY = cy !== to.y ? cy + Math.sign(to.y - cy) : cy;
      // Prefer horizontal step, else vertical
      if (tryX !== cx && isWalkable(tryX, cy)) {
        nx = tryX; ny = cy;
      } else if (tryY !== cy && isWalkable(cx, tryY)) {
        nx = cx; ny = tryY;
      } else if (tryX !== cx && tryY !== cy && isWalkable(tryX, tryY)) {
        // diagonal fallback if both open (still applies as two steps visually)
        nx = tryX; ny = tryY;
      } else {
        // Blocked; stop pathing
        break;
      }
      cx = nx; cy = ny;
      path.push({ x: cx, y: cy });
      if (path.length > 800) break; // safety
    }
    return path;
  }

  const handleSendMessage = (message) => {
    if (socket) {
      if (dmPeerId) {
        socket.emit('send-direct-message', { toUserId: dmPeerId, message });
      }
    }
  };

  // LiveKit group voice (not used for proximity mic now) — placeholder if needed later

  const sendWave = (toSocketId) => {
    try { socket?.emit('wave-send', { to: toSocketId }); } catch {}
    addToast('👋 Wave sent!', 'info');
  };

  const handleRoomChange = (newRoom) => {
    setCurrentRoom(newRoom);
    if (user && socket) {
      const newPosition = { x: 15, y: 12 }; // Adjusted for 30x25 grid
      const updatedUser = { ...user, position: newPosition, room: newRoom };
      setUser(updatedUser);
      socket.emit('user-move', {
        position: newPosition,
        room: newRoom,
        presence
      });
    }
  };

  if (!localStorage.getItem('token')) {
    return (
      <div className="office-container">
        <Auth onAuthSuccess={() => setIsConnected(false)} />
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="office-container">
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center'
        }}>
          <h1 style={{ color: '#64ffda', marginBottom: '20px' }}>Vorko</h1>
          <p style={{ color: '#b0b0b0' }}>Connecting to server...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="office-container">
      <div ref={userMenuRef} style={{ position: 'fixed', top: 12, right: 12, zIndex: 12000 }}>
        <button
          className="user-menu-button"
          aria-label="User menu"
          onClick={() => setIsUserMenuOpen(o => !o)}
          title={account?.name || 'Account'}
        >
          <span style={{ fontSize: 18 }}>{account?.avatar || localStorage.getItem('user_avatar') || '👤'}</span>
        </button>
        {isUserMenuOpen && (
          <div className="user-menu">
            <div className="user-menu-header">
              <div className="user-menu-avatar">{account?.avatar || '👤'}</div>
              <div className="user-menu-name">{account?.name || 'User'}</div>
              {account?.email && (<div className="user-menu-email">{account.email}</div>)}
            </div>
            <div className="user-menu-actions">
              <div className="user-menu-item" style={{ display: 'grid', gap: 10 }}>
                <div style={{ fontWeight: 800, color: '#F3F4F6', fontSize: 13 }}>Settings</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ color: '#E5E7EB', fontSize: 12 }}>Message notifications</div>
                  <button
                    onClick={() => {
                      if (!notificationsEnabled) {
                        const ok = ensureNotificationPermission();
                        if (ok) {
                          setNotificationsEnabled(true);
                          localStorage.setItem('notify_enabled', '1');
                          addToast('Message notifications enabled.', 'info');
                        }
                      } else {
                        setNotificationsEnabled(false);
                        localStorage.setItem('notify_enabled', '0');
                        addToast('Notifications disabled.', 'info');
                      }
                    }}
                    title={notificationsEnabled ? 'Disable message notifications' : 'Enable message notifications'}
                    style={{
                      background: notificationsEnabled ? 'rgba(16,185,129,0.18)' : 'rgba(17,17,17,0.6)',
                      border: notificationsEnabled ? '1px solid rgba(16,185,129,0.35)' : '1px solid rgba(255,255,255,0.12)',
                      color: '#E5E7EB',
                      borderRadius: 999,
                      padding: '6px 10px',
                      cursor: 'pointer'
                    }}
                  >{notificationsEnabled ? 'On' : 'Off'}</button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ color: '#E5E7EB', fontSize: 12 }}>Presence</div>
                  <select
                    value={presence}
                    onChange={(e) => {
                      const next = e.target.value;
                      setPresence(next);
                      if (socket && user) {
                        socket.emit('user-move', { position: user.position, room: user.room, presence: next });
                        setUser({ ...user, presence: next });
                      }
                    }}
                    style={{ background: 'rgba(17,17,17,0.6)', color: '#E5E7EB', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '6px 8px' }}
                  >
                    <option value="available">Available</option>
                    <option value="busy">Busy</option>
                    <option value="dnd">Do Not Disturb</option>
                  </select>
                </div>
              </div>
              <button
                className="user-menu-item danger"
                onClick={() => {
                  try { socket?.disconnect(); } catch {}
                  localStorage.removeItem('token');
                  localStorage.removeItem('user_name');
                  localStorage.removeItem('user_avatar');
                  window.location.reload();
                }}
              >Logout</button>
            </div>
          </div>
        )}
      </div>
      <OfficeGrid
        currentRoom={currentRoom}
        onDoubleClickTile={({ x, y }) => {
          if (!user) return;
          const clamped = { x: Math.max(1, Math.min(28, x)), y: Math.max(1, Math.min(23, y)) };
          if (!isWalkable(clamped.x, clamped.y)) return;
          const path = computePath(user.position, clamped);
          setAutoPath(path);
        }}
      >
        {/* Characters are now rendered inside the zoomable OfficeGrid */}
        {user && (
          <Character 
            user={user}
            onMove={handleMove}
            isCurrentUser={true}
            showRadius={false}
            radiusTiles={PROXIMITY_RADIUS}
            isSharingActive={isSharingScreen}
            onManualMove={cancelAutoWalk}
            isWalking={isWalking}
          />
        )}
        
        {users
          .filter(u => u.room === currentRoom)
          .map(user => (
            <Character 
              key={user.id}
              user={user}
              onMove={() => {}}
              isCurrentUser={false}
              isSharingActive={activeSharerIds.includes(user.id)}
              onClick={() => setProfileModalUserId(user.id)}
            />
          ))}
      </OfficeGrid>
      
      <Controls 
        onJoinOffice={handleJoinOffice}
        onRoomChange={handleRoomChange}
        currentRoom={currentRoom}
        user={user}
        account={account}
        collapsed={!showControls}
        onToggle={() => setShowControls((v) => !v)}
      />

      <RoomInfo 
        currentRoom={currentRoom}
        userCount={users.length + (user ? 1 : 0)}
        isConnected={isConnected}
      />

      {/* Nearby users top bar with scroll */}
      {user && (nearbyUsers.length > 0 || (isSharingScreen && minimizedSharerIds.includes(user.id)) || (isCamOn && videoMinimizedIds.includes(user.id))) && !fullScreenSharerId && !fullScreenVideoId && (
        <div style={{ position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 8, padding: 8, borderRadius: 12, background: 'rgba(17,17,17,0.6)', backdropFilter: 'blur(6px)', zIndex: 12500, boxShadow: '0 10px 28px rgba(0,0,0,0.35)' }}>
          <button title="Scroll left" aria-label="Scroll left" onClick={() => { try { document.getElementById('nearby-scroll')?.scrollBy({ left: -320, behavior: 'smooth' }); } catch {} }} style={{ border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.08)', color: '#fff', borderRadius: 8, width: 28, height: 62, cursor: 'pointer' }}>‹</button>
          <div id="nearby-scroll" style={{ overflowX: 'auto', overflowY: 'hidden', display: 'grid', gridAutoFlow: 'column', gap: 14, padding: '2px 4px', maxWidth: 'min(92vw, 1200px)' }}>
            {[...(((isSharingScreen && minimizedSharerIds.includes(user.id)) || (isCamOn && videoMinimizedIds.includes(user.id))) ? [{ ...user }] : []), ...nearbyUsers].map((u) => {
              const isScreenSelected = activeSharerIds.includes(u.id);
              const isVideoSelected = activeBroadcasterIds.includes(u.id);
              const isMinimizedScreenHere = isScreenSelected && minimizedSharerIds.includes(u.id);
              const isMinimizedVideoHere = isVideoSelected && videoMinimizedIds.includes(u.id);
              const isSelected = isScreenSelected || isVideoSelected;
              return (
                <div key={u.id} id={`nearby-card-${u.id}`} title={u.name} style={{ display: 'grid', gridTemplateColumns: (isMinimizedScreenHere || isMinimizedVideoHere) ? undefined : '40px 1fr', alignItems: 'center', minWidth: (isMinimizedScreenHere || isMinimizedVideoHere) ? 260 : 180, minHeight: (isMinimizedScreenHere || isMinimizedVideoHere) ? 160 : undefined, padding: (isMinimizedScreenHere || isMinimizedVideoHere) ? 8 : '10px 12px', borderRadius: 12, border: isSelected ? '2px solid #64FFDA' : '1px solid rgba(255,255,255,0.18)', background: isSelected ? 'rgba(100,255,218,0.12)' : 'rgba(255,255,255,0.06)', color: '#fff', cursor: isSelected ? 'pointer' : 'default', overflow: 'hidden' }} onClick={() => { if (!isSelected) return; if (isMinimizedVideoHere) { setFullScreenVideoId(u.id); removeMinimizedVideo(u.id); } else if (isMinimizedScreenHere) { setFullScreenSharerId(u.id); removeMinimizedSharer(u.id); } }}>
                  {(isMinimizedScreenHere || isMinimizedVideoHere || (u.id === user?.id && ((isSharingScreen && minimizedSharerIds.includes(user.id)) || (isCamOn && videoMinimizedIds.includes(user.id))))) ? (
                    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                      {isMinimizedVideoHere || (u.id === user?.id && isCamOn && videoMinimizedIds.includes(user.id)) ? (
                        <video id={`video-inline-card-${u.id}`} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#000', borderRadius: 8 }} ref={(el) => { const stream = videoViewerStreamsRef.current.get(u.id); const selfStream = (u.id === user?.id) ? localCamStreamRef.current : null; const target = stream || selfStream; if (el && target && el.srcObject !== target) { try { el.srcObject = target; } catch {} } }} />
                      ) : (
                        <video id={`screen-video-inline-${u.id}`} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000', borderRadius: 8 }} ref={(el) => { const stream = viewerStreamsRef.current.get(u.id); const selfStream = (u.id === user?.id) ? localScreenStreamRef.current : null; const target = stream || selfStream; if (el && target && el.srcObject !== target) { try { el.srcObject = target; } catch {} } }} />
                      )}
                      <div style={{ position: 'absolute', left: 8, bottom: 8, right: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 16 }}>{u.avatar || '🖥️'}</span>
                          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
                            <span style={{ fontSize: 12, fontWeight: 800 }}>{u.name}</span>
                            <span style={{ fontSize: 10, opacity: 0.9 }}>{(isMinimizedVideoHere || (u.id === user?.id && isCamOn && videoMinimizedIds.includes(user.id))) ? 'Video' : 'Screen Share'}</span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button title="Maximize" onClick={(e) => { e.stopPropagation(); const useVideo = isMinimizedVideoHere || (u.id === user?.id && isCamOn && videoMinimizedIds.includes(user.id)); if (useVideo) { setFullScreenVideoId(u.id); removeMinimizedVideo(u.id); } else { setFullScreenSharerId(u.id); removeMinimizedSharer(u.id); } }} style={{ border: 'none', background: 'rgba(255,255,255,0.18)', color: '#fff', borderRadius: 6, height: 22, padding: '0 6px', cursor: 'pointer' }}>⤢</button>
                          <button title="Close" onClick={(e) => { e.stopPropagation(); const useVideo = isMinimizedVideoHere || (u.id === user?.id && isCamOn && videoMinimizedIds.includes(user.id)); if (useVideo) { try { socket?.emit('video-unsubscribe', { broadcasterId: u.id }); } catch {} const pc = videoViewerPCsRef.current.get(u.id); if (pc) { try { pc.close(); } catch {} } videoViewerPCsRef.current.delete(u.id); removeVideoTile(u.id); removeMinimizedVideo(u.id); } else { 
                            // As viewer: unsubscribe from LiveKit screen share
                            const trackSub = subscribedRemoteScreenTracksRef.current.get(u.id);
                            if (trackSub && trackSub.publication) {
                              try {
                                trackSub.publication.setSubscribed(false);
                              } catch {}
                            }
                            if (trackSub && trackSub.track) {
                              const videoEl = document.getElementById(`screen-video-${u.id}`);
                              if (videoEl) {
                                try {
                                  trackSub.track.detach(videoEl);
                                  videoEl.srcObject = null;
                                } catch {}
                              }
                            }
                            subscribedRemoteScreenTracksRef.current.delete(u.id);
                            viewerStreamsRef.current.delete(u.id);
                            removeScreenTile(u.id);
                            try { socket?.emit('viewer-stopped-watching', { sharerId: u.id }); } catch {}
                            removeMinimizedSharer(u.id);
                            if (fullScreenSharerId === u.id) {
                              setFullScreenSharerId(null);
                            }
                          } }} style={{ border: 'none', background: 'rgba(255,255,255,0.18)', color: '#fff', borderRadius: 6, height: 22, padding: '0 6px', cursor: 'pointer' }}>×</button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span style={{ fontSize: 24 }}>{u.avatar || '👤'}</span>
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 999, background: (u.presence || 'available') === 'dnd' ? '#EF4444' : (u.presence || 'available') === 'busy' ? '#F59E0B' : '#10B981' }} />
                          {u.name}
                        </span>
                        <span style={{ fontSize: 11, opacity: 0.9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isSelected ? (isVideoSelected ? 'Video' : 'Screen Share') : 'Nearby'}</span>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <button title="Scroll right" aria-label="Scroll right" onClick={() => { try { document.getElementById('nearby-scroll')?.scrollBy({ left: 320, behavior: 'smooth' }); } catch {} }} style={{ border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.08)', color: '#fff', borderRadius: 8, width: 28, height: 62, cursor: 'pointer' }}>›</button>
        </div>
      )}

      {/* Profile modal for wave and details */}
      {user && profileModalUserId && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setProfileModalUserId(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'grid', placeItems: 'center', zIndex: 15050 }}
        >
          {(() => {
            const u = users.find(x => x.id === profileModalUserId);
            if (!u) return null;
            return (
              <div style={{ width: 'min(420px, 92vw)', background: 'rgba(17,17,17,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.6)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', fontSize: 24, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}>{u.avatar || '👤'}</div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <div style={{ color: '#F3F4F6', fontWeight: 800, fontSize: 16 }}>{u.name}</div>
                      {(() => {
                        const entry = directory.find(d => d.id === u.userId) || {};
                        return (
                          <div style={{ color: '#9CA3AF', fontSize: 12 }}>{entry.email || ''}</div>
                        );
                      })()}
                    </div>
                  </div>
                  <button onClick={() => setProfileModalUserId(null)} title="Close" style={{ border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#fff', borderRadius: 8, width: 32, height: 32, cursor: 'pointer' }}>×</button>
                </div>
              <div style={{ padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 12, color: '#9CA3AF' }}>Status:</span>
                    {(() => {
                      const p = u.presence || 'available';
                      const map = { available: '#10B981', busy: '#F59E0B', dnd: '#EF4444' };
                      const label = { available: 'Available', busy: 'Busy', dnd: 'Do Not Disturb' };
                      return (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#E5E7EB', fontSize: 12 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 999, background: map[p] || '#10B981' }} />
                          {label[p]}
                        </span>
                      );
                    })()}
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      onClick={() => { if ((u.presence || 'available') !== 'dnd') { sendWave(u.id); setProfileModalUserId(null); } }}
                      style={{
                        border: '1px solid rgba(100,255,218,0.35)', background: (u.presence || 'available') === 'dnd' ? 'rgba(255,255,255,0.06)' : 'rgba(100,255,218,0.12)', color: '#E5E7EB',
                        borderRadius: 10, padding: '10px 12px', cursor: 'pointer', fontWeight: 800
                      }}
                      disabled={(u.presence || 'available') === 'dnd'}
                    >{(u.presence || 'available') === 'dnd' ? '🚫 DND' : '👋 Wave'}</button>
                    <button
                      onClick={() => {
                        // Prefer stable account userId if present
                        const targetUserId = u.userId || (directory.find(d => d.id === u.id)?.id);
                        if (targetUserId) {
                          setDmPeerId(targetUserId);
                          loadDmHistory(targetUserId);
                          setUnreadByUserId(prev => ({ ...prev, [targetUserId]: 0 }));
                          setIsChatOpen(true);
                          setProfileModalUserId(null);
                          // expose to notification click handler as well
                          try { window.__openDm = (uid) => { setIsChatOpen(true); setDmPeerId(uid); loadDmHistory(uid); }; } catch {}
                        }
                      }}
                      style={{ border: '1px solid rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.12)', color: '#E5E7EB', borderRadius: 10, padding: '10px 12px', cursor: 'pointer', fontWeight: 800 }}
                    >💬 Message</button>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {user && isChatOpen && (
        <ChatPanel 
          messages={dmMessages[dmPeerId] || []}
          onSendMessage={handleSendMessage}
          currentUser={user}
          account={account}
          users={(() => {
            const others = directory.filter(u => u.id !== account?.id);
            const lastTsById = new Map();
            for (const u of others) {
              const thread = dmMessages[u.id] || [];
              const last = thread.length > 0 ? thread[thread.length - 1] : null;
              const ts = last && last.timestamp ? Date.parse(last.timestamp) || 0 : 0;
              lastTsById.set(u.id, ts);
            }
            return others.slice().sort((a, b) => (lastTsById.get(b.id) || 0) - (lastTsById.get(a.id) || 0));
          })()}
          dmThreads={dmMessages}
          unreadByUserId={unreadByUserId}
          dmPeerId={dmPeerId}
          onSelectPeer={(peerId) => {
            setDmPeerId(peerId);
            loadDmHistory(peerId);
            setUnreadByUserId(prev => ({ ...prev, [peerId]: 0 }));
          }}
          onClose={() => setIsChatOpen(false)}
        />
      )}

      {user && !fullScreenSharerId && !fullScreenVideoId && (
        <div className="meet-controls" aria-label="Call controls">
          <button
            className={`meet-btn ${isMicOn ? 'active' : ''}`}
            aria-label={isMicOn ? 'Turn off microphone' : 'Turn on microphone'}
            title={isMicOn ? 'Turn off microphone' : 'Turn on microphone'}
            onClick={toggleMic}
          >
            {isMicOn ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 14a4 4 0 0 0 4-4V7a4 4 0 1 0-8 0v3a4 4 0 0 0 4 4Z" stroke="currentColor" strokeWidth="2"/>
                <path d="M19 11a7 7 0 0 1-14 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 10V7a3 3 0 1 1 6 0v3a3 3 0 0 1-3 3" stroke="currentColor" strokeWidth="2"/>
                <path d="M19 11a7 7 0 0 1-3.1 5.78M8.1 16.78A7 7 0 0 1 5 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="m4 4 16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            )}
          </button>
          <button
            className={`meet-btn ${isCamOn ? 'active' : ''}`}
            aria-label={isCamOn ? 'Turn off camera' : 'Turn on camera'}
            title={isCamOn ? 'Turn off camera' : 'Turn on camera'}
            onClick={toggleCamera}
          >
            {isCamOn ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="3" y="6" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2"/>
                <path d="M21 8v8l-4-3-2-1 2-1 4-3Z" fill="currentColor"/>
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="3" y="6" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2"/>
                <path d="M21 8v8l-4-3-2-1 2-1 4-3Z" fill="currentColor"/>
                <path d="m4 4 16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            )}
          </button>
          <button
            className={`meet-btn ${isSharingScreen ? 'active' : ''}`}
            aria-label={isSharingScreen ? 'Stop presenting' : 'Present now'}
            title={isSharingScreen ? 'Stop presenting' : 'Present now'}
            onClick={toggleScreenShare}
          >
            {isSharingScreen ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="2"/>
                <path d="M12 20v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M9 10l3-3 3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="2"/>
                <path d="M12 20v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M12 8l-3 3m3-3 3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
          <button
            className="meet-btn danger"
            aria-label="Hang up"
            title="Hang up (turn off mic, camera, and screen share)"
            onClick={endAllMedia}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6.5 15.5c2.3-1.5 8.7-1.5 11 0 1 .6 2.5-.2 2.5-1.4v-2c0-.6-.4-1.2-1-1.4-4-1.5-10-1.5-14 0-.6.2-1 .8-1 1.4v2c0 1.2 1.5 2 2.5 1.4Z" fill="currentColor"/>
            </svg>
          </button>
        </div>
      )}

      {/* Screen tiles (viewer side) */}
      {/* Legacy floating tiles still supported for non-minimized sharers */}
      {user && !fullScreenSharerId && Object.entries(screenTiles).some(([sid]) => !minimizedSharerIds.includes(sid)) && (
        <>
          {Object.entries(screenTiles).filter(([sid]) => !minimizedSharerIds.includes(sid)).map(([sharerId, layout]) => (
            <div
              key={sharerId}
              style={{
                position: 'fixed',
                left: layout.left,
                top: layout.top,
                width: layout.width,
                height: layout.height,
                zIndex: 12000,
                background: 'rgba(10,10,10,0.85)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 10,
                overflow: 'hidden',
                boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
                transition: 'opacity 220ms ease',
                opacity: layout.visible ? 1 : 0
              }}
              onMouseDown={(e) => {
                // Bring to front by bumping z-index slightly
                e.currentTarget.style.zIndex = 13000;
              }}
            >
              <div
                style={{
                  height: 42,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  background: 'rgba(255,255,255,0.06)',
                  padding: '0 8px',
                  cursor: 'move',
                  userSelect: 'none'
                }}
                onMouseDown={(e) => {
                  const startX = e.clientX;
                  const startY = e.clientY;
                  const startLeft = layout.left;
                  const startTop = layout.top;
                  function onMove(ev) {
                    updateScreenTile(sharerId, { left: Math.max(0, startLeft + (ev.clientX - startX)), top: Math.max(0, startTop + (ev.clientY - startY)) });
                  }
                  function onUp() {
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                  }
                  window.addEventListener('mousemove', onMove);
                  window.addEventListener('mouseup', onUp);
                }}
              >
                <div style={{ fontSize: 12, color: '#fff', fontWeight: 600 }}>{layout.title || 'Screen'}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    title="Maximize"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeMinimizedSharer(sharerId);
                      setFullScreenSharerId(sharerId);
                    }}
                    style={{ border: 'none', background: 'rgba(255,255,255,0.12)', color: '#fff', borderRadius: 6, height: 24, padding: '0 8px', cursor: 'pointer' }}
                  >⤢</button>
                  <button
                    title="Close"
                    onClick={(e) => {
                      e.stopPropagation();
                      // As viewer: unsubscribe from LiveKit and close
                      const trackSub = subscribedRemoteScreenTracksRef.current.get(sharerId);
                      if (trackSub && trackSub.publication) {
                        try {
                          trackSub.publication.setSubscribed(false);
                        } catch {}
                      }
                      if (trackSub && trackSub.track) {
                        const videoEl = document.getElementById(`screen-video-${sharerId}`);
                        if (videoEl) {
                          try {
                            trackSub.track.detach(videoEl);
                            videoEl.srcObject = null;
                          } catch {}
                        }
                      }
                      subscribedRemoteScreenTracksRef.current.delete(sharerId);
                      viewerStreamsRef.current.delete(sharerId);
                      removeScreenTile(sharerId);
                      try { socket?.emit('viewer-stopped-watching', { sharerId }); } catch {}
                      removeMinimizedSharer(sharerId);
                      if (fullScreenSharerId === sharerId) {
                        setFullScreenSharerId(null);
                      }
                    }}
                    style={{ border: 'none', background: 'rgba(255,255,255,0.12)', color: '#fff', borderRadius: 6, height: 24, padding: '0 8px', cursor: 'pointer' }}
                  >×</button>
                </div>
              </div>
              <div style={{ position: 'relative', width: '100%', height: `calc(100% - 32px)` }}>
                {layout.ended ? (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#b0b0b0', fontSize: 14 }}>
                    Screen share has ended
                  </div>
                ) : (
                  <video
                    id={`screen-video-${sharerId}`}
                    autoPlay
                    muted
                    playsInline
                    style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
                    ref={(el) => {
                      const stream = viewerStreamsRef.current.get(sharerId) || (sharerId === user?.id ? localScreenStreamRef.current : null);
                      if (el && stream && el.srcObject !== stream) {
                        try { el.srcObject = stream; } catch {}
                      }
                    }}
                  />
                )}
                {/* Resize handle */}
                <div
                  style={{ position: 'absolute', right: 4, bottom: 4, width: 16, height: 16, cursor: 'nwse-resize', background: 'rgba(255,255,255,0.2)', borderRadius: 4 }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    const startX = e.clientX;
                    const startY = e.clientY;
                    const startW = layout.width;
                    const startH = layout.height;
                    function onMove(ev) {
                      updateScreenTile(sharerId, { width: Math.max(240, startW + (ev.clientX - startX)), height: Math.max(140, startH + (ev.clientY - startY)) });
                    }
                    function onUp() {
                      window.removeEventListener('mousemove', onMove);
                      window.removeEventListener('mouseup', onUp);
                    }
                    window.addEventListener('mousemove', onMove);
                    window.addEventListener('mouseup', onUp);
                  }}
                />
              </div>
            </div>
          ))}
        </>
      )}

      {/* Camera tiles (viewer side) */}
      {user && !fullScreenVideoId && Object.entries(videoTiles).some(([sid]) => !videoMinimizedIds.includes(sid)) && (
        <>
          {Object.entries(videoTiles).filter(([sid]) => !videoMinimizedIds.includes(sid)).map(([broadcasterId, layout]) => (
            <div
              key={broadcasterId}
              style={{
                position: 'fixed', left: layout.left, top: layout.top, width: layout.width, height: layout.height,
                zIndex: 12100, background: 'rgba(10,10,10,0.85)', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 10, overflow: 'hidden', boxShadow: '0 12px 32px rgba(0,0,0,0.45)', transition: 'opacity 220ms ease', opacity: layout.visible ? 1 : 0
              }}
            >
              <div style={{ height: 42, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: 'rgba(255,255,255,0.06)', padding: '0 8px', cursor: 'move', userSelect: 'none' }}
                onMouseDown={(e) => {
                  const startX = e.clientX;
                  const startY = e.clientY;
                  const startLeft = layout.left;
                  const startTop = layout.top;
                  function onMove(ev) {
                    updateVideoTile(broadcasterId, { left: Math.max(0, startLeft + (ev.clientX - startX)), top: Math.max(0, startTop + (ev.clientY - startY)) });
                  }
                  function onUp() {
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                  }
                  window.addEventListener('mousemove', onMove);
                  window.addEventListener('mouseup', onUp);
                }}
              >
                <div style={{ fontSize: 12, color: '#fff', fontWeight: 600 }}>{layout.title || 'Camera'}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button title="Maximize" onClick={() => { setFullScreenVideoId(broadcasterId); setVideoMinimizedIds([]); }} style={{ border: 'none', background: 'rgba(255,255,255,0.12)', color: '#fff', borderRadius: 6, height: 24, padding: '0 8px', cursor: 'pointer' }}>⤢</button>
                  <button title="Close" onClick={() => {
                    try { socket?.emit('video-unsubscribe', { broadcasterId }); } catch {}
                    const pc = videoViewerPCsRef.current.get(broadcasterId);
                    if (pc) { try { pc.close(); } catch {} }
                    videoViewerPCsRef.current.delete(broadcasterId);
                    removeVideoTile(broadcasterId);
                    removeMinimizedVideo(broadcasterId);
                  }} style={{ border: 'none', background: 'rgba(255,255,255,0.12)', color: '#fff', borderRadius: 6, height: 24, padding: '0 8px', cursor: 'pointer' }}>×</button>
                </div>
              </div>
              <div style={{ position: 'relative', width: '100%', height: `calc(100% - 32px)` }}>
                {layout.ended ? (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#b0b0b0', fontSize: 14 }}>Video has ended</div>
                ) : (
                  <>
                    <video
                      id={`video-inline-${broadcasterId}`}
                      autoPlay
                      muted
                      playsInline
                      style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#000' }}
                      ref={(el) => {
                        const stream = videoViewerStreamsRef.current.get(broadcasterId);
                        if (el && stream && el.srcObject !== stream) {
                          try { el.srcObject = stream; } catch {}
                        }
                      }}
                    />
                    {/* Resize handle */}
                    <div
                      style={{ position: 'absolute', right: 4, bottom: 4, width: 16, height: 16, cursor: 'nwse-resize', background: 'rgba(255,255,255,0.2)', borderRadius: 4 }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        const startX = e.clientX;
                        const startY = e.clientY;
                        const startW = layout.width;
                        const startH = layout.height;
                        function onMove(ev) {
                          updateVideoTile(broadcasterId, { width: Math.max(200, startW + (ev.clientX - startX)), height: Math.max(120, startH + (ev.clientY - startY)) });
                        }
                        function onUp() {
                          window.removeEventListener('mousemove', onMove);
                          window.removeEventListener('mouseup', onUp);
                        }
                        window.addEventListener('mousemove', onMove);
                        window.addEventListener('mouseup', onUp);
                      }}
                    />
                  </>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      {user && !isChatOpen && !fullScreenSharerId && (
        <button
          aria-label="Open chat"
          onClick={() => setIsChatOpen(true)}
          style={{
            position: 'fixed',
            bottom: 20,
            right: 20,
            width: 56,
            height: 56,
            borderRadius: '50%',
            border: 'none',
            background: '#F59E0B',
            color: '#111111',
            fontSize: 22,
            cursor: 'pointer',
            zIndex: 11000,
            boxShadow: '0 10px 28px rgba(245,158,11,0.35)'
          }}
        >💬</button>
      )}

      {/* Full-screen overlay: screen share */}
      {user && fullScreenSharerId && (
        <div
          className="ss-overlay"
          onMouseMove={() => {
            setFsControlsVisible(true);
            if (fsHideTimerRef.current) clearTimeout(fsHideTimerRef.current);
            fsHideTimerRef.current = setTimeout(() => setFsControlsVisible(false), 2500);
          }}
        >
          {/* Viewer list left side */}
          <div className={`ss-viewers ${fsViewersExpanded ? 'expanded' : ''}`}>
            {(() => {
              // Show all nearby users as title cards on the left during full-screen
              const list = nearbyUsers;
              const collapsed = !fsViewersExpanded ? list.slice(0, 8) : list;
              const hasMore = list.length > collapsed.length;
              return (
                <>
                  <div className="ss-viewers-scroll">
                    {collapsed.map(w => {
                      const isSharer = activeSharerIds.includes(w.id);
                      return (
                        <div
                          key={w.id}
                          className="ss-avatar"
                          title={w.name}
                          onClick={() => {
                            if (!isSharer) return;
                            setFullScreenSharerId(w.id);
                          }}
                          style={{ cursor: isSharer ? 'pointer' : 'default', outline: w.id === fullScreenSharerId ? '2px solid #64FFDA' : undefined }}
                        >
                          <span className="ss-avatar-emoji">{w.avatar || '👤'}</span>
                          {fsViewersExpanded && (<span className="ss-avatar-name">{w.name}</span>)}
                        </div>
                      );
                    })}
                  </div>
                  {hasMore && (
                    <button className="ss-viewers-more" title="Show more viewers" onClick={() => setFsViewersExpanded(true)}>▼</button>
                  )}
                  {fsViewersExpanded && list.length > 8 && (
                    <button className="ss-viewers-more" title="Collapse" onClick={() => setFsViewersExpanded(false)}>▲</button>
                  )}
                </>
              );
            })()}
          </div>

          {/* Video area */}
          <div key={fullScreenSharerId} className="ss-video-wrap">
            {(() => {
              const stream = viewerStreamsRef.current.get(fullScreenSharerId);
              return (
                <video
                  id={`screen-video-fs-${fullScreenSharerId}`}
                  autoPlay
                  muted
                  playsInline
                  className="ss-video fade-in"
                  ref={(el) => { if (el && stream && el.srcObject !== stream) { try { el.srcObject = stream; } catch {} } }}
                />
              );
            })()}
          </div>

          {/* Bottom sharer switcher */}
          {eligibleSharerIds.length > 1 && (
            <div className="ss-switcher">
              {eligibleSharerIds.map(id => {
                const u = users.find(x => x.id === id);
                const isActive = id === fullScreenSharerId;
                return (
                  <button key={id} className={`ss-switcher-item ${isActive ? 'active' : ''}`} title={u?.name || 'Screen'} onClick={() => {
                    removeMinimizedSharer(id);
                    setFullScreenSharerId(id);
                  }}>
                    <span className="ss-switcher-emoji">{u?.avatar || '🖥️'}</span>
                    <span className="ss-switcher-name">{u?.name || 'Screen'}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Controls toolbar */}
          <div className="ss-toolbar" style={{ display: fsControlsVisible ? 'flex' : 'none' }}>
            <button
              className="ss-btn"
              onClick={() => {
                const sid = fullScreenSharerId;
                if (sid) {
                  dockScreenTileToAnchor(sid);
                  addMinimizedSharer(sid);
                  setFullScreenSharerId(null);
                }
              }}
              title="Minimize"
            >⤡</button>
            {eligibleSharerIds.length > 1 && (
              <button
                className="ss-btn primary"
                onClick={() => {
                  const ids = eligibleSharerIds;
                  const idx = ids.indexOf(fullScreenSharerId);
                  const next = ids[(idx + 1) % ids.length];
                  setFullScreenSharerId(next);
                }}
                title="Switch Stream"
              >⇄</button>
            )}
          </div>
        </div>
      )}

      {/* Full-screen overlay: camera video */}
      {user && fullScreenVideoId && (
        <div className="ss-overlay">
          <div className="ss-video-wrap">
            {(() => {
              const stream = videoViewerStreamsRef.current.get(fullScreenVideoId);
              return (
                <video id={`video-fs-${fullScreenVideoId}`} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
                  ref={(el) => { if (el && stream && el.srcObject !== stream) { try { el.srcObject = stream; el.play?.().catch(() => {}); } catch {} } }}
                />
              );
            })()}
          </div>
          {activeBroadcasterIds.length > 1 && (
            <div className="ss-switcher">
              {activeBroadcasterIds.map(id => {
                const u = users.find(x => x.id === id);
                const isActive = id === fullScreenVideoId;
                return (
                  <button key={id} className={`ss-switcher-item ${isActive ? 'active' : ''}`} title={u?.name || 'Camera'} onClick={() => setFullScreenVideoId(id)}>
                    <span className="ss-switcher-emoji">{u?.avatar || '📷'}</span>
                    <span className="ss-switcher-name">{u?.name || 'Camera'}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="ss-toolbar">
            <button
              className="ss-btn"
              onClick={() => {
                const id = fullScreenVideoId;
                setFullScreenVideoId(null);
                if (id) { dockVideoTileToAnchor(id); addMinimizedVideo(id); }
              }}
              title="Minimize"
            >⤡</button>
            {activeBroadcasterIds.length > 1 && (
              <button
                className="ss-btn primary"
                onClick={() => {
                  const ids = activeBroadcasterIds;
                  const idx = ids.indexOf(fullScreenVideoId);
                  const next = ids[(idx + 1 + ids.length) % ids.length];
                  setFullScreenVideoId(next);
                }}
                title="Switch Video"
              >⇄</button>
            )}
          </div>
        </div>
      )}

      {/* Toasts */}
      {toasts.length > 0 && (
        <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 14000, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {toasts.map(t => (
            <div key={t.id} style={{ padding: '8px 12px', borderRadius: 8, background: t.type === 'error' ? 'rgba(255,59,48,0.15)' : 'rgba(17,17,17,0.75)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', boxShadow: '0 8px 24px rgba(0,0,0,0.35)', backdropFilter: 'blur(6px)' }}>
              {t.text}
            </div>
          ))}
        </div>
      )}

      {/* Notifications bottom pill removed; moved toggle into Profile > Settings */}

      {/* In-app notifications bell & panel */}
      {user && (
        <div ref={notifMenuRef} style={{ position: 'fixed', top: 16, right: 72, zIndex: 14000 }}>
          <button
            aria-label="Notifications"
            onClick={() => setIsNotifOpen(v => !v)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: 'rgba(17,17,17,0.6)', border: '1px solid rgba(255,255,255,0.12)', color: '#E5E7EB',
              backdropFilter: 'blur(8px)', borderRadius: 999, padding: '8px 12px', cursor: 'pointer'
            }}
          >
            <span>🔔</span>
            {notifUnread > 0 && (
              <span style={{ background: '#EF4444', color: '#fff', fontWeight: 800, borderRadius: 999, padding: '2px 6px', fontSize: 12 }}>{notifUnread}</span>
            )}
          </button>

          {isNotifOpen && (
            <div
              style={{
                position: 'absolute', top: 44, right: 0, width: 340, maxHeight: 420, overflowY: 'auto',
                background: 'rgba(17,17,17,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12,
                boxShadow: '0 18px 48px rgba(0,0,0,0.55)', padding: 8
              }}
            >
              {appNotifs.length === 0 ? (
                <div style={{ padding: 12, color: '#9CA3AF', textAlign: 'center' }}>No notifications</div>
              ) : (
                appNotifs.map(n => (
                  <div key={n.id} style={{ display: 'grid', gridTemplateColumns: '36px 1fr auto', gap: 10, alignItems: 'center', padding: 8, borderRadius: 10, background: n.read ? 'transparent' : 'rgba(255,255,255,0.06)' }}>
                    <div style={{ fontSize: 20, width: 36, height: 36, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8 }}>{n.fromAvatar || '👤'}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: '#F3F4F6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.fromName || 'User'}</span>
                        <span style={{ fontSize: 11, color: '#9CA3AF' }}>{new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#E5E7EB', opacity: 0.95, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.text}</div>
                      <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                        {n.type === 'dm' ? (
                          <button
                            onClick={() => openDmFromNotif(n)}
                            style={{ border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.08)', color: '#fff', borderRadius: 8, padding: '6px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
                          >Open</button>
                        ) : (
                          <button
                            onClick={() => { sendWave(n.fromSocketId); dismissNotif(n.id); }}
                            style={{ border: '1px solid rgba(100,255,218,0.35)', background: 'rgba(100,255,218,0.12)', color: '#E5E7EB', borderRadius: 8, padding: '6px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
                          >👋 Wave back</button>
                        )}
                        <button
                          onClick={() => dismissNotif(n.id)}
                          style={{ border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.12)', color: '#fff', borderRadius: 8, padding: '6px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
                        >Dismiss</button>
                      </div>
                    </div>
                    {!n.read && (
                      <span title="Unread" style={{ width: 8, height: 8, borderRadius: 999, background: '#60A5FA' }} />
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
