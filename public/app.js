const DEFAULT_SETTINGS = {
  minScore: 72,
  maxTurnover: 28,
  maxHighOpen: 7,
  dipBuy: 3,
  tRiseSell: 4,
  stopLoss: 4,
  style: "balanced",
  onlyGoodTemper: true
};

const state = {
  selected: null,
  indices: [],
  sectors: [],
  limitUp: [],
  movers: [],
  activeStocks: [],
  fundFlow: [],
  sectorFlowLines: [],
  sectorFlowPeriod: "day",
  predictionHistory: null,
  highOpenHistory: null,
  kline: [],
  klinePeriod: "day",
  chan: null,
  fundFlowType: "sector",
  sectorType: "industry",
  sectorPanelCollapsed: localStorage.getItem("stock-sector-panel-collapsed") === "1",
  collapsedPanels: JSON.parse(localStorage.getItem("stock-collapsible-panels") || "{}"),
  marketBias: JSON.parse(localStorage.getItem("stock-market-bias") || '{"text":"","themes":[],"tone":0}'),
  highOpenFilter: JSON.parse(localStorage.getItem("stock-high-open-filter") || '{"minPrice":"","maxPrice":""}'),
  settings: {
    ...DEFAULT_SETTINGS,
    ...JSON.parse(localStorage.getItem("stock-settings") || "{}")
  },
  watch: JSON.parse(localStorage.getItem("stock-watch") || '["300059","600030","002167"]'),
  expertTrades: JSON.parse(localStorage.getItem("stock-expert-trades") || "[]")
};

const $ = (selector) => document.querySelector(selector);
const fmt = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const CHART_COLORS = ["#d93025", "#2368c4", "#16834a", "#b46a00", "#7c3aed", "#0891b2", "#dc2626", "#475569", "#ea580c", "#0f766e", "#be185d", "#4f46e5"];
const REALTIME_REFRESH_MS = 15000;
const KLINE_REFRESH_MS = 60000;
const HIGH_OPEN_AUTO_SAVE_KEY = "stock-high-open-close30-auto-save";
const HIGH_OPEN_HISTORY_BACKUP_KEY = "stock-high-open-history-backup";
const COLLAPSIBLE_PANELS_KEY = "stock-collapsible-panels";
let realtimeRefreshTimer = null;
let isRefreshing = false;
let lastKlineRefreshAt = 0;
const DOUYIN_MARKET_NOTE = "06月22日午盘：科技线集体失血，下午还能修复吗？涉及5G、半导体、机器人、CPO、通信设备、人工智能、算力。资金流向显示科技线午盘承压，下午只看回流修复和强承接，不盲目追高。";
const DEFAULT_EXPERT_TRADES = [
  {
    id: "builtin-low-absorb-000725",
    builtin: true,
    expert: "回流低吸型参考",
    returnRate: 38.6,
    wins: 7,
    samples: 10,
    drawdown: 8.5,
    code: "000725",
    stock: "京东方Ａ",
    action: "低吸观察",
    price: 7.79,
    position: "1-2成观察仓",
    reason: "样例逻辑：高成交额、盘中急拉后回落仍有承接，适合观察次日是否弱转强；需到同花顺公开组合/问财核验真实来源。",
    createdAt: "内置参考样例"
  },
  {
    id: "builtin-trend-002202",
    builtin: true,
    expert: "趋势加速型参考",
    returnRate: 45.2,
    wins: 8,
    samples: 12,
    drawdown: 10.2,
    code: "002202",
    stock: "金风科技",
    action: "突破观察",
    price: 23.33,
    position: "突破确认后轻仓",
    reason: "样例逻辑：放量突破前高附近，跟踪竞价强度和板块资金；不追高，开盘过强且量价背离则放弃。",
    createdAt: "内置参考样例"
  },
  {
    id: "builtin-momentum-300666",
    builtin: true,
    expert: "强势动量型参考",
    returnRate: 52.8,
    wins: 6,
    samples: 8,
    drawdown: 13.4,
    code: "300666",
    stock: "江丰电子",
    action: "冲高验证",
    price: 354.78,
    position: "只做小仓试错",
    reason: "样例逻辑：前日未涨停但强势收盘，次日只看盘中是否能冲高5%以上并继续放量；冲高无承接则不跟。",
    createdAt: "内置参考样例"
  },
  {
    id: "builtin-risk-600522",
    builtin: true,
    expert: "风控反抽型参考",
    returnRate: 31.4,
    wins: 5,
    samples: 9,
    drawdown: 6.8,
    code: "600522",
    stock: "中天科技",
    action: "反抽观察",
    price: 61.29,
    position: "只等放量收复关键位",
    reason: "样例逻辑：大跌后不能直接抄底，优先看反抽能否收回关键均线和分时均价；弱反抽不参与。",
    createdAt: "内置参考样例"
  }
];

function money(value) {
  if (value === undefined || value === null || value === "-") return "--";
  const num = Number(value);
  if (Number.isNaN(num)) return "--";
  if (Math.abs(num) >= 100000000) return `${fmt.format(num / 100000000)}亿`;
  if (Math.abs(num) >= 10000) return `${fmt.format(num / 10000)}万`;
  return fmt.format(num);
}

function pct(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return "--";
  return `${num > 0 ? "+" : ""}${fmt.format(num)}%`;
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function timeLabel(value) {
  const text = String(value || "").padStart(6, "0");
  return `${text.slice(0, 2)}:${text.slice(2, 4)}:${text.slice(4, 6)}`;
}

function chinaClockParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23"
  }).formatToParts(now).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0)
  };
}

function highOpenWindowInfo(now = new Date()) {
  const clock = chinaClockParts(now);
  const minutes = clock.hour * 60 + clock.minute;
  const isTradingDay = !["Sat", "Sun"].includes(clock.weekday);
  const start = 14 * 60 + 30;
  const end = 15 * 60;
  const inWindow = isTradingDay && minutes >= start && minutes <= end;
  let label = "非尾盘窗口：当前只做预览，正式样本在交易日 14:30-15:00 记录。";
  if (!isTradingDay) label = "非交易日：当前只做预览，不计入正式尾盘样本。";
  else if (minutes < start) label = "等待尾盘窗口：14:30-15:00 自动给出并记录正式预测样本。";
  else if (minutes > end) label = "尾盘窗口已过：当前记录会标为预览样本，正式样本请在 14:30-15:00 保存。";
  else label = "正在尾盘预测窗口：当前记录将作为正式尾盘样本，用于后续优化模型。";
  return {
    ...clock,
    inWindow,
    sampleType: inWindow ? "close30" : "preview",
    modelVersion: inWindow ? "high-rush-close30-v3" : "high-rush-preview-v3",
    label
  };
}

function tone(value) {
  const num = Number(value);
  if (num > 0) return "red";
  if (num < 0) return "green";
  return "";
}

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(data?.error || "数据读取失败");
  }
  return data;
}

async function safeApi(path, fallback = []) {
  try {
    return await api(path);
  } catch (error) {
    console.warn(`接口读取失败：${path}`, error);
    return fallback;
  }
}

function thsInputs() {
  const rank = Number($("#thsRank").value || 0);
  const fund = Number($("#thsFund").value || 0);
  const theme = Number($("#thsTheme").value || 0);
  let score = theme;
  if (rank > 0 && rank <= 30) score += 8;
  else if (rank > 30 && rank <= 100) score += 5;
  else if (rank > 100 && rank <= 300) score += 2;
  else if (rank > 500) score -= 3;
  if (fund > 10000) score += 7;
  else if (fund > 3000) score += 4;
  else if (fund < -3000) score -= 5;
  return { rank, fund, theme, score };
}

function limitCandidateScore(item) {
  const sealRatio = item.floatMarketCap ? item.sealFund / item.floatMarketCap : 0;
  let score = 48;
  score += Math.min(22, (item.boardCount || 0) * 6);
  score += item.brokenCount === 0 ? 12 : Math.max(-12, 8 - item.brokenCount * 3);
  score += Math.min(12, sealRatio * 1200);
  score += item.turnover < 4 ? 5 : item.turnover < 12 ? 3 : -4;
  if ((item.firstLimitTime || 999999) <= 93030) score += 8;
  if ((item.firstLimitTime || 999999) >= 130000) score -= 6;
  if (["小金属", "工业金属", "化学原料", "农化制品", "证券Ⅱ", "通信设备"].includes(item.industry)) score += 4;
  return Math.max(0, Math.min(99, Math.round(score)));
}

function sectorHeatBonus(name = "", code = "") {
  const text = `${name} ${code}`;
  const hotNames = state.sectors.slice(0, 12).map((item) => item.name);
  if (hotNames.some((hot) => text.includes(hot.replace(/[ⅠⅡⅢ]/g, "")) || hot.includes(name))) return 8;
  if (/钨|钼|锌|锗|钽|小金属|有色|磷|氟|化工|证券|金融|通信|电子|机器人|电网/.test(text)) return 6;
  return 0;
}

function marketBiasBonus(item) {
  const bias = state.marketBias;
  if (!bias?.themes?.length) return 0;
  const text = `${item.name || ""} ${item.industry || ""} ${item.source || ""}`;
  const matched = bias.themes.some((theme) => text.includes(theme));
  if (!matched) return 0;
  return bias.tone;
}

function fundFlowBonus(item) {
  const name = item.industry || item.name || "";
  const code = item.code || "";
  const match = state.fundFlow.find((flow) => flow.code === code || flow.name === name || name.includes(flow.name) || flow.name?.includes(name));
  if (!match) return 0;
  const net = Number(match.mainNetInflow || 0);
  const ratio = Number(match.mainNetRatio || 0);
  if (net > 1000000000 || ratio > 5) return 6;
  if (net > 200000000 || ratio > 2) return 3;
  if (net < -1000000000 || ratio < -5) return -6;
  if (net < -200000000 || ratio < -2) return -3;
  return 0;
}

