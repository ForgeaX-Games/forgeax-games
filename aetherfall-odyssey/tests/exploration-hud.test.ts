// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createExplorationControlsTimer,
  explorationLockedFeedback,
  installExplorationHud,
} from "../assets/plugins/exploration-hud";
import {
  createGameSettingsState,
  mountSettings,
  SETTINGS_UI_GUID,
} from "../assets/plugins/settings";

const asset = {
  guid: "exploration-hud-test",
  html: '<section data-ui-slot="root"><header class="identity"><strong data-ui-slot="title"></strong></header><section class="quest"><span class="eyebrow">CURRENT THREAD</span><strong data-ui-slot="objective"></strong><span data-ui-slot="progress"><span data-ui-slot="progress-fill"></span></span><span data-ui-slot="progress-label"></span></section><section class="compass" aria-label="Direction"><span data-ui-slot="heading"></span><i></i><span data-ui-slot="landmark"></span></section><aside class="interaction" data-ui-slot="interaction"><kbd>E</kbd><span data-ui-slot="interaction-copy"></span></aside><aside class="completion" data-ui-slot="completion"></aside><footer data-ui-slot="controls"></footer></section>',
  css: "",
};

describe("Aetherfall exploration HUD", () => {
  it("projects high-contrast setting changes through the settings owner", () => {
    const root = document.createElement("div");
    const fallback = document.createElement("button");
    document.body.append(root, fallback);
    let projected = false;
    const settings = mountSettings(
      {
        guid: SETTINGS_UI_GUID,
        html: '<section role="dialog" hidden><div role="document" tabindex="-1"><input data-ui-setting="high-contrast" type="checkbox"><button data-ui-action="close-settings">Done</button></div></section>',
        css: "",
      },
      root,
      createGameSettingsState(),
      fallback,
      undefined,
      (state) => {
        projected = state.highContrast;
      },
    );
    const input =
      settings.instance?.host.shadowRoot?.querySelector<HTMLInputElement>(
        '[data-ui-setting="high-contrast"]',
      );

    if (input) {
      input.checked = true;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    expect(settings.state.highContrast).toBe(true);
    expect(projected).toBe(true);

    settings.dispose();
    root.remove();
    fallback.remove();
  });

  it("shows locked interaction feedback only at the matching landmark", () => {
    expect(
      explorationLockedFeedback("beacon-locked", "last-light-beacon"),
    ).toBe("Last Light is sealed · restore 3 shrines");
    expect(explorationLockedFeedback("sanctuary-locked", "sanctuary")).toBe(
      "Sanctuary awaits the Last Light",
    );
    expect(explorationLockedFeedback("beacon-locked", "sanctuary")).toBeNull();
    expect(
      explorationLockedFeedback("out-of-range", "last-light-beacon"),
    ).toBeNull();
  });

  it("restores the full controls window when a run resets", () => {
    const timer = createExplorationControlsTimer();

    expect(timer.visible()).toBe(true);
    expect(timer.advance(8)).toBe(false);

    timer.reset();
    expect(timer.visible()).toBe(true);
    expect(timer.advance(7.99)).toBe(true);
    expect(timer.advance(0.01)).toBe(false);
  });

  it("projects equivalent keyboard and gamepad prompts from the public snapshot", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const hud = installExplorationHud({ asset, root });
    const shadow = root.querySelector<HTMLElement>(
      '[data-ui-asset="exploration-hud-test"]',
    )?.shadowRoot;
    const hudRoot = shadow?.querySelector<HTMLElement>('[data-ui-slot="root"]');
    const interactionKey = shadow?.querySelector<HTMLElement>(
      '[data-ui-slot="interaction"] kbd',
    );
    const controls = shadow?.querySelector<HTMLElement>(
      '[data-ui-slot="controls"]',
    );

    hud.setSnapshot({
      inputDevice: "gamepad",
      interaction: "Restore the Last Light",
      showControls: true,
    });
    expect(hudRoot?.dataset.inputDevice).toBe("gamepad");
    expect(interactionKey?.textContent).toBe("X");
    expect(controls?.textContent).toContain("Left stick move");
    expect(controls?.textContent).toContain("L3 sprint");
    expect(controls?.textContent).toContain("X attune");
    expect(controls?.textContent).toContain("B restart");
    expect(controls?.textContent).not.toContain("WASD");

    hud.setSnapshot({
      inputDevice: "keyboard",
      interaction: "Restore the Last Light",
      showControls: true,
    });
    expect(hudRoot?.dataset.inputDevice).toBe("keyboard");
    expect(interactionKey?.textContent).toBe("E");
    expect(controls?.textContent).toContain("WASD move");
    expect(controls?.textContent).toContain("E attune");
    expect(controls?.textContent).toContain("R restart");

    hud.dispose();
    root.remove();
  });


  it("projects exploration state into the supplied viewport root and disposes cleanly", () => {
    const root = document.createElement("div");
    document.body.append(root);
    let settingsOpens = 0;
    const hud = installExplorationHud({
      asset,
      root,
      onSettings: () => {
        settingsOpens += 1;
      },
    });
    const shadow = root.querySelector<HTMLElement>(
      '[data-ui-asset="exploration-hud-test"]',
    )?.shadowRoot;
    const settingsButton = shadow?.querySelector<HTMLButtonElement>(
      "[data-aetherfall-settings]",
    );

    expect(
      shadow
        ?.querySelector('[data-ui-slot="root"]')
        ?.getAttribute("data-density"),
    ).toBe("compact");
    expect(shadow?.querySelector(".identity")?.hasAttribute("hidden")).toBe(
      true,
    );
    expect(
      shadow?.querySelector('[data-ui-slot="heading"]')?.hasAttribute("hidden"),
    ).toBe(false);
    expect(
      shadow
        ?.querySelector('[data-ui-slot="controls"]')
        ?.hasAttribute("hidden"),
    ).toBe(false);
    expect(shadow?.querySelector(".compass")?.getAttribute("aria-label")).toBe(
      "Destination",
    );
    expect(settingsButton?.tagName).toBe("BUTTON");
    expect(settingsButton?.getAttribute("aria-label")).toBe(
      "Open game settings",
    );
    expect(settingsButton?.tabIndex).toBe(0);
    settingsButton?.click();
    expect(settingsOpens).toBe(1);
    expect(
      shadow
        ?.querySelector('[data-ui-slot="interaction"]')
        ?.hasAttribute("hidden"),
    ).toBe(true);
    const presentationCss = shadow?.querySelector(
      'style[data-aetherfall-hud-presentation="compact"]',
    )?.textContent;
    expect(presentationCss).toContain("border-radius: 9px");
    expect(presentationCss).toContain('[data-high-contrast="true"]');
    expect(presentationCss).toContain("font-size: clamp(10px");
    expect(presentationCss).not.toContain("font-size: 7px");

    hud.setHighContrast(true);
    const hudRoot = shadow?.querySelector<HTMLElement>('[data-ui-slot="root"]');
    expect(hudRoot?.dataset.highContrast).toBe("true");
    expect(hudRoot?.classList.contains("high-contrast")).toBe(true);

    hud.setSnapshot({
      title: "AETHERFALL",
      objective: "Restore the Last Light beacon",
      completed: 3,
      total: 3,
      heading: "NE",
      landmark: "Stormglass Spire",
      interaction: "Press E to restore the beacon",
      phase: "beacon-ready",
      controls: "WASD move · E restore",
      showControls: true,
    });

    expect(
      root.querySelector('[data-ui-asset="exploration-hud-test"]'),
    ).not.toBeNull();
    expect(
      shadow
        ?.querySelector('[data-ui-slot="progress"]')
        ?.getAttribute("aria-valuenow"),
    ).toBe("3");
    expect(
      shadow?.querySelector<HTMLElement>('[data-ui-slot="progress-fill"]')
        ?.style.width,
    ).toBe("100%");
    expect(
      shadow
        ?.querySelector('[data-ui-slot="interaction"]')
        ?.getAttribute("data-state"),
    ).toBe("beacon-ready");
    expect(
      shadow?.querySelector('[data-ui-slot="interaction"] kbd')?.textContent,
    ).toBe("E");
    expect(
      shadow?.querySelector('[data-ui-slot="interaction-copy"]')?.textContent,
    ).toBe("Press E to restore the beacon");
    expect(shadow?.querySelector('[data-ui-slot="heading"]')?.textContent).toBe(
      "NE",
    );
    expect(shadow?.textContent).toContain("Stormglass Spire");
    expect(
      shadow
        ?.querySelector('[data-ui-slot="controls"]')
        ?.hasAttribute("hidden"),
    ).toBe(false);

    hud.setSnapshot({ showControls: false });
    expect(
      shadow
        ?.querySelector('[data-ui-slot="controls"]')
        ?.hasAttribute("hidden"),
    ).toBe(true);
    expect(
      shadow?.querySelector<HTMLElement>('[data-ui-slot="controls"]')?.style
        .display,
    ).toBe("none");

    hud.setSnapshot({ interaction: "   " });
    expect(
      shadow
        ?.querySelector('[data-ui-slot="interaction"]')
        ?.hasAttribute("hidden"),
    ).toBe(true);
    expect(
      shadow?.querySelector('[data-ui-slot="interaction-copy"]')?.textContent,
    ).toBe("");

    hud.setSnapshot({
      phase: "complete",
      completed: 3,
      total: 3,
      interaction: null,
    });
    expect(
      shadow
        ?.querySelector('[data-ui-slot="root"]')
        ?.getAttribute("data-phase"),
    ).toBe("complete");
    expect(
      shadow
        ?.querySelector('[data-ui-slot="completion"]')
        ?.hasAttribute("hidden"),
    ).toBe(false);
    expect(
      shadow
        ?.querySelector('[data-ui-slot="interaction"]')
        ?.hasAttribute("hidden"),
    ).toBe(true);
    expect(
      shadow?.querySelector<HTMLElement>('[data-ui-slot="completion"]')?.style
        .display,
    ).toBe("");
    expect(
      shadow?.querySelector<HTMLElement>('[data-ui-slot="interaction"]')?.style
        .display,
    ).toBe("none");
    expect(
      shadow?.querySelector('[data-ui-slot="progress-label"]')?.textContent,
    ).toBe("LAST LIGHT RESTORED");
    expect(
      shadow?.querySelector('[data-ui-slot="objective"]')?.textContent,
    ).toBe("The Last Light is restored");

    hud.dispose();
    expect(root.childElementCount).toBe(0);
    settingsButton?.click();
    expect(settingsOpens).toBe(1);
    root.remove();
  });

  it("fails closed when a UiAsset was unavailable", () => {
    const root = document.createElement("div");
    const hud = installExplorationHud({ asset: null, root });
    expect(hud.error?.code).toBe("invalid-asset");
    expect(root.childElementCount).toBe(0);
  });

  it("announces recovery briefly and clears timers on reset or dispose", () => {
    vi.useFakeTimers();
    const root = document.createElement("div");
    document.body.append(root);
    const hud = installExplorationHud({ asset, root });
    const shadow = root.querySelector<HTMLElement>(
      '[data-ui-asset="exploration-hud-test"]',
    )?.shadowRoot;
    const notice = shadow?.querySelector<HTMLElement>(
      "[data-aetherfall-recovery-notice]",
    );

    expect(notice?.getAttribute("role")).toBe("status");
    expect(notice?.getAttribute("aria-live")).toBe("polite");
    expect(notice?.hidden).toBe(true);

    hud.setSnapshot({ recovered: true, recoveries: 1 });
    expect(notice?.hidden).toBe(false);
    expect(notice?.textContent).toBe("Returned to safe ground · Recovery 1");
    hud.setSnapshot({ recovered: false, recoveries: 1 });
    expect(notice?.hidden).toBe(false);
    vi.advanceTimersByTime(2599);
    expect(notice?.hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(notice?.hidden).toBe(true);

    hud.setSnapshot({ recovered: true, recoveries: 2 });
    expect(vi.getTimerCount()).toBe(1);
    hud.setSnapshot({ recovered: false, recoveries: 0 });
    expect(notice?.hidden).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    hud.setSnapshot({ recovered: true, recoveries: 1 });
    expect(vi.getTimerCount()).toBe(1);
    hud.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(root.childElementCount).toBe(0);
    root.remove();
    vi.useRealTimers();
  });

  it("keeps authored chrome viewport-local, responsive and motion-safe", async () => {
    const packPath = process.cwd().endsWith("aetherfall-odyssey")
      ? resolve(process.cwd(), "assets/ui/aetherfall-hud.pack.json")
      : resolve(
          process.cwd(),
          ".forgeax/games/aetherfall-odyssey/assets/ui/aetherfall-hud.pack.json",
        );
    const pack = JSON.parse(await readFile(packPath, "utf8")) as {
      assets: Array<{ payload: { html: string; css: string } }>;
    };
    const payload = pack.assets[0]?.payload;

    expect(payload?.html).toContain('data-ui-slot="interaction-copy"');
    expect(payload?.html).toContain('<kbd aria-hidden="true">E</kbd>');
    expect(payload?.css).toContain("position: absolute");
    expect(payload?.css).toContain("--safe-x:");
    expect(payload?.css).toContain("@media (max-width: 430px)");
    expect(payload?.css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(payload?.css).not.toContain("position: fixed");
    expect(payload?.css).not.toContain("document.body");
  });
});
