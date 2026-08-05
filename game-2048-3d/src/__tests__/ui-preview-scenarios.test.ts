import { describe, expect, it } from 'vitest';
import { defaultUiPreviewScenario, extremeUiPreviewScenario } from '../ui-preview-scenarios.js';

function instance(markup: string) {
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = markup;
  return { host, signal: new AbortController().signal, dispose() {} };
}

describe('game-default preview scenarios', () => {
  it('prepares default and extreme scenarios from public UI parts', async () => {
    for (const scenario of [defaultUiPreviewScenario, extremeUiPreviewScenario]) {
      const result = await scenario.prepare({ instance: instance('<div data-ui-part="root"><span data-ui-part="score"></span><span data-ui-part="stress-meter"></span></div>'), signal: new AbortController().signal });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.ready).toBe(true);
    }
  });

  it('fails explicitly when a required part is absent', async () => {
    const result = await extremeUiPreviewScenario.prepare({ instance: instance('<div data-ui-part="root"></div>'), signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('preview-scenario-missing-part');
  });
});
