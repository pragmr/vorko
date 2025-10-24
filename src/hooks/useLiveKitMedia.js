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

  // Calculate proximity participants (2-tile radius for closer interaction)
  const proximityParticipants = useMemo(() => {
    if (!userPosition || !users) return [];

    const RADIUS = 2; // Reduced from 3 to 2 tiles for closer interaction
    const nearbyUsers = users.filter(user => {
      if (!user.position) return false; // Skip users without position
      
      const dx = userPosition.x - user.position.x;
      const dy = userPosition.y - user.position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      const isNearby = distance <= RADIUS && user.room === currentRoom;
      
      if (isNearby) {
        console.log(`👤 User ${user.name || user.id} is nearby:`, {
          distance: distance.toFixed(2),
          radius: RADIUS,
          userPos: `${user.position.x}, ${user.position.y}`,
          myPos: `${userPosition.x}, ${userPosition.y}`
        });
      }
      
      return isNearby;
    });
    
    console.log(`🔍 Proximity calculation: ${nearbyUsers.length} users within ${RADIUS} tiles`);
    return nearbyUsers;
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
      console.log('🚪 Leaving proximity room...');
      
      // Store current media states before disconnecting
      const wasMicOn = isMicOn;
      const wasCamOn = isCamOn;
      const wasScreenOn = isScreenOn;
      
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
      
      console.log('✅ Successfully left proximity room', { wasMicOn, wasCamOn, wasScreenOn });
      
      // Return the previous states for potential reconnection
      return { wasMicOn, wasCamOn, wasScreenOn };
    } catch (err) {
      console.error('❌ Failed to leave proximity room:', err);
      setError(err.message);
      return { wasMicOn: false, wasCamOn: false, wasScreenOn: false };
    }
  }, [isMicOn, isCamOn, isScreenOn]);

  // Helper function to restore audio state after reconnection
  const restoreAudioState = useCallback(async (delay = 1000) => {
    try {
      console.log('🔄 Attempting to restore audio state...');
      await new Promise(resolve => setTimeout(resolve, delay));
      
      if (livekitService.isConnected && !isMicOn) {
        await livekitService.publishAudio();
        setIsMicOn(true);
        console.log('✅ Audio state restored successfully');
      }
    } catch (err) {
      console.error('❌ Failed to restore audio state:', err);
    }
  }, [isMicOn]);

  // Auto-join proximity room when users are nearby
  useEffect(() => {
    const hasNearbyUsers = proximityParticipants.length > 0;
    
    console.log('🔍 Proximity check:', { 
      hasNearbyUsers, 
      nearbyCount: proximityParticipants.length,
      isConnected, 
      isLoading,
      userPosition: userPosition ? `${userPosition.x}, ${userPosition.y}` : 'none',
      currentRoom
    });
    
    if (hasNearbyUsers && !isConnected && !isLoading) {
      console.log('👥 Nearby users detected, auto-joining proximity room:', proximityParticipants.length);
      joinProximityRoom('audio').catch(err => {
        console.error('Failed to auto-join proximity room:', err);
        setError(`Auto-join failed: ${err.message}`);
      });
    } else if (hasNearbyUsers && isConnected && !isLoading) {
      // Check if we need to reconnect due to room change
      const currentRoomName = livekitService.room?.name;
      const expectedRoomName = `${currentRoom}__proximity__audio`;
      
      if (currentRoomName !== expectedRoomName) {
        console.log('🔄 Room name mismatch detected, reconnecting:', { 
          currentRoomName, 
          expectedRoomName,
          currentRoom,
          userPosition: userPosition ? `${userPosition.x}, ${userPosition.y}` : 'none'
        });
        
        // Disconnect and reconnect to the correct room
        leaveProximityRoom().then((previousStates) => {
          setTimeout(async () => {
            try {
              await joinProximityRoom('audio');
              
              // Restore previous audio state if it was on
              if (previousStates.wasMicOn) {
                console.log('🔄 Restoring audio state after room reconnection...');
                await restoreAudioState(1000);
              }
            } catch (err) {
              console.error('Failed to rejoin proximity room:', err);
              setError(`Rejoin failed: ${err.message}`);
            }
          }, 500); // Small delay to ensure clean disconnection
        }).catch(err => {
          console.error('Failed to leave room for rejoin:', err);
        });
      }
    } else if (!hasNearbyUsers && isConnected) {
      // Reduce delay for faster disconnection when moving away
      console.log('👥 No nearby users, scheduling disconnect in 1 second...');
      const disconnectTimer = setTimeout(() => {
        // Double-check that there are still no nearby users
        if (proximityParticipants.length === 0 && isConnected) {
          console.log('👥 Confirmed no nearby users, leaving proximity room');
          leaveProximityRoom().catch(err => {
            console.error('Failed to leave proximity room:', err);
            setError(`Auto-leave failed: ${err.message}`);
          });
        }
      }, 1000); // Reduced from 3000ms to 1000ms
      
      return () => clearTimeout(disconnectTimer);
    }
  }, [proximityParticipants.length, isConnected, isLoading, currentRoom, joinProximityRoom, leaveProximityRoom]);

  // Handle position changes - ensure we're in the right room
  useEffect(() => {
    if (!userPosition || !isConnected || isLoading) return;
    
    console.log('📍 Position changed, checking room connection:', {
      position: `${userPosition.x}, ${userPosition.y}`,
      currentRoom,
      roomName: livekitService.room?.name,
      proximityCount: proximityParticipants.length,
      isConnected
    });
    
    // If we have nearby users but are in wrong room, reconnect
    if (proximityParticipants.length > 0) {
      const currentRoomName = livekitService.room?.name;
      const expectedRoomName = `${currentRoom}__proximity__audio`;
      
      if (currentRoomName !== expectedRoomName) {
        console.log('🔄 Position change detected room mismatch, reconnecting...', {
          currentRoomName,
          expectedRoomName,
          position: `${userPosition.x}, ${userPosition.y}`,
          proximityCount: proximityParticipants.length
        });
        
        leaveProximityRoom().then((previousStates) => {
          setTimeout(async () => {
            try {
              await joinProximityRoom('audio');
              
              // Restore previous audio state if it was on
              if (previousStates.wasMicOn) {
                console.log('🔄 Restoring audio state after position change reconnection...');
                await restoreAudioState(1000);
              }
            } catch (err) {
              console.error('Failed to reconnect after position change:', err);
              setError(`Position reconnection failed: ${err.message}`);
            }
          }, 500);
        }).catch(err => {
          console.error('Failed to leave room after position change:', err);
        });
      }
    }
  }, [userPosition?.x, userPosition?.y, currentRoom, isConnected, isLoading, proximityParticipants.length, joinProximityRoom, leaveProximityRoom]);

  // Start audio
  const startAudio = useCallback(async () => {
    try {
      console.log('🎤 Starting audio...', { 
        isConnected, 
        currentRoom, 
        proximityParticipants: proximityParticipants.length,
        userPosition: userPosition ? `${userPosition.x}, ${userPosition.y}` : 'none'
      });
      
      // If not connected, wait for auto-join or force connection
      if (!isConnected) {
        console.log('🔗 Not connected yet, waiting for auto-join...');
        
        // If there are nearby users, wait for auto-join
        if (proximityParticipants.length > 0) {
          console.log('👥 Waiting for auto-join to nearby users...');
          // Wait up to 5 seconds for auto-join
          let attempts = 0;
          while (!livekitService.isConnected && attempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
          }
        } else {
          // No nearby users, force connection for testing
          console.log('🔗 No nearby users, forcing connection...');
          await joinProximityRoom('audio');
        }
        
        if (!livekitService.isConnected) {
          throw new Error('Failed to establish LiveKit connection');
        }
      }
      
      // Check if we're in the right room for the current context
      const currentRoomName = livekitService.room?.name;
      const expectedRoomName = `${currentRoom}__proximity__audio`;
      
      if (currentRoomName !== expectedRoomName) {
        console.log('🔄 Room mismatch detected in startAudio, reconnecting...', { 
          currentRoomName, 
          expectedRoomName,
          currentRoom,
          userPosition: userPosition ? `${userPosition.x}, ${userPosition.y}` : 'none'
        });
        
        await leaveProximityRoom();
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait for clean disconnection
        await joinProximityRoom('audio');
        
        // Wait a bit for the room to be fully connected before publishing audio
        await new Promise(resolve => setTimeout(resolve, 1000));
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
  }, [isConnected, proximityParticipants.length, currentRoom, joinProximityRoom]);

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
      console.log('📡 Track subscribed:', { 
        kind: track.kind, 
        source: track.source, 
        participant: participant.identity,
        trackId: track.sid 
      });
      
      const elementId = `${track.kind}-${track.source}-${participant.identity}`;
      let element = document.getElementById(elementId);
      
      // If element doesn't exist, create it
      if (!element) {
        console.log('🔧 Creating missing element:', elementId);
        if (track.kind === 'audio') {
          element = document.createElement('audio');
          element.id = elementId;
          element.autoplay = true;
          element.playsInline = true;
          element.muted = false; // IMPORTANT: Must be unmuted to hear audio
          element.style.display = 'none';
          document.body.appendChild(element);
        } else if (track.kind === 'video') {
          element = document.createElement('video');
          element.id = elementId;
          element.autoplay = true;
          element.playsInline = true;
          element.muted = true;
          element.style.width = '200px';
          element.style.height = '150px';
          element.style.borderRadius = '8px';
          element.style.objectFit = 'cover';
          document.body.appendChild(element);
        }
      }
      
      if (element) {
        track.attach(element);
        console.log('✅ Track attached to element:', elementId);
        
        // Ensure audio elements are properly configured
        if (track.kind === 'audio') {
          element.muted = false;
          element.volume = 1.0;
          console.log('🔊 Audio element configured:', { muted: element.muted, volume: element.volume });
          audioElementsRef.current.set(participant.identity, element);
        } else if (track.kind === 'video') {
          videoElementsRef.current.set(participant.identity, element);
        }
      } else {
        console.warn('⚠️ Could not create element for track:', elementId);
      }
    };

    const handleTrackUnsubscribed = ({ track, publication, participant }) => {
      console.log('📡 Track unsubscribed:', { 
        kind: track.kind, 
        source: track.source, 
        participant: participant.identity 
      });
      
      const elementId = `${track.kind}-${track.source}-${participant.identity}`;
      const element = document.getElementById(elementId);
      
      if (element) {
        track.detach(element);
        console.log('✅ Track detached from element:', elementId);
        
        // Remove element from DOM
        try {
          element.remove();
        } catch (error) {
          console.warn('Error removing element:', error);
        }
        
        if (track.kind === 'audio') {
          audioElementsRef.current.delete(participant.identity);
        } else if (track.kind === 'video') {
          videoElementsRef.current.delete(participant.identity);
        }
      }
    };

    const handleParticipantConnected = (participant) => {
      console.log('👤 Participant connected:', participant.identity);
      if (participant && participant.identity) {
        setParticipants(prev => [...prev.filter(p => p.identity !== participant.identity), participant]);
      }
    };

    const handleParticipantDisconnected = (participant) => {
      console.log('👤 Participant disconnected:', participant.identity);
      if (participant && participant.identity) {
        setParticipants(prev => prev.filter(p => p.identity !== participant.identity));
        
        // Clean up track elements for disconnected participant
        audioElementsRef.current.delete(participant.identity);
        videoElementsRef.current.delete(participant.identity);
        screenElementsRef.current.delete(participant.identity);
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
      
      // Clear all track elements
      audioElementsRef.current.clear();
      videoElementsRef.current.clear();
      screenElementsRef.current.clear();
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