function parseMarketBias(text) {
  const source = String(text || "").trim();
  const themes = [];
  const keywordMap = [
    ["科技", ["科技", "通信", "电子", "半导体", "软件", "算力", "AI"]],
    ["金融", ["证券", "金融", "券商", "保险"]],
    ["资源", ["小金属", "有色", "钨", "钼", "锌", "锗", "黄金"]],
    ["化工", ["化工", "磷", "氟", "农化"]],
    ["机器人", ["机器人", "自动化", "设备"]]
  ];
  keywordMap.forEach(([theme, words]) => {
    if (words.some((word) => source.includes(word))) themes.push(theme, ...words);
  });
  let tone = 0;
  if (/失血|退潮|分歧|杀跌|流出|跳水|亏钱/.test(source)) tone -= 6;
  if (/修复|回流|加强|共振|反包|转强/.test(source)) tone += 4;
  if (/还能修复吗|观察|能否/.test(source)) tone -= 2;
  const mode = /失血|流出|杀跌|跳水/.test(source) && /修复|回流|承接/.test(source) ? "修复观察" : tone < 0 ? "风险回避" : tone > 0 ? "回流增强" : "中性";
  return { text: source, themes: [...new Set(themes)], tone, mode };
}

function operationPlan(item) {
  const s = state.settings;
  const isLimit = item.source === "涨停接力";
  const highOpen = isLimit ? `3%-${s.maxHighOpen}%` : `1%-${Math.max(3, s.maxHighOpen - 2)}%`;
  const price = Number(item.price || 0);
  const tBuy = price ? price * (1 - s.dipBuy / 100) : 0;
  const tSell = price ? price * (1 + s.tRiseSell / 100) : 0;
  const stopPrice = price ? price * (1 - s.stopLoss / 100) : 0;
  const buy = isLimit ? "分歧后回封、封单增强再参与" : "高开不多且放量突破昨日高点再参与";
  const tText = price ? `T计划：回落到 ${fmt.format(tBuy)} 附近低吸，冲到 ${fmt.format(tSell)} 附近减T` : "T计划：等盘中回落低吸、冲高减T";
  const stop = price ? `止损 ${fmt.format(stopPrice)} 或亏损 ${s.stopLoss}%` : `止损 ${s.stopLoss}%`;
  const pass = `高开超过 ${s.maxHighOpen}%、换手超过 ${s.maxTurnover}%、板块跌出前排、竞价量弱就放弃`;
  return `开盘${highOpen}更优；${buy}；${tText}；${stop}；${pass}`;
}

function stockTemperScore(item) {
  let score = 50;
  const turnover = safeNumber(item.turnover);
  const amount = safeNumber(item.amount);
  const boardCount = safeNumber(item.boardCount);
  const brokenCount = Number.isFinite(Number(item.brokenCount)) ? Number(item.brokenCount) : null;
  score += boardCount >= 2 ? 14 : boardCount === 1 ? 7 : 0;
  if (brokenCount !== null) score += brokenCount === 0 ? 12 : Math.max(-16, 6 - brokenCount * 3);
  score += turnover >= 3 && turnover <= 18 ? 12 : turnover > 30 ? -15 : turnover > 0 ? 4 : 0;
  score += amount > 3000000000 ? 10 : amount > 800000000 ? 6 : 0;
  score += sectorHeatBonus(item.industry || item.name, item.code);
  if ((item.firstLimitTime || 999999) <= 93030) score += 8;
  return Math.max(0, Math.min(99, Math.round(score)));
}

function predictionReason(item) {
  const pieces = [];
  if (item.boardCount) pieces.push(`${item.boardCount}板`);
  if (item.firstLimitTime) pieces.push(`${timeLabel(item.firstLimitTime)}封板`);
  if (item.brokenCount === 0) pieces.push("未炸板");
  if (item.brokenCount > 0) pieces.push(`炸板${item.brokenCount}次`);
  if (item.turnover) pieces.push(`换手${pct(item.turnover)}`);
  if (item.amount) pieces.push(`成交${money(item.amount)}`);
  if (item.industry) pieces.push(item.industry);
  return pieces.slice(0, 4).join(" · ") || "强势异动";
}

function factorSummary(item) {
  const flow = fundFlowBonus(item);
  const bias = marketBiasBonus(item);
  const heat = sectorHeatBonus(item.industry || item.name, item.code);
  const parts = [
    `股性${stockTemperScore(item)}`,
    `板块${heat >= 6 ? "+" : ""}${heat}`,
    `资金${flow > 0 ? "+" : ""}${flow}`,
    `观点${bias > 0 ? "+" : ""}${bias}`
  ];
  return parts.join(" / ");
}

function futureLimitScore(raw) {
  const isLimit = raw.source === "涨停接力";
  const s = state.settings;
  let score = isLimit ? limitCandidateScore(raw) : 42;
  if (!isLimit) {
    const change = Number(raw.changePct || 0);
    const turnover = Number(raw.turnover || 0);
    const amount = Number(raw.amount || 0);
    const volumeRatio = Number(raw.volumeRatio || 0);
    score += change >= 15 ? 18 : change >= 10 ? 14 : change >= 7 ? 10 : change >= 4 ? 5 : 0;
    score += amount > 5000000000 ? 12 : amount > 1500000000 ? 8 : amount > 500000000 ? 4 : 0;
    score += turnover >= 4 && turnover <= 15 ? 8 : turnover > 25 ? -8 : 2;
    score += volumeRatio >= 1.2 && volumeRatio <= 4 ? 6 : volumeRatio > 6 ? -3 : 0;
  }
  score += sectorHeatBonus(raw.industry || raw.name, raw.code);
  score += Math.round((stockTemperScore(raw) - 55) / 5);
  if (s.style === "aggressive" && isLimit) score += 6;
  if (s.style === "dip" && Number(raw.turnover || 0) > 18) score -= 6;
  if (s.style === "t" && Number(raw.amount || 0) > 1000000000 && Number(raw.turnover || 0) <= s.maxTurnover) score += 5;
  score += fundFlowBonus(raw);
  score += marketBiasBonus(raw);
  if (raw.name?.includes("ST")) score -= 50;
  if (raw.brokenCount > 10) score -= 12;
  if (raw.boardCount >= 5) score -= 5;
  return Math.max(0, Math.min(99, Math.round(score)));
}

function buildPredictions() {
  const byCode = new Map();
  state.limitUp.forEach((item) => {
    byCode.set(item.code, {
      ...item,
      source: "涨停接力"
    });
  });
  state.movers.forEach((item) => {
    if (byCode.has(item.code) || item.name?.includes("ST")) return;
    const change = Number(item.changePct || 0);
    const amount = Number(item.amount || 0);
    if (change < 5 && amount < 800000000) return;
    byCode.set(item.code, {
      ...item,
      source: change >= 9.7 ? "强势首板" : "强势冲板"
    });
  });
  return [...byCode.values()]
    .map((item) => ({
      ...item,
      probability: futureLimitScore(item),
      temper: stockTemperScore(item),
      reason: predictionReason(item)
    }))
    .filter((item) => item.probability >= state.settings.minScore)
    .filter((item) => Number(item.turnover || 0) <= state.settings.maxTurnover)
    .filter((item) => !state.settings.onlyGoodTemper || item.temper >= 66)
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 30);
}

function firstBoardScore(item) {
  const change = safeNumber(item.changePct);
  const turnover = safeNumber(item.turnover);
  const volumeRatio = safeNumber(item.volumeRatio);
  const amount = safeNumber(item.amount);
  let score = 30;
  score += change >= 6.8 && change < 9.5 ? 23 : change >= 4.8 ? 17 : change >= 3 ? 9 : -14;
  score += amount >= 2500000000 ? 15 : amount >= 1000000000 ? 11 : amount >= 500000000 ? 6 : -8;
  score += turnover >= 2 && turnover <= 16 ? 12 : turnover > 24 ? -12 : turnover > 0 ? 4 : 0;
  score += volumeRatio >= 1.3 && volumeRatio <= 5.2 ? 11 : volumeRatio > 7 ? -9 : volumeRatio > 0 ? 3 : 0;
  score += sectorHeatBonus(item.industry || item.name, item.code);
  score += fundFlowBonus(item);
  score += marketBiasBonus(item);
  score += Math.round((stockTemperScore(item) - 55) / 4);
  if (item.name?.includes("ST")) score -= 60;
  if (change >= 9.7) score -= 60;
  if (change < 2.5) score -= 18;
  return Math.max(0, Math.min(99, Math.round(score)));
}

function firstBoardTrigger(item) {
  const change = safeNumber(item.changePct);
  const volumeRatio = safeNumber(item.volumeRatio);
  const price = safeNumber(item.price);
  const targetHigh = price > 0 ? fmt.format(price * 1.05) : "--";
  if (change >= 6.8) return `前一日未涨停但收盘强势；次日盘中最高价冲高≥5%算命中，参考价 ${targetHigh}`;
  if (change >= 4.8) return `需尾盘资金继续承接，次日盘中冲高≥5%；当前量比 ${fmt.format(volumeRatio || 0)}`;
  return `只做观察，需收盘保持强势并有板块资金配合；冲高5%参考价 ${targetHigh}`;
}

function firstBoardRisk(item) {
  const turnover = safeNumber(item.turnover);
  const volumeRatio = safeNumber(item.volumeRatio);
  const change = safeNumber(item.changePct);
  if (change >= 9.7) return "前一日已涨停，不符合该模型";
  if (turnover > 22) return "换手偏高，次日冲高回落风险大";
  if (volumeRatio > 7) return "量比过热，防止尾盘透支次日竞价";
  if (change < 3) return "强度不足，盘中冲高5%概率偏低";
  return "次日若冲高不放量或快速回落，不追高";
}

function firstBoardConditionPlan(item) {
  const price = safeNumber(item.price);
  const triggerPrice = price > 0 ? price * 1.05 : 0;
  const accuracy = state.highOpenHistory?.summary?.top5?.rate;
  const accuracyText = Number.isFinite(Number(accuracy)) ? `历史Top5 ${accuracy}%` : "历史样本不足";
  const triggerText = triggerPrice > 0 ? fmt.format(triggerPrice) : "--";
  return `条件单参考：触价 ${triggerText} 视为冲高5%触发；${accuracyText}，样本稳定前建议先设提醒不自动买入。`;
}

