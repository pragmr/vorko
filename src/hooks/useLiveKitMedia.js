import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import livekitService from '../services/livekitService';

export const useLiveKitMedia = (currentRoom, userPosition, users) => {
  const [isConnected, setIsConnected] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  
  // Media state
  const [isMicOn, setIsMicOn] = useState(false);
  const [isCamOn, setIsCamOn] = useState(false);
  const [isScreenOn, setIsScreenOn] = useState(false);
  
  // Track elements for rendering
  const audioElementsRef = useRef(new Map());
  const videoElementsRef = useRef(new Map());
  const screenElementsRef = useRef(new Map());

  // Calculate proximity participants (3-tile radius)
  const proximityParticipants = useMemo(() => {
    if (!userPosition || !users) return [];

    const RADIUS = 3; // tiles
    return users.filter(user => {
      if (!user.position) return false;
      
      const dx = userPosition.x - user.position.x;
      const dy = userPosition.y - user.position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      return distance <= RADIUS && user.room === currentRoom;
    });
  }, [userPosition, users, currentRoom]);

  // Join proximity room
  const joinProximityRoom = useCallback(async (mediaType = 'all') => {
    // Prevent multiple simultaneous connections
    if (isLoading) {
      console.log('⚠️ Already connecting, skipping...');
      return;
    }
    
    try {
      console.log('🚀 Starting joinProximityRoom:', { mediaType, currentRoom, userPosition });
      setIsLoading(true);
      setError(null);
      
      const roomName = `${currentRoom}__proximity__${mediaType}`;
      const identity = `user-${Date.now()}`;
      const name = 'User';
      
      console.log('📝 Room details:', { roomName, identity, name });
      
      await livekitService.initializeRoom(currentRoom, mediaType, identity, name);
      
      console.log('🔍 Service connection state after init:', livekitService.isConnected);
      setIsConnected(true);
      console.log('✅ Hook connection state set to true');
    } catch (err) {
      console.error('❌ joinProximityRoom failed:', err);
      setError(err.message);
      setIsConnected(false);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [currentRoom, isLoading]);

  // Leave proximity room
  const leaveProximityRoom = useCallback(async () => {
    try {
      await livekitService.disconnect();
      setIsConnected(false);
      setParticipants([]);
      setIsMicOn(false);
      setIsCamOn(false);
      setIsScreenOn(false);
      
      // Clear all track elements
      audioElementsRef.current.clear();
      videoElementsRef.current.clear();
      screenElementsRef.current.clear();
    } catch (err) {
      setError(err.message);
    }
  }, []);

  // Auto-join proximity room when users are nearby
  useEffect(() => {
    const hasNearbyUsers = proximityParticipants.length > 0;
    
    if (hasNearbyUsers && !isConnected && !isLoading) {
      console.log('👥 Nearby users detected, auto-joining proximity room:', proximityParticipants.length);
      joinProximityRoom('all').catch(err => {
        console.error('Failed to auto-join proximity room:', err);
        setError(`Auto-join failed: ${err.message}`);
      });
    } else if (!hasNearbyUsers && isConnected) {
      console.log('👥 No nearby users, leaving proximity room');
      leaveProximityRoom().catch(err => {
        console.error('Failed to leave proximity room:', err);
        setError(`Auto-leave failed: ${err.message}`);
      });
    }
  }, [proximityParticipants.length, isConnected, isLoading, joinProximityRoom, leaveProximityRoom]);

  // Start audio
  const startAudio = useCallback(async () => {
    try {
      console.log('🎤 Starting audio...', { isConnected, currentRoom, proximityParticipants: proximityParticipants.length });
      
      // If not connected, the auto-join effect will handle it
      if (!isConnected) {
        console.log('🔗 Not connected yet, waiting for auto-join...');
        // Wait a bit for auto-join to complete
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (!livekitService.isConnected) {
          throw new Error('Failed to establish LiveKit connection automatically');
        }
      }
      
      console.log('📡 Publishing audio track...');
      await livekitService.publishAudio();
      setIsMicOn(true);
      console.log('✅ Audio started successfully');
    } catch (err) {
      console.error('❌ Failed to start audio:', err);
      setError(err.message);
      setIsMicOn(false);
      throw err;
    }
  }, [isConnected, proximityParticipants.length]);

  // Stop audio
  const stopAudio = useCallback(async () => {
    try {
      await livekitService.unpublishTrack('audio');
      setIsMicOn(false);
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, []);

  // Start video
  const startVideo = useCallback(async () => {
    try {
      console.log('📹 Starting video...', { isConnected, proximityParticipants: proximityParticipants.length });
      
      if (!isConnected) {
        console.log('🔗 Not connected yet, waiting for auto-join...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (!livekitService.isConnected) {
          throw new Error('Failed to establish LiveKit connection automatically');
        }
      }
      
      await livekitService.publishVideo();
      setIsCamOn(true);
      console.log('✅ Video started successfully');
    } catch (err) {
      console.error('❌ Failed to start video:', err);
      setError(err.message);
      setIsCamOn(false);
      throw err;
    }
  }, [isConnected, proximityParticipants.length]);

  // Stop video
  const stopVideo = useCallback(async () => {
    try {
      await livekitService.unpublishTrack('video');
      setIsCamOn(false);
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, []);

  // Start screen share
  const startScreenShare = useCallback(async () => {
    try {
      console.log('🖥️ Starting screen share...', { isConnected, proximityParticipants: proximityParticipants.length });
      
      if (!isConnected) {
        console.log('🔗 Not connected yet, waiting for auto-join...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (!livekitService.isConnected) {
          throw new Error('Failed to establish LiveKit connection automatically');
        }
      }
      
      await livekitService.publishScreenShare();
      setIsScreenOn(true);
      console.log('✅ Screen share started successfully');
    } catch (err) {
      console.error('❌ Failed to start screen share:', err);
      setError(err.message);
      setIsScreenOn(false);
      throw err;
    }
  }, [isConnected, proximityParticipants.length]);

  // Stop screen share
  const stopScreenShare = useCallback(async () => {
    try {
      await livekitService.unpublishTrack('screen');
      setIsScreenOn(false);
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, []);

  // Handle track subscription for rendering
  useEffect(() => {
    const handleTrackSubscribed = ({ track, publication, participant }) => {
      const elementId = `${track.kind}-${track.source}-${participant.identity}`;
      const element = document.getElementById(elementId);
      
      if (element && track.kind === 'audio') {
        track.attach(element);
        audioElementsRef.current.set(participant.identity, element);
      } else if (element && track.kind === 'video') {
        track.attach(element);
        videoElementsRef.current.set(participant.identity, element);
      }
    };

    const handleTrackUnsubscribed = ({ track, publication, participant }) => {
      const elementId = `${track.kind}-${track.source}-${participant.identity}`;
      const element = document.getElementById(elementId);
      
      if (element) {
        track.detach(element);
        if (track.kind === 'audio') {
          audioElementsRef.current.delete(participant.identity);
        } else if (track.kind === 'video') {
          videoElementsRef.current.delete(participant.identity);
        }
      }
    };

    const handleParticipantConnected = (participant) => {
      if (participant && participant.identity) {
        setParticipants(prev => [...prev.filter(p => p.identity !== participant.identity), participant]);
      }
    };

    const handleParticipantDisconnected = (participant) => {
      if (participant && participant.identity) {
        setParticipants(prev => prev.filter(p => p.identity !== participant.identity));
      }
    };

    const handleConnected = () => {
      console.log('🎉 Hook: Connected event received');
      setIsConnected(true);
    };

    const handleDisconnected = () => {
      console.log('💔 Hook: Disconnected event received');
      setIsConnected(false);
      setParticipants([]);
    };

    // Add event listeners
    livekitService.on('trackSubscribed', handleTrackSubscribed);
    livekitService.on('trackUnsubscribed', handleTrackUnsubscribed);
    livekitService.on('participantConnected', handleParticipantConnected);
    livekitService.on('participantDisconnected', handleParticipantDisconnected);
    livekitService.on('connected', handleConnected);
    livekitService.on('disconnected', handleDisconnected);

    // Cleanup
    return () => {
      livekitService.off('trackSubscribed', handleTrackSubscribed);
      livekitService.off('trackUnsubscribed', handleTrackUnsubscribed);
      livekitService.off('participantConnected', handleParticipantConnected);
      livekitService.off('participantDisconnected', handleParticipantDisconnected);
      livekitService.off('connected', handleConnected);
      livekitService.off('disconnected', handleDisconnected);
    };
  }, []);

  // No cleanup on unmount - let LiveKit service manage its own lifecycle
  // useEffect(() => {
  //   return () => {
  //     console.log('🧹 Hook cleanup: disconnecting from LiveKit');
  //     livekitService.disconnect();
  //   };
  // }, []); // This was causing immediate disconnection

  return {
    // Connection state
    isConnected,
    isLoading,
    error,
    
    // Media state
    isMicOn,
    isCamOn,
    isScreenOn,
    
    // Participants
    participants,
    proximityParticipants,
    
    // Controls
    startAudio,
    stopAudio,
    startVideo,
    stopVideo,
    startScreenShare,
    stopScreenShare,
    joinProximityRoom,
    leaveProximityRoom,
    
    // Service access
    service: livekitService
  };
};
