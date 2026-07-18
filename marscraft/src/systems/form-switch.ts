/**
 * MarsCraft -> forgeax-engine — FormSwitchSystem (Milestone M9 chunk 2)
 * =============================================================================
 * Port of the Three.js source `web/systems/FormSwitchSystem.ts`. Manages
 * reversible unit FORM transforms (siege tank <-> tank mode, viking assault <->
 * fighter, roach brace, etc.). A form switch immediately swaps the unit's
 * stats / weapon / movement / model / abilities to the target form; switching
 * back restores from the captured base snapshot.
 *
 * `switchForm(entity, formId)` is the public entry. The M9 ch1 effect-executor's
 * `form_switch` seam is wired (in main.ts) to call it. `requestExitToBase` force-
 * reverts (used by a form's exitTrigger; sustained-completion triggering is a
 * remaining seam — only the manual/effect path is exercised here).
 *
 * ── forgeax adaptation vs the source class (add/removeComponent + EventBus) ────
 *   - The source add/removed CAttack/CMovement per form. forgeax combat units
 *     keep the Attack/Movement SoA columns; a `weaponId === null` form ZEROES the
 *     Attack columns (no fire) rather than removing the component, and a `speed`
 *     of 0 zeroes Movement. (Removing/re-adding SoA components mid-game churns
 *     archetypes; zeroing is behaviorally identical for the ported systems.)
 *   - Form state (activeFormId + baseSnapshot) lives in the M2 Map companions
 *     `formActiveId` / `formBaseSnapshot` (CForm is a pure-tag component).
 *   - The model swap (source `render:invalidateMesh` event) is performed directly:
 *     despawn the unit's ChildOf model parts (via the engine `Children` list, same
 *     pattern as DeathSystem) then rebuild via `spawnUnitModel` using a synthetic
 *     UnitDef whose model fields reflect the new form (model id + size). This is
 *     done AFTER the stat swap and is collect-free (single entity, no iteration).
 *   - EventBus `form:switched` is dropped (no EventBus port); the HUD (M12) polls.
 *
 * ⚠️ ECS rules: this is NOT a per-frame query system (form switches are instant,
 * triggered by abilities/commands). It only mutates the one target entity via
 * world.get/set + a single despawn-children/spawn-model model rebuild.
 */

import { type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Children, ChildOf, Transform } from '@forgeax/engine-runtime';
import {
  Attack, Movement, Health, Selectable, UnitType, UnitStats,
  Abilities, Renderable,
  formActiveId, formBaseSnapshot, attackWeaponId, attackSplashFalloff, abilityIds, renderableModelPath, unitTypeId,
  abilityActivatedPassives, abilityBuffs, abilityToggleStates,
  MOVE_TYPE, COMBAT_TYPE, UNIT_SIZE,
  type FormSnapshot, type ToggleState,
} from '../components';
import { getUnitDef, type FormDef, type UnitDef, type CombatType, type UnitSize } from '../data/units';
import { getWeaponDef, RANGE_SCALE } from '../data/weapons';
import { getAbilityDef } from '../data/abilities';
import { spawnUnitModel, type UnitPrimitives, type TintFn } from '../world/unit-models';

/** Model deps the form/morph systems need to rebuild a unit's composite mesh. */
export interface ModelRebuildDeps {
  prims: UnitPrimitives;
  tint: TintFn;
}

const COMBAT_CODE: Record<CombatType, number> = {
  bio: COMBAT_TYPE.BIO, armored: COMBAT_TYPE.ARMORED, psionic: COMBAT_TYPE.PSIONIC,
  void: COMBAT_TYPE.VOID, structure: COMBAT_TYPE.STRUCTURE,
};
const SIZE_CODE: Record<UnitSize, number> = {
  small: UNIT_SIZE.SMALL, medium: UNIT_SIZE.MEDIUM, large: UNIT_SIZE.LARGE,
};

export interface FormSwitchHandle {
  /** Switch `entity` to `formId`; if already in it, revert to base. */
  switchForm(entity: EntityHandle, formId: string): boolean;
  /** Force-revert `entity` to its base form (exitTrigger / death). */
  exitToBase(entity: EntityHandle): boolean;
  /** Current active form id of `entity` (null = base form). */
  activeForm(entity: EntityHandle): string | null;
}

export class FormSwitchSystem implements FormSwitchHandle {
  private _world!: World;
  private readonly _model: ModelRebuildDeps;

