const HOWTO_ID = 'luo-sai-ya-howto';

const HOWTO_HTML = `
<h2 style="margin:0 0 12px;font-size:18px;color:#fbbf24;">洛塞娅 · 玩法说明</h2>
<section style="margin-bottom:12px;">
  <h3 style="margin:0 0 6px;font-size:13px;color:#67e8f9;">目标</h3>
  <p style="margin:0;line-height:1.55;font-size:12px;color:#e2e8f0;">率先达到 <b>10 分</b> 获胜。分数来自村庄、城镇、发展卡与成就（最长道路 / 最大军队）。</p>
</section>
<section style="margin-bottom:12px;">
  <h3 style="margin:0 0 6px;font-size:13px;color:#67e8f9;">开局</h3>
  <p style="margin:0;line-height:1.55;font-size:12px;color:#e2e8f0;">四名玩家轮流：每轮放置 <b>1 村庄 + 1 道路</b>，共两轮（合计 2 村庄 + 2 道路）。道路须与己方村庄或已有道路相邻，可沿道路延伸。放村庄时获得相邻地块资源。</p>
</section>
<section style="margin-bottom:12px;">
  <h3 style="margin:0 0 6px;font-size:13px;color:#67e8f9;">回合流程</h3>
  <ol style="margin:0;padding-left:18px;line-height:1.6;font-size:12px;color:#e2e8f0;">
    <li><b>掷骰</b>：点数之和决定哪些数字格产出资源。</li>
    <li><b>收割</b>：村庄得 1 张、城镇得 2 张对应资源。</li>
    <li>掷出 <b>7</b>：手牌 ≥8 张者弃一半 → 移动强盗 → 掠夺相邻玩家 1 张资源。</li>
    <li><b>自由发展</b>：交易、建造、买发展卡，最后结束回合。</li>
  </ol>
</section>
<section style="margin-bottom:12px;">
  <h3 style="margin:0 0 6px;font-size:13px;color:#67e8f9;">建造花费</h3>
  <ul style="margin:0;padding-left:18px;line-height:1.6;font-size:12px;color:#e2e8f0;">
    <li>道路：木 + 砖（上限 10 条）</li>
    <li>村庄：木 + 砖 + 粮 + 羊（须与己方路网相连，且距其他村庄 ≥2 边）</li>
    <li>城镇：石×3 + 粮×2（升级自己的村庄）</li>
    <li>发展卡：木 + 石 + 粮</li>
  </ul>
</section>
<section style="margin-bottom:12px;">
  <h3 style="margin:0 0 6px;font-size:13px;color:#67e8f9;">交易与港口</h3>
  <p style="margin:0;line-height:1.55;font-size:12px;color:#e2e8f0;">底栏可与银行 4:1 交易；靠海的港口可 3:1 或 2:1（对应资源）。也可与其他玩家交换资源。</p>
</section>
<section>
  <h3 style="margin:0 0 6px;font-size:13px;color:#67e8f9;">发展卡（右上角可点击打出）</h3>
  <ul style="margin:0;padding-left:18px;line-height:1.6;font-size:12px;color:#e2e8f0;">
    <li><b>骑士</b>：移动强盗并掠夺。</li>
    <li><b>大学</b>：+1 发展分。</li>
    <li><b>资源控制</b>：夺取全场某一资源。</li>
  </ul>
</section>
`;

export interface HowToPlayApi {
  show(): void;
  hide(): void;
  dispose(): void;
}

export function installHowToPlay(): HowToPlayApi {
  document.getElementById(HOWTO_ID)?.remove();

  const overlay = document.createElement('div');
  overlay.id = HOWTO_ID;
  overlay.style.cssText =
    'display:none;position:fixed;inset:0;z-index:10050;pointer-events:auto;' +
    'background:rgba(0,0,0,0.72);align-items:center;justify-content:center;padding:16px;';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) hide();
  });

  const panel = document.createElement('div');
  panel.style.cssText =
    'background:linear-gradient(160deg,#0f172a,#1e293b);border:1px solid rgba(255,255,255,0.12);' +
    'border-radius:12px;max-width:480px;max-height:min(82vh,560px);overflow-y:auto;padding:16px 18px;' +
    'box-shadow:0 20px 50px rgba(0,0,0,0.55);font-family:system-ui,sans-serif;';
  panel.innerHTML = HOWTO_HTML;

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '关闭';
  closeBtn.style.cssText =
    'margin-top:14px;width:100%;padding:8px;border:none;border-radius:8px;' +
    'background:linear-gradient(135deg,#d97706,#b45309);color:#fff;font-weight:700;cursor:pointer;';
  closeBtn.onclick = () => hide();
  panel.appendChild(closeBtn);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  function show(): void {
    overlay.style.display = 'flex';
  }

  function hide(): void {
    overlay.style.display = 'none';
  }

  return { show, hide, dispose: () => overlay.remove() };
}
