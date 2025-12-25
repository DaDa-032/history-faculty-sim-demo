import { clamp, deepClone } from "./state.js";


let CONTENT = null;

const DEFAULT_BASE = {
  turns: {
    randomQuotaByTerm: { "0": 5, "1": 2, "2": 5, "3": 3 },
    timeResetEndTurn: 100,
    recoveryEndOfTerm: {
      "1": { mood: 50, energy: 50 },
      "3": { mood: 50, energy: 50 }
    }
  },
  rules: {
    mustClearRandomBeforeLeavingEventStage: true
  }
};

const DEFAULT_ACTIONS = {
  WRITE_PAPER: { cost: { mood: 10, time: 20, energy: 20 }, draftClicksPerDraft: 3 },
  PREP_CLASS: { cost: { mood: 9, time: 9 }, gain: { mood: 3 } },
  SLACK_OFF: { cost: { time: 10 }, gain: { energy: 10, mood: 5, inspiration: 5 } }
};

async function safeJson(url, fallback){
  try{
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }catch{
    return fallback;
  }
}

function baseCfg(){
  return CONTENT?.base ?? DEFAULT_BASE;
}

function actionCfg(key){
  return (CONTENT?.actions && CONTENT.actions[key]) ? CONTENT.actions[key] : DEFAULT_ACTIONS[key];
}

function timeResetValue(){
  return baseCfg()?.turns?.timeResetEndTurn ?? 100;
}

export async function loadContent(){
  if (CONTENT) return CONTENT;

  const [school, good, mid, bad, randomAll, base, actions, projects, fixedFall, fixedWinter, fixedSpring, fixedSummer] = await Promise.all([
    safeJson("./content/schools/lipu.json", null),
    safeJson("./content/events/random.good.json", []),
    safeJson("./content/events/random.mid.json", []),
    safeJson("./content/events/random.bad.json", []),
    safeJson("./content/events/random/events.json", null),
    safeJson("./content/rules/base.json", DEFAULT_BASE),
    safeJson("./content/actions/actions.json", DEFAULT_ACTIONS),
    safeJson("./content/projects/projects.json", null),

    // Step B: fixed event panels (data-driven UI)
    safeJson("./content/events/fixed/fall.json", null),
    safeJson("./content/events/fixed/winter.json", null),
    safeJson("./content/events/fixed/spring.json", null),
    safeJson("./content/events/fixed/summer.json", null),
  ]);

  CONTENT = {
    schools: school ? { [school.id]: school } : {},
    randomPools: { good, mid, bad },
    randomEvents: (randomAll && Array.isArray(randomAll.events)) ? randomAll.events : null,
    base,
    actions,
    projects,
    fixedPanels: {
      "0": fixedFall,
      "1": fixedWinter,
      "2": fixedSpring,
      "3": fixedSummer
    }
  };
  return CONTENT;
}

export function logPush(state, msg){
  state.log.unshift(`[Y${state.time.year}-${termName(state.time.term)}-${state.time.phase}] ${msg}`);
  state.log = state.log.slice(0, 200);
}

export function d6(){
  return 1 + Math.floor(Math.random()*6);
}

export function fourD6Total(){
  return d6()+d6()+d6()+d6();
}

// skill multipliers: gain +5%/lvl, cost -5%/lvl
export function multForStat(state, statKey, kind){
  const s = state.skills;
  let lv = 1;
  if (statKey === "inspiration") lv = s.talent;
  else if (statKey === "energy") lv = s.diligence;
  else if (statKey === "mood") lv = s.social;
  else if (statKey === "time") lv = s.luck;

  const step = 0.05;
  const gainMult = 1 + (lv - 1) * step;
  const costMult = 1 - (lv - 1) * step;
  const safeCost = Math.max(0.5, costMult);
  return kind === "cost" ? safeCost : gainMult;
}

export function applyDelta(state, statKey, delta){
  const kind = delta < 0 ? "cost" : "gain";
  const m = multForStat(state, statKey, kind);
  const v = state.stats[statKey];
  state.stats[statKey] = clamp(Math.round(v + delta * m), 0, 1000);
}

export function canAfford(state, cost){
  for (const [k,v] of Object.entries(cost)){
    if (state.stats[k] < v) return false;
  }
  return true;
}

export function spend(state, cost){
  for (const [k,v] of Object.entries(cost)){
    applyDelta(state, k, -v);
  }
}

function applyEffectOnce(state, ef){
  const kind = ef.kind ?? "stat";

  if (kind === "stat"){
    const stat = ef.stat;
    const delta = Number(ef.delta ?? 0);
    if (!stat || !Number.isFinite(delta)) return;
    applyDelta(state, stat, delta);
    return;
  }

  if (kind === "result"){
    const key = ef.key;
    const delta = Number(ef.delta ?? 0);
    if (!key || !Number.isFinite(delta)) return;
    state.results[key] = (state.results[key] ?? 0) + delta;
    return;
  }

  if (kind === "counter"){
    const key = ef.key;
    const delta = Number(ef.delta ?? 0);
    if (!key || !Number.isFinite(delta)) return;
    state[key] = (state[key] ?? 0) + delta;
    return;
  }
}

function applyEffects(state, effects, times=1){
  const t = Math.max(1, Number(times) || 1);
  if (!Array.isArray(effects)) return;
  for (let i=0;i<t;i++){
    for (const ef of effects){
      applyEffectOnce(state, ef);
    }
  }
}

function labelStat(k){
  return ({
    mood: "心态",
    energy: "精力",
    time: "时间",
    inspiration: "灵感"
  }[k] ?? k);
}

