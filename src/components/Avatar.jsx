import React from 'react';
import { isAvatarImage, getInitials, getAvatarColorFromName } from '../utils/avatar';

/**
 * Profile photo or two-letter initials (Google-style). No emojis.
 * avatar: optional image URL; when missing, shows initials from name.
 */
export default function Avatar({ name, avatar, size = 40, className = '', style = {} }) {
  const sz = typeof size === 'number' ? size : 40;
  const isImage = isAvatarImage(avatar);
  const initials = getInitials(name || '?');
  const bgColor = getAvatarColorFromName(name || '');

  const baseStyle = {
    width: sz,
    height: sz,
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
    ...style
  };

  if (isImage) {
    return (
      <img
        src={avatar}
        alt=""
        className={className}
        style={{ ...baseStyle, objectFit: 'cover' }}
      />
    );
  }

  return (
    <div
      className={className}
      style={{
        ...baseStyle,
        backgroundColor: bgColor,
        color: '#fff',
        fontSize: Math.max(10, Math.floor(sz * 0.45)),
        fontWeight: 700
      }}
      aria-hidden
    >
      {initials}
    </div>
  );
}
