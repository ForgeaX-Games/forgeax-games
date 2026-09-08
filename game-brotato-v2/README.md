# Brotato 3D v2

一个基于 ForgeaX Engine 制作的 2.5D 生存竞技场游戏原型。玩家控制一只卡比风格的番茄，在封闭竞技场中移动，依靠长矛和斧头自动攻击不断出现的发芽土豆，并尽可能长时间存活。

> 当前模板交付范围：M2（战斗核心、双武器与敌人部署）。这是可运行的战斗原型，不是已经完成商店、升级和角色解锁的完整 Brotato 产品。

## 游戏内容

### 核心玩法

- **移动生存**：使用键盘或手柄控制番茄，在竞技场内走位、拉扯敌人。
- **自动战斗**：玩家不需要手动攻击，两把武器各自独立寻找目标并按冷却自动出招。
- **双武器配置**：
  - 长矛：突刺攻击，攻击距离约 4.2，攻击扇区 18°，最多命中 3 个目标。
  - 斧头：扇形劈砍，攻击距离约 2.3，攻击扇区 140°，最多命中 6 个目标。
- **敌人追击**：发芽土豆会从玩家周围部署并持续追击，接触时造成伤害。
- **持续刷怪**：刷怪节奏会逐级加快，场上最多保留 20 个敌人；达到上限时会跳过部分刷怪批次。
- **战斗反馈**：攻击范围会随出招变化，命中会显示伤害数字，敌人会闪白并在短暂的濒死表现后消失。
- **死亡与重开**：玩家生命值归零后进入 defeated 状态，按 `R` 可重置玩家、敌人、武器和刷怪时间线。

### 竞技场与镜头

- 40×40 格竞技场，带地砖、围墙、定向光和阴影。
- 内部绘制分辨率固定为 1600×900，浏览器窗口只做等比例缩放。
- 镜头采用固定角度的俯视跟随；地面可视范围约束为不超过 25×25，玩家移动到边缘时仍保持在画面内。
- 番茄采用红色主体、绿色蒂叶和漂浮四肢；待机与移动时会有浮动、摆动动画。

### 开发与验收功能

- 调试 HUD 可查看 FPS、帧时间、实体数、敌人数、玩家坐标、生命值、镜头范围、刷怪层级和武器状态。
- 刷怪 gizmo 可显示玩家周围的出生环、视野矩形和红叉倒计时。
- 目标连线可显示两把武器当前分配到的敌人。
- 压力测试会开启无敌并逐步增加敌人数量，用于观察 FPS、峰值敌人数和移动/碰撞/战斗耗时。
- 刷怪使用确定性随机种子，便于复现同一场战斗和定位问题。

## 操作方式

| 按键 | 功能 |
|:--|:--|
| `W` / `A` / `S` / `D` | 移动 |
| 方向键 | 移动 |
| 手柄左摇杆 | 移动 |
| `F1` | 打开运行时 HUD |
| `F2` | 打开属性页（当前为 M3 占位页） |
| `F3` | 打开武器页 |
| `Tab` | 显示/隐藏 HUD |
| `R` | 重启战斗循环 |
| `F4` / `G` | 开关压力测试 |
| `F5` / `T` | 显示/隐藏武器目标连线 |
| `F8` / `X` | 显示/隐藏敌人出生 gizmo |
| `F9` / `V` | 显示/隐藏 25×25 视野标定框 |
| `P` | 暂停/继续 FixedUpdate |
| `.` | 暂停时单步推进一次 FixedUpdate |

进入游戏后可以先按 `F1`，再用 `WASD` 走位；建议按 `F5` 查看武器目标分配，按 `F8` 查看红叉出生位置，按 `F4` 进入压力测试。

## 启动方式

### 在当前 ForgeaX Engine 仓库中运行

首次运行或引擎源码发生变化时，在仓库根目录执行：

```bash
cd /Users/you/forgeaX/forgeax-engine
pnpm install
pnpm build:engine
```

然后进入模板目录，执行测试、资产校验并启动开发服务器：

```bash
cd templates/game-brotato-v2
pnpm test
node ../../packages/engine/dist/bin/forgeax.mjs asset verify --json
node ../../packages/engine/dist/bin/forgeax.mjs dev .
```

命令启动后，在浏览器打开终端输出的本地 HTTP 地址。游戏依赖 WebGPU，请使用支持 WebGPU 的现代浏览器；不要直接双击 HTML 或使用 `file://` 地址打开。

### 构建生产版本并预览

```bash
cd /Users/you/forgeaX/forgeax-engine/templates/game-brotato-v2
node ../../packages/engine/dist/bin/forgeax.mjs build .
node ../../packages/engine/dist/bin/forgeax.mjs preview .
```

如需生成可分发的 Web 压缩包：

```bash
node ../../packages/engine/dist/bin/forgeax.mjs package . \
  --output release/brotato-v2-web.zip
```

生产包同样需要通过 HTTP(S) 静态服务器访问，不能使用 `file://`。

### 使用已安装的 ForgeaX SDK

如果游戏已经通过 SDK 创建并安装了 `forgeax` CLI，也可以在游戏根目录直接执行：

```bash
forgeax dev .
forgeax build .
forgeax preview .
```

## 项目结构

| 路径 | 作用 |
|:--|:--|
| `forge.json` | 游戏身份、入口、画布尺寸、插件和物理配置 |
| `src/main.ts` | 组合场景、输入、移动、战斗、刷怪、死亡和调试插件 |
| `src/config/` | 竞技场、镜头、移动、战斗、刷怪和压力测试的数值配置 |
| `src/systems/` | ECS 输入、移动、相机跟随、自动战斗、刷怪、敌人动画和死亡系统 |
| `src/combat/` | 伤害、目标分配、碰撞和攻击时序等纯逻辑 |
| `src/spawn/` | 确定性随机数、出生点约束和分阶段刷怪调度 |
| `src/runtime/` | 竞技场、番茄、敌人、武器和调试表现的运行时装配 |
| `assets/` | 程序化模型、材质、武器和 UI 的 ScriptablePack author source |
| `src/__tests__/` | 与功能 owner 对应的 Vitest 单元测试 |

## 当前未实现范围

以下内容仍属于后续里程碑，不应视为当前版本已有功能：属性系统、正式波次状态机、经验与材料掉落、升级选择、商店、6 槽武器成长、道具、角色选择、精英/Boss、完整音频和最终 UI。

详细设计与验收标准见 [`docs/PLAN.md`](docs/PLAN.md)、[`docs/M2-SPEC.md`](docs/M2-SPEC.md) 和 [`FORGE.md`](FORGE.md)。