function buildFirstBoardCandidates() {
  const byCode = new Map();
  const minPrice = safeNumber(state.highOpenFilter.minPrice, 0);
  const maxPrice = safeNumber(state.highOpenFilter.maxPrice, 0);
  [...state.movers, ...state.activeStocks].forEach((item) => {
    const change = safeNumber(item.changePct);
    const amount = safeNumber(item.amount);
    const price = safeNumber(item.price);
    if (item.name?.includes("ST")) return;
    if (change < 2.5 || change >= 9.7 || amount < 300000000) return;
    if (minPrice && price < minPrice) return;
    if (maxPrice && price > maxPrice) return;
    const probability = firstBoardScore(item);
    byCode.set(item.code, {
      ...item,
      source: probability >= 58 ? "未涨停强势股" : "低置信观察",
      firstBoardProbability: probability,
      trigger: firstBoardTrigger(item),
      risk: firstBoardRisk(item),
      temper: stockTemperScore(item)
    });
  });
  const sorted = [...byCode.values()].sort((a, b) => b.firstBoardProbability - a.firstBoardProbability);
  const strong = sorted.filter((item) => item.firstBoardProbability >= 58);
  return (strong.length ? strong.slice(0, 15) : sorted.slice(0, 10));
}

function syncHighOpenFilter() {
  const minInput = $("#highOpenMinPrice");
  const maxInput = $("#highOpenMaxPrice");
  if (minInput) minInput.value = state.highOpenFilter.minPrice || "";
  if (maxInput) maxInput.value = state.highOpenFilter.maxPrice || "";
  renderHighOpenFilterStatus();
}

function renderHighOpenFilterStatus() {
  const status = $("#highOpenFilterStatus");
  if (!status) return;
  const minPrice = safeNumber(state.highOpenFilter.minPrice, 0);
  const maxPrice = safeNumber(state.highOpenFilter.maxPrice, 0);
  if (minPrice && maxPrice) status.textContent = `筛选 ${fmt.format(minPrice)}-${fmt.format(maxPrice)} 元`;
  else if (minPrice) status.textContent = `筛选 ≥${fmt.format(minPrice)} 元`;
  else if (maxPrice) status.textContent = `筛选 ≤${fmt.format(maxPrice)} 元`;
  else status.textContent = "价格不限";
}

function readHighOpenFilter() {
  const minPrice = $("#highOpenMinPrice")?.value || "";
  const maxPrice = $("#highOpenMaxPrice")?.value || "";
  state.highOpenFilter = { minPrice, maxPrice };
  localStorage.setItem("stock-high-open-filter", JSON.stringify(state.highOpenFilter));
  renderHighOpenFilterStatus();
  renderFirstBoard();
}

function renderHighOpenWindowStatus() {
  const box = $("#highOpenWindowStatus");
  const saveButton = $("#saveHighOpenSnapshot");
  if (!box) return highOpenWindowInfo();
  const info = highOpenWindowInfo();
  box.textContent = `${info.label} 当前北京时间 ${info.hour.toString().padStart(2, "0")}:${info.minute.toString().padStart(2, "0")}，预测目标为下一交易日盘中冲高≥5%。`;
  box.classList.toggle("active", info.inWindow);
  box.classList.toggle("waiting", !info.inWindow);
  if (saveButton) {
    saveButton.textContent = info.inWindow ? "记录正式尾盘预测" : "记录预览预测";
    saveButton.title = info.inWindow ? "保存为正式尾盘样本" : "非尾盘窗口保存为预览样本，不作为正式尾盘模型样本";
  }
  return info;
}

function quoteScore(stock) {
  if (!stock) return { score: 0, parts: {} };
  const ths = thsInputs();
  const change = Number(stock.changePct || 0);
  const turnover = Number(stock.turnover || 0);
  const volumeRatio = Number(stock.volumeRatio || 0);
  const amount = Number(stock.amount || 0);
  const pb = Number(stock.pb || 0);
  let score = 35;
  score += change >= 9.7 ? 20 : change >= 5 ? 13 : change >= 2 ? 7 : change < -2 ? -8 : 0;
  score += turnover >= 3 && turnover <= 12 ? 10 : turnover > 20 ? -5 : 3;
  score += volumeRatio >= 1.5 && volumeRatio <= 4 ? 9 : volumeRatio > 6 ? -3 : 2;
  score += amount > 3000000000 ? 10 : amount > 800000000 ? 6 : 1;
  score += pb > 0 && pb < 8 ? 4 : pb >= 20 ? -4 : 0;
  score += marketMoodScore() / 8;
  score += ths.score;
  return {
    score: Math.max(0, Math.min(99, Math.round(score))),
    parts: { change, turnover, volumeRatio, amount, ths }
  };
}

function marketMoodScore() {
  if (!state.indices.length) return 0;
  const avg = state.indices.reduce((sum, item) => sum + Number(item.changePct || 0), 0) / state.indices.length;
  const limitCount = state.limitUp.length;
  return Math.min(40, Math.max(-20, avg * 8 + Math.min(22, limitCount / 6)));
}

function renderIndices() {
  $("#indexGrid").innerHTML = state.indices.map((item) => `
    <div class="mini-item">
      <strong>${item.name}</strong>
      <b class="${tone(item.changePct)}">${pct(item.changePct)}</b>
      <span>${fmt.format(item.price)}</span>
      <span>${money(item.amount)}</span>
    </div>
  `).join("");
}

function renderWatch() {
  $("#watchList").innerHTML = state.watch.map((code) => `
    <button type="button" data-code="${code}">
      <strong>${code}</strong>
      <span>点击分析</span>
    </button>
  `).join("");
}

function saveExpertTrades() {
  localStorage.setItem("stock-expert-trades", JSON.stringify(state.expertTrades.slice(0, 80)));
}

function expertRecords() {
  return [...state.expertTrades, ...DEFAULT_EXPERT_TRADES];
}

function expertScore(item) {
  const returnRate = Number(item.returnRate || 0);
  const wins = Number(item.wins || 0);
  const samples = Math.max(1, Number(item.samples || 1));
  const drawdown = Number(item.drawdown || 0);
  const winRate = Math.min(100, Math.max(0, wins / samples * 100));
  let score = 35;
  score += Math.min(28, Math.max(-10, returnRate * 0.45));
  score += Math.min(20, winRate * 0.2);
  score += Math.min(12, Math.log10(samples + 1) * 8);
  score -= Math.min(18, drawdown * 0.55);
  if (samples < 3) score -= 10;
  if (samples >= 10) score += 5;
  return Math.max(0, Math.min(99, Math.round(score)));
}

