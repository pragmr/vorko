import { Room, RoomEvent, Track } from 'livekit-client';

class LiveKitService {
  constructor() {
    this.room = null;
    this.isConnected = false;
    this.eventListeners = new Map();
    this.localTracks = new Map(); // Track local tracks for cleanup
  }

  // Initialize room with proximity-based room name
  async initializeRoom(officeRoom, mediaType = 'all', identity, name) {
    try {
      console.log('🚀 Initializing LiveKit room:', { officeRoom, mediaType, identity, name });
      
      // Disconnect from any existing room first
      if (this.room && this.isConnected) {
        console.log('🔄 Disconnecting from existing room...');
        await this.disconnect();
      }
      
      // Generate proximity-based room name
      const roomName = `${officeRoom}__proximity__${mediaType}`;
      console.log('📝 Generated room name:', roomName);
      
      // Get token from server
      console.log('🔑 Getting token from server...');
      const tokenResponse = await this.getToken(roomName, identity, name, mediaType);
      if (!tokenResponse.token || !tokenResponse.url) {
        throw new Error('Failed to get LiveKit token');
      }
      console.log('✅ Token received:', { url: tokenResponse.url, tokenLength: tokenResponse.token.length });

      // Create room instance
      this.room = new Room();
      console.log('🏠 Room instance created');
      
      // Set up event listeners BEFORE connecting
      this.setupEventListeners();
      console.log('👂 Event listeners set up');

      // Connect to room
      console.log('🔌 Connecting to room...');
      console.log('🔗 Connection details:', { 
        url: tokenResponse.url, 
        tokenLength: tokenResponse.token.length,
        roomName: roomName 
      });
      
      // Simple connection without complex waiting
      await this.room.connect(tokenResponse.url, tokenResponse.token);
      
      console.log('✅ LiveKit room connected successfully:', roomName);
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize LiveKit room:', error);
      this.isConnected = false;
      // Clean up on error
      if (this.room) {
        try {
          await this.room.disconnect();
        } catch (cleanupError) {
          console.error('Error during cleanup:', cleanupError);
        }
        this.room = null;
      }
      throw error;
    }
  }