function effectSummary(beforeStats, afterStats, opts = {}){
  const exclude = new Set(opts.excludeKeys || []);
  const keys = Object.keys(afterStats || {});
  const changes = [];
  for (const k of keys){
    if (exclude.has(k)) continue;
    const b = beforeStats?.[k];
    const a = afterStats?.[k];
    const diff = (Number(a) || 0) - (Number(b) || 0);
    if (diff !== 0) changes.push(`${labelStat(k)}${diff>0?"+":""}${diff}`);
  }
  return changes.length ? `影响：${changes.join("，")}` : "影响：无";
}

function findFixedBlockByActionId(state, actionId){
  const panel = CONTENT?.fixedPanels?.[String(state.time.term)];
  const blocks = Array.isArray(panel?.blocks) ? panel.blocks : [];
  return blocks.find(b => b && b.actionId === actionId) ?? null;
}

export function termName(t){
  return ["第一学期","寒假","第二学期","暑假"][t] ?? `T${t}`;
}

export function quotaForTerm(term){
  const m = baseCfg()?.turns?.randomQuotaByTerm;
  const v = m?.[String(term)];
  if (typeof v === "number") return v;
  if (term===0) return 5;
  if (term===1) return 2;
  if (term===2) return 5;
  return 3;
}

function hasFixedPanelForTerm(termIdx){
  const p = CONTENT?.fixedPanels?.[String(termIdx)];
  return !!(p && Array.isArray(p.blocks) && p.blocks.length > 0);
}

/** luck scheme A: choose good/mid/bad pool by luck */
export function luckPoolProbs(state){
  const luck = state.skills.luck;
  let pGood = 0.15 + 0.10 * (luck - 1);
  let pBad  = 0.55 - 0.08 * (luck - 1);
  pGood = clamp(pGood, 0.05, 0.85);
  pBad  = clamp(pBad,  0.05, 0.85);
  let pMid = 1 - pGood - pBad;
  if (pMid < 0.05){
    const deficit = 0.05 - pMid;
    const takeFromBad = Math.min(deficit, Math.max(0, pBad - 0.05));
    pBad -= takeFromBad;
    const remaining = deficit - takeFromBad;
    const takeFromGood = Math.min(remaining, Math.max(0, pGood - 0.05));
    pGood -= takeFromGood;
    pMid = 0.05;
  }
  const sum = pGood + pMid + pBad;
  return { pGood: pGood/sum, pMid: pMid/sum, pBad: pBad/sum };
}

function ensureRandomSeen(state){
  if (!state.randomSeenRun) state.randomSeenRun = {};
  if (!state.randomSeenTerm) state.randomSeenTerm = {};
}

function countSeen(map, id){
  return Number(map?.[id] ?? 0);
}

function incSeen(map, id){
  map[id] = countSeen(map, id) + 1;
}

function eventAllowedNow(state, ev){
  const y = state.time.year;
  if (typeof ev.minYear === "number" && y < ev.minYear) return false;
  if (typeof ev.maxYear === "number" && y > ev.maxYear) return false;

  if (Array.isArray(ev.termIn) && ev.termIn.length > 0){
    if (!ev.termIn.includes(state.time.term)) return false;
  }

  const id = ev.id;
  const maxRun  = (typeof ev.maxPerRun === "number") ? ev.maxPerRun : Infinity;
  const maxTerm = (typeof ev.maxPerTerm === "number") ? ev.maxPerTerm : Infinity;

  if (countSeen(state.randomSeenRun, id)  >= maxRun) return false;
  if (countSeen(state.randomSeenTerm, id) >= maxTerm) return false;

  return true;
}

// Luck scheme A: positive up, negative down (0..0.30)
function luckBiasFactor(state, ev){
  const tags = Array.isArray(ev.tags) ? ev.tags : [];
  const luck = state.skills.luck;
  const bias = (luck - 1) * 0.06;

  const isPos = tags.includes("positive") || tags.includes("good");
  const isNeg = tags.includes("negative") || tags.includes("bad");

  if (isPos) return 1 + bias;
  if (isNeg) return 1 - bias;
  return 1;
}

function pickWeighted(candidates){
  const total = candidates.reduce((s, c) => s + c.w, 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const c of candidates){
    r -= c.w;
    if (r <= 0) return c.ev;
  }
  return candidates[candidates.length - 1]?.ev ?? null;
}

function pickRandomEventFromUnified(state){
  const list = CONTENT?.randomEvents;
  if (!Array.isArray(list) || list.length === 0) return null;

  ensureRandomSeen(state);

  const candidates = [];
  for (const ev of list){
    if (!ev || !ev.id) continue;
    if (!eventAllowedNow(state, ev)) continue;

    const baseW = (typeof ev.weight === "number") ? ev.weight : 1;
    const w = Math.max(0, baseW * luckBiasFactor(state, ev));
    if (w <= 0) continue;

    candidates.push({ ev, w });
  }
  return pickWeighted(candidates);
}

function normalizeLegacyEffects(legacy){
  if (!Array.isArray(legacy)) return [];
  return legacy
    .filter(e => e && e.stat)
    .map(e => ({ kind: "stat", stat: e.stat, delta: Number(e.delta ?? 0) }));
}

