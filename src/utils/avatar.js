/**
 * Get two-letter initials from name, Google-style.
 * "John Doe" -> "JD", "John" -> "JO", "A" -> "A"
 */
export function getInitials(name) {
  if (!name || typeof name !== 'string') return '?';
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
  }
  return trimmed.slice(0, 2).toUpperCase();
}

/**
 * Whether avatar value is an image URL (http, https, /, or data:).
 */
export function isAvatarImage(avatar) {
  if (!avatar || typeof avatar !== 'string') return false;
  const s = avatar.trim();
  return s.startsWith('http://') || s.startsWith('https://') || s.startsWith('/') || s.startsWith('data:');
}

/**
 * Stable color from name for initials circle (hash-based).
 */
const PALETTE = ['#4A90E2', '#E91E63', '#8BC34A', '#FF9800', '#9C27B0', '#607D8B', '#00BCD4', '#64FFDA'];
export function getAvatarColorFromName(name) {
  if (!name || typeof name !== 'string') return PALETTE[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h) + name.charCodeAt(i) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}
