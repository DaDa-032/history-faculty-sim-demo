import { createInitialState } from "../core/state.js";
import { loadContent, dispatch, getViewModel, levelName } from "../core/engine.js";

let state = createInitialState();
const app = document.getElementById("app");

function h(str){ return str; }
function phaseLabel(phase){
  return ({ event: "事件阶段", action: "行动阶段" }[phase] ?? phase);
}
function findLastLine(lines, startsWith){
  for (let i = lines.length - 1; i >= 0; i--){
    const s = String(lines[i] ?? "");
    if (s.startsWith(startsWith)) return s;
  }
  return "";
}

function extractRunSummaryLines(lines){
  const out = [];
  const idx = lines.findIndex(x => String(x).includes("=== 聘期总结 ==="));
  if (idx < 0) return out;
  for (let i = idx + 1; i < lines.length; i++){
    const s = String(lines[i] ?? "");
    if (!s) continue;
    out.push(s);
  }
  return out;
}

function renderYearSummaryPanel(vm){
  const lines = Array.isArray(vm.log) ? vm.log : [];
  const last = findLastLine(lines, "年度总结：");
  if (!last) return "";
  return `
    <div class="panel">
      <div class="muted">年终总结</div>
      <div class="hr"></div>
      <div>${highlightLogLine(last)}</div>
    </div>
  `;
}

function renderRunSummaryPanel(vm){
  const lines = Array.isArray(vm.log) ? vm.log : [];
  const run = extractRunSummaryLines(lines);
  if (!run.length) return "";
  return `
    <div class="panel">
      <div class="muted">聘期总结</div>
      <div class="hr"></div>
      <div class="log">${run.map(x => `<div>${highlightLogLine(x)}</div>`).join("")}</div>
    </div>
  `;
}

function buildPendingLines(vm){
  const pend = vm.pendingProjects ?? vm.pending ?? {};
  const parts = [];

  // New IDs
  if (pend.national_nssfc) parts.push("国家项目：等待暑假公布");
  if (pend.provincial) parts.push("省部级项目：等待暑假行动阶段公布");

  // Legacy keys
  if (pend.national) parts.push("国家项目：等待暑假公布");

  return Array.from(new Set(parts));
}

function renderPending(vm, { muted = true } = {}){
  const lines = buildPendingLines(vm);
  if (lines.length === 0) return "";
  return `<div ${muted ? 'class="muted"' : ""} style="margin-top:6px">${lines.join("；")}</div>`;
}

function statGrid(vm){
  const s = vm.stats;
  return `
    <div class="stats">
      <div class="stat"><span class="muted">心态</span><b>${s.mood}</b></div>
      <div class="stat"><span class="muted">精力</span><b>${s.energy}</b></div>
      <div class="stat"><span class="muted">时间</span><b>${s.time}</b></div>
      <div class="stat"><span class="muted">灵感</span><b>${s.inspiration}</b></div>
    </div>
  `;
}

function progressGrid(vm){
  const r = vm.results;
  return `
    <div class="panel">
      <div class="twoCol">
        <div>
          <div class="sectionTitle">成果</div>
          <div class="hr"></div>
          <div>论文(≥C刊)：<b>${r.qualifiedPapers}</b></div>
          <div>顶刊：<b>${r.topPapers}</b></div>
          <div>国家项目：<b>${r.national}</b>；省部级：<b>${r.provincial}</b></div>
          ${vm.req.topExtra>0 ? `<div><span class="tag">顶刊要求已触发</span></div>` : ``}
          ${renderPending(vm, { muted:false })}
        </div>
        <div>
          <div class="sectionTitle">回合</div>
          <div class="hr"></div>
          <div>第 <b>${vm.year}</b> 年 · <b>${vm.term}</b></div>
          <div>阶段：<b>${phaseLabel(vm.phase)}</b></div>
          <div>随机事件剩余：<b>${vm.randomQuota}</b></div>
          <div>本学年授课数：<b>${vm.teachingThisYear}</b></div>
        </div>
      </div>
    </div>
  `;
}

