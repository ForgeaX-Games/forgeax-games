import {
  createDomPartScenario,
  type UiPreviewScenario,
} from '@forgeax/engine-ui/preview';

/** Lightweight default scenario kept in the game source, never in UiAsset data. */
export const defaultUiPreviewScenario: UiPreviewScenario = createDomPartScenario({
  requiredParts: ['root', 'score'],
});

/** Stress scenario exercises an additional status part without changing the asset schema. */
export const extremeUiPreviewScenario: UiPreviewScenario = createDomPartScenario({
  requiredParts: ['root', 'score', 'stress-meter'],
});