  // Get token from server
  async getToken(roomName, identity, name, mediaType) {
    const token = localStorage.getItem('token');
    console.log('🔑 Requesting token:', { roomName, identity, name, mediaType });
    
    const response = await fetch('/api/livekit/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        room: roomName,
        identity,
        name,
        mediaType
      })
    });

    console.log('📡 Token response status:', response.status);
    
    if (!response.ok) {
      const error = await response.json();
      console.error('❌ Token request failed:', error);
      throw new Error(error.error || 'Failed to get token');
    }

    const result = await response.json();
    console.log('✅ Token received successfully');
    return result;
  }

  // Set up event listeners
  setupEventListeners() {
    if (!this.room) return;

    this.room.on(RoomEvent.Connected, () => {
      console.log('✅ LiveKit connected event fired');
      console.log('🔍 Room state after connect:', this.room.state);
      console.log('🔍 Room name:', this.room.name);
      console.log('🔍 Local participant:', this.room.localParticipant?.identity);
      this.isConnected = true;
      this.emit('connected');
    });

    this.room.on(RoomEvent.Disconnected, (reason) => {
      console.log('❌ LiveKit disconnected event fired:', reason);
      console.log('🔍 Disconnect reason details:', {
        reason: reason,
        roomState: this.room?.state,
        roomName: this.room?.name,
        wasConnected: this.isConnected
      });
      this.isConnected = false;
      this.emit('disconnected');
    });

    this.room.on(RoomEvent.ParticipantConnected, (participant) => {
      console.log('👤 Participant connected:', participant.identity);
      this.emit('participantConnected', participant);
    });

    this.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      console.log('👤 Participant disconnected:', participant.identity);
      this.emit('participantDisconnected', participant);
    });

    this.room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      console.log('📡 Track subscribed:', track.kind, track.source, participant.identity);
      this.emit('trackSubscribed', { track, publication, participant });
    });

    this.room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      console.log('📡 Track unsubscribed:', track.kind, track.source, participant.identity);
      this.emit('trackUnsubscribed', { track, publication, participant });
    });

    // Add error event listener
    this.room.on(RoomEvent.ConnectionStateChanged, (state) => {
      console.log('🔄 Connection state changed:', state);
    });

    this.room.on(RoomEvent.Reconnecting, () => {
      console.log('🔄 LiveKit reconnecting...');
    });

    this.room.on(RoomEvent.Reconnected, () => {
      console.log('✅ LiveKit reconnected');
    });
  }

  // Publish audio track
  async publishAudio() {
    if (!this.room || !this.isConnected) {
      throw new Error('Not connected to room');
    }
    
    try {
      console.log('🎤 Creating local audio track...');
      
      // Check if audio track already exists
      if (this.localTracks.has('audio')) {
        console.log('⚠️ Audio track already exists, unpublishing first...');
        await this.unpublishTrack('audio');
      }
      
      const { createLocalAudioTrack } = await import('livekit-client');
      const audioTrack = await createLocalAudioTrack({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
      console.log('✅ Audio track created:', audioTrack);
      
      console.log('📡 Publishing audio track to room...');
      await this.room.localParticipant.publishTrack(audioTrack);
      this.localTracks.set('audio', audioTrack);
      console.log('✅ Audio track published successfully');
      return audioTrack;
    } catch (error) {
      console.error('❌ Failed to publish audio:', error);
      // Clean up on error
      if (this.localTracks.has('audio')) {
        this.localTracks.delete('audio');
      }
      throw error;
    }
  }

  // Publish video track
  async publishVideo() {
    if (!this.room || !this.isConnected) {
      throw new Error('Not connected to room');
    }
    
    try {
      const { createLocalVideoTrack } = await import('livekit-client');
      const videoTrack = await createLocalVideoTrack({
        resolution: { width: 640, height: 480 },
        frameRate: 30,
      });
      
      await this.room.localParticipant.publishTrack(videoTrack);
      this.localTracks.set('video', videoTrack);
      console.log('Video track published');
      return videoTrack;
    } catch (error) {
      console.error('Failed to publish video:', error);
      throw error;
    }
  }

  // Publish screen share
  async publishScreenShare() {
    if (!this.room || !this.isConnected) {
      throw new Error('Not connected to room');
    }
    
    try {
      const { createLocalScreenTracks } = await import('livekit-client');
      const screenTracks = await createLocalScreenTracks({
        video: {
          displaySurface: 'monitor',
          frameRate: { ideal: 30, max: 60 },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });
      
      for (const track of screenTracks) {
        await this.room.localParticipant.publishTrack(track);
      }
      
      this.localTracks.set('screen', screenTracks);
      console.log('Screen share published');
      return screenTracks;
    } catch (error) {
      console.error('Failed to publish screen share:', error);
      throw error;
    }
  }

  // Unpublish specific track type
  async unpublishTrack(trackType) {
    if (!this.room || !this.isConnected) return;
    
    try {
      const track = this.localTracks.get(trackType);
      if (track) {
        if (Array.isArray(track)) {
          // Screen tracks are arrays
          for (const t of track) {
            await this.room.localParticipant.unpublishTrack(t);
          }
        } else {
          await this.room.localParticipant.unpublishTrack(track);
        }
        this.localTracks.delete(trackType);
        console.log(`${trackType} track unpublished`);
      }
    } catch (error) {
      console.error(`Failed to unpublish ${trackType}:`, error);
    }
  }

  // Unpublish all tracks
  async unpublishAllTracks() {
    if (!this.room || !this.isConnected) return;
    
    try {
      await this.room.localParticipant.unpublishTracks();
      this.localTracks.clear();
      console.log('All tracks unpublished');
    } catch (error) {
      console.error('Failed to unpublish all tracks:', error);
    }
  }

  // Get participants
  getParticipants() {
    if (!this.room) return [];
    return Array.from(this.room.participants.values());
  }

  // Get local participant
  getLocalParticipant() {
    if (!this.room) return null;
    return this.room.localParticipant;
  }

  // Check if participant has specific track
  hasTrack(participant, kind, source) {
    if (!participant || !participant.trackPublications) return false;
    
    const publications = Array.from(participant.trackPublications.values());
    return publications.some(pub => 
      pub.track && 
      pub.track.kind === kind && 
      pub.source === source
    );
  }

  // Get track by kind and source
  getTrack(participant, kind, source) {
    if (!participant || !participant.trackPublications) return null;
    
    const publications = Array.from(participant.trackPublications.values());
    const publication = publications.find(pub => 
      pub.track && 
      pub.track.kind === kind && 
      pub.source === source
    );
    
    return publication ? publication.track : null;
  }

  // Event system
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(callback);
  }

  off(event, callback) {
    if (!this.eventListeners.has(event)) return;
    
    const listeners = this.eventListeners.get(event);
    const index = listeners.indexOf(callback);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  }

  emit(event, data) {
    if (!this.eventListeners.has(event)) return;
    
    const listeners = this.eventListeners.get(event);
    listeners.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in event listener for ${event}:`, error);
      }
    });
  }

  // Disconnect and cleanup
  async disconnect() {
    console.log('🔄 Disconnecting from LiveKit room...');
    
    if (this.room) {
      try {
        // Stop all local tracks first
        for (const [trackType, track] of this.localTracks) {
          try {
            if (Array.isArray(track)) {
              // Screen tracks are arrays
              for (const t of track) {
                await this.room.localParticipant.unpublishTrack(t);
                t.stop();
              }
            } else {
              await this.room.localParticipant.unpublishTrack(track);
              track.stop();
            }
          } catch (error) {
            console.warn(`Error stopping ${trackType} track:`, error);
          }
        }
        
        // Disconnect from room
        await this.room.disconnect();
        console.log('✅ LiveKit room disconnected');
      } catch (error) {
        console.error('Error disconnecting from room:', error);
      }
    }
    
    // Clean up state
    this.room = null;
    this.isConnected = false;
    this.localTracks.clear();
    this.eventListeners.clear();
    
    console.log('🧹 Cleanup completed');
  }
}

// Create singleton instance
const livekitService = new LiveKitService();
export default livekitService;