  constructor(modelDeps: ModelRebuildDeps) { this._model = modelDeps; }

  install(world: World): FormSwitchHandle {
    this._world = world;
    return this;
  }

  activeForm(entity: EntityHandle): string | null {
    return formActiveId.get(entity) ?? null;
  }

  switchForm(entity: EntityHandle, formId: string): boolean {
    const world = this._world;
    if (!world.get(entity, Health).ok) return false;
    const ut = world.get(entity, UnitType);
    if (!ut.ok) return false;
    // Base typeId is the unit's authoritative type (forms never change it); the
    // visible-model path (renderableModelPath) is cosmetic. Read the base def
    // from unitTypeId so a 2nd toggle still resolves the same forms.
    const baseTypeId = unitTypeId.get(entity);
    const unitDef = baseTypeId ? getUnitDef(baseTypeId) : undefined;
    if (!unitDef?.forms) return false;

    const cur = formActiveId.get(entity) ?? null;

    if (cur === formId) {
      // toggle off -> restore base
      this._restoreBase(entity, unitDef);
      formActiveId.set(entity, null);
    } else {
      if (!formBaseSnapshot.get(entity)) {
        formBaseSnapshot.set(entity, this._captureSnapshot(entity, unitDef.weaponId));
      }
      const formDef = unitDef.forms.find((f) => f.formId === formId);
      if (!formDef) return false;
      this._applyForm(entity, formDef, unitDef);
      formActiveId.set(entity, formId);
    }

    // clear movement / attack state (source clearTarget + isAttacking=false)
    const mv = world.get(entity, Movement);
    if (mv.ok) world.set(entity, Movement, { hasTarget: false, arrived: true, currentSpeed: 0 });
    const at = world.get(entity, Attack);
    if (at.ok) world.set(entity, Attack, { isAttacking: false, targetEntity: -1 });

    return true;
  }

  exitToBase(entity: EntityHandle): boolean {
    if (!formActiveId.get(entity)) return false;
    const baseTypeId = unitTypeId.get(entity);
    const unitDef = baseTypeId ? getUnitDef(baseTypeId) : undefined;
    if (!unitDef) return false;
    this._restoreBase(entity, unitDef);
    formActiveId.set(entity, null);
    const mv = this._world.get(entity, Movement);
    if (mv.ok) this._world.set(entity, Movement, { hasTarget: false, arrived: true, currentSpeed: 0 });
    const at = this._world.get(entity, Attack);
    if (at.ok) this._world.set(entity, Attack, { isAttacking: false, targetEntity: -1 });
    return true;
  }