function buildExpertRecommendations() {
  const byExpert = new Map();
  expertRecords().forEach((item) => {
    const key = item.expert || "未命名高手";
    const prev = byExpert.get(key) || {
      expert: key,
      records: 0,
      returnRate: 0,
      wins: 0,
      samples: 0,
      drawdown: 0,
      latest: "",
      hasBuiltin: false,
      actions: []
    };
    prev.records += 1;
    prev.returnRate = Math.max(prev.returnRate, Number(item.returnRate || 0));
    prev.wins += Number(item.wins || 0);
    prev.samples += Math.max(1, Number(item.samples || 1));
    prev.drawdown = Math.max(prev.drawdown, Number(item.drawdown || 0));
    prev.latest = item.createdAt || prev.latest;
    prev.hasBuiltin = prev.hasBuiltin || Boolean(item.builtin);
    prev.actions.push(item);
    byExpert.set(key, prev);
  });
  return [...byExpert.values()]
    .map((item) => ({
      ...item,
      score: expertScore(item),
      winRate: item.samples ? Math.round(item.wins / item.samples * 1000) / 10 : 0
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function renderExpertTrades() {
  const list = $("#expertTradeList");
  if (!list) return;
  const recommendBox = $("#expertRecommendList");
  if (recommendBox) {
    const recommendations = buildExpertRecommendations();
    recommendBox.innerHTML = recommendations.length ? recommendations.map((item, index) => `
      <div class="expert-recommend-card">
        <b>${index + 1}</b>
        <div>
          <strong>${item.expert}${item.hasBuiltin ? '<small>样例</small>' : ''}</strong>
          <span>推荐指数 ${item.score} · 收益 ${pct(item.returnRate)} · 胜率 ${pct(item.winRate)} · 样本 ${item.samples}</span>
          ${item.actions.slice(0, 1).map((action) => `
            <p>
              <button class="stock-link" type="button" data-code="${action.code}">${action.stock || action.code}</button>
              ${action.action} · ${action.price ? fmt.format(action.price) : "--"} · ${action.position || "--"}
              <br>${action.reason || "未填写交易逻辑"}
            </p>
          `).join("")}
        </div>
        <em>${item.drawdown ? `最大回撤 ${fmt.format(item.drawdown)}%` : "回撤未填"}</em>
      </div>
    `).join("") : `<div class="empty-state">录入公开高手记录后，这里会自动推荐最值得参考的股民/组合。</div>`;
  }
  const rows = expertRecords()
    .sort((a, b) => expertScore(b) - expertScore(a))
    .slice(0, 12);
  if (!rows.length) {
    list.innerHTML = `<div class="empty-state">暂无记录。可从同花顺公开组合/高手榜手动录入，用于复盘参考。</div>`;
    return;
  }
  list.innerHTML = rows.map((item) => `
    <div class="expert-trade-card">
      <div>
        <strong>${item.expert || "未命名高手"}${item.builtin ? '<small>样例</small>' : ''}</strong>
        <span class="${tone(item.returnRate)}">推荐 ${expertScore(item)} · ${pct(item.returnRate)}</span>
      </div>
      <div>
        <button class="stock-link" type="button" data-code="${item.code}">${item.stock || item.code}</button>
        <em>${item.action} · ${item.price ? fmt.format(item.price) : "--"} · ${item.position || "--"}</em>
      </div>
      <p>胜率 ${pct(Math.max(0, Number(item.wins || 0)) / Math.max(1, Number(item.samples || 1)) * 100)} · 样本 ${item.samples || 1} · 回撤 ${item.drawdown ? `${fmt.format(item.drawdown)}%` : "--"}<br>${item.reason || "未填写来源/理由"}<br><small>${item.createdAt || ""}</small></p>
    </div>
  `).join("");
}

function syncSettingsForm() {
  $("#setMinScore").value = state.settings.minScore;
  $("#setMaxTurnover").value = state.settings.maxTurnover;
  $("#setMaxHighOpen").value = state.settings.maxHighOpen;
  $("#setDipBuy").value = state.settings.dipBuy;
  $("#setTRiseSell").value = state.settings.tRiseSell;
  $("#setStopLoss").value = state.settings.stopLoss;
  $("#setStyle").value = state.settings.style;
  $("#setOnlyGoodTemper").checked = state.settings.onlyGoodTemper;
}

function readSettingsForm() {
  state.settings = {
    minScore: Number($("#setMinScore").value || DEFAULT_SETTINGS.minScore),
    maxTurnover: Number($("#setMaxTurnover").value || DEFAULT_SETTINGS.maxTurnover),
    maxHighOpen: Number($("#setMaxHighOpen").value || DEFAULT_SETTINGS.maxHighOpen),
    dipBuy: Number($("#setDipBuy").value || DEFAULT_SETTINGS.dipBuy),
    tRiseSell: Number($("#setTRiseSell").value || DEFAULT_SETTINGS.tRiseSell),
    stopLoss: Number($("#setStopLoss").value || DEFAULT_SETTINGS.stopLoss),
    style: $("#setStyle").value || DEFAULT_SETTINGS.style,
    onlyGoodTemper: $("#setOnlyGoodTemper").checked
  };
  localStorage.setItem("stock-settings", JSON.stringify(state.settings));
  renderPredictions();
  renderQuote();
}

function currentTradePlanText() {
  const stock = state.selected;
  if (!stock) return "请先选择一只股票。";
  const s = state.settings;
  const price = Number(stock.price || 0);
  const tBuy = price * (1 - s.dipBuy / 100);
  const tSell = price * (1 + s.tRiseSell / 100);
  const stopPrice = price * (1 - s.stopLoss / 100);
  const limitMatch = state.limitUp.find((item) => item.code === stock.code);
  const synthetic = {
    ...stock,
    source: limitMatch ? "涨停接力" : Number(stock.changePct || 0) >= 9.7 ? "强势首板" : "强势冲板",
    ...(limitMatch || {})
  };
  return [
    `股票：${stock.name} ${stock.code}`,
    `当前价：${fmt.format(price)}，预测分：${futureLimitScore(synthetic)}，股性分：${stockTemperScore(synthetic)}`,
    `低吸条件：盘中回落约 ${s.dipBuy}% 且分时承接不破，参考价 ${fmt.format(tBuy)}`,
    `卖T条件：冲高约 ${s.tRiseSell}% 或量能衰减，参考价 ${fmt.format(tSell)}`,
    `止损条件：跌破 ${fmt.format(stopPrice)} 或亏损 ${s.stopLoss}%`,
    `放弃条件：高开超过 ${s.maxHighOpen}%、换手超过 ${s.maxTurnover}%、板块跌出前排、竞价量弱`,
    "执行：由本人在同花顺确认买入/卖出/撤单，AI 不自动提交订单。"
  ].join("\n");
}

function renderTradeDesk() {
  const stock = state.selected;
  if (!stock) {
    $("#tradeDeskStatus").textContent = "等待选择股票";
    return;
  }
  const s = state.settings;
  const price = Number(stock.price || 0);
  $("#tradeDeskStatus").textContent = `低吸 ${fmt.format(price * (1 - s.dipBuy / 100))} · 卖T ${fmt.format(price * (1 + s.tRiseSell / 100))}`;
}

function renderSectors() {
  const summary = $("#sectorSummary");
  if (summary) {
    summary.textContent = state.sectors.length
      ? state.sectors.slice(0, 3).map((item) => `${item.name} ${pct(item.changePct)}`).join(" · ")
      : "等待板块数据";
  }
  $("#sectorList").innerHTML = state.sectors.slice(0, 16).map((item, index) => `
    <div class="sector-item">
      <div>
        <strong>${index + 1}. ${item.name}</strong>
        <div class="sector-meta">成交 ${money(item.amount)} · 量比 ${fmt.format(item.volumeRatio || 0)}</div>
      </div>
      <b class="${tone(item.changePct)}">${pct(item.changePct)}</b>
    </div>
  `).join("");
}

function renderSectorPanelState() {
  const panel = $("#sectorPanel");
  const button = $("#toggleSectorPanel");
  if (!panel || !button) return;
  panel.classList.toggle("collapsed", state.sectorPanelCollapsed);
  button.textContent = state.sectorPanelCollapsed ? "展开" : "收起";
}

function panelCollapseKey(panel, index) {
  if (panel.id) return panel.id;
  const title = panel.querySelector(".panel-head h2, .panel-head h3")?.textContent.trim();
  const classKey = [...panel.classList]
    .filter((name) => !["panel", "table-panel", "collapsible-panel"].includes(name))
    .join("-");
  return classKey || title || `panel-${index}`;
}

function saveCollapsedPanels() {
  localStorage.setItem(COLLAPSIBLE_PANELS_KEY, JSON.stringify(state.collapsedPanels));
}

function renderCollapsiblePanels() {
  document.querySelectorAll(".collapsible-panel").forEach((panel) => {
    const key = panel.dataset.collapseKey;
    const collapsed = Boolean(state.collapsedPanels[key]);
    const button = panel.querySelector(".panel-collapse-toggle");
    panel.classList.toggle("is-collapsed", collapsed);
    if (button) {
      button.textContent = collapsed ? "展开" : "收起";
      button.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
  });
}

function initCollapsiblePanels() {
  document.querySelectorAll(".panel").forEach((panel, index) => {
    if (panel.id === "sectorPanel") return;
    const head = panel.querySelector(":scope > .panel-head");
    if (!head) return;
    const key = panelCollapseKey(panel, index);
    panel.dataset.collapseKey = key;
    panel.classList.add("collapsible-panel");

    let actions = head.querySelector(":scope > .panel-actions");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "panel-actions";
      head.appendChild(actions);
    }
    if (!actions.querySelector(".panel-collapse-toggle")) {
      const button = document.createElement("button");
      button.className = "ghost-button panel-collapse-toggle";
      button.type = "button";
      button.dataset.collapseKey = key;
      button.setAttribute("aria-label", "收纳板块");
      actions.appendChild(button);
    }
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest(".panel-collapse-toggle");
    if (!button) return;
    const key = button.dataset.collapseKey;
    state.collapsedPanels[key] = !state.collapsedPanels[key];
    saveCollapsedPanels();
    renderCollapsiblePanels();
  });

  renderCollapsiblePanels();
}

function renderFundFlow() {
  $("#fundFlowList").innerHTML = state.fundFlow.slice(0, 12).map((item, index) => `
    <div class="fund-flow-item">
      <div>
        <strong>${index + 1}. ${item.name}</strong>
        <div class="sector-meta">主力净流入 ${money(item.mainNetInflow)} · 占比 ${pct(item.mainNetRatio)}${item.estimated ? " · 云端估算" : ""}</div>
      </div>
      <b class="${tone(item.mainNetInflow)}">${money(item.mainNetInflow)}</b>
    </div>
  `).join("");
}

function setFlowSyncStatus(text) {
  const el = $("#flowSyncStatus");
  if (el) el.textContent = text;
}

function formatFlowTime(value) {
  const text = String(value || "");
  if (state.sectorFlowPeriod === "day") return text.includes(" ") ? text.split(" ").at(-1).slice(0, 5) : text.slice(-5);
  return text.slice(5);
}

function renderSectorFlowChart() {
  const canvas = $("#sectorFlowCanvas");
  const legend = $("#sectorFlowLegend");
  if (!canvas || !legend) return;
  const series = state.sectorFlowLines || [];
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(360, canvas.clientWidth || 520);
  const height = Math.max(280, canvas.clientHeight || 280);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.font = "12px Arial, sans-serif";

  if (!series.length) {
    ctx.fillStyle = "#66727f";
    ctx.fillText("暂无板块资金折线数据", 16, 28);
    legend.innerHTML = "";
    return;
  }

  const points = series.flatMap((item) => item.points || []);
  const values = points.map((point) => Number(point.main || 0));
  const maxAbs = Math.max(1, ...values.map((value) => Math.abs(value)));
  const padding = { left: 72, right: 28, top: 24, bottom: 38 };
  const plotW = Math.max(1, width - padding.left - padding.right);
  const plotH = Math.max(1, height - padding.top - padding.bottom);
  const y = (value) => padding.top + (maxAbs - value) / (maxAbs * 2) * plotH;
  const x = (index, total) => padding.left + (total <= 1 ? 0 : index / (total - 1) * plotW);

  ctx.strokeStyle = "#dbe2e8";
  ctx.lineWidth = 1;
  [-1, -0.5, 0, 0.5, 1].forEach((ratio) => {
    const gy = y(maxAbs * ratio);
    ctx.beginPath();
    ctx.moveTo(padding.left, gy);
    ctx.lineTo(width - padding.right, gy);
    ctx.stroke();
    ctx.fillStyle = ratio === 0 ? "#1f2937" : "#66727f";
    ctx.fillText(money(maxAbs * ratio), 8, gy + 4);
  });

  const zeroY = y(0);
  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(padding.left, zeroY);
  ctx.lineTo(width - padding.right, zeroY);
  ctx.stroke();

  ctx.fillStyle = "#66727f";
  ctx.fillText("主力净流入", padding.left, 14);

  series.forEach((item, seriesIndex) => {
    const color = CHART_COLORS[seriesIndex % CHART_COLORS.length];
    const itemPoints = item.points || [];
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    itemPoints.forEach((point, pointIndex) => {
      const px = x(pointIndex, itemPoints.length);
      const py = y(Number(point.main || 0));
      if (pointIndex === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    const last = itemPoints.at(-1);
    if (last) {
      const px = x(itemPoints.length - 1, itemPoints.length);
      const py = y(Number(last.main || 0));
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  const firstPoints = series[0]?.points || [];
  if (firstPoints.length) {
    const mid = firstPoints[Math.floor(firstPoints.length / 2)];
    ctx.fillStyle = "#66727f";
    ctx.fillText(formatFlowTime(firstPoints[0].time), padding.left, height - 12);
    ctx.fillText(formatFlowTime(mid.time), padding.left + plotW / 2 - 18, height - 12);
    ctx.fillText(formatFlowTime(firstPoints.at(-1).time), width - padding.right - 48, height - 12);
  }

  legend.innerHTML = series.map((item, index) => {
    const last = item.points?.at(-1);
    const latest = last ? ` · ${money(last.main)}` : "";
    return `<span><i style="background:${CHART_COLORS[index % CHART_COLORS.length]}"></i>${item.name}${latest}</span>`;
  }).join("");
}

function showSectorFlowTooltip(event) {
  const canvas = $("#sectorFlowCanvas");
  const tooltip = $("#sectorFlowTooltip");
  const series = state.sectorFlowLines || [];
  const firstPoints = series[0]?.points || [];
  if (!canvas || !tooltip || !series.length || !firstPoints.length) return;
  const rect = canvas.getBoundingClientRect();
  const paddingLeft = 72;
  const paddingRight = 28;
  const plotW = Math.max(1, rect.width - paddingLeft - paddingRight);
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left - paddingLeft) / plotW));
  const index = Math.round(ratio * (firstPoints.length - 1));
  const time = firstPoints[index]?.time || "--";
  const rows = series.slice(0, 8).map((item, seriesIndex) => {
    const points = item.points || [];
    const point = points[Math.min(index, points.length - 1)];
    const color = CHART_COLORS[seriesIndex % CHART_COLORS.length];
    return `<div><i style="display:inline-block;width:10px;height:3px;background:${color};margin-right:6px"></i>${item.name}: ${money(point?.main)}</div>`;
  }).join("");
  tooltip.innerHTML = `<strong>${formatFlowTime(time)}</strong>${rows}`;
  tooltip.hidden = false;
  tooltip.style.left = `${Math.min(rect.width - 230, Math.max(10, event.clientX - rect.left + 12))}px`;
  tooltip.style.top = `${Math.max(44, event.clientY - rect.top - 10)}px`;
}

function hideSectorFlowTooltip() {
  const tooltip = $("#sectorFlowTooltip");
  if (tooltip) tooltip.hidden = true;
}

async function loadSectorFlowLines(period = state.sectorFlowPeriod) {
  state.sectorFlowPeriod = period;
  setFlowSyncStatus("同步中...");
  state.sectorFlowLines = await safeApi(`/api/sector-flow-lines?period=${period}&limit=8&_=${Date.now()}`, []);
  document.querySelectorAll("[data-flow-period]").forEach((button) => {
    button.classList.toggle("active", button.dataset.flowPeriod === period);
  });
  renderSectorFlowChart();
  const hasEstimated = state.sectorFlowLines.some((line) => line.estimated || line.points?.some((point) => point.estimated));
  const status = state.sectorFlowLines.length
    ? `已同步 ${new Date().toLocaleTimeString("zh-CN", { hour12: false })} · ${hasEstimated ? "云端估算" : "30秒自动刷新"}`
    : "暂无实时资金曲线数据";
  setFlowSyncStatus(status);
}

function toggleFlowFullscreen() {
  const box = document.querySelector(".flow-chart-box");
  if (!box) return;
  if (!document.fullscreenElement) box.requestFullscreen?.();
  else document.exitFullscreen?.();
}

async function refreshRealtimeData({ silent = false } = {}) {
  if (isRefreshing) return;
  isRefreshing = true;
  try {
    if (!silent) $("#updatedAt").textContent = "刷新中...";
    await loadAll({ fromRealtime: silent });
    await refreshSelectedStock();
  } finally {
    isRefreshing = false;
  }
}

function startRealtimeSync() {
  if (realtimeRefreshTimer) clearInterval(realtimeRefreshTimer);
  realtimeRefreshTimer = setInterval(() => {
    renderHighOpenWindowStatus();
    refreshRealtimeData({ silent: true }).catch((error) => console.warn("实时同步失败", error));
  }, REALTIME_REFRESH_MS);
}
function renderMarketBias() {
  const bias = state.marketBias;
  const noteInput = $("#marketNote");
  const view = $("#marketBiasView");
  if (!noteInput || !view) return;
  noteInput.value = bias.text || "";
  const toneText = bias.tone > 0 ? "偏多/修复" : bias.tone < 0 ? "偏空/分歧" : "中性";
  const themes = bias.themes?.length ? bias.themes.slice(0, 8).join("、") : "未识别题材";
  view.textContent = `${toneText} · ${bias.mode || "中性"} · ${themes}`;
}

function renderPredictions() {
  const rows = buildPredictions();
  if (!rows.length) {
    $("#predictionTable").innerHTML = `
      <tr>
        <td colspan="6">当前条件太严格，暂时没有候选。可以降低最低预测分、放宽最高换手，或关闭“只看股性好”。</td>
      </tr>
    `;
    renderAiPicks(rows);
    return;
  }
  $("#predictionTable").innerHTML = rows.map((item) => `
    <tr data-code="${item.code}">
      <td><button class="stock-link" type="button" data-code="${item.code}">${item.name}</button><br><span>${item.code}</span></td>
      <td><b class="${item.probability >= 78 ? "red" : "amber"}">${item.probability}</b></td>
      <td><span class="tag">${item.source}</span></td>
      <td>${item.reason}<br><span class="sector-meta">${factorSummary(item)}</span></td>
      <td class="plan-cell">${operationPlan(item)}</td>
      <td><a target="_blank" rel="noreferrer" href="https://www.iwencai.com/unifiedwap/result?w=${encodeURIComponent(`${item.name} ${item.code} 人气排名 主力资金 涨停原因 明日连板概率`)}">问财</a></td>
    </tr>
  `).join("");
  renderAiPicks(rows);
}

function renderFirstBoard() {
  renderHighOpenWindowStatus();
  const rows = buildFirstBoardCandidates();
  const table = $("#firstBoardTable");
  if (!table) return;
  if (!rows.length) {
    const filterText = $("#highOpenFilterStatus")?.textContent || "价格不限";
    table.innerHTML = `
      <tr>
        <td colspan="5">当前没有达到冲高 5% 模型阈值的候选。当前筛选：${filterText}。优先等待未涨停强势股、量能和板块资金形成共振。</td>
      </tr>
    `;
    return;
  }
  table.innerHTML = rows.map((item) => `
    <tr data-code="${item.code}">
      <td><button class="stock-link" type="button" data-code="${item.code}">${item.name}</button><br><span>${item.code}</span></td>
      <td><b class="${item.firstBoardProbability >= 76 ? "red" : "amber"}">${item.firstBoardProbability}</b></td>
      <td>${item.trigger}</td>
      <td>${factorSummary(item)}<br><span class="sector-meta">股性 ${item.temper} · 板块 ${item.industry || "--"}</span></td>
      <td class="plan-cell">${item.risk}<br><span class="sector-meta">${firstBoardConditionPlan(item)}</span><br><a target="_blank" rel="noreferrer" href="https://www.iwencai.com/unifiedwap/result?w=${encodeURIComponent(`${item.name} ${item.code} 前一天未涨停 次日盘中冲高5%以上 主力资金 人气排名`)}">同花顺验证</a></td>
    </tr>
  `).join("");
}

function renderHighOpenAccuracy(data = state.highOpenHistory) {
  const box = $("#highOpenAccuracy");
  if (!box || !data?.summary) return;
  const { summary, snapshots = [] } = data;
  const cards = box.querySelectorAll(".accuracy-card strong");
  if (cards[0]) cards[0].textContent = `${summary.top5.rate}%`;
  if (cards[1]) cards[1].textContent = `${summary.top10.rate}%`;
  if (cards[2]) cards[2].textContent = summary.pendingDays ? `${summary.settledDays}/${summary.pendingDays}天` : `${summary.settledDays}天`;
  const note = $("#highOpenAccuracyNote");
  if (note) note.textContent = `${summary.suggestion || "记录预测后，会按次日盘中最高价自动结算。"} 正式尾盘样本 ${summary.formalDays ?? 0} 天，预览样本 ${summary.previewDays ?? 0} 天。`;
  const list = $("#highOpenHistoryList");
  if (list) {
    list.innerHTML = snapshots.slice(0, 8).map((item) => {
      const sampleLabel = (item.sampleType || "close30") === "close30" ? "尾盘正式" : "预览";
      const status = item.status === "settled"
        ? `Top5 ${item.top5?.hits || 0}/${item.top5?.total || 0} · Top10 ${item.top10?.hits || 0}/${item.top10?.total || 0}`
        : `待 ${item.targetDate} 收盘后结算`;
      const resultByCode = new Map((item.results || []).map((row) => [row.code, row]));
      const rows = (item.predictions || []).slice(0, 5).map((row) => {
        const result = resultByCode.get(row.code);
        const mark = item.status === "settled"
          ? result?.hit ? "命中" : "未中"
          : "待验证";
        const rushValue = result?.highRushPct ?? result?.highOpenPct;
        const openText = rushValue !== undefined ? ` · 冲高 ${pct(rushValue)}` : "";
        return `<span class="history-pick ${result?.hit ? "hit" : ""}">${row.rank}. ${row.name} ${row.code} · ${Math.round(row.probability || 0)}% · ${mark}${openText}</span>`;
      }).join("");
      return `<div class="history-record"><b>${sampleLabel}</b> ${item.date} 预测 ${item.targetDate}：${status}<div class="history-picks">${rows || "无候选明细"}</div></div>`;
    }).join("") || `<div>暂无冲高 5% 预测历史。尾盘 14:30-15:00 会自动记录，也可以点“记录尾盘预测”。</div>`;
  }
}

function readHighOpenHistoryBackup() {
  try {
    return JSON.parse(localStorage.getItem(HIGH_OPEN_HISTORY_BACKUP_KEY) || "null");
  } catch {
    return null;
  }
}

function writeHighOpenHistoryBackup(data) {
  if (!data?.summary || !Array.isArray(data.snapshots)) return;
  localStorage.setItem(HIGH_OPEN_HISTORY_BACKUP_KEY, JSON.stringify({
    summary: data.summary,
    snapshots: data.snapshots.slice(0, 20),
    savedAt: new Date().toISOString()
  }));
}

function renderPredictionAccuracy(data = state.predictionHistory) {
  const box = $("#predictionAccuracy");
  if (!box || !data?.summary) return;
  const { summary, snapshots = [] } = data;
  const cards = box.querySelectorAll(".accuracy-card strong");
  if (cards[0]) cards[0].textContent = `${summary.top5.rate}%`;
  if (cards[1]) cards[1].textContent = `${summary.top10.rate}%`;
  if (cards[2]) cards[2].textContent = `${summary.settledDays}天`;
  const note = $("#predictionAccuracyNote");
  if (note) note.textContent = summary.suggestion;
  const list = $("#predictionHistoryList");
  if (list) {
    list.innerHTML = snapshots.slice(0, 3).map((item) => {
      const status = item.status === "settled"
        ? `Top5 ${item.top5?.hits || 0}/${item.top5?.total || 0} · Top10 ${item.top10?.hits || 0}/${item.top10?.total || 0}`
        : `待 ${item.targetDate} 收盘后结算`;
      return `<div>${item.date} 预测 ${item.targetDate}：${status}</div>`;
    }).join("");
  }
}

async function loadHighOpenHistory() {
  const backup = readHighOpenHistoryBackup();
  const data = await safeApi("/api/high-open-history", null);
  state.highOpenHistory = data?.snapshots?.length ? data : backup || data;
  if (state.highOpenHistory?.snapshots?.length) writeHighOpenHistoryBackup(state.highOpenHistory);
  renderHighOpenAccuracy();
}

async function saveHighOpenSnapshot() {
  const windowInfo = renderHighOpenWindowStatus();
  const rows = buildFirstBoardCandidates();
  if (!rows.length) {
    alert("当前没有可记录的冲高 5% 预测候选。");
    return;
  }
  const data = await api("/api/high-open-history/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      predictions: rows,
      sampleType: windowInfo.sampleType,
      modelVersion: windowInfo.modelVersion,
      predictionWindow: {
        name: "tail-close-30m",
        label: "交易日14:30-15:00",
        inWindow: windowInfo.inWindow,
        savedDate: windowInfo.date
      },
      settings: { ...state.settings, highOpenFilter: state.highOpenFilter }
    })
  });
  if (data?.error) throw new Error(data.error);
  state.highOpenHistory = { summary: data.summary, snapshots: [data.snapshot] };
  writeHighOpenHistoryBackup(state.highOpenHistory);
  await loadHighOpenHistory();
  alert(windowInfo.inWindow
    ? "已记录正式尾盘冲高 5% 预测，后续会按次日盘中最高价自动结算准确度并用于优化模型。"
    : "已记录预览预测。非 14:30-15:00 尾盘窗口样本会保留复盘，但不作为正式尾盘模型样本。");
}

async function autoSaveHighOpenSnapshotIfNeeded() {
  const windowInfo = renderHighOpenWindowStatus();
  if (!windowInfo.inWindow) return;
  const savedDate = localStorage.getItem(HIGH_OPEN_AUTO_SAVE_KEY);
  if (savedDate === windowInfo.date) return;
  const rows = buildFirstBoardCandidates();
  if (!rows.length) return;
  const data = await api("/api/high-open-history/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      predictions: rows,
      sampleType: "close30",
      modelVersion: "high-rush-close30-v3",
      predictionWindow: {
        name: "tail-close-30m",
        label: "交易日14:30-15:00",
        inWindow: true,
        savedDate: windowInfo.date,
        autoSaved: true
      },
      settings: { ...state.settings, highOpenFilter: state.highOpenFilter }
    })
  });
  if (data?.error) throw new Error(data.error);
  localStorage.setItem(HIGH_OPEN_AUTO_SAVE_KEY, windowInfo.date);
  writeHighOpenHistoryBackup({ summary: data.summary, snapshots: [data.snapshot] });
  await loadHighOpenHistory();
}

async function loadPredictionHistory() {
  state.predictionHistory = await safeApi("/api/prediction-history", null);
  renderPredictionAccuracy();
}

async function savePredictionSnapshot() {
  const rows = buildPredictions();
  if (!rows.length) {
    alert("当前没有可记录的预测候选。");
    return;
  }
  const data = await api("/api/prediction-history/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ predictions: rows, settings: state.settings })
  });
  if (data?.error) throw new Error(data.error);
  state.predictionHistory = { summary: data.summary, snapshots: [data.snapshot] };
  await loadPredictionHistory();
  alert("已记录今天的明日涨停预测，后续会按实际涨停池自动结算准确度。");
}

