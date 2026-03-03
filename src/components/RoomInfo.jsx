import React from 'react';
import { officeLayout } from '../data/officeData';

const RoomInfo = ({ currentRoom, userCount, isConnected, onToggleMemberList }) => {
  const currentRoomData = officeLayout[currentRoom];

  return (
    <div className="room-info">
      <div className="ri-header">
        <div className="ri-title">
          <span className="ri-room-icon" aria-hidden>🏢</span>
          <span className="ri-room-name">{currentRoomData?.name || 'Unknown Room'}</span>
        </div>
        <span className={`ri-status ${isConnected ? 'ok' : 'down'}`}>
          {isConnected ? 'Connected' : 'Disconnected'}
        </span>
      </div>
      <div className="ri-body">
        <div
          className="ri-item clickable"
          title="View all members"
          onClick={onToggleMemberList}
          style={{ cursor: 'pointer' }}
        >
          <span className="ri-item-icon" aria-hidden>👥</span>
          <span className="ri-item-text">{userCount} online</span>
        </div>
        <div className="ri-divider" />
        <div className="ri-item" title="Room id">
          <span className="ri-item-icon" aria-hidden>🗂️</span>
          <span className="ri-item-text">{currentRoom}</span>
        </div>
      </div>
    </div>
  );
};

export default RoomInfo;
