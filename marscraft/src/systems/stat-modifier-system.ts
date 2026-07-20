/**
 * MarsCraft -> forgeax-engine — stat-modifier system (Milestone M9)
 * =============================================================================
 * Port of the Three.js source `web/systems/StatModifierSystem.ts`.
 *
 * Each frame, for every unit with UnitStats: recompute the `final*` columns from
 * `base* + upgrade* + buff modifiers` (the SC2-style formulas, verbatim), sync
 * the resource `current` values (hp/shield/energy) when their max changes, and
 * write the finals back to the legacy gameplay components (Health.armor,
 * Movement.speed, Attack.damage/range/cooldown/splashRadius, Energy.regenRate,
 * UnitType.visionRange) so the other systems read buff-corrected values.
 *
 * Formulas (from source):
 *   finalMaxHp     = max(1, round((baseMaxHp + add) * (1 + pct)))
 *   finalMaxShield = max(0, round((baseMaxShield + add) * (1 + pct)))
 *   finalMaxEnergy = max(0, round((baseMaxEnergy + add) * (1 + pct)))
 *   finalArmor     = (baseArmor + upgradeArmorBonus + add) * max(0, 1 + pct)
 *   finalShieldArmor = baseShieldArmor + add
 *   finalDamage    = baseDamage + upgradeAttackBonus + add
 *   finalAttackCooldown = baseAttackCooldown / clamp(1+pct, 0.2, 10)   (attackSpeed)
 *   finalRange     = max(0, baseRange + upgradeRangeBonus + add)
 *   finalMoveSpeed = baseMoveSpeed * clamp(1+pct, 0, 4)                (moveSpeed)
 *   finalVisionRange = max(0, baseVisionRange + add)
 *   finalSplashRadius = max(0, baseSplashRadius + add)
 *   finalEnergyRegen = baseEnergyRegen * max(0, multiplicative)        (energyRegen)
 *   finalShieldRegen = (baseShieldRegen + add) * max(0, 1+pct)
 *   finalShieldRegenDelay = max(0, baseShieldRegenDelay*(1+pct) + add)
 *   finalDamageTakenMult / finalSpell.../finalNormal... = max(0, multiplicative)
 *   finalHealPowerMult / finalHealRateMult = max(0, 1 + pct)
 *
 * Resource current-sync (when finalMaxXxx changes):
 *   max increased -> current += delta   (keep the missing amount constant)
 *   max decreased -> current = clamp(current, floor, newMax)  (floor: hp=1, else 0)
 *
 * ⚠️ ECS rules: qr[0] is Batch[] — iterate; companions/cross-archetype reads via
 * world.get/set. No spawn/despawn.
 */

import { Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import {
  UnitStats, Abilities, Health, Energy, Movement, Attack, UnitType,
  attackWeaponId,
} from '../components';
import { getWeaponDef } from '../data/weapons';
import { getStatModifier } from './abilities-runtime';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

const ZERO_MOD = { additive: 0, percentBonus: 0, multiplicative: 1 };

export class StatModifierSystem {
  readonly name = 'StatModifierSystem';

  install(world: World): this {
    world.addSystem({
      name: this.name,
      queries: [{ with: [Entity, UnitStats] }],
      resources: ['Time'],
      fn: (_w, qr) => {
        const batches = qr[0] as unknown as Batch[];
        for (const b of batches) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            const e = b.Entity.self[i] as EntityHandle;
            this._updateOne(world, e, b, i);
          }
        }
      },
    });
    return this;
  }

  private _updateOne(world: World, e: EntityHandle, b: Batch, i: number): void {
    const hasAbilities = world.get(e, Abilities).ok;
    const getMod = (stat: string) =>
      hasAbilities ? getStatModifier(e, stat) : ZERO_MOD;

    const s = b.UnitStats;

    // cache old maxima for resource current-sync
    const oldMaxHp = s.finalMaxHp[i] as number;
    const oldMaxShield = s.finalMaxShield[i] as number;
    const oldMaxEnergy = s.finalMaxEnergy[i] as number;

    // ── compute finals ──
    const maxHpMod = getMod('maxHp');
    const finalMaxHp = Math.max(1, Math.round((s.baseMaxHp[i] + maxHpMod.additive) * (1 + maxHpMod.percentBonus)));
    s.finalMaxHp[i] = finalMaxHp;

    const maxShieldMod = getMod('maxShield');
    const finalMaxShield = Math.max(0, Math.round((s.baseMaxShield[i] + maxShieldMod.additive) * (1 + maxShieldMod.percentBonus)));
    s.finalMaxShield[i] = finalMaxShield;

    const maxEnergyMod = getMod('maxEnergy');
    const finalMaxEnergy = Math.max(0, Math.round((s.baseMaxEnergy[i] + maxEnergyMod.additive) * (1 + maxEnergyMod.percentBonus)));
    s.finalMaxEnergy[i] = finalMaxEnergy;

    const armorMod = getMod('armor');
    s.finalArmor[i] = (s.baseArmor[i] + s.upgradeArmorBonus[i] + armorMod.additive) * Math.max(0, 1 + armorMod.percentBonus);

    const shieldArmorMod = getMod('shieldArmor');
    s.finalShieldArmor[i] = s.baseShieldArmor[i] + shieldArmorMod.additive;

    const damageMod = getMod('damage');
    s.finalDamage[i] = s.baseDamage[i] + s.upgradeAttackBonus[i] + damageMod.additive;

    const attackSpeedMod = getMod('attackSpeed');
    const attackSpeedFactor = Math.max(0.2, Math.min(10, 1 + attackSpeedMod.percentBonus));
    s.finalAttackCooldown[i] = s.baseAttackCooldown[i] / attackSpeedFactor;

    const rangeMod = getMod('range');
    s.finalRange[i] = Math.max(0, s.baseRange[i] + s.upgradeRangeBonus[i] + rangeMod.additive);

    const moveSpeedMod = getMod('moveSpeed');
    const moveSpeedFactor = Math.max(0, Math.min(4, 1 + moveSpeedMod.percentBonus));
    s.finalMoveSpeed[i] = s.baseMoveSpeed[i] * moveSpeedFactor;

    const visionMod = getMod('visionRange');
    s.finalVisionRange[i] = Math.max(0, s.baseVisionRange[i] + visionMod.additive);

    const splashMod = getMod('splashRadius');
    s.finalSplashRadius[i] = Math.max(0, s.baseSplashRadius[i] + splashMod.additive);

    const energyRegenMod = getMod('energyRegen');
    s.finalEnergyRegen[i] = s.baseEnergyRegen[i] * Math.max(0, energyRegenMod.multiplicative);

    const shieldRegenMod = getMod('shieldRegen');
    s.finalShieldRegen[i] = (s.baseShieldRegen[i] + shieldRegenMod.additive) * Math.max(0, 1 + shieldRegenMod.percentBonus);

    const shieldDelayMod = getMod('shieldRegenDelay');
    s.finalShieldRegenDelay[i] = Math.max(0, s.baseShieldRegenDelay[i] * (1 + shieldDelayMod.percentBonus) + shieldDelayMod.additive);

    s.finalDamageTakenMult[i] = Math.max(0, getMod('damageTaken').multiplicative);
    s.finalSpellDamageTakenMult[i] = Math.max(0, getMod('spellDamageTaken').multiplicative);
    s.finalNormalDamageTakenMult[i] = Math.max(0, getMod('normalDamageTaken').multiplicative);
    s.finalHealPowerMult[i] = Math.max(0, 1 + getMod('healPower').percentBonus);
    s.finalHealRateMult[i] = Math.max(0, 1 + getMod('healRate').percentBonus);

    // ── resource current-sync (only when max changed) ──
    this._syncResourceCurrent(world, e, finalMaxHp, finalMaxShield, finalMaxEnergy, oldMaxHp, oldMaxShield, oldMaxEnergy);

    // ── write finals back to legacy gameplay components ──
    this._syncLegacy(world, e, s, i);
  }

  private _syncResourceCurrent(
    world: World, e: EntityHandle,
    finalMaxHp: number, finalMaxShield: number, finalMaxEnergy: number,
    oldMaxHp: number, oldMaxShield: number, oldMaxEnergy: number,
  ): void {
    if (finalMaxHp !== oldMaxHp || finalMaxShield !== oldMaxShield) {
      const hr = world.get(e, Health);
      if (hr.ok) {
        const h = hr.value;
        let hp = h.hp, shield = h.shield, maxHp = h.maxHp, maxShield = h.maxShield;
        if (finalMaxHp !== oldMaxHp && !h.isDead) {
          const delta = finalMaxHp - oldMaxHp;
          maxHp = finalMaxHp;
          hp = delta > 0 ? Math.min(finalMaxHp, hp + delta) : Math.max(1, Math.min(hp, finalMaxHp));
        }
        if (finalMaxShield !== oldMaxShield) {
          const delta = finalMaxShield - oldMaxShield;
          maxShield = finalMaxShield;
          shield = delta > 0 ? Math.min(finalMaxShield, shield + delta) : Math.max(0, Math.min(shield, finalMaxShield));
        }
        world.set(e, Health, { hp, shield, maxHp, maxShield });
      }
    }
    if (finalMaxEnergy !== oldMaxEnergy) {
      const er = world.get(e, Energy);
      if (er.ok) {
        const delta = finalMaxEnergy - oldMaxEnergy;
        const energy = delta > 0
          ? Math.min(finalMaxEnergy, er.value.energy + delta)
          : Math.max(0, Math.min(er.value.energy, finalMaxEnergy));
        world.set(e, Energy, { energy, maxEnergy: finalMaxEnergy });
      }
    }
  }

  private _syncLegacy(world: World, e: EntityHandle, s: Batch, i: number): void {
    const hr = world.get(e, Health);
    if (hr.ok) {
      world.set(e, Health, { armor: s.finalArmor[i], shieldArmor: s.finalShieldArmor[i] });
    }
    const mv = world.get(e, Movement);
    if (mv.ok) {
      // Lifted buildings' speed is managed by the lift system; don't clobber it
      // unless this unit actually has a moveSpeed (matches source guard).
      if (s.finalMoveSpeed[i] > 0 || mv.value.speed === 0) {
        world.set(e, Movement, { speed: s.finalMoveSpeed[i] });
      }
    }
    // ── Attack: layer buffs on the WEAPON DEF base (M6 keeps authoritative
    //    weapon numbers in the Attack cols, NOT in UnitStats.base*, so the source's
    //    "Attack.damage = finalDamage" would zero them out — baseDamage is 0 for
    //    every unit here). Instead recompute from the weapon def + the live buff
    //    modifiers each frame (idempotent: weapon-def base never compounds). If a
    //    unit has no weapon def (e.g. ability-only), skip — nothing to layer. ──
    const at = world.get(e, Attack);
    if (at.ok) {
      const wid = attackWeaponId.get(e);
      const wdef = wid ? getWeaponDef(wid) : undefined;
      if (wdef) {
        const dmgMod = getStatModifier(e, 'damage');
        const rangeMod = getStatModifier(e, 'range');
        const spdMod = getStatModifier(e, 'attackSpeed');
        const splashMod = getStatModifier(e, 'splashRadius');
        const spdFactor = Math.max(0.2, Math.min(10, 1 + spdMod.percentBonus));
        world.set(e, Attack, {
          damage: wdef.damage + s.upgradeAttackBonus[i] + dmgMod.additive,
          range: Math.max(0, wdef.range + s.upgradeRangeBonus[i] + rangeMod.additive),
          cooldown: wdef.cooldown / spdFactor,
          splashRadius: Math.max(0, wdef.splashRadius + splashMod.additive),
        });
      }
    }
    const en = world.get(e, Energy);
    if (en.ok) world.set(e, Energy, { regenRate: s.finalEnergyRegen[i] });
    const ut = world.get(e, UnitType);
    if (ut.ok) world.set(e, UnitType, { visionRange: s.finalVisionRange[i] });
  }
}