function renderAiPicks(rows = buildPredictions()) {
  const top = rows.slice(0, 5);
  $("#aiPicks").innerHTML = top.length ? top.map((item, index) => `
    <button type="button" class="pick-card" data-code="${item.code}">
      <span class="pick-rank">${index + 1}</span>
      <span>
        <strong>${item.name} ${item.code}</strong>
        <em>${item.source} · 预测 ${item.probability} · 股性 ${item.temper}</em>
        <small>${predictionReason(item)}</small>
      </span>
    </button>
  `).join("") : `
    <div class="empty-state">当前条件下没有 AI 候选，放宽 T 操作条件后再试。</div>
  `;
}

function renderQuote() {
  const stock = state.selected;
  const result = quoteScore(stock);
  renderTradeDesk();
  $("#scoreValue").textContent = stock ? result.score : "--";
  $("#scoreLabel").textContent = !stock ? "输入代码开始" : result.score >= 78 ? "强势接力" : result.score >= 62 ? "可观察" : "谨慎";
  $("#stockTitle").textContent = stock ? `${stock.name} ${stock.code}` : "未选择股票";

  const mood = marketMoodScore();
  $("#marketMood").textContent = Math.round(mood);
  $("#marketMoodText").textContent = mood >= 25 ? "情绪强" : mood >= 10 ? "偏暖" : "一般";

  const hotSector = state.sectors[0];
  $("#sectorScore").textContent = hotSector ? pct(hotSector.changePct) : "--";
  $("#sectorScoreText").textContent = hotSector ? hotSector.name : "等待匹配";

  const limitMatch = stock ? state.limitUp.find((item) => item.code === stock.code) : null;
  $("#limitScore").textContent = limitMatch ? limitCandidateScore(limitMatch) : "--";
  $("#limitScoreText").textContent = limitMatch ? `${limitMatch.boardCount || 1}板 ${timeLabel(limitMatch.firstLimitTime)}` : "非涨停池";

  if (!stock) return;
  $("#quoteMetrics").innerHTML = [
    ["现价", fmt.format(stock.price), pct(stock.changePct), tone(stock.changePct)],
    ["成交额", money(stock.amount), `换手 ${pct(stock.turnover)}`, ""],
    ["量比", fmt.format(stock.volumeRatio || 0), `流通市值 ${money(stock.floatMarketCap)}`, ""],
    ["估值", `PE ${stock.pe || "--"}`, `PB ${stock.pb || "--"}`, ""],
    ["开盘", fmt.format(stock.open), `昨收 ${fmt.format(stock.previousClose)}`, ""],
    ["区间", `${fmt.format(stock.low)} - ${fmt.format(stock.high)}`, `涨速 ${pct(stock.speed)}`, tone(stock.speed)]
  ].map(([label, value, sub, cls]) => `
    <div class="metric">
      <span>${label}</span>
      <strong class="${cls}">${value}</strong>
      <small>${sub}</small>
    </div>
  `).join("");

  const ths = thsInputs();
  const synthetic = {
    ...stock,
    source: limitMatch ? "涨停接力" : Number(stock.changePct || 0) >= 9.7 ? "强势首板" : "强势冲板",
    ...(limitMatch || {})
  };
  const predict = futureLimitScore(synthetic);
  const temper = stockTemperScore(synthetic);
  const price = Number(stock.price || 0);
  const s = state.settings;
  const tBuy = price * (1 - s.dipBuy / 100);
  const tSell = price * (1 + s.tRiseSell / 100);
  const stopPrice = price * (1 - s.stopLoss / 100);
  const warnings = [];
  if (predict >= 82 && temper >= 70) warnings.push("AI 认为它属于明日涨停高关注候选，但仍要等竞价和板块确认。");
  else if (predict >= s.minScore) warnings.push("AI 认为它有交易价值，更适合按条件参与，不适合无脑追高。");
  else warnings.push("AI 预测分未达到你当前设置的最低门槛，先观察更合适。");
  if (temper >= 75) warnings.push("股性较好，成交活跃且承接条件相对友好。");
  else if (temper < 60) warnings.push("股性一般，容易冲高回落或分时剧烈波动。");
  if (Number(stock.turnover) > s.maxTurnover) warnings.push(`换手超过你设置的 ${s.maxTurnover}%，按规则应降低仓位或放弃。`);
  if (limitMatch?.brokenCount > 5) warnings.push("今天炸板次数较多，明天接力需要更苛刻。");
  if (ths.score > 8) warnings.push("同花顺参考项加分明显，说明短线人气可能正在聚集。");
  if (state.chan?.signal) warnings.push(`缠论结构：${state.chan.trend}，${state.chan.signal}；结构分 ${state.chan.score}。`);

  $("#assistantView").innerHTML = `
    <h3>AI 预测与操作建议</h3>
    <p>${warnings.join(" ")}</p>
    <div class="trade-plan">
      <span>明日涨停预测 <b>${predict}</b></span>
      <span>股性评分 <b>${temper}</b></span>
      <span>低吸参考 <b>${fmt.format(tBuy)}</b></span>
      <span>T卖参考 <b>${fmt.format(tSell)}</b></span>
      <span>止损参考 <b>${fmt.format(stopPrice)}</b></span>
    </div>
    <p>执行规则：高开超过 ${s.maxHighOpen}% 不追；回落 ${s.dipBuy}% 附近有承接才低吸；冲高 ${s.tRiseSell}% 附近优先减T；跌破止损价或亏损 ${s.stopLoss}% 走。买卖必须由你本人确认。</p>
  `;

  const code = stock.code;
  $("#openEastmoney").onclick = () => window.open(`https://quote.eastmoney.com/${code.startsWith("6") ? "sh" : "sz"}${code}.html`, "_blank");
  $("#thsSearch").href = `https://www.iwencai.com/unifiedwap/result?w=${encodeURIComponent(`${stock.name} ${stock.code} 人气排名 主力资金 涨停原因`)}`;
  $("#openIwc").onclick = () => {
    const query = $("#thsQuery").value || `${stock.name} 短线强势`;
    window.open(`https://www.iwencai.com/unifiedwap/result?w=${encodeURIComponent(query)}`, "_blank");
  };
}