  // ── apply a form ────────────────────────────────────────────────────────────
  private _applyForm(entity: EntityHandle, formDef: FormDef, unitDef: UnitDef): void {
    const world = this._world;

    // Weapon
    if (formDef.weaponId === null) {
      // immobile/no-attack form: zero the Attack columns (source removed CAttack).
      const at = world.get(entity, Attack);
      if (at.ok) world.set(entity, Attack, { damage: 0, range: 0, splashRadius: 0, isAttacking: false, targetEntity: -1 });
    } else {
      const wdef = getWeaponDef(formDef.weaponId);
      if (wdef) {
        attackWeaponId.set(entity, formDef.weaponId);
        attackSplashFalloff.set(entity, [...wdef.splashFalloff]);
        const at = world.get(entity, Attack);
        const data = {
          damage: wdef.damage, damageCount: wdef.damageCount, damageType: this._dmgCode(wdef.damageType),
          range: wdef.range, cooldown: wdef.cooldown, projectileType: this._projCode(wdef.projectileType),
          projectileSpeed: wdef.projectileSpeed, canAttackAir: wdef.canAttackAir, canAttackGround: wdef.canAttackGround,
          splashRadius: wdef.splashRadius, splashShape: this._splashCode(wdef.splashShape),
          splashAngle: wdef.splashAngle, splashWidth: wdef.splashWidth,
          bounceCount: wdef.bounceCount, bounceDamageDecay: wdef.bounceDamageDecay, leashDistance: wdef.leashDistance,
          isAttacking: false, targetEntity: -1,
        };
        if (at.ok) world.set(entity, Attack, data);
        else world.addComponent(entity, { component: Attack, data });
      }
    }

    // Movement
    if (formDef.speed !== undefined) {
      const mv = world.get(entity, Movement);
      if (mv.ok) {
        const patch: Record<string, number> = { speed: formDef.speed };
        if (formDef.speed === 0) patch.currentSpeed = 0;
        if (formDef.turnRate !== undefined) patch.turnRate = formDef.turnRate;
        if (formDef.moveType) patch.moveType = formDef.moveType === 'air' ? MOVE_TYPE.AIR : MOVE_TYPE.GROUND;
        world.set(entity, Movement, patch);
      } else if (formDef.speed > 0) {
        world.addComponent(entity, {
          component: Movement,
          data: {
            speed: formDef.speed, turnRate: formDef.turnRate ?? unitDef.turnRate,
            moveType: (formDef.moveType ?? (unitDef.isGround ? 'ground' : 'air')) === 'air' ? MOVE_TYPE.AIR : MOVE_TYPE.GROUND,
          },
        });
      }
    }

    // Health / armor (keep hp ratio)
    const hr = world.get(entity, Health);
    if (hr.ok) {
      const h = hr.value;
      const patch: Record<string, number> = {};
      if (formDef.hp !== undefined) {
        const ratio = h.maxHp > 0 ? h.hp / h.maxHp : 1;
        patch.maxHp = formDef.hp;
        patch.hp = Math.max(1, Math.round(ratio * formDef.hp));
      }
      if (formDef.armor !== undefined) patch.armor = formDef.armor;
      if (formDef.shield !== undefined) {
        const sr = h.maxShield > 0 ? h.shield / h.maxShield : 0;
        patch.maxShield = formDef.shield;
        patch.shield = Math.round(sr * formDef.shield);
      }
      if (formDef.shieldArmor !== undefined) patch.shieldArmor = formDef.shieldArmor;
      if (Object.keys(patch).length) world.set(entity, Health, patch);
    }

    // Selection radius
    if (formDef.selectionRadius !== undefined) {
      const sel = world.get(entity, Selectable);
      if (sel.ok) world.set(entity, Selectable, { selectionRadius: formDef.selectionRadius });
    }

    // Abilities
    if (formDef.abilityIds) {
      const old = new Set(abilityIds.get(entity) ?? []);
      abilityIds.set(entity, [...formDef.abilityIds]);
      this._cleanupStalePassives(entity, old, new Set(formDef.abilityIds));
    }

    // UnitType (combat/size/vision) — source set ut.visionRange via grid.
    const utPatch: Record<string, number> = {};
    if (formDef.combatType) utPatch.combatType = COMBAT_CODE[formDef.combatType];
    if (formDef.unitSize) utPatch.unitSize = SIZE_CODE[formDef.unitSize];
    if (formDef.visionRangeGrid !== undefined) utPatch.visionRange = formDef.visionRangeGrid * RANGE_SCALE;
    if (Object.keys(utPatch).length) world.set(entity, UnitType, utPatch);

    // UnitStats base values (StatModifierSystem re-derives finals from these)
    const ss = world.get(entity, UnitStats);
    if (ss.ok) {
      const patch: Record<string, number> = {};
      if (formDef.weaponId === null) { patch.baseDamage = 0; patch.baseRange = 0; patch.baseSplashRadius = 0; }
      else {
        const wdef = getWeaponDef(formDef.weaponId);
        if (wdef) { patch.baseDamage = wdef.damage; patch.baseAttackCooldown = wdef.cooldown; patch.baseRange = wdef.range; patch.baseSplashRadius = wdef.splashRadius; }
      }
      if (formDef.speed !== undefined) patch.baseMoveSpeed = formDef.speed;
      if (formDef.turnRate !== undefined) patch.baseTurnRate = formDef.turnRate;
      if (formDef.armor !== undefined) patch.baseArmor = formDef.armor;
      if (formDef.hp !== undefined) patch.baseMaxHp = formDef.hp;
      if (formDef.shield !== undefined) patch.baseMaxShield = formDef.shield;
      if (formDef.shieldArmor !== undefined) patch.baseShieldArmor = formDef.shieldArmor;
      if (formDef.visionRangeGrid !== undefined) patch.baseVisionRange = formDef.visionRangeGrid * RANGE_SCALE;
      if (Object.keys(patch).length) world.set(entity, UnitStats, patch);
    }

    // Cloak on enter
    if (formDef.applyCloakOnEnter) this._setCloak(entity, true);

    // Model swap: re-spawn the composite model at the form's model id + size.
    this._rebuildModel(entity, formDef.modelId ?? unitDef.typeId, formDef.modelSize ?? unitDef.modelSize, unitDef);
  }