function pickRandomEventFromLegacyPools(state){
  const pools = CONTENT?.randomPools;
  if (!pools) return null;

  const { pGood, pMid } = luckPoolProbs(state);
  const r = Math.random();
  let poolName = "mid";
  if (r < pGood) poolName = "good";
  else if (r < pGood + pMid) poolName = "mid";
  else poolName = "bad";

  const pool = pools[poolName] || [];
  if (!Array.isArray(pool) || pool.length === 0) return null;

  const pick = pool[Math.floor(Math.random()*pool.length)];
  if (!pick) return null;

  const tags = poolName === "good" ? ["positive"] : (poolName === "bad" ? ["negative"] : ["neutral"]);
  return {
    id: `legacy_${poolName}_${Math.floor(Math.random()*1e9)}`,
    title: pick.title || "随机事件",
    text: pick.text || pick.msg || pick.description || "（发生了一些事）",
    tags,
    weight: 1,
    maxPerRun: Infinity,
    maxPerTerm: Infinity,
    effects: normalizeLegacyEffects(pick.effects)
  };
}

export function getViewModel(state){
  return {
    screen: state.screen,
    schoolName: state.schoolId ? state.schoolId : "",
    year: state.time.year,
    term: termName(state.time.term),
    phase: state.time.phase,
    rollTotal: state.rollTotal,
    skillPoints: state.skillPoints,
    stats: deepClone(state.stats),
    skills: deepClone(state.skills),
    results: deepClone(state.results),
    req: deepClone(state.req),
    teachingThisYear: state.teachingThisYear,
    randomQuota: state.randomQuota,
    fixedDone: state.fixedDone,
    pending: deepClone(state.pending ?? {}),
    pendingProjects: deepClone(state.pendingProjects ?? {}),
    selectedPaperId: state.selectedPaperId,
    papers: deepClone(state.papers),

    fixedPanel: deepClone(CONTENT?.fixedPanels?.[String(state.time.term)] ?? null),
    fixedPanels: deepClone(CONTENT?.fixedPanels ?? {}),

    log: [...state.log]
  };
}

export function getAvailableActions(state){
  const a = [];
  const { screen } = state;

  if (screen === "intro"){
    a.push({ id:"START", label:"开始（读博）" });
    return a;
  }

  if (screen === "character"){
    a.push({ id:"CONFIRM_SKILLS", label:"确认并毕业求职", enabled: true });
    return a;
  }

  if (screen === "job"){
    a.push({ id:"CHOOSE_SCHOOL", label:"入职：李普大学" });
    return a;
  }

  if (screen === "main"){
    a.push({ id:"GO_EVENT", label:"进入事件阶段", enabled: state.time.phase==="event" });
    a.push({ id:"GO_ACTION", label:"进入行动阶段", enabled: state.time.phase==="event" });
    a.push({ id:"END_TURN", label:"结束回合", enabled: state.time.phase==="action" });
    a.push({ id:"OPEN_PAPERS", label:"打开 Word（论文）" });
    a.push({ id:"OPEN_REQ", label:"查看考核要求" });
    return a;
  }

  if (screen === "event"){
    const needFixed = hasFixedPanelForTerm(state.time.term);
    const mustClearRandom = state.randomQuota > 0;
    const mustDoFixed = needFixed && !state.fixedDone;

    a.push({ id:"DO_FIXED", label:"执行固定事件面板（在 UI 里点）", enabled:false });

    a.push({
      id:"RANDOM_EVENT",
      label: `触发随机事件（剩余${state.randomQuota}）`,
      enabled: state.randomQuota > 0
    });

    const canLeaveEvent = (!mustClearRandom) && (!mustDoFixed);

    const suffix = [
      mustDoFixed ? "需先处理固定事件" : null,
      mustClearRandom ? "需先触发完随机事件" : null
    ].filter(Boolean).join("；");

    a.push({
      id:"TO_ACTION",
      label: suffix ? `进入行动阶段（${suffix}）` : "进入行动阶段",
      enabled: canLeaveEvent
    });

    a.push({
      id:"BACK_MAIN",
      label: suffix ? `返回主界面（${suffix}）` : "返回主界面",
      enabled: canLeaveEvent
    });

    return a;
  }

  if (screen === "action"){
    a.push({ id:"WRITE_PAPER", label:"写论文（+1写作进度）" });
    a.push({ id:"PREP_CLASS", label:"备课" });
    a.push({ id:"SLACK_OFF", label:"摸鱼" });
    a.push({ id:"BACK_MAIN", label:"返回主界面" });
    return a;
  }

  if (screen === "papers"){
    a.push({ id:"BACK_MAIN", label:"返回主界面" });
    return a;
  }

  if (screen === "requirements"){
    a.push({ id:"BACK_MAIN", label:"返回主界面" });
    return a;
  }

  if (screen === "end"){
    a.push({ id:"RESTART", label:"再来一局" });
    return a;
  }

  return a;
}

/** ======= project system (Step E: data-driven) ======= */
function getProjectsCfg(){
  const p = CONTENT?.projects;
  if (p && Array.isArray(p.projects)) return p;
  return null;
}

function getProjectById(projectId){
  const cfg = getProjectsCfg();
  const list = cfg?.projects ?? [];
  return list.find(x => x && x.id === projectId) ?? null;
}

function ensurePendingProjects(state){
  if (!state.pendingProjects) state.pendingProjects = {};
}

function migrateLegacyPending(state){
  // Backward compatible: mirror legacy pending -> pendingProjects
  ensurePendingProjects(state);
  state.pending = state.pending || {};

  if (state.pending.national && !state.pendingProjects.national_nssfc){
    state.pendingProjects.national_nssfc = { yearApplied: state.pending.national.yearApplied };
  }
  if (state.pending.provincial && !state.pendingProjects.provincial){
    state.pendingProjects.provincial = { yearApplied: state.pending.provincial.yearApplied };
  }
}