function renderTradingAgents(data) {
  const view = $("#tradingAgentsView");
  if (!view) return;
  if (!data) {
    view.textContent = "选择股票后可运行多角色分析：技术、资金、风险、交易员。";
    return;
  }
  const quote = data.quote || {};
  const levels = data.levels || {};
  const pnlText = data.pnl === null || data.pnl === undefined ? "未填写持仓" : `${data.pnl >= 0 ? "+" : ""}${fmt.format(data.pnl)} 元`;
  view.innerHTML = `
    <div class="agents-summary">
      <span>综合分<b>${data.composite ?? "--"}</b></span>
      <span>结论<b>${data.action || "--"}</b></span>
      <span>当前价<b>${fmt.format(quote.price || 0)}</b></span>
      <span>浮盈亏<b class="${Number(data.pnl || 0) >= 0 ? "red" : "green"}">${pnlText}</b></span>
    </div>
    <div class="agents-summary">
      <span>支撑<b>${fmt.format(levels.support || 0)}</b></span>
      <span>压力<b>${fmt.format(levels.resistance || 0)}</b></span>
      <span>利润保护<b>${fmt.format(levels.profitProtect || 0)}</b></span>
      <span>风控止损<b>${fmt.format(levels.stop || 0)}</b></span>
    </div>
    <div class="agent-list">
      ${(data.agents || []).map((agent) => `
        <div class="agent-card">
          <strong>${agent.role}<span>${agent.score}</span></strong>
          <div>${agent.view}</div>
        </div>
      `).join("")}
    </div>
    ${(data.dataWarnings || []).length ? `<p class="amber">${data.dataWarnings.join(" ")}</p>` : ""}
    <p class="sector-meta">兼容 ${data.upstream?.project || "TradingAgents"}，A股映射代码 ${data.upstream?.ticker || "--"}。当前结果基于东方财富实时行情与资金流，本模块只给建议，不自动下单。</p>
  `;
}

