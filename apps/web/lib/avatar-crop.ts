export type AvatarPosition = { x: number; y: number; zoom: number };

export const CENTERED_AVATAR: AvatarPosition = { x: 0.5, y: 0.5, zoom: 1 };

export function avatarCrop(width: number, height: number, position: AvatarPosition) {
  const size = Math.min(width, height) / position.zoom;
  return {
    left: Math.min(width - size, Math.max(0, position.x * width - size / 2)),
    top: Math.min(height - size, Math.max(0, position.y * height - size / 2)),
    size,
  };
}

export function moveAvatar(width: number, height: number, position: AvatarPosition, x: number, y: number): AvatarPosition {
  const crop = avatarCrop(width, height, position);
  const next = avatarCrop(width, height, {
    zoom: position.zoom,
    x: (crop.left + crop.size / 2 - x) / width,
    y: (crop.top + crop.size / 2 - y) / height,
  });
  return { zoom: position.zoom, x: (next.left + crop.size / 2) / width, y: (next.top + crop.size / 2) / height };
}