function highlightLogLine(line){
  // 轻量 markup：只做关键词包裹，不改业务逻辑
  return String(line)
    .replaceAll("失败", `<span class="kw kw-fail">失败</span>`)
    .replaceAll("成功", `<span class="kw kw-success">成功</span>`)
    .replaceAll("论文", `<span class="kw kw-paper">论文</span>`)
    .replaceAll("项目", `<span class="kw kw-project">项目</span>`);
}

function renderLog(vm){
  const lines = Array.isArray(vm.log) ? vm.log : [];
  return `<div class="log">${
    lines.map(x => `<div>${highlightLogLine(x)}</div>`).join("")
  }</div>`;
}

function renderIntro(vm){
  return h(`
    <h1>非升即走：青年教师 Demo</h1>
    <div class="muted">玩法：回合制资源管理。先读博分配技能，再入职 6 年冲刺长聘。</div>

    <div class="panel">
      <h2>规则（首次说明）</h2>
      <ul>
        <li>时间期限：6 年；每年 4 回合（第一学期/寒假/第二学期/暑假）；每回合分事件阶段与行动阶段。</li>
        <li>非升即走：每学年授课 ≥ 2 门；累计论文(≥C刊) ≥ 6；项目：省部级或国家项目 ≥ 1。</li>
        <li>技能：天赋/勤奋/社交/运气（1–6）。技能越高：消耗 -5%，收益 +5%。</li>
        <li>随机事件：每回合有次数上限；运气越高越容易遇到正面随机事件。</li>
        <li>项目：寒假申请国家项目→暑假公布；暑假申请省部级→暑假行动阶段公布。</li>
      </ul>
      <div class="btns">
        <button id="btnStart">开始（读博）</button>
      </div>
    </div>
  `);
}

function renderCharacter(vm){
  const s = vm.skills;
  return h(`
    <h2>读博阶段：分配技能点</h2>
    <div class="muted">系统掷骰得到技能点总数：<b>${vm.rollTotal}</b>。四项技能默认各 1，剩余可分配：<b>${vm.skillPoints}</b>。</div>

    <div class="panel">
      <table class="table">
        <thead><tr><th>技能</th><th>当前</th><th>设置为</th></tr></thead>
        <tbody>
          ${skillRow("talent","天赋", s.talent, vm)}
          ${skillRow("diligence","勤奋", s.diligence, vm)}
          ${skillRow("social","社交", s.social, vm)}
          ${skillRow("luck","运气", s.luck, vm)}
        </tbody>
      </table>
      <div class="muted">提示：调整数字后会自动校验剩余点数，不能超出总点数。</div>
      <div class="btns">
        <button id="btnConfirmSkills" ${vm.skillPoints<0 ? "disabled":""}>确认并毕业求职</button>
      </div>
    </div>

    ${statGrid(vm)}
    ${renderLog(vm)}
  `);
}

function skillRow(key, label, value, vm){
  return `
    <tr>
      <td>${label}</td>
      <td><b>${value}</b></td>
      <td>
        <input type="number" min="1" max="6" value="${value}" data-skill="${key}" />
      </td>
    </tr>
  `;
}

function renderJob(vm){
  return h(`
    <h2>毕业求职</h2>
    <div class="panel">
      <h3>李普大学·非升即走</h3>
      <ul>
        <li>教学：每学年授课 ≥ 2 门</li>
        <li>科研：论文(≥C刊) ≥ 6</li>
        <li>项目：省部级或国家项目 ≥ 1</li>
        <li>期限：6 年</li>
      </ul>
      <div class="btns">
        <button id="btnChooseSchool">入职李普大学</button>
      </div>
    </div>
    ${renderLog(vm)}
  `);
}

