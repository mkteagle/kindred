// One tile in the mosaic.
//
// The image comes from the local cache; until it is there the tile is the
// placeholder colour, and a photo the cache has never seen carries a small dot
// so "on this machine" and "on the server" are visibly different states rather
// than both being a grey square.

import { memo, type KeyboardEvent, type MouseEvent } from "react";
import { useMedia } from "../lib/media";
import { formatClock } from "../lib/format";

export type TilePhoto = {
  photo_id: string;
  photo_title: string;
  media_kind: "photo" | "video";
  duration_seconds: number | null;
};

type Props = {
  photo: TilePhoto;
  selected: boolean;
  focused: boolean;
  /** False while the tile is only in the overscan buffer — no bytes are asked for. */
  visible: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  onDoubleClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
};

export const PhotoTile = memo(function PhotoTile({
  photo,
  selected,
  focused,
  visible,
  onClick,
  onDoubleClick,
  onKeyDown,
}: Props) {
  const media = useMedia(photo.photo_id, "thumb", visible);
  const duration = formatClock(photo.duration_seconds);

  return (
    <button
      type="button"
      className="k-tile"
      aria-selected={selected}
      aria-label={photo.photo_title || "Untitled photo"}
      data-photo-id={photo.photo_id}
      tabIndex={focused ? 0 : -1}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
    >
      {media.src ? (
        <img src={media.src} alt="" className="is-loaded" draggable={false} />
      ) : null}
      {photo.media_kind === "video" && duration ? (
        <span className="k-tile-badge">{duration}</span>
      ) : null}
      {!media.cached && !media.loading ? (
        <span
          className="k-tile-offline"
          title={media.error ? "Not kept offline — server unreachable" : "Not kept offline"}
        />
      ) : null}
    </button>
  );
});