async function runTradingAgents() {
  if (!state.selected?.code) {
    alert("请先选择一只股票");
    return;
  }
  const view = $("#tradingAgentsView");
  if (view) view.textContent = "多智能体分析中...";
  const params = new URLSearchParams({ code: state.selected.code });
  const cost = $("#agentCost")?.value;
  const shares = $("#agentShares")?.value;
  if (cost) params.set("cost", cost);
  if (shares) params.set("shares", shares);
  const data = await api(`/api/trading-agents?${params.toString()}`);
  renderTradingAgents(data);
}

function renderKline() {
  const rows = state.kline || [];
  const canvas = $("#klineCanvas");
  const tbody = $("#klineTable");
  if (!canvas || !tbody) return;
  tbody.innerHTML = rows.slice(-12).reverse().map((row) => `
    <tr>
      <td>${row.date}</td>
      <td>${fmt.format(row.open)}</td>
      <td class="${tone(row.changePct)}">${fmt.format(row.close)}</td>
      <td>${fmt.format(row.high)}</td>
      <td>${fmt.format(row.low)}</td>
      <td class="${tone(row.changePct)}">${pct(row.changePct)}</td>
      <td>${money(row.amount)}</td>
      <td>${pct(row.turnover)}</td>
    </tr>
  `).join("") || `<tr><td colspan="8">暂无K线数据</td></tr>`;

  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 880;
  const height = 320;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  if (!rows.length) {
    ctx.fillStyle = "#66727f";
    ctx.fillText("暂无K线数据", 20, 30);
    return;
  }
  const data = rows.slice(-40);
  const padding = { left: 48, right: 18, top: 18, bottom: 28 };
  const highs = data.map((row) => row.high);
  const lows = data.map((row) => row.low);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const range = Math.max(0.01, max - min);
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const xStep = plotW / data.length;
  const y = (price) => padding.top + (max - price) / range * plotH;

  ctx.strokeStyle = "#dbe2e8";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const gy = padding.top + plotH * i / 4;
    ctx.beginPath();
    ctx.moveTo(padding.left, gy);
    ctx.lineTo(width - padding.right, gy);
    ctx.stroke();
    ctx.fillStyle = "#66727f";
    ctx.fillText(fmt.format(max - range * i / 4), 6, gy + 4);
  }

  data.forEach((row, index) => {
    const x = padding.left + index * xStep + xStep / 2;
    const up = row.close >= row.open;
    const color = up ? "#d93025" : "#16834a";
    const bodyTop = y(Math.max(row.open, row.close));
    const bodyBottom = y(Math.min(row.open, row.close));
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y(row.high));
    ctx.lineTo(x, y(row.low));
    ctx.stroke();
    const bodyW = Math.max(3, xStep * 0.56);
    const bodyH = Math.max(2, bodyBottom - bodyTop);
    if (up) {
      ctx.strokeRect(x - bodyW / 2, bodyTop, bodyW, bodyH);
    } else {
      ctx.fillRect(x - bodyW / 2, bodyTop, bodyW, bodyH);
    }
  });
}

async function loadKline(code = state.selected?.code, period = state.klinePeriod) {
  state.klinePeriod = period;
  document.querySelectorAll("[data-kline-period]").forEach((button) => {
    button.classList.toggle("active", button.dataset.klinePeriod === period);
  });
  if (!code) {
    state.kline = [];
    state.chan = null;
    renderKline();
    renderChanAnalysis();
    return;
  }
  const data = await api(`/api/kline?code=${code}&period=${period}&limit=${period === "week" ? 120 : 60}`);
  state.kline = data.klines || [];
  state.chan = data.chan || null;
  renderKline();
  renderChanAnalysis();
  renderQuote();
}

function renderChanAnalysis(data = state.chan) {
  const box = $("#chanView");
  if (!box) return;
  if (!data) {
    box.innerHTML = `
      <div class="panel-head slim">
        <h3>缠论结构分析</h3>
        <span>分型 / 笔 / 中枢 / 背驰</span>
      </div>
      <p>选择股票后，根据日 K 线自动识别结构信号。</p>
    `;
    return;
  }
  const zone = data.latestZone;
  const stroke = data.latestStroke;
  const divergence = data.divergence;
  const scoreClass = Number(data.score || 0) >= 68 ? "red" : Number(data.score || 0) <= 42 ? "green" : "amber";
  box.innerHTML = `
    <div class="panel-head slim">
      <h3>缠论结构分析</h3>
      <span>轻量模型，需结合成交量和盘中资金确认</span>
    </div>
    <div class="chan-summary">
      <span>结构分<b class="${scoreClass}">${data.score ?? "--"}</b></span>
      <span>走势<b>${data.trend || "--"}</b></span>
      <span>信号<b>${data.signal || "--"}</b></span>
    </div>
    <p>${data.risk || "等待结构确认。"}</p>
    <div class="chan-grid">
      <div>
        <strong>最近中枢</strong>
        <span>${zone ? `${zone.from} 至 ${zone.to} · ${zone.lower}-${zone.upper}` : "暂未形成清晰中枢"}</span>
      </div>
      <div>
        <strong>最近一笔</strong>
        <span>${stroke ? `${stroke.direction === "up" ? "向上" : "向下"} · ${stroke.from} 至 ${stroke.to} · 力度 ${fmt.format(stroke.power || 0)}` : "暂未形成有效笔"}</span>
      </div>
      <div>
        <strong>背驰判断</strong>
        <span>${divergence ? `${divergence.type} · 旧力度 ${fmt.format(divergence.previousPower)} / 新力度 ${fmt.format(divergence.latestPower)}` : "未出现明显背驰"}</span>
      </div>
    </div>
    <div class="chan-strokes">
      ${(data.strokes || []).slice(-5).map((item) => `
        <span>${item.direction === "up" ? "上笔" : "下笔"} ${item.from.slice(5)}-${item.to.slice(5)}</span>
      `).join("") || "<span>暂无笔结构</span>"}
    </div>
  `;
}

function appendChatMessage(role, text) {
  const box = $("#stockChatMessages");
  if (!box) return;
  const node = document.createElement("div");
  node.className = `chat-message ${role}`;
  node.innerHTML = `<strong>${role === "user" ? "你" : "AI智能助手"}</strong><p>${String(text).replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]))}</p>`;
  box.appendChild(node);
  box.scrollTop = box.scrollHeight;
}

async function sendStockChat(message) {
  const selected = state.selected || {};
  const context = {
    code: selected.code,
    cost: $("#agentCost")?.value || "",
    shares: $("#agentShares")?.value || ""
  };
  appendChatMessage("user", message);
  appendChatMessage("assistant", "分析中...");
  const box = $("#stockChatMessages");
  const pending = box?.lastElementChild;
  const response = await fetch("/api/stock-chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, context })
  });
  const data = await response.json();
  if (!response.ok || data?.error) throw new Error(data?.error || "问答接口失败");
  if (pending) pending.querySelector("p").textContent = data.answer;
}

async function loadAll(options = {}) {
  if (!options.fromRealtime) $("#updatedAt").textContent = "刷新中";
  const [indices, sectors, limitUp, movers, activeStocks, fundFlow] = await Promise.all([
    safeApi("/api/indices"),
    safeApi(`/api/sectors?type=${state.sectorType}`),
    safeApi("/api/limit-up"),
    safeApi("/api/movers"),
    safeApi("/api/active-stocks"),
    safeApi(`/api/fund-flow?type=${state.fundFlowType}`)
  ]);
  state.indices = indices;
  state.sectors = sectors;
  state.limitUp = limitUp;
  state.movers = movers;
  state.activeStocks = activeStocks;
  state.fundFlow = fundFlow;
  renderIndices();
  renderSectors();
  renderFundFlow();
  await loadSectorFlowLines().catch(() => renderSectorFlowChart());
  renderMarketBias();
  renderFirstBoard();
  renderHighOpenAccuracy();
  autoSaveHighOpenSnapshotIfNeeded().catch((error) => console.warn("尾盘冲高预测自动记录失败", error));
  renderPredictions();
  renderPredictionAccuracy();
  renderQuote();
  $("#updatedAt").textContent = `已同步 ${new Date().toLocaleTimeString("zh-CN", { hour12: false })} · 15秒自动刷新`;
}

async function refreshSelectedStock({ refreshKline = false } = {}) {
  const code = state.selected?.code || $("#stockInput").value.replace(/\D/g, "").slice(0, 6);
  if (!code || code.length !== 6) return;
  state.selected = await safeApi(`/api/quote?code=${code}`, state.selected);
  renderQuote();
  const now = Date.now();
  if (refreshKline || now - lastKlineRefreshAt >= KLINE_REFRESH_MS) {
    lastKlineRefreshAt = now;
    loadKline(code).catch((error) => {
      $("#klineTable").innerHTML = `<tr><td colspan="8">${error.message}</td></tr>`;
    });
  }
}

