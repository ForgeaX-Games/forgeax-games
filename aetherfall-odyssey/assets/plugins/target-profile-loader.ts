import type { LoadContext, Loader, LoaderOutput } from '@forgeax/engine-types';
import {
  GAME_DEFAULT_TARGET_PROFILE_KIND,
  isTargetProfile,
  type TargetProfile,
} from './target-profile-asset';

/** Runtime half of the host plugin; malformed payloads fail closed at the loader boundary. */
export function targetProfileLoader(): Loader<TargetProfile> {
  return {
    kind: GAME_DEFAULT_TARGET_PROFILE_KIND,
    load(payload: Record<string, unknown>, _refs: readonly string[] | undefined, _ctx: LoadContext): LoaderOutput<TargetProfile> {
      return isTargetProfile(payload) ? payload : undefined;
    },
  };
}