  // ── restore base from snapshot ────────────────────────────────────────────────
  private _restoreBase(entity: EntityHandle, unitDef: UnitDef): void {
    const world = this._world;
    const snap = formBaseSnapshot.get(entity);
    if (!snap) return;

    // Weapon
    if (snap.weaponId === null) {
      const at = world.get(entity, Attack);
      if (at.ok) world.set(entity, Attack, { damage: 0, range: 0, splashRadius: 0, isAttacking: false, targetEntity: -1 });
    } else {
      attackWeaponId.set(entity, snap.weaponId);
      attackSplashFalloff.set(entity, [...snap.splashFalloff]);
      const at = world.get(entity, Attack);
      const data = {
        damage: snap.damage, damageCount: snap.damageCount, damageType: this._dmgCode(snap.damageType),
        range: snap.range, cooldown: snap.cooldown, projectileType: this._projCode(snap.projectileType),
        projectileSpeed: snap.projectileSpeed, canAttackAir: snap.canAttackAir, canAttackGround: snap.canAttackGround,
        splashRadius: snap.splashRadius, splashShape: this._splashCode(snap.splashShape),
        splashAngle: snap.splashAngle, splashWidth: snap.splashWidth,
        bounceCount: snap.bounceCount, bounceDamageDecay: snap.bounceDamageDecay,
        isAttacking: false, targetEntity: -1,
      };
      if (at.ok) world.set(entity, Attack, data);
      else world.addComponent(entity, { component: Attack, data });
    }

    // Movement
    const mv = world.get(entity, Movement);
    if (mv.ok) {
      world.set(entity, Movement, {
        speed: snap.speed, turnRate: snap.turnRate,
        moveType: snap.moveType === 'air' ? MOVE_TYPE.AIR : MOVE_TYPE.GROUND,
      });
    } else if (snap.speed > 0) {
      world.addComponent(entity, {
        component: Movement,
        data: { speed: snap.speed, turnRate: snap.turnRate, moveType: snap.moveType === 'air' ? MOVE_TYPE.AIR : MOVE_TYPE.GROUND },
      });
    }

    // Health (keep ratio)
    const hr = world.get(entity, Health);
    if (hr.ok) {
      const h = hr.value;
      const ratio = h.maxHp > 0 ? h.hp / h.maxHp : 1;
      const sr = h.maxShield > 0 ? h.shield / h.maxShield : 0;
      world.set(entity, Health, {
        maxHp: snap.maxHp, hp: Math.max(1, Math.round(ratio * snap.maxHp)),
        armor: snap.armor, maxShield: snap.maxShield, shield: Math.round(sr * snap.maxShield),
        shieldArmor: snap.shieldArmor,
      });
    }

    // Selection
    const sel = world.get(entity, Selectable);
    if (sel.ok) world.set(entity, Selectable, { selectionRadius: snap.selectionRadius });

    // Abilities
    const old = new Set(abilityIds.get(entity) ?? []);
    abilityIds.set(entity, [...snap.abilityIds]);
    this._cleanupStalePassives(entity, old, new Set(snap.abilityIds));

    // remove cloak
    this._setCloak(entity, false);

    // UnitType vision + UnitStats base
    const ut = world.get(entity, UnitType);
    if (ut.ok) world.set(entity, UnitType, { visionRange: snap.visionRange });
    const ss = world.get(entity, UnitStats);
    if (ss.ok) {
      world.set(entity, UnitStats, {
        baseDamage: snap.baseDamage, baseAttackCooldown: snap.baseAttackCooldown, baseRange: snap.baseRange,
        baseMoveSpeed: snap.baseMoveSpeed, baseTurnRate: snap.baseTurnRate, baseArmor: snap.baseArmor,
        baseMaxHp: snap.baseMaxHp, baseMaxShield: snap.baseMaxShield, baseShieldArmor: snap.baseShieldArmor,
        baseVisionRange: snap.visionRange, baseSplashRadius: snap.baseSplashRadius,
      });
    }

    // Model: back to base model id/size.
    this._rebuildModel(entity, snap.modelPath || unitDef.typeId, snap.modelSize || unitDef.modelSize, unitDef);

    formBaseSnapshot.set(entity, null);
  }

