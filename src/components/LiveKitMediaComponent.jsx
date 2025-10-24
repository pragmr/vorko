import React, { useEffect } from 'react';
import { useLiveKitMedia } from '../hooks/useLiveKitMedia';

const LiveKitMediaComponent = ({ 
  currentRoom, 
  userPosition, 
  users, 
  socket,
  onMediaStateChange 
}) => {
  try {
    const {
      isConnected,
      isLoading,
      error,
      isMicOn,
      isCamOn,
      isScreenOn,
      participants,
      proximityParticipants,
      startAudio,
      stopAudio,
      startVideo,
      stopVideo,
      startScreenShare,
      stopScreenShare,
      joinProximityRoom,
      leaveProximityRoom,
      service
    } = useLiveKitMedia(currentRoom, userPosition, users);

  // Toggle microphone
  const toggleMic = async () => {
    try {
      console.log('🎤 ToggleMic called:', { isMicOn, isConnected, currentRoom });
      if (isMicOn) {
        console.log('🔇 Stopping audio...');
        await stopAudio();
        // Socket.IO emit removed - LiveKit handles all media now
      } else {
        console.log('🎤 Starting audio...');
        await startAudio();
        // Socket.IO emit removed - LiveKit handles all media now
      }
      
      onMediaStateChange?.({ mic: !isMicOn });
    } catch (error) {
      console.error('❌ Failed to toggle microphone:', error);
    }
  };

  // Toggle camera
  const toggleCam = async () => {
    try {
      if (isCamOn) {
        await stopVideo();
        // Socket.IO emit removed - LiveKit handles all media now
      } else {
        await startVideo();
        // Socket.IO emit removed - LiveKit handles all media now
      }
      
      onMediaStateChange?.({ cam: !isCamOn });
    } catch (error) {
      console.error('Failed to toggle camera:', error);
    }
  };

  // Toggle screen share
  const toggleScreenShare = async () => {
    try {
      if (isScreenOn) {
        await stopScreenShare();
        // Socket.IO emit removed - LiveKit handles all media now
      } else {
        await startScreenShare();
        // Socket.IO emit removed - LiveKit handles all media now
      }
      
      onMediaStateChange?.({ screen: !isScreenOn });
    } catch (error) {
      console.error('Failed to toggle screen share:', error);
    }
  };

  // Render audio elements for LiveKit participants
  const renderAudioElements = () => {
    return participants.map(participant => {
      const elementId = `audio-microphone-${participant.identity}`;
      return (
        <audio
          key={elementId}
          id={elementId}
          autoPlay
          playsInline
          muted={false}
          style={{ display: 'none' }}
        />
      );
    });
  };

  // Render video elements for LiveKit participants
  const renderVideoElements = () => {
    return participants.map(participant => {
      const elementId = `video-camera-${participant.identity}`;
      return (
        <video
          key={elementId}
          id={elementId}
          autoPlay
          playsInline
          muted={true}
          style={{ 
            width: '200px', 
            height: '150px',
            borderRadius: '8px',
            objectFit: 'cover'
          }}
        />
      );
    });
  };

  // Render screen share elements for LiveKit participants
  const renderScreenShareElements = () => {
    return participants
      .filter(participant => {
        try {
          return service.hasTrack(participant, 'video', 'screen_share');
        } catch (error) {
          console.warn('Error checking track for participant:', participant, error);
          return false;
        }
      })
      .map(participant => {
        const elementId = `video-screen_share-${participant.identity}`;
        return (
          <video
            key={elementId}
            id={elementId}
            autoPlay
            playsInline
            muted={true}
            style={{ 
              width: '100%', 
              height: 'auto',
              borderRadius: '8px',
              objectFit: 'contain'
            }}
          />
        );
      });
  };

  return (
    <div className="livekit-media-container">
      {/* Media Controls */}
      <div className="media-controls">
        <button 
          onClick={toggleMic}
          className={`media-btn ${isMicOn ? 'active' : ''}`}
          disabled={isLoading}
          title={isMicOn ? 'Mute Microphone' : 'Unmute Microphone'}
        >
          {isMicOn ? '🎤' : '🎤❌'}
        </button>
        
        <button 
          onClick={toggleCam}
          className={`media-btn ${isCamOn ? 'active' : ''}`}
          disabled={isLoading}
          title={isCamOn ? 'Turn Off Camera' : 'Turn On Camera'}
        >
          {isCamOn ? '📹' : '📹❌'}
        </button>
        
        <button 
          onClick={toggleScreenShare}
          className={`media-btn ${isScreenOn ? 'active' : ''}`}
          disabled={isLoading}
          title={isScreenOn ? 'Stop Screen Share' : 'Start Screen Share'}
        >
          {isScreenOn ? '🖥️' : '🖥️❌'}
        </button>
      </div>

      {/* Status Info */}
      <div className="proximity-info">
        <p>LiveKit Participants: {participants.length}</p>
        <p>Proximity Users: {proximityParticipants.length}</p>
        <p>LiveKit Room: {isConnected ? '✅ Connected' : '❌ Disconnected'}</p>
        {isLoading && <p>🔄 Connecting...</p>}
        {error && <p style={{ color: '#ff6b6b' }}>❌ Error: {error}</p>}
        
        {/* Auto-join Status */}
        <p style={{ fontSize: '12px', opacity: 0.8 }}>
          {proximityParticipants.length > 0 
            ? `👥 Auto-joined proximity room (${proximityParticipants.length} nearby)`
            : '👥 No nearby users - room will auto-join when users approach'
          }
        </p>
        
        {/* Debug Info */}
        <div style={{ fontSize: '10px', marginTop: '5px', opacity: 0.7 }}>
          <p>Room: {currentRoom}</p>
          <p>Position: {userPosition ? `${userPosition.x}, ${userPosition.y}` : 'None'}</p>
          <p>Service Connected: {service?.isConnected ? 'Yes' : 'No'}</p>
          <p>Mic State: {isMicOn ? '🎤 ON' : '🎤 OFF'}</p>
          <p>Cam State: {isCamOn ? '📹 ON' : '📹 OFF'}</p>
          <p>Screen State: {isScreenOn ? '🖥️ ON' : '🖥️ OFF'}</p>
          {participants.length > 0 && (
            <div>
              <p>LiveKit Participants:</p>
              {participants.map(p => (
                <p key={p.identity} style={{ marginLeft: '10px', fontSize: '9px' }}>
                  • {p.identity} (Audio: {service.hasTrack(p, 'audio', 'microphone') ? '✅' : '❌'})
                </p>
              ))}
            </div>
          )}
        </div>
        
        {/* Manual Connection Controls */}
        <div style={{ marginTop: '10px', padding: '10px', background: 'rgba(255,255,255,0.1)', borderRadius: '5px' }}>
          <p style={{ fontSize: '12px', margin: '0 0 5px 0' }}>Manual Controls:</p>
          <button 
            onClick={async () => {
              console.log('🔗 Manual connect to LiveKit room...');
              try {
                await joinProximityRoom('all');
                console.log('✅ Manual connection successful');
              } catch (err) {
                console.error('❌ Manual connection failed:', err);
              }
            }}
            disabled={isConnected || isLoading}
            style={{ 
              marginRight: '5px',
              padding: '5px 10px', 
              fontSize: '10px',
              background: isConnected ? '#666' : '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              cursor: isConnected ? 'not-allowed' : 'pointer'
            }}
          >
            {isConnected ? '✅ Connected' : '🔗 Connect'}
          </button>
          
          <button 
            onClick={async () => {
              console.log('🔌 Manual disconnect from LiveKit room...');
              try {
                await leaveProximityRoom();
                console.log('✅ Manual disconnect successful');
              } catch (err) {
                console.error('❌ Manual disconnect failed:', err);
              }
            }}
            disabled={!isConnected}
            style={{ 
              padding: '5px 10px', 
              fontSize: '10px',
              background: !isConnected ? '#666' : '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              cursor: !isConnected ? 'not-allowed' : 'pointer'
            }}
          >
            {!isConnected ? '❌ Disconnected' : '🔌 Disconnect'}
          </button>
        </div>
      </div>

      {/* Audio Elements (hidden) */}
      {renderAudioElements()}

      {/* Video Elements */}
      <div className="proximity-videos">
        {renderVideoElements()}
      </div>

      {/* Screen Share Elements */}
      <div className="proximity-screens">
        {renderScreenShareElements()}
      </div>

      {/* CSS Styles */}
      <style>{`
        .livekit-media-container {
          position: fixed;
          bottom: 20px;
          right: 20px;
          background: rgba(0, 0, 0, 0.8);
          padding: 15px;
          border-radius: 10px;
          color: white;
          z-index: 1000;
          font-family: Arial, sans-serif;
        }

        .media-controls {
          display: flex;
          gap: 10px;
          margin-bottom: 10px;
        }

        .media-btn {
          background: #333;
          border: none;
          padding: 10px;
          border-radius: 5px;
          cursor: pointer;
          font-size: 16px;
          transition: background 0.3s;
        }

        .media-btn:hover:not(:disabled) {
          background: #555;
        }

        .media-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .media-btn.active {
          background: #4CAF50;
        }

        .proximity-info {
          font-size: 12px;
          margin-bottom: 10px;
        }

        .proximity-info p {
          margin: 2px 0;
        }

        .proximity-videos {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 10px;
        }

        .proximity-screens {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
      `}</style>
    </div>
  );
  } catch (error) {
    console.error('LiveKitMediaComponent error:', error);
    return (
      <div style={{ 
        position: 'fixed', 
        bottom: '20px', 
        right: '20px', 
        background: 'rgba(255, 0, 0, 0.8)', 
        color: 'white', 
        padding: '10px', 
        borderRadius: '5px',
        fontSize: '12px'
      }}>
        ❌ LiveKit Error: {error.message}
      </div>
    );
  }
};

export default LiveKitMediaComponent;
