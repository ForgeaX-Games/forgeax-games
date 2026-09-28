/** Host HUD only. The center stays readable; damage never captures pointer input. */
export function createInjuryHud(parent: HTMLElement) {
  const root = document.createElement('div');
  root.className = 'ra-injury';
  root.innerHTML = `<style>
.ra-injury{position:absolute;inset:0;pointer-events:none;z-index:24;color:#eee0cc;font:12px 'PingFang TC',sans-serif}.ra-wound{position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse at center,transparent 30%,#57080345 62%,#850e0bbb 100%);transition:opacity .08s}.ra-wound:before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 45px 180px at 2% 5%,#64110dbb 20%,transparent 75%),radial-gradient(ellipse 25px 130px at 97% 35%,#7e1514bb 20%,transparent 75%),radial-gradient(ellipse 170px 35px at 22% 98%,#650b0cdd,transparent 80%)}.ra-direction{position:absolute;left:50%;top:50%;width:200px;height:200px;margin:-100px;border-top:5px solid #e96148;border-radius:50%;opacity:0}.ra-vitals{position:absolute;left:34px;bottom:119px;width:155px;letter-spacing:2px;font-size:10px}.ra-health-track{height:4px;background:#262421;margin-top:8px}.ra-health{height:100%;background:#bf5b40;transform-origin:left}.ra-hint{position:absolute;bottom:26%;width:100%;text-align:center;letter-spacing:2px;color:#e0cba5}.ra-death{position:absolute;inset:0;background:#100b0ada;display:none;place-content:center;text-align:center;pointer-events:auto}.ra-death h2{font:40px 'Songti TC',serif;letter-spacing:10px}.ra-death button{cursor:pointer;color:#e6d5bf;background:#722e24;border:1px solid #af6251;padding:14px 25px;font:inherit}.ra-death p{color:#b8a99b}
</style><div class="ra-wound"></div><div class="ra-direction"></div><div class="ra-vitals">狀態 <span>100</span><div class="ra-health-track"><div class="ra-health"></div></div></div><div class="ra-hint"></div><div class="ra-death"><h2>雨夜未盡</h2><p>你倒在了街巷裡。尋找掩體，避開正面交火。</p><button>重新進入街區 · Enter</button></div>`;
  parent.append(root);
  const q = (s: string) => root.querySelector<HTMLElement>(s)!;
  let hitAt = -100,
    direction = 0,
    restart = false;
  q('button').onclick = () => {
    restart = true;
  };
  return {
    hit(now: number, angle: number) {
      hitAt = now;
      direction = angle;
    },
    takeRestart() {
      const r = restart;
      restart = false;
      return r;
    },
    update(health: number, now: number, yaw: number, hint: string) {
      const impact = Math.max(0, 1 - (now - hitAt) / 1.1),
        critical =
          health < 35 && health > 0
            ? (1 - health / 35) * (0.48 + 0.12 * Math.sin(now * 6))
            : 0;
      q('.ra-wound').style.opacity = String(
        Math.min(0.9, impact * 0.8 + critical),
      );
      q('.ra-direction').style.opacity = String(impact);
      q('.ra-direction').style.transform =
        `rotate(${((direction - yaw) * 180) / Math.PI}deg)`;
      q('.ra-health').style.transform = `scaleX(${health / 100})`;
      q('.ra-vitals span').textContent =
        health > 0
          ? `${Math.ceil(health)}${health < 35 ? ' · 重傷' : ''}`
          : '倒下';
      q('.ra-death').style.display = health <= 0 ? 'grid' : 'none';
      q('.ra-hint').textContent = hint;
    },
    dispose() {
      root.remove();
    },
  };
}
