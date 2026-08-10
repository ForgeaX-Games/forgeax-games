import {
  IMPORT_ERROR_HINTS,
  ImportError,
  type ImportContext,
  type ImportedAsset,
  type Importer,
  type ImportResult,
} from '@forgeax/engine-types';
import {
  GAME_DEFAULT_TARGET_PROFILE_IMPORTER_KEY,
  GAME_DEFAULT_TARGET_PROFILE_KIND,
  type TargetProfile,
} from './target-profile-asset';

/** Build-time host plugin: parse the game-owned target profile and preserve its sidecar GUID. */
export function targetProfileImporter(): Importer {
  return {
    key: GAME_DEFAULT_TARGET_PROFILE_IMPORTER_KEY,
    async import(ctx: ImportContext): Promise<ImportResult> {
      const subAsset = ctx.subAssets[0];
      if (subAsset === undefined) {
        return { ok: true, value: { assets: [], sourceDependencies: [] } };
      }
      const read = await ctx.readSource();
      if (!read.ok) {
        return {
          ok: false,
          error: new ImportError({
            code: 'source-read-failed',
            expected: `readable target profile source "${ctx.source}"`,
            hint: IMPORT_ERROR_HINTS['source-read-failed'],
            detail: {
              source: ctx.source,
              reason: read.error instanceof Error ? read.error.message : String(read.error),
            },
          }),
        };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(read.value));
      } catch (error) {
        return {
          ok: false,
          error: new ImportError({
            code: 'source-validation-failed',
            expected: 'valid target-profile JSON',
            hint: IMPORT_ERROR_HINTS['source-validation-failed'],
            detail: {
              diagnostics: [{
                code: 'target-profile-json-invalid',
                severity: 'error',
                sourcePath: ctx.source,
                sourceRange: { start: 0, end: read.value.byteLength, line: 1, column: 1 },
                rule: 'json-parse',
                expected: 'valid JSON object',
                actual: error instanceof Error ? error.message : String(error),
                hint: 'repair target-profile.json before rebuilding',
              }],
            },
          }),
        };
      }
      const record = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>;
      const color = record.baseColor;
      if (
        record.kind !== GAME_DEFAULT_TARGET_PROFILE_KIND
        || record.version !== 1
        || typeof record.title !== 'string'
        || record.title.length === 0
        || typeof record.scoreMultiplier !== 'number'
        || !Number.isFinite(record.scoreMultiplier)
        || record.scoreMultiplier <= 0
        || typeof record.rotationSpeed !== 'number'
        || !Number.isFinite(record.rotationSpeed)
        || record.rotationSpeed <= 0
        || !Array.isArray(color)
        || color.length !== 4
        || !color.every((channel) => typeof channel === 'number' && Number.isFinite(channel) && channel >= 0 && channel <= 1)
      ) {
        return {
          ok: false,
          error: new ImportError({
            code: 'source-validation-failed',
            expected: 'kind, version, title, positive scoreMultiplier, positive rotationSpeed, and four normalized baseColor channels',
            hint: IMPORT_ERROR_HINTS['source-validation-failed'],
            detail: {
              diagnostics: [{
                code: 'target-profile-shape-invalid',
                severity: 'error',
                sourcePath: ctx.source,
                sourceRange: { start: 0, end: read.value.byteLength, line: 1, column: 1 },
                rule: 'target-profile-shape',
                expected: 'valid TargetProfile fields',
                actual: JSON.stringify(parsed),
                hint: 'see templates/game-default/assets/target-profile.json',
              }],
            },
          }),
        };
      }
      const payload: TargetProfile = {
        kind: GAME_DEFAULT_TARGET_PROFILE_KIND,
        version: 1,
        title: record.title,
        scoreMultiplier: record.scoreMultiplier,
        rotationSpeed: record.rotationSpeed,
        baseColor: [color[0] as number, color[1] as number, color[2] as number, color[3] as number],
      };
      return {
        ok: true,
        value: {
          assets: [{
            guid: subAsset.guid,
            kind: GAME_DEFAULT_TARGET_PROFILE_KIND,
            name: 'game-default-precision-target',
            payload: payload as unknown as ImportedAsset['payload'],
            refs: [],
            artifacts: {
              payload: {
                mediaType: 'application/json',
                assetCodec: { name: 'game-default-target-profile-json', version: '1' },
                bytes: read.value,
              },
            },
          }],
          sourceDependencies: [ctx.source],
        },
      };
    },
  };
}