async function analyze(code) {
  const clean = String(code || "").replace(/\D/g, "").slice(0, 6);
  if (clean.length !== 6) {
    alert("请输入 6 位 A 股代码");
    return;
  }
  $("#stockInput").value = clean;
  state.selected = await api(`/api/quote?code=${clean}`);
  renderQuote();
  renderTradingAgents(null);
  lastKlineRefreshAt = Date.now();
  loadKline(clean).catch((error) => {
    $("#klineTable").innerHTML = `<tr><td colspan="8">${error.message}</td></tr>`;
  });
}

function selectStockFromList(code) {
  analyze(code).then(() => {
    document.querySelector(".quote-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }).catch((error) => alert(error.message));
}

$("#searchForm").addEventListener("submit", (event) => {
  event.preventDefault();
  analyze($("#stockInput").value).catch((error) => alert(error.message));
});

$("#refreshAll").addEventListener("click", () => refreshRealtimeData().catch((error) => alert(error.message)));
$("#reloadFirstBoard").addEventListener("click", () => refreshRealtimeData().catch((error) => alert(error.message)));
$("#saveHighOpenSnapshot").addEventListener("click", () => saveHighOpenSnapshot().catch((error) => alert(error.message)));
$("#refreshHighOpenHistory").addEventListener("click", () => loadHighOpenHistory().catch((error) => alert(error.message)));
$("#highOpenMinPrice")?.addEventListener("input", readHighOpenFilter);
$("#highOpenMaxPrice")?.addEventListener("input", readHighOpenFilter);
$("#resetHighOpenFilter")?.addEventListener("click", () => {
  state.highOpenFilter = { minPrice: "", maxPrice: "" };
  localStorage.setItem("stock-high-open-filter", JSON.stringify(state.highOpenFilter));
  syncHighOpenFilter();
  renderFirstBoard();
});
$("#savePredictionSnapshot").addEventListener("click", () => savePredictionSnapshot().catch((error) => alert(error.message)));
$("#refreshPredictionHistory").addEventListener("click", () => loadPredictionHistory().catch((error) => alert(error.message)));
$("#toggleFlowFullscreen").addEventListener("click", toggleFlowFullscreen);
$("#sectorFlowCanvas").addEventListener("mousemove", showSectorFlowTooltip);
$("#sectorFlowCanvas").addEventListener("mouseleave", hideSectorFlowTooltip);
window.addEventListener("resize", renderSectorFlowChart);
document.addEventListener("fullscreenchange", () => {
  $("#toggleFlowFullscreen").textContent = document.fullscreenElement ? "退出全屏" : "全屏";
  setTimeout(renderSectorFlowChart, 80);
});
$("#runTradingAgents").addEventListener("click", () => runTradingAgents().catch((error) => {
  $("#tradingAgentsView").textContent = error.message;
}));
$("#reloadKline").addEventListener("click", () => loadKline().catch((error) => alert(error.message)));
document.querySelectorAll("[data-kline-period]").forEach((button) => {
  button.addEventListener("click", () => {
    loadKline(state.selected?.code, button.dataset.klinePeriod).catch((error) => alert(error.message));
  });
});
$("#stockChatForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("#stockChatInput");
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  sendStockChat(message).catch((error) => appendChatMessage("assistant", error.message));
});
$("#clearStockChat").addEventListener("click", () => {
  $("#stockChatMessages").innerHTML = `
    <div class="chat-message assistant">
      <strong>AI智能助手</strong>
      <p>我会结合当前选中股票、成本、股数、实时行情、资金流和多智能体分析回答。示例：现在京东方A要不要卖？金风科技可买吗？</p>
    </div>
  `;
});
$("#reloadLimit").addEventListener("click", () => Promise.all([api("/api/limit-up"), api("/api/movers"), api("/api/active-stocks")]).then(([limitUp, movers, activeStocks]) => {
  state.limitUp = limitUp;
  state.movers = movers;
  state.activeStocks = activeStocks;
  renderFirstBoard();
  renderPredictions();
  renderQuote();
}));

$("#toggleSector").addEventListener("click", async () => {
  state.sectorType = state.sectorType === "industry" ? "concept" : "industry";
  $("#toggleSector").textContent = state.sectorType === "industry" ? "概念" : "行业";
  state.sectors = await api(`/api/sectors?type=${state.sectorType}`);
  renderSectors();
  renderPredictions();
  renderQuote();
});

$("#toggleSectorPanel").addEventListener("click", () => {
  state.sectorPanelCollapsed = !state.sectorPanelCollapsed;
  localStorage.setItem("stock-sector-panel-collapsed", state.sectorPanelCollapsed ? "1" : "0");
  renderSectorPanelState();
});

$("#toggleFundFlow").addEventListener("click", async () => {
  state.fundFlowType = state.fundFlowType === "sector" ? "stock" : "sector";
  $("#toggleFundFlow").textContent = state.fundFlowType === "sector" ? "个股" : "行业";
  state.fundFlow = await api(`/api/fund-flow?type=${state.fundFlowType}`);
  renderFundFlow();
  renderPredictions();
  renderQuote();
});

document.querySelectorAll("[data-flow-period]").forEach((button) => {
  button.addEventListener("click", () => {
    loadSectorFlowLines(button.dataset.flowPeriod).catch((error) => alert(error.message));
  });
});

$("#addWatch").addEventListener("click", () => {
  const code = $("#stockInput").value.replace(/\D/g, "").slice(0, 6);
  if (code.length !== 6 || state.watch.includes(code)) return;
  state.watch.unshift(code);
  localStorage.setItem("stock-watch", JSON.stringify(state.watch.slice(0, 12)));
  renderWatch();
});

$("#watchList").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-code]");
  if (button) selectStockFromList(button.dataset.code);
});

$("#aiPicks").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-code]");
  if (button) selectStockFromList(button.dataset.code);
});

$("#predictionTable").addEventListener("click", (event) => {
  if (event.target.closest("a")) return;
  const target = event.target.closest("[data-code]");
  if (target) selectStockFromList(target.dataset.code);
});

$("#firstBoardTable").addEventListener("click", (event) => {
  if (event.target.closest("a")) return;
  const target = event.target.closest("[data-code]");
  if (target) selectStockFromList(target.dataset.code);
});

$("#expertTradeForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const code = $("#expertCode").value.replace(/\D/g, "").slice(0, 6);
  if (code.length !== 6) {
    alert("请输入 6 位股票代码。");
    return;
  }
  const record = {
    id: `${Date.now()}-${code}`,
    expert: $("#expertName").value.trim(),
    returnRate: Number($("#expertReturn").value || 0),
    wins: Number($("#expertWins").value || 0),
    samples: Number($("#expertSamples").value || 1),
    drawdown: Number($("#expertDrawdown").value || 0),
    code,
    stock: $("#expertStock").value.trim(),
    action: $("#expertAction").value,
    price: Number($("#expertPrice").value || 0),
    position: $("#expertPosition").value.trim(),
    reason: $("#expertReason").value.trim(),
    createdAt: new Date().toLocaleString("zh-CN", { hour12: false })
  };
  state.expertTrades.unshift(record);
  state.expertTrades = state.expertTrades.slice(0, 80);
  saveExpertTrades();
  renderExpertTrades();
  $("#expertTradeForm").reset();
});

$("#expertTradeList").addEventListener("click", (event) => {
  const target = event.target.closest("[data-code]");
  if (target) selectStockFromList(target.dataset.code);
});

$("#clearExpertTrades").addEventListener("click", () => {
  if (!confirm("确认清空高手交易参考记录？")) return;
  state.expertTrades = [];
  saveExpertTrades();
  renderExpertTrades();
});

$("#openExpertSearch").addEventListener("click", () => {
  const query = encodeURIComponent("同花顺 高收益 公开组合 实盘 交易记录 收益率");
  window.open(`https://www.iwencai.com/unifiedwap/result?w=${query}`, "_blank");
});

["thsRank", "thsFund", "thsTheme"].forEach((id) => {
  $(`#${id}`).addEventListener("input", renderQuote);
});

["setMinScore", "setMaxTurnover", "setMaxHighOpen", "setDipBuy", "setTRiseSell", "setStopLoss", "setStyle", "setOnlyGoodTemper"].forEach((id) => {
  $(`#${id}`).addEventListener("input", readSettingsForm);
  $(`#${id}`).addEventListener("change", readSettingsForm);
});

$("#resetSettings").addEventListener("click", () => {
  state.settings = { ...DEFAULT_SETTINGS };
  localStorage.setItem("stock-settings", JSON.stringify(state.settings));
  syncSettingsForm();
  renderPredictions();
  renderQuote();
});

$("#autoPick").addEventListener("click", () => {
  renderPredictions();
  const first = $("#aiPicks button[data-code]");
  if (first) analyze(first.dataset.code).catch((error) => alert(error.message));
});

$("#openThsLogin").addEventListener("click", () => {
  window.open("https://www.10jqka.com.cn/", "_blank");
});

$("#openThsStock").addEventListener("click", () => {
  if (!state.selected) {
    alert("请先选择一只股票");
    return;
  }
  window.open(`https://stockpage.10jqka.com.cn/${state.selected.code}/`, "_blank");
});

$("#copyTPlan").addEventListener("click", async () => {
  const text = currentTradePlanText();
  try {
    await navigator.clipboard.writeText(text);
    $("#manualTradeLog").textContent = "T计划已复制。请在同花顺中核对价格、仓位和账户状态后手动确认。";
  } catch {
    $("#manualTradeLog").textContent = text;
  }
});

$("#markManualTrade").addEventListener("click", () => {
  const stock = state.selected;
  if (!stock) {
    alert("请先选择一只股票");
    return;
  }
  $("#manualTradeLog").textContent = `${new Date().toLocaleString("zh-CN", { hour12: false })} 已记录：${stock.name} ${stock.code} 由用户手动执行/处理。`;
});

renderWatch();
renderExpertTrades();
syncSettingsForm();
syncHighOpenFilter();
initCollapsiblePanels();
renderSectorPanelState();
startRealtimeSync();
loadHighOpenHistory().catch(() => renderHighOpenAccuracy());
loadPredictionHistory().catch(() => renderPredictionAccuracy());
loadAll().then(() => analyze(state.watch[0])).catch((error) => {
  $("#updatedAt").textContent = error.message;
});