function submitProject(state, projectId){
  const proj = getProjectById(projectId);
  if (!proj){
    logPush(state, "项目配置缺失，无法提交。");
    return;
  }

  migrateLegacyPending(state);
  ensurePendingProjects(state);

  // Term gates keep demo rules
  if (projectId === "national_nssfc" && state.time.term !== 1){
    logPush(state, "国家项目只允许在寒假提交。");
    return;
  }
  if (projectId === "provincial" && state.time.term !== 3){
    logPush(state, "省部级项目只允许在暑假提交。");
    return;
  }

  // Already succeeded
  if (proj.tier === "national" && state.results.national >= 1){
    logPush(state, "你已经有国家项目了，本次不再申请。");
    return;
  }
  if (proj.tier === "provincial" && state.results.provincial >= 1){
    logPush(state, "你已经有省部级项目了，本次不再申请。");
    return;
  }

  // Mutual exclusion (keep your current flow)
  if (projectId === "provincial"){
    if (state.pendingProjects.national_nssfc || state.pending?.national){
      logPush(state, "国家项目结果尚未公布，暂时无法改申省部级项目。");
      return;
    }
    if (state.results.national >= 1){
      logPush(state, "你已有国家项目，本次不再申请省部级项目。");
      return;
    }
  }

  // Already pending
  if (state.pendingProjects[projectId]){
    if (projectId === "national_nssfc") logPush(state, "国家项目已提交，等待暑假公布结果。");
    else logPush(state, "省部级项目已提交，等待公布结果。");
    return;
  }

  const before = deepClone(state.stats);

  const submitCost = Array.isArray(proj.submitCost)
    ? proj.submitCost
    : [{ kind:"stat", stat:"time", delta:-5 }, { kind:"stat", stat:"energy", delta:-5 }];

  // affordability for stat costs
  const costObj = {};
  for (const ef of submitCost){
    if ((ef.kind ?? "stat") !== "stat") continue;
    const stat = ef.stat;
    const delta = Number(ef.delta ?? 0);
    if (!stat || !Number.isFinite(delta)) continue;
    if (delta < 0) costObj[stat] = (costObj[stat] ?? 0) + Math.abs(delta);
  }
  if (!canAfford(state, costObj)){
    logPush(state, "状态不足，无法申请该项目。");
    return;
  }

  applyEffects(state, submitCost, 1);

  state.pendingProjects[projectId] = { yearApplied: state.time.year };

  // legacy mirrors (temporary)
  if (projectId === "national_nssfc") state.pending.national = { yearApplied: state.time.year };
  if (projectId === "provincial") state.pending.provincial = { yearApplied: state.time.year };

  if (projectId === "national_nssfc") logPush(state, "国家项目：已提交申请（结果将在暑假公布）。");
  else logPush(state, "省部级项目：已提交申请（结果将于暑假行动阶段公布）。");

  logPush(state, effectSummary(before, state.stats));

  state.fixedDone = true;
  state.fixedChoices = state.fixedChoices || {};
  state.fixedChoices[`apply_${projectId}`] = true;
}

function resolveProjectIfDue(state, projectId, proj){
  const resolveAt = proj?.resolveAt || null;

  const due = (() => {
    if (!resolveAt){
      if (projectId === "national_nssfc") return (state.time.term === 3 && state.time.phase === "event");
      if (projectId === "provincial") return (state.time.term === 3 && state.time.phase === "action");
      return false;
    }
    const termMap = { fall:0, winter:1, spring:2, summer:3 };
    const termIdx = (typeof resolveAt.term === "number") ? resolveAt.term : termMap[String(resolveAt.term)];
    const phase = resolveAt.phase;
    return (state.time.term === termIdx && state.time.phase === phase);
  })();

  if (!due) return;

  const pend = state.pendingProjects?.[projectId];
  if (!pend) return;
  if (pend.yearApplied !== state.time.year) return;

  // prevent double resolve
  pend.resolvedYear = pend.resolvedYear ?? null;
  if (pend.resolvedYear === state.time.year) return;

  const ok = Math.random() < Number(proj?.successRate ?? 0.25);

  if (ok){
    const onSuccess = Array.isArray(proj?.onSuccess)
      ? proj.onSuccess
      : (projectId === "national_nssfc"
        ? [{ kind:"result", key:"national", delta:1 }]
        : [{ kind:"result", key:"provincial", delta:1 }]);
    applyEffects(state, onSuccess, 1);

    if (projectId === "national_nssfc") logPush(state, "国家项目：立项成功（国家项目+1）。");
    else logPush(state, "省部级项目：立项成功（省部级+1）。");
  } else {
    if (projectId === "national_nssfc") logPush(state, "国家项目：未中。");
    else logPush(state, "省部级项目：未中。");
    const onFail = Array.isArray(proj?.onFail) ? proj.onFail : [];
    if (onFail.length) applyEffects(state, onFail, 1);
  }

  pend.resolvedYear = state.time.year;

  // clear pending
  delete state.pendingProjects[projectId];

  // clear legacy mirrors
  if (projectId === "national_nssfc"){
    state.pending.national = null;
    state.pending.nationalResolvedYear = state.time.year;
  }
  if (projectId === "provincial"){
    state.pending.provincial = null;
    state.pending.provincialResolvedYear = state.time.year;
  }
}

export function resolveDueProjects(state){
  migrateLegacyPending(state);

  const cfg = getProjectsCfg();
  if (!cfg){
    resolveProjectIfDue(state, "national_nssfc", { id:"national_nssfc", successRate:0.25 });
    resolveProjectIfDue(state, "provincial", { id:"provincial", successRate:0.25 });
    return;
  }

  for (const proj of (cfg.projects || [])){
    if (!proj || !proj.id) continue;
    if (!state.pendingProjects?.[proj.id]) continue;
    resolveProjectIfDue(state, proj.id, proj);
  }
}

