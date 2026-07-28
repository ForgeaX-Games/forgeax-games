/**
 * Resolve content/ paths for narrative & minigame media.
 * Studio preview serves the game via Vite; relative URLs from the game module
 * work when prefixed with the game file base. Prefer absolute-from-origin
 * `/api/files/raw?path=.forgeax/games/<slug>/...` when available.
 */

const GAME_SLUG = 'tonight-no-human';
const GAME_ROOT_REL = `.forgeax/games/${GAME_SLUG}`;

/** Turn a game-root-relative content path into a fetchable URL. */
export function resolveContentUrl(contentPath: string): string {
  const clean = contentPath.replace(/^\/+/, '');
  // Studio files API (works in Play iframe on localhost Studio).
  return `/api/files/raw?path=${encodeURIComponent(`${GAME_ROOT_REL}/${clean}`)}`;
}

/** Convenience: narrative media under content/narrative/... */
export function narrativeMediaUrl(relUnderMediaOrFull: string): string {
  if (relUnderMediaOrFull.startsWith('content/')) {
    return resolveContentUrl(relUnderMediaOrFull);
  }
  return resolveContentUrl(`content/narrative/${relUnderMediaOrFull}`);
}

/** Minigame library asset root: content/minigames/<id>/... */
export function minigameContentRoot(minigameId: string): string {
  return `content/minigames/${minigameId}`;
}

export function minigameContentUrl(minigameId: string, rel: string): string {
  return resolveContentUrl(`${minigameContentRoot(minigameId)}/${rel.replace(/^\/+/, '')}`);
}

export async function contentExists(contentPath: string): Promise<boolean> {
  try {
    const r = await fetch(resolveContentUrl(contentPath), { method: 'HEAD' });
    return r.ok;
  } catch {
    return false;
  }
}