  // ── snapshot capture (source _captureSnapshot) ────────────────────────────────
  private _captureSnapshot(entity: EntityHandle, baseWeaponId: string | null): FormSnapshot {
    const world = this._world;
    const at = world.get(entity, Attack);
    const mv = world.get(entity, Movement);
    const hr = world.get(entity, Health);
    const rn = world.get(entity, Renderable);
    const sel = world.get(entity, Selectable);
    const ut = world.get(entity, UnitType);
    const ss = world.get(entity, UnitStats);
    const wId = attackWeaponId.get(entity) ?? baseWeaponId;
    return {
      weaponId: wId ?? null,
      damage: at.ok ? at.value.damage : 0,
      damageCount: at.ok ? at.value.damageCount : 1,
      damageType: at.ok ? this._dmgName(at.value.damageType) : 'normal',
      range: at.ok ? at.value.range : 0,
      cooldown: at.ok ? at.value.cooldown : 1,
      projectileType: at.ok ? this._projName(at.value.projectileType) : 'instant',
      projectileSpeed: at.ok ? at.value.projectileSpeed : 0,
      canAttackAir: at.ok ? at.value.canAttackAir : false,
      canAttackGround: at.ok ? at.value.canAttackGround : true,
      splashRadius: at.ok ? at.value.splashRadius : 0,
      splashShape: at.ok ? this._splashName(at.value.splashShape) : 'circle',
      splashFalloff: [...(attackSplashFalloff.get(entity) ?? [])],
      splashAngle: at.ok ? at.value.splashAngle : 0,
      splashWidth: at.ok ? at.value.splashWidth : 0,
      bounceCount: at.ok ? at.value.bounceCount : 0,
      bounceDamageDecay: at.ok ? at.value.bounceDamageDecay : 0,

      speed: mv.ok ? mv.value.speed : 0,
      turnRate: mv.ok ? mv.value.turnRate : Math.PI * 4,
      moveType: mv.ok ? (mv.value.moveType === MOVE_TYPE.AIR ? 'air' : 'ground') : 'ground',

      maxHp: hr.ok ? hr.value.maxHp : 0,
      armor: hr.ok ? hr.value.armor : 0,
      maxShield: hr.ok ? hr.value.maxShield : 0,
      shieldArmor: hr.ok ? hr.value.shieldArmor : 0,

      modelPath: renderableModelPath.get(entity) ?? '',
      modelSize: rn.ok ? rn.value.size : 1,
      selectionRadius: sel.ok ? sel.value.selectionRadius : 0.5,

      abilityIds: [...(abilityIds.get(entity) ?? [])],
      visionRange: ut.ok ? ut.value.visionRange : 0,

      baseDamage: ss.ok ? ss.value.baseDamage : 0,
      baseAttackCooldown: ss.ok ? ss.value.baseAttackCooldown : 1,
      baseRange: ss.ok ? ss.value.baseRange : 0,
      baseMoveSpeed: ss.ok ? ss.value.baseMoveSpeed : 0,
      baseTurnRate: ss.ok ? ss.value.baseTurnRate : Math.PI * 4,
      baseArmor: ss.ok ? ss.value.baseArmor : 0,
      baseMaxHp: ss.ok ? ss.value.baseMaxHp : 0,
      baseMaxShield: ss.ok ? ss.value.baseMaxShield : 0,
      baseShieldArmor: ss.ok ? ss.value.baseShieldArmor : 0,
      baseVisionRange: ss.ok ? ss.value.baseVisionRange : 0,
      baseSplashRadius: ss.ok ? ss.value.baseSplashRadius : 0,
    };
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  /** Despawn the unit's ChildOf model parts + rebuild for the new form. */
  private _rebuildModel(entity: EntityHandle, modelTypeId: string, modelSize: number, baseDef: UnitDef): void {
    rebuildUnitModel(this._world, this._model, entity, modelTypeId, modelSize, baseDef);
  }

  private _setCloak(entity: EntityHandle, active: boolean): void {
    if (!this._world.get(entity, Abilities).ok) return;
    const m = abilityToggleStatesOf(entity);
    const s = m.get('cloak');
    if (!s) m.set('cloak', { stateId: 'cloak', active, transitionRemaining: 0, transitionTotal: 0 });
    else s.active = active;
  }

  /** Drop activatedPassives + their buffs for passives no longer in the ability list. */
  private _cleanupStalePassives(entity: EntityHandle, oldIds: Set<string>, newIds: Set<string>): void {
    const activated = abilityActivatedPassives.get(entity);
    if (!activated) return;
    for (const oldId of oldIds) {
      if (newIds.has(oldId)) continue;
      if (!activated.has(oldId)) continue;
      const def = getAbilityDef(oldId);
      if (!def?.isPassive) continue;
      activated.delete(oldId);
      const buffs = abilityBuffs.get(entity);
      if (!buffs) continue;
      for (const eff of def.effects) {
        if (eff.type === 'apply_buff') {
          const idx = buffs.findIndex((b) => b.id === (eff as { buffId: string }).buffId);
          if (idx >= 0) buffs.splice(idx, 1);
        }
      }
    }
  }

  // enum <-> string mappers (snapshot stores source string unions; cols store codes)
  private _dmgCode(s: string): number { return s === 'spell' ? 1 : 0; }
  private _dmgName(c: number): string { return c === 1 ? 'spell' : 'normal'; }
  private _projCode(s: string): number { return s === 'bullet' ? 1 : s === 'missile' ? 2 : s === 'bounce' ? 3 : 0; }
  private _projName(c: number): string { return c === 1 ? 'bullet' : c === 2 ? 'missile' : c === 3 ? 'bounce' : 'instant'; }
  private _splashCode(s: string): number { return s === 'cone' ? 1 : s === 'line' ? 2 : 0; }
  private _splashName(c: number): string { return c === 1 ? 'cone' : c === 2 ? 'line' : 'circle'; }
}

function abilityToggleStatesOf(e: EntityHandle): Map<string, ToggleState> {
  let m = abilityToggleStates.get(e);
  if (!m) { m = new Map<string, ToggleState>(); abilityToggleStates.set(e, m); }
  return m;
}

/**
 * Shared model rebuild used by FormSwitchSystem + UnitMorphSystem: despawn the
 * unit's ChildOf model-part children (via the engine Children forward list, same
 * as DeathSystem) and re-spawn the composite model for `modelTypeId` at
 * `modelSize`. Updates Renderable.size + renderableModelPath companion to match.
 *
 * ⚠️ Call OUTSIDE a query-iteration fn (single-entity despawn+spawn). The form/
 * morph callers are command/effect-driven (not per-frame batch loops); the morph
 * SYSTEM collects completions during its loop and rebuilds AFTER it.
 */
export function rebuildUnitModel(
  world: World, deps: ModelRebuildDeps, entity: EntityHandle,
  modelTypeId: string, modelSize: number, baseDef: UnitDef,
): void {
  const ch = world.get(entity, Children);
  if (ch.ok) {
    const ids: number[] = [];
    const kids = ch.value.entities;
    for (let k = 0; k < kids.length; k++) ids.push(kids[k]);
    // Clear ChildOf before despawning each old part (batched despawns can leave
    // a 1-frame dangling ChildOf that propagateTransforms flags — same class as
    // the death-system fix; matters on the high-churn zerg larva→egg rebuild).
    for (const cid of ids) {
      const child = cid as unknown as EntityHandle;
      if (world.get(child, ChildOf).ok) world.removeComponent(child, ChildOf);
    }
    for (const cid of ids) {
      const child = cid as unknown as EntityHandle;
      if (world.get(child, Transform).ok) world.despawn(child);
    }
    // ⚠️ ENGINE QUIRK (see ENGINE-ISSUES-for-ubpa.md): the ChildOf→Children
    // relationship mirror only populates correctly via the LAZY-CREATE arm of
    // relationshipOnInsert (mirror component ABSENT on the parent). Once the
    // parent already carries a Children component that has been emptied by
    // removeComponent(ChildOf), the append arm silently no-ops — re-spawned
    // model parts get a live ChildOf but are NEVER added back to the parent's
    // Children list (measured: spawned=5, mirrorAfter=0). Every subtree despawn
    // (death-system, despawnScene/iterDescendants) walks that list, so the parts
    // orphan → propagateTransforms `hierarchy-broken` storm on the high-churn
    // zerg larva→egg→unit pipeline. Fix: drop the now-empty Children component
    // so the next spawnUnitModel re-enters the working lazy-create path.
    if (world.get(entity, Children).ok) world.removeComponent(entity, Children);
  }
  // synthetic def: base def with the target model id + size so the right parts
  // (keyed by typeId) + scale are used.
  const modelDef: UnitDef = { ...baseDef, typeId: modelTypeId, modelSize };
  const rn = world.get(entity, Renderable);
  const color = rn.ok ? rn.value.color : 0x888888;
  spawnUnitModel(world, entity, modelDef, color, deps.prims, deps.tint);
  if (rn.ok) world.set(entity, Renderable, { size: modelSize });
  renderableModelPath.set(entity, modelTypeId);
}