function renderMain(vm){
  const needFixed = !!(vm.fixedPanel && Array.isArray(vm.fixedPanel.blocks) && vm.fixedPanel.blocks.length > 0);
  const canGoAction = (vm.phase === "event") && (vm.randomQuota <= 0) && (!needFixed || vm.fixedDone);

  return h(`
    <h2>办公系统</h2>
    <div class="muted">第${vm.year}年·${vm.term}｜阶段：${phaseLabel(vm.phase)}</div>

    ${statGrid(vm)}
    ${progressGrid(vm)}
    ${renderYearSummaryPanel(vm)}

    <div class="panel">
      <div class="muted">菜单</div>
      <div class="btns">
        <button id="btnGoEvent" ${vm.phase!=="event" ? "disabled":""}>进入事件阶段</button>
        <button id="btnGoAction" ${canGoAction ? "" : "disabled"}>进入行动阶段</button>
        <button id="btnEndTurn" ${vm.phase!=="action" ? "disabled":""}>结束回合</button>
        <button id="btnPapers">论文</button>
        <button id="btnReq">考核要求</button>
      </div>
      <div class="muted" style="margin-top:6px">
        先完成事件阶段，再进入行动阶段；进入行动阶段后不能返回事件阶段。完成后才能结束回合。
        ${vm.phase==="event" && (!canGoAction) ? `<br/>提示：${needFixed && !vm.fixedDone ? "需先处理固定事件；" : ""}${vm.randomQuota>0 ? `需先触发完随机事件（剩余 <b>${vm.randomQuota}</b>）。` : ""}` : ``}
      </div>
    </div>

    ${renderLog(vm)}
  `);
}

function renderFixedPanel(vm){
  const p = vm.fixedPanel;
  if (!p){
    return `<div class="muted">（未找到固定事件面板配置：请创建 content/events/fixed/*.json）</div>`;
  }

  const blocks = Array.isArray(p.blocks) ? p.blocks : [];
  if (blocks.length === 0){
    return `<div class="muted">（固定事件面板为空）</div>`;
  }

  const blockHtml = blocks.map((b)=>{
    const title = b.title ?? b.id ?? "固定事件";
    const desc = b.desc ?? "";
    if (b.kind === "counter"){
      const min = Number.isFinite(+b.min) ? +b.min : 0;
      const max = Number.isFinite(+b.max) ? +b.max : min;
      const nums = [];
      for (let n=min; n<=max; n++) nums.push(n);
      return `
        <div>
          <div><b>${title}</b></div>
          ${desc ? `<div class="muted">${desc}</div>` : ``}
          <div class="btns">
            ${nums.map(n=>`<button class="fixedCounter" data-action="${b.actionId}" data-n="${n}">${title} ${n}</button>`).join("")}
          </div>
        </div>
      `;
    }

    if (b.kind === "button"){
      const label = b.label ?? "执行";
      return `
        <div>
          <div><b>${title}</b></div>
          ${desc ? `<div class="muted">${desc}</div>` : ``}
          <div class="btns">
            <button class="fixedButton" data-action="${b.actionId}" ${b.payload ? `data-payload='${encodeURIComponent(JSON.stringify(b.payload))}'` : ""}>${label}</button>
          </div>
        </div>
      `;
    }

    return `
      <div>
        <div><b>${title}</b></div>
        <div class="muted">（未知 block.kind：${String(b.kind)}）</div>
      </div>
    `;
  }).join(`<div class="hr"></div>`);

  const title = p.title ? `<div class="muted">${p.title}</div><div class="hr"></div>` : ``;
  return `${title}${blockHtml}`;
}

