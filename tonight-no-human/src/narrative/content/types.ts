/** Interactive narrative (影游) content types — scripts live under content/scripts. */

export type NarrativeAssetKind = 'master' | 'privateStill' | 'dmPortrait' | 'sfx' | 'bgm';

/** Path relative to the game root, e.g. content/narrative/chapter_mx/media/foo.webp */
export type ContentPath = string;

export interface NarrativeAssetRef {
  kind: NarrativeAssetKind;
  /** Game-root-relative path under content/ */
  path: ContentPath;
  /** Optional label for editors / missing-asset logs */
  label?: string;
}

export interface NarrativeClueDef {
  clueId: string;
  /** Shown only to the assigned player via PrivacyChannel */
  body: string;
  /** Optional private still shown with the clue */
  stillPath?: ContentPath;
}

export interface NarrativeVoteDef {
  id: string;
  prompt: string;
  options: Array<{ id: string; label: string }>;
  /** Seconds after segment start when vote opens; 0 = immediately */
  openAtSec: number;
  durationSec: number;
}

export interface NarrativeBeat {
  id: string;
  /** Seconds from script start */
  atSec: number;
  kind: 'title' | 'line' | 'ruleIcon' | 'clueBeat' | 'vote' | 'hook';
  text?: string;
  voteId?: string;
}

export interface NarrativeScript {
  id: string;
  chapterId: string;
  title: string;
  /** Total master-track duration (Host clock) */
  durationSec: number;
  /** Where media files live (documentation + default resolve root) */
  mediaRoot: ContentPath;
  assets: {
    master?: NarrativeAssetRef;
    dmPortrait?: NarrativeAssetRef;
    privateStills?: NarrativeAssetRef[];
    sfx?: NarrativeAssetRef[];
  };
  beats: NarrativeBeat[];
  /** One unique clue per player; Host distributes by seat order */
  clues: NarrativeClueDef[];
  votes?: NarrativeVoteDef[];
  /** Next-country / story hook line (finale) */
  hookLine?: string;
}

export interface NarrativeCatalogStats {
  scriptCount: number;
  byChapter: Record<string, number>;
}
