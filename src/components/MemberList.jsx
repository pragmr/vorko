import React from 'react';
import Avatar from './Avatar';

const MemberList = ({
    onClose,
    onlineUsers,
    allUsers,
    onWave,
    onMessage,
    currentUser
}) => {
    // Filter out current user from all lists for display
    const otherAllUsers = allUsers.filter(u => u.id !== currentUser?.userId);
    const otherOnlineUsers = onlineUsers.filter(u => u.id !== currentUser?.id);

    // Group into Online and Offline
    const onlineUserIds = new Set(onlineUsers.map(u => String(u.userId)));

    const categorized = {
        online: otherOnlineUsers,
        offline: otherAllUsers.filter(u => !onlineUserIds.has(String(u.id)))
    };

    return (
        <div className="chat-panel member-list-panel">
            <div className="chat-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>Members</span>
                    <span style={{ fontSize: '12px', background: 'rgba(100, 255, 218, 0.1)', color: '#64ffda', padding: '2px 8px', borderRadius: '10px' }}>
                        {onlineUsers.length} online
                    </span>
                </div>
                <button className="panel-close" onClick={onClose} aria-label="Close member list">✕</button>
            </div>

            <div className="chat-messages" style={{ padding: '0' }}>
                <div className="member-section">
                    <div className="member-section-title">Online — {categorized.online.length}</div>
                    {categorized.online.length === 0 && <div className="member-empty">No other members online</div>}
                    {categorized.online.map(u => (
                        <div key={u.id} className="member-item">
                            <div className="member-info">
                                <div style={{ position: 'relative' }}>
                                    <Avatar name={u.name} avatar={u.avatar} size={36} />
                                    <div className="status-indicator online" />
                                </div>
                                <div className="member-details">
                                    <div className="member-name">{u.name}</div>
                                    <div className="member-room">{u.room || 'In office'}</div>
                                </div>
                            </div>
                            <div className="member-actions">
                                <button
                                    className="member-action-btn wave"
                                    title="Wave"
                                    onClick={() => onWave(u.id)}
                                >
                                    👋
                                </button>
                                <button
                                    className="member-action-btn message"
                                    title="Message"
                                    onClick={() => onMessage(u.userId)}
                                >
                                    💬
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="member-section">
                    <div className="member-section-title">Offline — {categorized.offline.length}</div>
                    {categorized.offline.length === 0 && <div className="member-empty">No members offline</div>}
                    {categorized.offline.map(u => (
                        <div key={u.id} className="member-item offline">
                            <div className="member-info">
                                <div style={{ position: 'relative' }}>
                                    <Avatar name={u.name} avatar={u.avatar} size={36} />
                                    <div className="status-indicator offline" />
                                </div>
                                <div className="member-details">
                                    <div className="member-name">{u.name}</div>
                                    <div className="member-status">Last seen recently</div>
                                </div>
                            </div>
                            <div className="member-actions">
                                <button
                                    className="member-action-btn message"
                                    title="Message"
                                    onClick={() => onMessage(u.id)}
                                >
                                    💬
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default MemberList;