/** ======= hidden tightening events at year end (mutually exclusive) ======= */
function yearEndHiddenTighten(state){
  state.hidden = state.hidden || { lock: null, topTightenCount: 0, nationalTightenDone: false, reformTriggered: false, originalReq: null };
  // 20% chance each year end, max TOP 3 times, NATIONAL 1 time, mutually exclusive with each other per run lock
  const roll = Math.random();
  if (roll > 0.20) return;

  // lock determines which kind is allowed to happen in this run
  if (state.hidden.lock === null){
    // randomly choose which family this run will use
    state.hidden.lock = Math.random() < 0.5 ? "TOP" : "NATIONAL";
  }

  if (state.hidden.lock === "TOP"){
    if (state.hidden.topTightenCount >= 3) return;
    state.hidden.topTightenCount += 1;
    state.req.topExtra += 1; // UI uses req.topExtra>0 => top required ≥1
    logPush(state, "（制度变化）考核口径发生变化。");
    return;
  }

  if (state.hidden.lock === "NATIONAL"){
    if (state.hidden.nationalTightenDone) return;
    state.hidden.nationalTightenDone = true;
    state.req.projectMode = "national";
    logPush(state, "（制度变化）考核口径发生变化。");
    return;
  }
}

/** ======= evaluation ======= */
export function evaluate(state){
  const teachNeed = state.req.teachPerYear;
  const paperNeed = state.req.paperNeed;
  const projectNeed = state.req.projectNeed ?? 1;

  const teachOk = state.teachingThisYear >= teachNeed;
  const paperOk = state.results.qualifiedPapers >= paperNeed;

  const projectCount = state.results.national + state.results.provincial;
  const projectOk = state.req.projectMode === "either"
    ? (projectCount >= projectNeed)
    : (state.results.national >= projectNeed);

  const topOk = state.req.topExtra > 0 ? (state.results.topPapers >= 1) : true;

  // hidden leader condition (not shown)
  const leaderOk = state.results.leader > 20;

  return { teachOk, paperOk, projectOk, topOk, leaderOk };
}

/** ======= hidden reform at end of year 5: quasi-tenure track ======= */
function year5HiddenReform(state){
  // Trigger only once per run, only at the end of year 5
  state.hidden = state.hidden || {};
  if (state.hidden.reformTriggered) return false;
  if (state.time.year !== 5) return false;

  // probability (hidden from player)
  const p = 0.25;
  if (Math.random() >= p) return false;

  state.hidden.reformTriggered = true;

  // Snapshot original requirements once (for correct doubling even if other hidden events changed things)
  if (!state.hidden.originalReq){
    state.hidden.originalReq = {
      maxYear: state.req.maxYear,
      teachPerYear: state.req.teachPerYear,
      paperNeed: state.req.paperNeed,
      projectMode: state.req.projectMode,
      projectNeed: state.req.projectNeed ?? 1
    };
  }

  const o = state.hidden.originalReq;

  // Clear achievements
  state.results = { qualifiedPapers:0, topPapers:0, national:0, provincial:0, leader:0 };
  state.papers = [];
  state.selectedPaperId = null;
  state.teachingThisYear = 0;

  // Keep current personal stats (mood/energy/time/inspiration) as-is; only reset time baseline
  state.stats.time = timeResetValue();

  // Double requirements based on the original baseline
  state.req.teachPerYear = o.teachPerYear * 2;
  state.req.paperNeed = o.paperNeed * 2;
  state.req.projectMode = o.projectMode;
  state.req.projectNeed = (o.projectNeed ?? 1) * 2;

  // Extend timeline: +6 years
  state.req.maxYear = o.maxYear + 6;

  // Inform player (but do not reveal probability)
  logPush(state, "（制度改革）非升即走制度改革，改为准长聘制。聘为准聘助理教授，再战6年。此前成果清零，考核要求提高。" );

  return true;
}