function renderEvent(vm){
  const needFixed = !!(vm.fixedPanel && Array.isArray(vm.fixedPanel.blocks) && vm.fixedPanel.blocks.length > 0);
  const canLeaveEvent = (vm.randomQuota <= 0) && (!needFixed || vm.fixedDone);

  return h(`
    <h2>事件阶段：第${vm.year}年·${vm.term}</h2>
    ${statGrid(vm)}
    ${progressGrid(vm)}
    ${renderYearSummaryPanel(vm)}

    <div class="panel">
      <div class="muted">固定事件</div>
      <div class="hr"></div>

      ${renderFixedPanel(vm)}
      ${renderPending(vm)}

      <div class="hr"></div>
      <div class="btns">
        <button id="btnRandom" ${vm.randomQuota<=0 ? "disabled":""}>触发随机事件（剩余 ${vm.randomQuota}）</button>
        <button id="btnToAction" ${canLeaveEvent ? "" : "disabled"}>进入行动阶段</button>
        <button id="btnBackMain" ${canLeaveEvent ? "" : "disabled"}>返回主界面</button>
      </div>
      ${(!canLeaveEvent) ? `<div class="muted" style="margin-top:6px">规则：${needFixed && !vm.fixedDone ? "需先处理固定事件；" : ""}${vm.randomQuota>0 ? `需先触发完随机事件（剩余 <b>${vm.randomQuota}</b>）。` : ""}</div>` : ``}
    </div>

    ${renderLog(vm)}
  `);
}

function renderAction(vm){
  return h(`
    <h2>行动阶段：第${vm.year}年·${vm.term}</h2>
    ${statGrid(vm)}
    ${progressGrid(vm)}

    <div class="panel">
      ${renderPending(vm)}
      <div class="muted">行动（可重复点击）</div>
      <div class="hr"></div>
      <div class="btns">
        <button id="btnWrite">写论文</button>
        <button id="btnPrep">备课</button>
        <button id="btnSlack">摸鱼</button>
        <button id="btnBackMain2">返回主界面</button>
      </div>
      <div class="muted" style="margin-top:6px">提示：写论文累计3次生成草稿；提升消耗灵感；每篇每回合投稿最多3次。</div>
    </div>

    ${renderLog(vm)}
  `);
}

