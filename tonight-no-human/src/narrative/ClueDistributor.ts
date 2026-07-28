import type { PlayerId } from '../shared/types';
import { PrivacyChannel } from '../net/privacy/PrivacyChannel';

/** Assign one private clue per player; deliver via PrivacyChannel only. */
export class ClueDistributor {
  constructor(private privacy: PrivacyChannel) {}

  distributeDemoOpening(playerIds: PlayerId[]): void {
    const bodies = [
      '你看见供坛缺了一支金盏花——别告诉别人位置。',
      '糖颅左眼眶有道裂痕，像爪痕。',
      '剪纸廊桥第三扇窗后面有缝隙。',
      '清扫爪今晚会提早巡游一圈。',
    ];
    const clues = bodies.map((body, i) => ({ clueId: `clue_open_${i}`, body }));
    this.privacy.distributeUnique(clues, playerIds);
  }
}