/** ======= main reducer: dispatch ======= */
export async function dispatch(prevState, action){
  await loadContent();
  const state = deepClone(prevState);
  // ===== Step C: Generic fixed-panel handler (data-driven effects) =====
  // Only handle fixed-panel blocks that exist in current term panel.
  // Keep APPLY_NATIONAL / APPLY_PROVINCIAL as special hardcoded flows.
  if (state.screen === "event"
      && action?.id
      && action.id !== "APPLY_NATIONAL"
      && action.id !== "APPLY_PROVINCIAL"
      && action.id !== "PROJECT_SUBMIT"){

    const block = findFixedBlockByActionId(state, action.id);

    // 推荐：你的 fixed JSON 用 actionId: "FP_*"；但这里不强制，只要匹配到 block 就处理
    if (block){
      // optional guard: termIn
      if (Array.isArray(block.guard?.termIn)){
        const ok = block.guard.termIn.includes(state.time.term);
        if (!ok){
          logPush(state, "当前学期不可执行该固定事件。");
          return state;
        }
      }

      // determine times
      let times = 1;
      if (block.kind === "counter"){
        const min = Number.isFinite(+block.min) ? +block.min : 0;
        const max = Number.isFinite(+block.max) ? +block.max : min;
        times = clamp(Number(action.payload?.count), min, max);
      }

      // snapshot stats for effect diff log
      const before = deepClone(state.stats);

      // optional cost (per times by default)
      if (block.cost){
        const mode = block.costMode ?? "per"; // "per" | "once"
        const costTimes = (mode === "once") ? 1 : Math.max(0, Number(times)||0);

        // expand per-times cost
        const finalCost = {};
        for (const [k,v] of Object.entries(block.cost)){
          finalCost[k] = (Number(v)||0) * costTimes;
        }

        if (!canAfford(state, finalCost)){
          logPush(state, "状态不足，无法执行该固定事件。");
          return state;
        }
        spend(state, finalCost);
      }

      // apply effects (per times)
      applyEffects(state, block.effects ?? [], times);

      // mark fixed handled
      state.fixedDone = true;
      state.fixedChoices = state.fixedChoices || {};
      state.fixedChoices[block.id || block.actionId] = times;

      // logging
      const title = block.log || block.title || "固定事件已执行";
      if (block.kind === "counter") logPush(state, `${title}：${times}次。`);
      else logPush(state, `${title}。`);

      const after = state.stats;
      logPush(state, effectSummary(before, after));

      return state;
    }
  }
  // ===== End Step C =====
  switch(action.id){

    case "START": {
      // init character
      state.rollTotal = fourD6Total();
      state.skills = { talent:1, diligence:1, social:1, luck:1 };
      state.skillPoints = Math.max(0, state.rollTotal - 4);
      state.screen = "character";
      logPush(state, `读博阶段开始：技能点总数=${state.rollTotal}，剩余可分配=${state.skillPoints}。`);
      return state;
    }

    case "SET_SKILL": {
      // payload: { key, value }
      const { key, value } = action.payload;
      const v = clamp(Number(value), 1, 6);
      const base = 4; // four skills baseline
      const total = (key==="talent"?v:state.skills.talent)
        + (key==="diligence"?v:state.skills.diligence)
        + (key==="social"?v:state.skills.social)
        + (key==="luck"?v:state.skills.luck);

      const remaining = state.rollTotal - total;
      if (remaining < 0) return state; // UI should prevent
      state.skills[key] = v;
      state.skillPoints = remaining;
      return state;
    }

    case "CONFIRM_SKILLS": {
      // ensure remaining not negative
      if (state.skillPoints < 0) return state;
      state.screen = "job";
      return state;
    }

    case "CHOOSE_SCHOOL": {
      const content = await loadContent();
      const school = content.schools["lipu"];
      state.schoolId = school.id;
      state.req.maxYear = school.tenure.maxYear;
      state.req.teachPerYear = school.tenure.teachPerYear;
      state.req.paperNeed = school.tenure.paperNeed;
      state.req.projectMode = school.tenure.projectMode;
      if (state.req.projectNeed == null) state.req.projectNeed = 1;

      state.time = { year:1, term:0, phase:"event" };
      state.teachingThisYear = 0;
      state.randomQuota = quotaForTerm(0);
      state.randomSeenRun = {};
      state.randomSeenTerm = {};
      state.pendingProjects = {};
      state.fixedDone = false;
      state.fixedChoices = {};
      state.stats.time = timeResetValue();

      state.screen = "main";
      logPush(state, `入职：${school.name}。开始第1年第一学期。`);
      return state;
    }

    case "GO_EVENT": {
      if (state.time.phase !== "event") return state;
      state.screen = "event";
      // resolve national if due at summer event start
      resolveDueProjects(state);
      return state;
    }

    case "GO_ACTION": {
      if (state.time.phase !== "event") return state;

      const needFixed = hasFixedPanelForTerm(state.time.term);
      if (needFixed && !state.fixedDone){
        logPush(state, "请先处理本学期固定事件面板。");
        return state;
      }
      if (state.randomQuota > 0){
        logPush(state, `还有${state.randomQuota}个随机事件未处理，需全部触发后才能进入行动阶段。`);
        return state;
      }

      state.time.phase = "action";
      state.screen = "action";
      resolveDueProjects(state);
      return state;
    }

    case "BACK_MAIN": {
      if (state.screen === "event"){
        const needFixed = hasFixedPanelForTerm(state.time.term);
        if (needFixed && !state.fixedDone){
          logPush(state, "请先处理本学期固定事件面板。");
          return state;
        }
        if (state.randomQuota > 0){
          logPush(state, `还有${state.randomQuota}个随机事件未处理，需全部触发后才能离开事件阶段。`);
          return state;
        }
      }
      state.screen = "main";
      return state;
    }

    case "OPEN_PAPERS": {
      state.screen = "papers";
      return state;
    }

    case "OPEN_REQ": {
      state.screen = "requirements";
      return state;
    }

    case "SELECT_PAPER": {
      const id = action.payload?.paperId ?? null;
      state.selectedPaperId = id;
      return state;
    }

    case "RANDOM_EVENT": {
      if (state.screen !== "event") return state;
      if (state.randomQuota <= 0) return state;

      const unifiedPick = pickRandomEventFromUnified(state);
      const ev = unifiedPick || pickRandomEventFromLegacyPools(state);

      if (!ev){
        // 没有可选事件：消耗一次 quota，避免卡死
        state.randomQuota -= 1;
        logPush(state, "本回合没有可触发的随机事件了。");
        return state;
      }

      // consume quota
      state.randomQuota -= 1;

      const before = deepClone(state.stats);

      const title = ev.title ? `【${ev.title}】` : "【随机事件】";
      const text = ev.text || "（发生了一些事）";
      logPush(state, `${title}${text ? " " + text : ""}`);

      // generic effects: 支持 stat/result/counter
      applyEffects(state, ev.effects ?? [], 1);

      // only show public stats; hidden metrics like leader satisfaction are not shown
      logPush(state, effectSummary(before, state.stats, { excludeKeys: [] }));

      // only track caps for unified events (legacy events id is random)
      if (unifiedPick && ev.id){
        ensureRandomSeen(state);
        incSeen(state.randomSeenRun, ev.id);
        incSeen(state.randomSeenTerm, ev.id);
      }

      state.screen = "event";
      return state;
    }

    case "PROJECT_SUBMIT": {
      if (state.screen !== "event") return state;
      const projectId = action.payload?.projectId;
      if (!projectId){
        logPush(state, "未指定项目类型，无法提交。");
        return state;
      }
      submitProject(state, projectId);
      return state;
    }

    case "APPLY_NATIONAL": {
      // legacy wrapper
      if (state.screen !== "event") return state;
      submitProject(state, "national_nssfc");
      return state;
    }

    case "APPLY_PROVINCIAL": {
      // legacy wrapper
      if (state.screen !== "event") return state;
      submitProject(state, "provincial");
      return state;
    }

    case "TO_ACTION": {
      if (state.screen !== "event") return state;

      const needFixed = hasFixedPanelForTerm(state.time.term);
      if (needFixed && !state.fixedDone){
        logPush(state, "请先处理本学期固定事件面板。");
        return state;
      }
      if (state.randomQuota > 0){
        logPush(state, `还有${state.randomQuota}个随机事件未处理，需全部触发后才能进入行动阶段。`);
        return state;
      }

      state.time.phase = "action";
      state.screen = "action";
      resolveDueProjects(state);
      return state;
    }

    case "WRITE_PAPER": {
      if (state.screen !== "action") return state;
      const cfg = actionCfg("WRITE_PAPER");
      const cost = cfg?.cost ?? { mood:10, time:20, energy:20 };
      if (!canAfford(state, cost)){
        logPush(state, "状态不足，无法写论文。");
        return state;
      }
      spend(state, cost);

      // record draft clicks as a runtime on a pseudo-paper slot
      let current = state.papers[state.papers.length-1];
      if (!current || current.published || current.stage !== "drafting"){
        current = { id:`P${state.papers.length+1}`, stage:"drafting", level:"general", published:false, attemptsThisTurn:0, draftClicks:0 };
        state.papers.push(current);
      }
      current.draftClicks += 1;

      if (current.draftClicks >= (cfg?.draftClicksPerDraft ?? 3)){
        current.stage = "draft";
        current.draftClicks = 0;
        logPush(state, `论文草稿完成：${current.id}（可提升等级/投稿）。`);
      } else {
        logPush(state, `写论文：进度+1（${current.id}）。`);
      }
      return state;
    }

    case "UPGRADE_PAPER": {
      if (!["action","papers"].includes(state.screen)) return state;
      const paperId = action.payload?.paperId ?? state.selectedPaperId;
      const p = paperId ? findPaperById(state, paperId) : null;

      if (!p){
        logPush(state, "请先在 Word（论文）里选择要提升的论文。");
        return state;
      }
      if (p.published || p.stage !== "draft"){
        logPush(state, "所选论文不可提升（需要是未发表且处于草稿 draft 状态）。");
        return state;
      }
      if (!canAfford(state, { inspiration:50 })){
        logPush(state, "灵感不足，无法提升论文。");
        return state;
      }
      spend(state, { inspiration:50 });

      const order = ["general","cssci","first","top"];
      const idx = order.indexOf(p.level);
      p.level = order[Math.min(order.length-1, idx+1)];
      logPush(state, `论文提升：${p.id} → ${levelName(p.level)}。`);
      return state;
    }

    case "SUBMIT_PAPER": {
      if (!["action","papers"].includes(state.screen)) return state;
      const paperId = action.payload?.paperId ?? state.selectedPaperId;
      const p = paperId ? findPaperById(state, paperId) : null;

      if (!p){
        logPush(state, "请先在 Word（论文）里选择要投稿的论文。");
        return state;
      }
      if (p.published || p.stage !== "draft"){
        logPush(state, "所选论文不可投稿（需要是未发表且处于草稿 draft 状态）。");
        return state;
      }
      p.attemptsThisTurn = p.attemptsThisTurn ?? 0;
      if (p.attemptsThisTurn >= 3){
        logPush(state, `${p.id} 本回合投稿次数已用完（最多3次）。`);
        return state;
      }
      p.attemptsThisTurn += 1;

      const roll = d6();
      const social = state.skills.social;
      let ok = false;
      if (social <= 2) ok = (roll === 6);
      else if (social <= 4) ok = (roll >= 5);
      else {
        // social 5-6: allow one extra chance if first roll fails
        if (roll >= 5) ok = true;
        else {
          const roll2 = d6();
          ok = (roll2 >= 5);
        }
      }

      if (!ok){
        logPush(state, `投稿失败：${p.id} 被退稿（尝试 ${p.attemptsThisTurn}/3）。`);
        return state;
      }

      p.published = true;

      // qualified papers: cssci/first/top all count
      if (["cssci","first","top"].includes(p.level)){
        state.results.qualifiedPapers += 1;
      }
      if (p.level === "top"){
        state.results.topPapers += 1;
      }

      logPush(state, `发表成功：${p.id}（${levelName(p.level)}）。`);
      return state;
    }

    case "PREP_CLASS": {
      if (state.screen !== "action") return state;
      const cfg = actionCfg("PREP_CLASS");
      const cost = cfg?.cost ?? { mood:9, time:9 };
      if (!canAfford(state, cost)){
        logPush(state, "状态不足，无法备课。");
        return state;
      }
      spend(state, cost);
      const gain = cfg?.gain ?? { mood:3 };
      for (const [k,v] of Object.entries(gain)) applyDelta(state, k, +v);
      logPush(state, `备课完成：${Object.entries(gain).map(([k,v])=>`${k}+${v}`).join("，")}。`);
      return state;
    }

    case "SLACK_OFF": {
      if (state.screen !== "action") return state;
      const cfg = actionCfg("SLACK_OFF");
      const cost = cfg?.cost ?? { time:10 };
      if (!canAfford(state, cost)){
        logPush(state, "时间不足，无法摸鱼。");
        return state;
      }
      spend(state, cost);
      const gain = cfg?.gain ?? { energy:10, mood:5, inspiration:5 };
      for (const [k,v] of Object.entries(gain)) applyDelta(state, k, +v);
      logPush(state, `摸鱼：短暂回血（${Object.entries(gain).map(([k,v])=>`${k}+${v}`).join("，")}）。`);
      return state;
    }

    case "END_TURN": {
      if (state.screen !== "main") return state;
      if (state.time.phase !== "action") return state;

      // end of term effects
      // after term ends, reset time
      state.stats.time = timeResetValue();

      // reset per-paper attempts this turn
      for (const p of state.papers){
        p.attemptsThisTurn = 0;
      }

      // term transitions & recovery
      if (state.time.term === 1){
        const rec = baseCfg()?.turns?.recoveryEndOfTerm?.["1"];
        const dm = rec?.mood ?? 50;
        const de = rec?.energy ?? 50;
        applyDelta(state, "mood", +dm);
        applyDelta(state, "energy", +de);
        logPush(state, `寒假结束：心态+${dm}，精力+${de}，时间恢复为${timeResetValue()}。`);
      }
      if (state.time.term === 3){
        const rec = baseCfg()?.turns?.recoveryEndOfTerm?.["3"];
        const dm = rec?.mood ?? 50;
        const de = rec?.energy ?? 50;
        applyDelta(state, "mood", +dm);
        applyDelta(state, "energy", +de);
        logPush(state, `暑假结束：心态+${dm}，精力+${de}，时间恢复为${timeResetValue()}。`);
      }

      // advance term
      state.time.term += 1;

      if (state.time.term <= 3){
        // next term start
        state.time.phase = "event";
        state.fixedDone = false;
        state.fixedChoices = {};
        state.randomQuota = quotaForTerm(state.time.term);
        state.randomSeenTerm = {};
        state.screen = "main";
        return state;
      }

      // year end
      // safety: if national pending unresolved, mark failed
      if ((state.pending?.national && state.pending.national.yearApplied === state.time.year)
          || (state.pendingProjects?.national_nssfc && state.pendingProjects.national_nssfc.yearApplied === state.time.year)){
        logPush(state, "国家项目：本年度结果未能按时公布，视为未中。");
        if (state.pending){
          state.pending.national = null;
          state.pending.nationalResolvedYear = state.time.year;
        }
        if (state.pendingProjects){
          delete state.pendingProjects.national_nssfc;
        }
      }

      // hidden reform at end of year 5 (do not disclose probability)
      const reformed = year5HiddenReform(state);

      // hidden tightening event (do not disclose)
      // If reform triggers this year, skip additional tightening to keep rules coherent.
      if (!reformed){
        yearEndHiddenTighten(state);
      }

      // evaluate year: teaching requirement is per year
      const evalRes = evaluate(state);

      // if last year ended, decide game
      if (state.time.year >= state.req.maxYear) {
        state.screen = "end";

        const okAll =
          evalRes.teachOk &&
          evalRes.paperOk &&
          evalRes.projectOk &&
          evalRes.topOk &&
          evalRes.leaderOk;

        if (okAll) {
          logPush(state, "通关：获得长聘教职！");
        } else {
          const reasons = [];

          // 教学
          if (!evalRes.teachOk) {
            reasons.push(`教学未达标：本年度授课 ${state.teachingThisYear}/${state.req.teachPerYear}`);
          }

          // 论文（合格论文= C刊/一流/顶刊）
          if (!evalRes.paperOk) {
            reasons.push(`科研未达标：合格论文 ${state.results.qualifiedPapers}/${state.req.paperNeed}`);
          }

          // 项目
          if (!evalRes.projectOk) {
            if (state.req.projectMode === "either") {
              const got = (state.results.national || 0) + (state.results.provincial || 0);
              const need = state.req.projectNeed ?? 1;
              reasons.push(`项目未达标：国家+省部级合计 ${got}/${need}`);
            } else {
              const need = state.req.projectNeed ?? 1;
              reasons.push(`项目未达标：国家项目 ${state.results.national}/${need}`);
            }
         }

          // 顶刊额外要求（隐藏事件触发后才需要）
          if (!evalRes.topOk) {
            reasons.push(`顶刊要求未达标：顶刊 ${state.results.topPapers}/1`);
          }

          // 领导满意度（隐藏数值，但失败原因要告诉玩家）
          if (!evalRes.leaderOk) {
            reasons.push(`行政未达标：领导满意度 ${state.results.leader}/21（需要 > 20）`);
          }

          logPush(state, "失败：未能通过非升即走考核。");
          if (reasons.length) {
            logPush(state, "失败原因：");
            for (const r of reasons) logPush(state, `- ${r}`);
          }
        }

        return state;
      }

      // new year reset
      state.time.year += 1;
      state.time.term = 0;
      state.time.phase = "event";
      state.fixedDone = false;
      state.fixedChoices = {};
      state.teachingThisYear = 0;
      state.randomQuota = quotaForTerm(0);
      state.randomSeenTerm = {};
      state.stats.time = timeResetValue();

      logPush(state, `进入第${state.time.year}年·第一学期。`);
      state.screen = "main";
      return state;
    }

    case "RESTART": {
      const { createInitialState } = await import("./state.js");
      return createInitialState();
    }

    default:
      return state;
  }
}

function findPaperById(state, id){
  return state.papers.find(p => p.id === id);
}

export function levelName(level){
  if (level==="general") return "普刊";
  if (level==="cssci") return "C刊";
  if (level==="first") return "一流";
  if (level==="top") return "顶刊";
  return level;
}