function renderPapers(vm){
  const selectable = vm.papers
    .filter(p => !p.published && (p.stage === "draft" || p.stage === "草稿"))
    .slice()
    .reverse();

  const selected = vm.selectedPaperId ?? (selectable[0]?.id ?? "");

  const rows = vm.papers.slice().reverse().map(p=>{
    return `<tr>
      <td>${p.id}</td>
      <td>${p.stage === "draft" ? "草稿" : (p.stage === "submitted" ? "已投稿" : p.stage)}</td>
      <td>${levelName(p.level)}</td>
      <td>${p.published ? "是" : "否"}</td>
      <td>${p.attemptsThisTurn ?? 0}</td>
    </tr>`;
  }).join("");

  return h(`
    <h2>Word（论文列表）</h2>
    <div class="panel">
      <div class="muted">选择操作对象（仅显示“未发表且处于草稿状态”的论文）</div>
      <div style="margin-top:6px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        <select id="paperSelect" style="padding:8px;border:1px solid #d0d5dd;border-radius:8px;min-width:220px;">
          ${selectable.length===0
            ? `<option value="">（暂无可操作草稿）</option>`
            : selectable.map(p => `<option value="${p.id}" ${p.id===selected ? "selected": ""}>${p.id} · ${levelName(p.level)}</option>`).join("")
          }
        </select>
        <span class="muted">当前选择：<b>${selected || "无"}</b></span>
      </div>
      <div class="hr"></div>
      <table class="table">
        <thead><tr><th>ID</th><th>阶段</th><th>等级</th><th>已发表</th><th>本回合投稿次数</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5" class="muted">暂无论文</td></tr>`}</tbody>
      </table>
      <div class="btns">
        <button id="btnPaperUpgrade">提升所选草稿</button>
        <button id="btnPaperSubmit">投稿所选草稿</button>
        <button id="btnBackMain3">返回主界面</button>
      </div>
      <div class="muted" style="margin-top:6px">提示：需要先写论文 3 次生成草稿；每篇论文每回合最多投稿 3 次。</div>
    </div>
    ${renderLog(vm)}
  `);
}

function renderRequirements(vm){
  const r = vm.req;
  const showTop = r.topExtra > 0;
  return h(`
    <h2>考核要求</h2>
    <div class="panel">
      <ul>
        <li>期限：${r.maxYear} 年</li>
        <li>教学：每学年授课 ≥ ${r.teachPerYear}（当前 ${vm.teachingThisYear}）</li>
        <li>科研：论文(≥C刊) ≥ ${r.paperNeed}（当前 ${vm.results.qualifiedPapers}）</li>
        <li>项目：${r.projectMode==="either" ? `省部级或国家项目 ≥ ${r.projectNeed ?? 1}` : `必须国家项目 ≥ ${r.projectNeed ?? 1}`}（当前 国${vm.results.national}/省${vm.results.provincial}）</li>
        ${showTop ? `<li>顶刊要求：≥1（当前 ${vm.results.topPapers}）</li>` : ``}
      </ul>
      <div class="btns">
        <button id="btnBackMain4">返回主界面</button>
      </div>
      <div class="muted">注：部分制度变化可能在运行中发生。</div>
    </div>
    ${renderLog(vm)}
  `);
}

function renderEnd(vm){
  return h(`
    <h2>结局</h2>

    ${renderRunSummaryPanel(vm)}

    <div class="panel">
      <div class="muted">你可以在下方日志中查看完整过程。</div>
      <div class="btns">
        <button id="btnRestart">再来一局</button>
      </div>
    </div>

    ${renderLog(vm)}
  `);
}

function render(){
  const vm = getViewModel(state);

  // UI skin hook: OA (Notion + 压迫感)
  // Allows CSS to style by screen/phase without changing game logic.
  const screenClass = (vm.screen === "end") ? "main" : vm.screen;
  app.className = `oa skin-notion phase-${vm.phase} screen-${screenClass}`;

  let html = "";
  if (vm.screen === "intro") html = renderIntro(vm);
  else if (vm.screen === "character") html = renderCharacter(vm);
  else if (vm.screen === "job") html = renderJob(vm);
  else if (vm.screen === "main") html = renderMain(vm);
  else if (vm.screen === "event") html = renderEvent(vm);
  else if (vm.screen === "action") html = renderAction(vm);
  else if (vm.screen === "papers") html = renderPapers(vm);
  else if (vm.screen === "requirements") html = renderRequirements(vm);
  else if (vm.screen === "end") html = renderEnd(vm);
  else html = `<div>Unknown screen: ${vm.screen}</div>`;

  app.innerHTML = html;
  bind(vm);
}

async function act(action){
  state = await dispatch(state, action);
  render();
}

function bind(vm){
  // Intro
  const btnStart = document.getElementById("btnStart");
  if (btnStart) btnStart.onclick = () => act({id:"START"});

  // Character: skill inputs
  document.querySelectorAll("input[data-skill]").forEach(inp=>{
    inp.addEventListener("change", async (e)=>{
      const key = e.target.dataset.skill;
      const value = e.target.value;
      // optimistic: ask engine to set, then rerender
      await act({ id:"SET_SKILL", payload:{ key, value }});
    });
  });
  const btnConfirm = document.getElementById("btnConfirmSkills");
  if (btnConfirm) btnConfirm.onclick = () => act({id:"CONFIRM_SKILLS"});

  // Job
  const btnChoose = document.getElementById("btnChooseSchool");
  if (btnChoose) btnChoose.onclick = () => act({id:"CHOOSE_SCHOOL"});

  // Main
  const btnGoEvent = document.getElementById("btnGoEvent");
  if (btnGoEvent) btnGoEvent.onclick = () => act({id:"GO_EVENT"});
  const btnGoAction = document.getElementById("btnGoAction");
  if (btnGoAction) btnGoAction.onclick = () => act({id:"GO_ACTION"});
  const btnEndTurn = document.getElementById("btnEndTurn");
  if (btnEndTurn) btnEndTurn.onclick = () => act({id:"END_TURN"});
  const btnPapers = document.getElementById("btnPapers");
  if (btnPapers) btnPapers.onclick = () => act({id:"OPEN_PAPERS"});
  const btnReq = document.getElementById("btnReq");
  if (btnReq) btnReq.onclick = () => act({id:"OPEN_REQ"});

  // Event
  const btnBack = document.getElementById("btnBackMain");
  if (btnBack) btnBack.onclick = () => act({id:"BACK_MAIN"});
  const btnRandom = document.getElementById("btnRandom");
  if (btnRandom) btnRandom.onclick = () => act({id:"RANDOM_EVENT"});
  const btnToAction = document.getElementById("btnToAction");
  if (btnToAction) btnToAction.onclick = () => act({id:"TO_ACTION"});


  // Fixed panel (data-driven)
  document.querySelectorAll(".fixedCounter").forEach(b=>{
    b.addEventListener("click", ()=>{
      const actionId = b.dataset.action;
      const n = b.dataset.n;
      if (!actionId) return;
      act({ id: actionId, payload: { count: n } });
    });
  });

  document.querySelectorAll(".fixedButton").forEach(b=>{
    b.addEventListener("click", ()=>{
      const actionId = b.dataset.action;
      if (!actionId) return;
      let payload = undefined;
      if (b.dataset.payload){
        try{
          payload = JSON.parse(decodeURIComponent(b.dataset.payload));
        } catch (e){
          payload = undefined;
        }
      }
      act({ id: actionId, payload });
    });
  });

  // Action
  const btnWrite = document.getElementById("btnWrite");
  if (btnWrite) btnWrite.onclick = () => act({id:"WRITE_PAPER"});
  const btnPrep = document.getElementById("btnPrep");
  if (btnPrep) btnPrep.onclick = () => act({id:"PREP_CLASS"});
  const btnSlack = document.getElementById("btnSlack");
  if (btnSlack) btnSlack.onclick = () => act({id:"SLACK_OFF"});
  const btnBackMain2 = document.getElementById("btnBackMain2");
  if (btnBackMain2) btnBackMain2.onclick = () => act({id:"BACK_MAIN"});

  // Papers
  const btnBackMain3 = document.getElementById("btnBackMain3");
  if (btnBackMain3) btnBackMain3.onclick = () => act({id:"BACK_MAIN"});

  const getSelectedPaperId = () => {
    const sel = document.getElementById("paperSelect");
    return sel ? (sel.value || null) : null;
  };

  const paperSelect = document.getElementById("paperSelect");
  if (paperSelect){
    paperSelect.addEventListener("change", (e)=>{
      act({ id:"SELECT_PAPER", payload:{ paperId: e.target.value || null }});
    });
  }

  const btnPaperUpgrade = document.getElementById("btnPaperUpgrade");
  if (btnPaperUpgrade) btnPaperUpgrade.onclick = () => act({id:"UPGRADE_PAPER", payload:{ paperId: getSelectedPaperId() }});
  const btnPaperSubmit = document.getElementById("btnPaperSubmit");
  if (btnPaperSubmit) btnPaperSubmit.onclick = () => act({id:"SUBMIT_PAPER", payload:{ paperId: getSelectedPaperId() }});

  // Req
  const btnBackMain4 = document.getElementById("btnBackMain4");
  if (btnBackMain4) btnBackMain4.onclick = () => act({id:"BACK_MAIN"});

  // End
  const btnRestart = document.getElementById("btnRestart");
  if (btnRestart) btnRestart.onclick = () => act({id:"RESTART"});
}

// boot
(async function main(){
  await loadContent();
  render();
})();
