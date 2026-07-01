import http from "node:http";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const dataDir = join(root, "data");
const predictionHistoryFile = join(dataDir, "prediction-history.json");
const highOpenHistoryFile = join(dataDir, "high-open-history.json");
const overnightHistoryFile = join(dataDir, "overnight-history.json");
const port = Number(process.env.PORT || 3788);
const execFileAsync = promisify(execFile);
const curlCommand = process.platform === "win32" ? "curl.exe" : "curl";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

async function fetchJson(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 9000);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "user-agent": "Mozilla/5.0 stock-ai-assistant",
          "referer": "https://quote.eastmoney.com/"
        }
      });
      clearTimeout(timeout);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const text = await response.text();
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
    }
    try {
      const { stdout } = await execFileAsync(curlCommand, [
        "--noproxy",
        "*",
        "-s",
        "--retry",
        "2",
        "--retry-delay",
        "1",
        "--max-time",
        "9",
        "-A",
        "Mozilla/5.0 stock-ai-assistant",
        "-e",
        "https://quote.eastmoney.com/",
        url
      ], { maxBuffer: 1024 * 1024 * 8 });
      if (stdout.trim()) {
        return JSON.parse(stdout);
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("fetch failed");
}

function chinaDate(offsetDays = 0) {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1000 + offsetDays * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function compactDate(dateText) {
  return String(dateText || "").replaceAll("-", "");
}

function nextTradeDate(dateText = chinaDate()) {
  const [year, month, day] = String(dateText).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  do {
    date.setUTCDate(date.getUTCDate() + 1);
  } while ([0, 6].includes(date.getUTCDay()));
  return date.toISOString().slice(0, 10);
}

async function readPredictionHistory() {
  try {
    const text = await readFile(predictionHistoryFile, "utf8");
    const data = JSON.parse(text);
    return {
      snapshots: Array.isArray(data.snapshots) ? data.snapshots : []
    };
  } catch {
    return { snapshots: [] };
  }
}

async function writePredictionHistory(data) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(predictionHistoryFile, JSON.stringify(data, null, 2), "utf8");
}

async function readHighOpenHistory() {
  try {
    const text = await readFile(highOpenHistoryFile, "utf8");
    const data = JSON.parse(text);
    return {
      snapshots: Array.isArray(data.snapshots) ? data.snapshots : []
    };
  } catch {
    return { snapshots: [] };
  }
}

async function writeHighOpenHistory(data) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(highOpenHistoryFile, JSON.stringify(data, null, 2), "utf8");
}

async function readOvernightHistory() {
  try {
    const text = await readFile(overnightHistoryFile, "utf8");
    const data = JSON.parse(text);
    return {
      snapshots: Array.isArray(data.snapshots) ? data.snapshots : []
    };
  } catch {
    return { snapshots: [] };
  }
}

async function writeOvernightHistory(data) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(overnightHistoryFile, JSON.stringify(data, null, 2), "utf8");
}

function normalizePredictions(rows = []) {
  return rows
    .filter((item) => item?.code && item?.name)
    .slice(0, 30)
    .map((item, index) => ({
      rank: index + 1,
      code: String(item.code).padStart(6, "0").slice(0, 6),
      name: String(item.name || ""),
      probability: Number(item.probability || 0),
      source: String(item.source || ""),
      reason: String(item.reason || ""),
      temper: Number(item.temper || 0)
    }));
}

function normalizeHighOpenPredictions(rows = []) {
  return rows
    .filter((item) => item?.code && item?.name)
    .slice(0, 20)
    .map((item, index) => ({
      rank: index + 1,
      code: String(item.code).padStart(6, "0").slice(0, 6),
      name: String(item.name || ""),
      probability: Number(item.firstBoardProbability ?? item.highOpenProbability ?? item.probability ?? 0),
      source: String(item.source || "未涨停强势股"),
      trigger: String(item.trigger || ""),
      risk: String(item.risk || ""),
      changePct: Number(item.changePct || 0),
      turnover: Number(item.turnover || 0),
      volumeRatio: Number(item.volumeRatio || 0),
      amount: Number(item.amount || 0)
    }));
}

function normalizeOvernightPredictions(rows = []) {
  return rows
    .filter((item) => item?.code && item?.name)
    .slice(0, 30)
    .map((item, index) => ({
      rank: index + 1,
      code: String(item.code).padStart(6, "0").slice(0, 6),
      name: String(item.name || ""),
      probability: Number(item.overnightProbability ?? item.probability ?? 0),
      source: String(item.source || "一夜持股候选"),
      reason: String(item.reason || ""),
      risk: String(item.risk || ""),
      changePct: Number(item.changePct || 0),
      turnover: Number(item.turnover || 0),
      volumeRatio: Number(item.volumeRatio || 0),
      amount: Number(item.amount || 0),
      marketCap: Number(item.marketCap || item.floatMarketCap || 0),
      floatMarketCap: Number(item.floatMarketCap || 0),
      lastLimitDate: String(item.lastLimitDate || ""),
      aboveAverageStatus: String(item.aboveAverageStatus || "pending"),
      aboveAverageRatio: Number(item.aboveAverageRatio || 0),
      factors: Array.isArray(item.factors) ? item.factors.slice(0, 8).map(String) : []
    }));
}

function accuracyFor(predictions = [], hitCodes = new Set(), topN = predictions.length) {
  const selected = predictions.slice(0, topN);
  const hits = selected.filter((item) => hitCodes.has(item.code)).length;
  return {
    total: selected.length,
    hits,
    rate: selected.length ? Math.round((hits / selected.length) * 1000) / 10 : 0
  };
}

async function settlePredictionSnapshot(snapshot) {
  if (!snapshot?.targetDate || snapshot.status === "settled") return snapshot;
  if (snapshot.targetDate > chinaDate()) return snapshot;
  const actualPool = await limitUpPoolByDate(snapshot.targetDate);
  const hitCodes = new Set(actualPool.map((item) => item.code));
  const predictions = snapshot.predictions || [];
  return {
    ...snapshot,
    status: "settled",
    settledAt: new Date().toISOString(),
    actualLimitCount: actualPool.length,
    top5: accuracyFor(predictions, hitCodes, 5),
    top10: accuracyFor(predictions, hitCodes, 10),
    all: accuracyFor(predictions, hitCodes, predictions.length),
    hits: predictions
      .filter((item) => hitCodes.has(item.code))
      .map((item) => ({ code: item.code, name: item.name, rank: item.rank, probability: item.probability }))
  };
}

function summarizeAccuracy(snapshots = []) {
  const settled = snapshots.filter((item) => item.status === "settled");
  const sum = (field) => settled.reduce((acc, item) => ({
    hits: acc.hits + (item[field]?.hits || 0),
    total: acc.total + (item[field]?.total || 0)
  }), { hits: 0, total: 0 });
  const toRate = (value) => ({
    ...value,
    rate: value.total ? Math.round((value.hits / value.total) * 1000) / 10 : 0
  });
  const top5 = toRate(sum("top5"));
  const top10 = toRate(sum("top10"));
  const all = toRate(sum("all"));
  const best = [top5, top10, all].sort((a, b) => b.rate - a.rate)[0];
  return {
    settledDays: settled.length,
    pendingDays: snapshots.length - settled.length,
    top5,
    top10,
    all,
    suggestion: settled.length
      ? `历史最好区间命中率 ${best.rate}%，优先观察高概率前排，低分候选只做备选。`
      : "暂无已结算记录，先连续记录 3-5 个交易日后再调整模型阈值。"
  };
}

async function settleHighOpenSnapshot(snapshot) {
  if (!snapshot?.targetDate) return snapshot;
  const hasRushResults = (snapshot.results || []).some((item) => item.highRushPct !== undefined);
  if (snapshot.status === "settled" && hasRushResults) return snapshot;
  if (snapshot.targetDate > chinaDate()) return snapshot;
  const predictions = snapshot.predictions || [];
  const results = [];
  for (const item of predictions) {
    try {
      const rows = await dailyKlines(item.code, 20);
      const targetIndex = rows.findIndex((row) => row.date === snapshot.targetDate);
      if (targetIndex <= 0) {
        results.push({ ...item, hit: false, reason: "缺少目标日K线" });
        continue;
      }
      const prev = rows[targetIndex - 1];
      const target = rows[targetIndex];
      const prevWasLimit = Number(prev.changePct || 0) >= 9.7;
      const highRushPct = prev.close ? ((target.high - prev.close) / prev.close) * 100 : 0;
      const hit = !prevWasLimit && highRushPct >= 5;
      results.push({
        ...item,
        hit,
        highRushPct: Math.round(highRushPct * 100) / 100,
        highOpenPct: Math.round(highRushPct * 100) / 100,
        prevDate: prev.date,
        prevChangePct: prev.changePct,
        targetOpen: target.open,
        targetHigh: target.high,
        prevClose: prev.close,
        reason: hit ? "前日未涨停且次日盘中冲高>=5%" : "未满足盘中冲高>=5%或前日已涨停"
      });
    } catch (error) {
      results.push({ ...item, hit: false, reason: error.message || "结算失败" });
    }
  }
  const validResults = results.filter((item) => item.highRushPct !== undefined);
  if (!validResults.length) {
    return {
      ...snapshot,
      status: "pending",
      settleError: "No valid target-day kline data; keep pending instead of counting failures as misses.",
      lastTriedSettleAt: new Date().toISOString()
    };
  }
  const hitCodes = new Set(validResults.filter((item) => item.hit).map((item) => item.code));
  return {
    ...snapshot,
    status: "settled",
    settledAt: new Date().toISOString(),
    top5: accuracyFor(validResults, hitCodes, 5),
    top10: accuracyFor(validResults, hitCodes, 10),
    all: accuracyFor(validResults, hitCodes, validResults.length),
    results,
    hits: validResults.filter((item) => item.hit)
  };
}

function summarizeHighOpenAccuracy(snapshots = []) {
  const formalSnapshots = snapshots.filter((item) => (item.sampleType || "close30") === "close30");
  const previewCount = snapshots.filter((item) => item.sampleType === "preview").length;
  const summary = summarizeAccuracy(formalSnapshots.length ? formalSnapshots : snapshots);
  return {
    ...summary,
    formalDays: formalSnapshots.length,
    previewDays: previewCount,
    suggestion: summary.settledDays
      ? `冲高5%历史Top5命中率 ${summary.top5.rate}%，优先跟踪前排且前日未涨停的强势股。`
      : summary.pendingDays
        ? `已有 ${summary.pendingDays} 个待结算冲高样本，等目标交易日收盘后自动更新命中率。`
        : "暂无已结算冲高样本，先连续记录 3-5 个交易日后再评估模型。"
  };
}

async function settleOvernightSnapshot(snapshot) {
  if (!snapshot?.targetDate) return snapshot;
  if (snapshot.status === "settled" && (snapshot.results || []).some((item) => item.nextHighPct !== undefined)) return snapshot;
  if (snapshot.targetDate > chinaDate()) return snapshot;
  const predictions = snapshot.predictions || [];
  const results = [];
  for (const item of predictions) {
    try {
      const rows = await dailyKlines(item.code, 45);
      const targetIndex = rows.findIndex((row) => row.date === snapshot.targetDate);
      if (targetIndex <= 0) {
        results.push({ ...item, hit: false, reason: "缺少目标日K线，暂不计入有效样本" });
        continue;
      }
      const prev = rows[targetIndex - 1];
      const target = rows[targetIndex];
      const base = Number(prev.close || 0);
      const nextOpenPct = base ? ((target.open - base) / base) * 100 : 0;
      const nextHighPct = base ? ((target.high - base) / base) * 100 : 0;
      const nextClosePct = base ? ((target.close - base) / base) * 100 : 0;
      const maxDrawdownPct = base ? ((target.low - base) / base) * 100 : 0;
      const hit = nextHighPct >= 3 && maxDrawdownPct >= -3;
      results.push({
        ...item,
        hit,
        nextOpenPct: Math.round(nextOpenPct * 100) / 100,
        nextHighPct: Math.round(nextHighPct * 100) / 100,
        nextClosePct: Math.round(nextClosePct * 100) / 100,
        maxDrawdownPct: Math.round(maxDrawdownPct * 100) / 100,
        prevDate: prev.date,
        prevClose: prev.close,
        targetOpen: target.open,
        targetHigh: target.high,
        targetClose: target.close,
        targetLow: target.low,
        reason: hit ? "次日盘中高点达到+3%且回撤未破-3%" : "次日弹性或风控未达标"
      });
    } catch (error) {
      results.push({ ...item, hit: false, reason: error.message || "结算失败" });
    }
  }
  const validResults = results.filter((item) => item.nextHighPct !== undefined);
  if (!validResults.length) {
    return {
      ...snapshot,
      status: "pending",
      settleError: "No valid target-day kline data; keep pending instead of counting failures as misses.",
      lastTriedSettleAt: new Date().toISOString()
    };
  }
  const hitCodes = new Set(validResults.filter((item) => item.hit).map((item) => item.code));
  return {
    ...snapshot,
    status: "settled",
    settledAt: new Date().toISOString(),
    top5: accuracyFor(validResults, hitCodes, 5),
    top10: accuracyFor(validResults, hitCodes, 10),
    all: accuracyFor(validResults, hitCodes, validResults.length),
    results,
    hits: validResults.filter((item) => item.hit)
  };
}

function summarizeOvernightAccuracy(snapshots = []) {
  const summary = summarizeAccuracy(snapshots);
  const settled = snapshots.filter((item) => item.status === "settled");
  const resultRows = settled.flatMap((item) => item.results || []);
  const avgHigh = resultRows.length
    ? Math.round((resultRows.reduce((sum, item) => sum + Number(item.nextHighPct || 0), 0) / resultRows.length) * 100) / 100
    : 0;
  const avgClose = resultRows.length
    ? Math.round((resultRows.reduce((sum, item) => sum + Number(item.nextClosePct || 0), 0) / resultRows.length) * 100) / 100
    : 0;
  return {
    ...summary,
    avgHigh,
    avgClose,
    modelVersion: "overnight-tail-v1",
    suggestion: summary.settledDays
      ? `一夜持股Top5命中率 ${summary.top5.rate}%，平均次日高点 ${avgHigh}%，平均收盘 ${avgClose}%；低样本阶段只用于复盘调权。`
      : "暂无已结算一夜持股样本，先连续记录3-5个交易日，再根据Top5命中率调高或调低阈值。"
  };
}

function secidFromCode(rawCode) {
  const code = String(rawCode || "").replace(/\D/g, "").slice(0, 6);
  if (!/^\d{6}$/.test(code)) return null;
  const shPrefixes = ["5", "6", "9"];
  return `${shPrefixes.includes(code[0]) ? 1 : 0}.${code}`;
}

function yahooTickerFromCode(rawCode) {
  const code = String(rawCode || "").replace(/\D/g, "").slice(0, 6);
  if (!/^\d{6}$/.test(code)) return null;
  return `${code}.${["5", "6", "9"].includes(code[0]) ? "SS" : "SZ"}`;
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function moneyWan(value) {
  return Math.round(num(value) / 10000);
}

function normalizeStock(row) {
  return {
    code: row.f12,
    name: row.f14,
    price: row.f2,
    changePct: row.f3,
    change: row.f4,
    volume: row.f5,
    amount: row.f6,
    turnover: row.f8,
    pe: row.f9,
    volumeRatio: row.f10,
    high: row.f15,
    low: row.f16,
    open: row.f17,
    previousClose: row.f18,
    marketCap: row.f20,
    floatMarketCap: row.f21,
    speed: row.f22,
    pb: row.f23
  };
}

const fallbackIndices = [
  { code: "000001", name: "上证指数", price: 2988.42, changePct: 0.46, change: 13.7, volume: 0, amount: 428000000000, turnover: 0, pe: 0, volumeRatio: 1.02, high: 2996.8, low: 2968.2, open: 2972.3, previousClose: 2974.7, marketCap: 0, floatMarketCap: 0, speed: 0.01, pb: 0 },
  { code: "399001", name: "深证成指", price: 9328.6, changePct: 0.82, change: 75.9, volume: 0, amount: 612000000000, turnover: 0, pe: 0, volumeRatio: 1.08, high: 9362.1, low: 9230.2, open: 9248.3, previousClose: 9252.7, marketCap: 0, floatMarketCap: 0, speed: 0.02, pb: 0 },
  { code: "399006", name: "创业板指", price: 1816.3, changePct: 1.15, change: 20.6, volume: 0, amount: 268000000000, turnover: 0, pe: 0, volumeRatio: 1.12, high: 1824.5, low: 1792.1, open: 1797.4, previousClose: 1795.7, marketCap: 0, floatMarketCap: 0, speed: 0.03, pb: 0 },
  { code: "000300", name: "沪深300", price: 3548.9, changePct: 0.58, change: 20.4, volume: 0, amount: 286000000000, turnover: 0, pe: 0, volumeRatio: 1.03, high: 3560.2, low: 3524.8, open: 3529.1, previousClose: 3528.5, marketCap: 0, floatMarketCap: 0, speed: 0.01, pb: 0 },
  { code: "000688", name: "科创50", price: 742.6, changePct: 1.34, change: 9.8, volume: 0, amount: 86000000000, turnover: 0, pe: 0, volumeRatio: 1.18, high: 746.8, low: 729.4, open: 732.2, previousClose: 732.8, marketCap: 0, floatMarketCap: 0, speed: 0.04, pb: 0 }
];

const fallbackStocks = [
  { code: "300059", name: "东方财富", price: 15.86, changePct: 3.12, change: 0.48, volume: 0, amount: 5200000000, turnover: 5.8, pe: 31.2, volumeRatio: 1.55, high: 16.12, low: 15.22, open: 15.31, previousClose: 15.38, marketCap: 0, floatMarketCap: 238000000000, speed: 0.05, pb: 3.2 },
  { code: "600030", name: "中信证券", price: 20.42, changePct: 1.84, change: 0.37, volume: 0, amount: 3100000000, turnover: 2.3, pe: 17.6, volumeRatio: 1.18, high: 20.58, low: 20.02, open: 20.08, previousClose: 20.05, marketCap: 0, floatMarketCap: 226000000000, speed: 0.02, pb: 1.1 },
  { code: "002167", name: "东方锆业", price: 8.74, changePct: 6.2, change: 0.51, volume: 0, amount: 1800000000, turnover: 12.8, pe: 0, volumeRatio: 2.35, high: 8.92, low: 8.18, open: 8.25, previousClose: 8.23, marketCap: 0, floatMarketCap: 6200000000, speed: 0.11, pb: 4.8 },
  { code: "000725", name: "京东方A", price: 4.36, changePct: 2.59, change: 0.11, volume: 0, amount: 4200000000, turnover: 2.9, pe: 26.5, volumeRatio: 1.42, high: 4.42, low: 4.25, open: 4.27, previousClose: 4.25, marketCap: 0, floatMarketCap: 158000000000, speed: 0.03, pb: 1.3 },
  { code: "002202", name: "金风科技", price: 9.64, changePct: 4.56, change: 0.42, volume: 0, amount: 2100000000, turnover: 4.7, pe: 22.4, volumeRatio: 1.92, high: 9.78, low: 9.18, open: 9.2, previousClose: 9.22, marketCap: 0, floatMarketCap: 32000000000, speed: 0.07, pb: 1.5 },
  { code: "300666", name: "江丰电子", price: 62.8, changePct: 5.84, change: 3.46, volume: 0, amount: 1900000000, turnover: 6.6, pe: 58.2, volumeRatio: 2.18, high: 64.2, low: 59.3, open: 59.8, previousClose: 59.34, marketCap: 0, floatMarketCap: 12800000000, speed: 0.09, pb: 5.2 }
];

async function quote(reqUrl) {
  const code = reqUrl.searchParams.get("code");
  const secid = secidFromCode(code);
  if (!secid) {
    return { error: "请输入 6 位 A 股代码" };
  }
  const fields = "f12,f14,f2,f3,f4,f5,f6,f8,f9,f10,f15,f16,f17,f18,f20,f21,f22,f23";
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=${fields}&secids=${secid}`;
  const data = await fetchJson(url);
  const row = data?.data?.diff?.[0];
  return row ? normalizeStock(row) : { error: "没有查到这只股票" };
}

async function listBySecids(secids) {
  const fields = "f12,f14,f2,f3,f4,f5,f6,f8,f9,f10,f15,f16,f17,f18,f20,f21,f22,f23";
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=${fields}&secids=${secids}`;
  const data = await fetchJson(url);
  return (data?.data?.diff || []).map(normalizeStock);
}

async function indices() {
  try {
    return await listBySecids("1.000001,0.399001,0.399006,1.000300,1.000688");
  } catch {
    return fallbackIndices.map((item) => ({ ...item, estimated: true }));
  }
}

async function sectors(type = "industry") {
  const fs = type === "concept" ? "m:90+t:3" : "m:90+t:2";
  const fields = "f12,f14,f2,f3,f4,f5,f6,f8,f9,f10,f15,f16,f17,f18";
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=60&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${fs}&fields=${fields}`;
  try {
    const data = await fetchJson(url);
    return (data?.data?.diff || []).map((row) => ({
      code: row.f12,
      name: row.f14,
      price: row.f2,
      changePct: row.f3,
      amount: row.f6,
      turnover: row.f8,
      volumeRatio: row.f10
    }));
  } catch {
    return fallbackSectorFlows.slice(0, 10).map(([code, name, changePct, amount, volumeRatio]) => ({
      code,
      name,
      price: null,
      changePct,
      amount,
      turnover: 0,
      volumeRatio,
      estimated: true
    }));
  }
}

async function movers() {
  const fields = "f12,f14,f2,f3,f4,f5,f6,f8,f9,f10,f15,f16,f17,f18,f20,f21,f22,f23";
  const fs = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23";
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=80&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${fs}&fields=${fields}`;
  try {
    const data = await fetchJson(url);
    return (data?.data?.diff || []).map(normalizeStock).filter((item) => !item.name?.includes("ST"));
  } catch {
    return fallbackStocks.map((item) => ({ ...item, estimated: true }));
  }
}

async function activeStocks() {
  const fields = "f12,f14,f2,f3,f4,f5,f6,f8,f9,f10,f15,f16,f17,f18,f20,f21,f22,f23";
  const fs = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23";
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=150&po=1&np=1&fltt=2&invt=2&fid=f6&fs=${fs}&fields=${fields}`;
  try {
    const data = await fetchJson(url);
    return (data?.data?.diff || []).map(normalizeStock).filter((item) => !item.name?.includes("ST"));
  } catch {
    return fallbackStocks.map((item) => ({ ...item, estimated: true }));
  }
}

const fallbackSectorFlows = [
  ["BK1201", "电子", 4.3, 18700000000, 2.2],
  ["BK1215", "通信", 3.7, 10500000000, 6.1],
  ["BK1591", "通信网络设备及器件", 5.0, 9700000000, 9.0],
  ["BK0448", "通信设备", 4.1, 9600000000, 6.0],
  ["BK1038", "光学光电子", 6.1, 8800000000, 7.9],
  ["BK1335", "面板", 6.2, 7200000000, 10.5],
  ["BK0459", "元件", 3.6, 6300000000, 4.9],
  ["BK1340", "印制电路板", 4.6, 6200000000, 6.4],
  ["BK1207", "计算机", 2.5, 6200000000, 6.0],
  ["BK1200", "电力设备", 2.0, 3600000000, 2.1],
  ["BK1205", "机械设备", 2.2, 3600000000, 1.8],
  ["BK1408", "机器人", 5.8, 1200000000, 8.0]
];

const fallbackStockFlows = [
  ["000725", "京东方A", 6.2, 7200000000, 10.5],
  ["002475", "立讯精密", 3.6, 3400000000, 3.8],
  ["600522", "中天科技", 3.7, 1050000000, 6.1],
  ["300059", "东方财富", 2.5, 620000000, 2.1],
  ["600030", "中信证券", 1.2, 480000000, 1.6],
  ["002167", "东方锆业", 2.9, 360000000, 2.4]
];

function fallbackFundFlow(type = "sector") {
  const rows = type === "stock" ? fallbackStockFlows : fallbackSectorFlows;
  return rows.map(([code, name, changePct, mainNetInflow, mainNetRatio]) => ({
    code,
    name,
    price: null,
    changePct,
    mainNetInflow,
    superNetInflow: Math.round(mainNetInflow * 0.72),
    superNetRatio: Number((mainNetRatio * 0.72).toFixed(2)),
    largeNetInflow: Math.round(mainNetInflow * 0.28),
    largeNetRatio: Number((mainNetRatio * 0.28).toFixed(2)),
    midNetInflow: -Math.round(mainNetInflow * 0.55),
    midNetRatio: -Number((mainNetRatio * 0.55).toFixed(2)),
    smallNetInflow: -Math.round(mainNetInflow * 0.45),
    smallNetRatio: -Number((mainNetRatio * 0.45).toFixed(2)),
    mainNetRatio,
    estimated: true
  }));
}

async function fundFlow(type = "sector") {
  const fs = type === "stock" ? "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23" : "m:90+t:2";
  const fields = "f12,f14,f2,f3,f62,f66,f69,f72,f75,f78,f81,f84,f87,f184";
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=50&po=1&np=1&fltt=2&invt=2&fid=f62&fs=${fs}&fields=${fields}`;
  try {
    const data = await fetchJson(url);
    const rows = (data?.data?.diff || []).map((row) => ({
      code: row.f12,
      name: row.f14,
      price: row.f2,
      changePct: row.f3,
      mainNetInflow: row.f62,
      superNetInflow: row.f66,
      superNetRatio: row.f69,
      largeNetInflow: row.f72,
      largeNetRatio: row.f75,
      midNetInflow: row.f78,
      midNetRatio: row.f81,
      smallNetInflow: row.f84,
      smallNetRatio: row.f87,
      mainNetRatio: row.f184
    }));
    return rows.length ? rows : fallbackFundFlow(type);
  } catch {
    return fallbackFundFlow(type);
  }
}

async function quoteDetail(code) {
  const secid = secidFromCode(code);
  if (!secid) return null;
  try {
    const fields = "f43,f44,f45,f46,f47,f48,f50,f57,f58,f60,f168,f169,f170,f171";
    const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fltt=2&invt=2&fields=${fields}`;
    const data = await fetchJson(url);
    const row = data?.data;
    if (row) {
      return {
        code: row.f57,
        name: row.f58,
        price: row.f43,
        high: row.f44,
        low: row.f45,
        open: row.f46,
        volume: row.f47,
        amount: row.f48,
        volumeRatio: row.f50,
        previousClose: row.f60,
        turnover: row.f168,
        change: row.f169,
        changePct: row.f170,
        amplitude: row.f171
      };
    }
  } catch {
    // Fall through to the list quote API; Eastmoney sometimes closes stock/get.
  }
  const fields = "f12,f14,f2,f3,f4,f5,f6,f8,f10,f15,f16,f17,f18";
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=${fields}&secids=${secid}`;
  const data = await fetchJson(url);
  const row = data?.data?.diff?.[0];
  if (!row) return null;
  return {
    code: row.f12,
    name: row.f14,
    price: row.f2,
    high: row.f15,
    low: row.f16,
    open: row.f17,
    volume: row.f5,
    amount: row.f6,
    volumeRatio: row.f10,
    previousClose: row.f18,
    turnover: row.f8,
    change: row.f4,
    changePct: row.f3,
    amplitude: row.f18 ? ((num(row.f15) - num(row.f16)) / num(row.f18)) * 100 : 0
  };
}

function klinePeriodToKlt(period = "day") {
  if (period === "week") return "102";
  if (period === "month") return "103";
  return "101";
}

async function dailyKlines(code, limit = 30, period = "day") {
  const secid = secidFromCode(code);
  if (!secid) return [];
  const klt = klinePeriodToKlt(period);
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=${klt}&fqt=1&lmt=${limit}&end=20500101&iscca=1&fields1=f1,f2,f3,f4,f5,f6,f7,f8&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`;
  const data = await fetchJson(url);
  return (data?.data?.klines || []).map((line) => {
    const [date, open, close, high, low, volume, amount, amplitude, changePct, change, turnover] = line.split(",");
    return {
      date,
      open: num(open),
      close: num(close),
      high: num(high),
      low: num(low),
      volume: num(volume),
      amount: num(amount),
      amplitude: num(amplitude),
      changePct: num(changePct),
      change: num(change),
      turnover: num(turnover)
    };
  });
}

async function intradayAboveAverage(code) {
  const secid = secidFromCode(code);
  if (!secid) return { status: "pending", ratio: 0, reason: "invalid code" };
  const url = `https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&ndays=1&iscr=0&iscca=0&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58`;
  try {
    const data = await fetchJson(url);
    const rows = (data?.data?.trends || [])
      .map((line) => {
        const [time, price, avgPrice, volume, amount] = String(line).split(",");
        return { time, price: num(price), avgPrice: num(avgPrice), volume: num(volume), amount: num(amount) };
      })
      .filter((item) => item.price > 0 && item.avgPrice > 0);
    if (!rows.length) return { status: "pending", ratio: 0, reason: "intraday data missing" };
    const valid = rows.filter((item) => item.price >= item.avgPrice * 0.998);
    const ratio = valid.length / rows.length;
    return {
      status: ratio >= 0.95 ? "confirmed" : "failed",
      ratio: Math.round(ratio * 1000) / 10,
      firstTime: rows[0]?.time || "",
      lastTime: rows.at(-1)?.time || "",
      reason: ratio >= 0.95 ? "price stayed above avg line" : "price broke avg line"
    };
  } catch (error) {
    return { status: "pending", ratio: 0, reason: error.message || "intraday pending" };
  }
}

function hasLimitUpInMonth(rows = []) {
  const lookback = rows.slice(0, -1).slice(-30);
  const found = [...lookback].reverse().find((item) => Number(item.changePct || 0) >= 9.7);
  return found ? { ok: true, date: found.date, changePct: found.changePct } : { ok: false, date: "", changePct: 0 };
}

function overnightRawRejectReason(item) {
  const change = num(item.changePct);
  const turnover = num(item.turnover);
  const volumeRatio = num(item.volumeRatio);
  const marketCap = num(item.marketCap || item.floatMarketCap);
  if (item.name?.includes("ST")) return "ST";
  if (change < 3 || change > 5) return "change not 3-5";
  if (!marketCap || marketCap > 20000000000) return "market cap over 20b";
  if (volumeRatio <= 1) return "volume ratio <= 1";
  if (turnover < 5 || turnover > 10) return "turnover not 5-10";
  return "";
}

function overnightScore(item, klines = [], intraday = {}) {
  const change = num(item.changePct);
  const turnover = num(item.turnover);
  const volumeRatio = num(item.volumeRatio);
  const amount = num(item.amount);
  const marketCap = num(item.marketCap || item.floatMarketCap);
  const latest = klines.at(-1) || {};
  const prev = klines.at(-2) || {};
  const price = num(item.price || latest.close);
  const closeStrength = latest.high && latest.low ? ((price - latest.low) / Math.max(0.01, latest.high - latest.low)) * 100 : 50;
  const monthHigh = Math.max(...klines.slice(-22).map((row) => num(row.high)));
  const nearMonthHigh = monthHigh && price ? (price / monthHigh) * 100 : 0;
  let score = 46;
  score += change >= 3.2 && change <= 4.6 ? 16 : 7;
  score += turnover >= 6 && turnover <= 8.8 ? 13 : 5;
  score += volumeRatio >= 1.15 && volumeRatio <= 2.8 ? 12 : volumeRatio > 4 ? -8 : 4;
  score += amount >= 500000000 && amount <= 8000000000 ? 10 : amount > 0 ? 3 : -4;
  score += marketCap > 0 && marketCap <= 8000000000 ? 9 : marketCap <= 20000000000 ? 5 : -18;
  score += closeStrength >= 70 ? 8 : closeStrength >= 55 ? 4 : -8;
  score += nearMonthHigh >= 92 ? 6 : nearMonthHigh >= 82 ? 3 : -4;
  score += sectorHeatBonus(item.industry || item.name, item.code);
  if (intraday.status === "confirmed") score += 12;
  if (intraday.status === "pending") score -= 3;
  if (intraday.status === "failed") score -= 40;
  if (prev.changePct < -4 && latest.changePct > 4) score += 4;
  return Math.max(0, Math.min(99, Math.round(score)));
}

function overnightFactorText(item, limitInfo, intraday, klines = []) {
  const latest = klines.at(-1) || {};
  const price = num(item.price || latest.close);
  const closeStrength = latest.high && latest.low
    ? Math.round(((price - latest.low) / Math.max(0.01, latest.high - latest.low)) * 100)
    : 0;
  return [
    `gain ${num(item.changePct).toFixed(2)}%`,
    `limit ${limitInfo.date || "verified"}`,
    `cap ${Math.round(num(item.marketCap || item.floatMarketCap) / 100000000)}y`,
    `vr ${num(item.volumeRatio).toFixed(2)}`,
    `turn ${num(item.turnover).toFixed(2)}%`,
    intraday.status === "confirmed" ? `avg ${intraday.ratio}%` : "avg pending",
    closeStrength ? `close ${closeStrength}%` : ""
  ].filter(Boolean);
}

function fallbackOvernightCandidates() {
  return [
    {
      code: "002202",
      name: "金风科技",
      price: 9.64,
      changePct: 4.56,
      turnover: 6.2,
      volumeRatio: 1.92,
      amount: 2100000000,
      marketCap: 18000000000,
      floatMarketCap: 18000000000,
      lastLimitDate: chinaDate(-8),
      aboveAverageStatus: "pending",
      aboveAverageRatio: 0,
      overnightProbability: 72,
      source: "fallback sample",
      reason: "行情源降级样例：涨幅、近月涨停、市值、量比、换手满足，分时均价线需人工核验。",
      risk: "样例只用于页面兜底，不作为真实预测。",
      factors: ["gain 4.56%", "cap 180y", "vr 1.92", "turn 6.20%", "avg pending"],
      estimated: true
    }
  ];
}

async function overnightCandidates() {
  let pool = [];
  try {
    const [moverRows, activeRows] = await Promise.all([movers(), activeStocks()]);
    const byCode = new Map();
    [...moverRows, ...activeRows].forEach((item) => {
      if (!item?.code || byCode.has(item.code)) return;
      byCode.set(item.code, item);
    });
    pool = [...byCode.values()];
  } catch {
    pool = fallbackStocks;
  }
  const prefiltered = pool
    .filter((item) => !overnightRawRejectReason(item))
    .sort((a, b) => num(b.amount) - num(a.amount))
    .slice(0, 36);
  const rows = [];
  for (const item of prefiltered) {
    try {
      const klines = await dailyKlines(item.code, 36);
      const limitInfo = hasLimitUpInMonth(klines);
      if (!limitInfo.ok) continue;
      const intraday = await intradayAboveAverage(item.code);
      if (intraday.status === "failed") continue;
      const score = overnightScore(item, klines, intraday);
      if (score < 68) continue;
      const factors = overnightFactorText(item, limitInfo, intraday, klines);
      rows.push({
        ...item,
        marketCap: num(item.marketCap || item.floatMarketCap),
        lastLimitDate: limitInfo.date,
        aboveAverageStatus: intraday.status,
        aboveAverageRatio: intraday.ratio,
        overnightProbability: score,
        source: intraday.status === "confirmed" ? "avg-line confirmed" : "avg-line pending",
        reason: factors.slice(0, 5).join(" / "),
        risk: intraday.status === "confirmed"
          ? "仅用于尾盘记录验证；次日高开过多或跌破昨收需放弃。"
          : "分时均价线待核验，需在同花顺/东方财富人工确认全天强承接。",
        factors
      });
    } catch {
      // Keep the board responsive when a single stock data source fails.
    }
  }
  const sorted = rows.sort((a, b) => b.overnightProbability - a.overnightProbability).slice(0, 12);
  return sorted.length ? sorted : fallbackOvernightCandidates();
}

async function minuteFundFlow(code, limit = 12) {
  const secid = secidFromCode(code);
  if (!secid) return [];
  const url = `https://push2.eastmoney.com/api/qt/stock/fflow/kline/get?secid=${secid}&klt=1&lmt=${limit}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63`;
  const data = await fetchJson(url);
  return (data?.data?.klines || []).map((line) => {
    const [time, main, superFlow, large, medium, small] = line.split(",");
    return {
      time,
      main: num(main),
      super: num(superFlow),
      large: num(large),
      medium: num(medium),
      small: num(small)
    };
  });
}

async function sectorMinuteFundFlow(code, limit = 241) {
  const cleanCode = String(code || "").trim().toUpperCase();
  if (!/^BK\d{4}$/.test(cleanCode)) return [];
  const url = `https://push2.eastmoney.com/api/qt/stock/fflow/kline/get?secid=90.${cleanCode}&klt=1&lmt=${limit}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63`;
  const data = await fetchJson(url);
  return (data?.data?.klines || []).map((line) => {
    const [time, main, small, medium, large, superFlow] = line.split(",");
    return {
      time,
      main: num(main),
      super: num(superFlow),
      large: num(large),
      medium: num(medium),
      small: num(small)
    };
  });
}

async function sectorDailyFundFlow(code, limit = 22) {
  const cleanCode = String(code || "").trim().toUpperCase();
  if (!/^BK\d{4}$/.test(cleanCode)) return [];
  const url = `https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?secid=90.${cleanCode}&lmt=${limit}&klt=101&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58`;
  const data = await fetchJson(url);
  return (data?.data?.klines || []).map((line) => {
    const [time, main, small, medium, large, superFlow, mainRatio, smallRatio] = line.split(",");
    return {
      time,
      main: num(main),
      super: num(superFlow),
      large: num(large),
      medium: num(medium),
      small: num(small),
      mainRatio: num(mainRatio),
      smallRatio: num(smallRatio)
    };
  });
}

function movingAverage(rows, days) {
  const slice = rows.slice(-days);
  if (!slice.length) return 0;
  return slice.reduce((sum, row) => sum + row.close, 0) / slice.length;
}

function detectChanFractals(rows = []) {
  const fractals = [];
  for (let index = 1; index < rows.length - 1; index += 1) {
    const prev = rows[index - 1];
    const row = rows[index];
    const next = rows[index + 1];
    const top = row.high >= prev.high && row.high >= next.high && row.low >= prev.low && row.low >= next.low;
    const bottom = row.low <= prev.low && row.low <= next.low && row.high <= prev.high && row.high <= next.high;
    if (top) fractals.push({ type: "top", index, date: row.date, price: row.high, high: row.high, low: row.low });
    if (bottom) fractals.push({ type: "bottom", index, date: row.date, price: row.low, high: row.high, low: row.low });
  }
  return fractals;
}

function buildChanStrokes(fractals = [], rows = []) {
  const points = [];
  for (const fractal of fractals) {
    const last = points.at(-1);
    if (last?.type === fractal.type) {
      const stronger = fractal.type === "top" ? fractal.price >= last.price : fractal.price <= last.price;
      if (stronger) points[points.length - 1] = fractal;
      continue;
    }
    if (last && fractal.index - last.index < 3) continue;
    points.push(fractal);
  }
  const strokes = [];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const slice = rows.slice(start.index, end.index + 1);
    const high = Math.max(...slice.map((row) => row.high));
    const low = Math.min(...slice.map((row) => row.low));
    const amount = slice.reduce((sum, row) => sum + num(row.amount), 0);
    strokes.push({
      start,
      end,
      direction: end.type === "top" ? "up" : "down",
      high,
      low,
      power: Math.abs(end.price - start.price) * Math.max(1, amount / 100000000),
      bars: end.index - start.index
    });
  }
  return strokes;
}

function detectChanZones(strokes = []) {
  const zones = [];
  for (let index = 2; index < strokes.length; index += 1) {
    const group = strokes.slice(index - 2, index + 1);
    const upper = Math.min(...group.map((item) => item.high));
    const lower = Math.max(...group.map((item) => item.low));
    if (lower <= upper) {
      zones.push({
        from: group[0].start.date,
        to: group[2].end.date,
        upper: Number(upper.toFixed(2)),
        lower: Number(lower.toFixed(2)),
        mid: Number(((upper + lower) / 2).toFixed(2))
      });
    }
  }
  return zones;
}

function chanAnalysisFromKlines(rows = []) {
  if (rows.length < 12) {
    return {
      score: 50,
      trend: "样本不足",
      signal: "等待更多K线",
      risk: "日线样本不足，暂不使用缠论结构加权",
      fractals: [],
      strokes: [],
      zones: []
    };
  }
  const fractals = detectChanFractals(rows);
  const strokes = buildChanStrokes(fractals, rows);
  const zones = detectChanZones(strokes);
  const lastClose = rows.at(-1).close;
  const lastStroke = strokes.at(-1);
  const latestZone = zones.at(-1);
  const sameDirection = lastStroke ? strokes.filter((item) => item.direction === lastStroke.direction).slice(-2) : [];
  const previousSame = sameDirection[0];
  let divergence = null;
  if (lastStroke && previousSame && sameDirection.length === 2) {
    const priceExtended = lastStroke.direction === "up"
      ? lastStroke.high > previousSame.high
      : lastStroke.low < previousSame.low;
    if (priceExtended && lastStroke.power < previousSame.power * 0.82) {
      divergence = {
        type: lastStroke.direction === "up" ? "顶背驰风险" : "底背驰候选",
        previousPower: Number(previousSame.power.toFixed(2)),
        latestPower: Number(lastStroke.power.toFixed(2))
      };
    }
  }
  let score = 50;
  if (lastStroke?.direction === "up") score += 10;
  if (lastStroke?.direction === "down") score -= 8;
  if (latestZone && lastClose > latestZone.upper) score += 14;
  if (latestZone && lastClose < latestZone.lower) score -= 14;
  if (divergence?.type === "底背驰候选") score += 12;
  if (divergence?.type === "顶背驰风险") score -= 14;
  const lastFractal = fractals.at(-1);
  if (lastFractal?.type === "bottom") score += 5;
  if (lastFractal?.type === "top") score -= 4;
  score = Math.max(0, Math.min(99, Math.round(score)));
  const trend = latestZone
    ? lastClose > latestZone.upper ? "离开中枢向上" : lastClose < latestZone.lower ? "跌破中枢" : "中枢震荡"
    : lastStroke?.direction === "up" ? "上行笔" : lastStroke?.direction === "down" ? "下行笔" : "结构未明";
  const signal = divergence?.type || (lastFractal?.type === "bottom" ? "底分型后观察" : lastFractal?.type === "top" ? "顶分型后谨慎" : "等待结构确认");
  const risk = latestZone
    ? `中枢区间 ${latestZone.lower}-${latestZone.upper}，跌破下沿转弱，突破上沿转强`
    : "尚未形成清晰中枢，按分型与均线辅助判断";
  return {
    score,
    trend,
    signal,
    risk,
    latestFractal: lastFractal || null,
    latestStroke: lastStroke ? {
      direction: lastStroke.direction,
      from: lastStroke.start.date,
      to: lastStroke.end.date,
      high: Number(lastStroke.high.toFixed(2)),
      low: Number(lastStroke.low.toFixed(2)),
      power: Number(lastStroke.power.toFixed(2))
    } : null,
    latestZone: latestZone || null,
    divergence,
    fractals: fractals.slice(-8),
    strokes: strokes.slice(-6).map((item) => ({
      direction: item.direction,
      from: item.start.date,
      to: item.end.date,
      high: Number(item.high.toFixed(2)),
      low: Number(item.low.toFixed(2)),
      power: Number(item.power.toFixed(2))
    })),
    zones: zones.slice(-3)
  };
}

function tradingDecision({ quote: q, klines, flows, cost, shares, chan }) {
  const price = num(q.price);
  const high = num(q.high);
  const low = num(q.low);
  const open = num(q.open);
  const previousClose = num(q.previousClose);
  const changePct = num(q.changePct);
  const turnover = num(q.turnover);
  const volumeRatio = num(q.volumeRatio);
  const amplitude = num(q.amplitude);
  const latestFlow = flows.at(-1) || {};
  const previousFlow = flows.at(-2) || latestFlow;
  const mainFlow = num(latestFlow.main);
  const mainFlowTrend = mainFlow - num(previousFlow.main);
  const ma5 = movingAverage(klines, 5);
  const ma10 = movingAverage(klines, 10);
  const closeToHighPct = high ? ((price - high) / high) * 100 : 0;
  const costValue = num(cost);
  const sharesValue = num(shares);
  const pnl = costValue && sharesValue ? (price - costValue) * sharesValue : null;

  let technicalScore = 50;
  technicalScore += changePct > 6 ? 18 : changePct > 3 ? 10 : changePct > 0 ? 4 : changePct < -5 ? -18 : changePct < -2 ? -10 : 0;
  technicalScore += price > ma5 && ma5 >= ma10 ? 12 : price > ma5 ? 6 : price < ma5 ? -8 : 0;
  technicalScore += closeToHighPct > -2 ? 8 : closeToHighPct < -5 ? -10 : -3;
  technicalScore += price > open ? 6 : -4;
  if (chan?.score) technicalScore += (chan.score - 50) * 0.35;

  let flowScore = 50;
  flowScore += mainFlow > 500000000 ? 18 : mainFlow > 100000000 ? 10 : mainFlow < -500000000 ? -18 : mainFlow < -100000000 ? -10 : 0;
  flowScore += mainFlowTrend > 0 ? 6 : mainFlowTrend < 0 ? -6 : 0;
  flowScore += volumeRatio >= 1.2 && volumeRatio <= 4 ? 6 : volumeRatio > 6 ? -5 : 0;

  let riskScore = 50;
  riskScore += amplitude > 10 ? -16 : amplitude > 6 ? -8 : 4;
  riskScore += turnover > 12 ? -10 : turnover >= 3 && turnover <= 9 ? 6 : 0;
  riskScore += closeToHighPct < -5 ? -8 : 4;

  const composite = Math.round(Math.max(0, Math.min(99, technicalScore * 0.4 + flowScore * 0.4 + riskScore * 0.2)));
  const protect = costValue ? Math.max(costValue, price * 0.97) : price * 0.97;
  const stop = Math.min(price * 0.96, low * 0.995);
  const resistance = Math.max(high, price * 1.025);
  const support = Math.max(low, price * 0.985);

  let action = "等待";
  if (composite >= 76 && mainFlowTrend >= 0 && closeToHighPct > -3) action = "继续持有/轻仓试错";
  else if (composite >= 62 && price >= support) action = "观察持有";
  else if (mainFlow < -500000000 || changePct < -5) action = "不买/减仓";
  else action = "等待确认";

  return {
    composite,
    action,
    levels: {
      support: Number(support.toFixed(2)),
      resistance: Number(resistance.toFixed(2)),
      profitProtect: Number(protect.toFixed(2)),
      stop: Number(stop.toFixed(2)),
      ma5: Number(ma5.toFixed(2)),
      ma10: Number(ma10.toFixed(2))
    },
    pnl: pnl === null ? null : Number(pnl.toFixed(2)),
    agents: [
      {
        role: "缠论结构员",
        score: chan?.score ?? 50,
        view: chan ? `${chan.trend}；${chan.signal}；${chan.risk}` : "日线结构样本不足，暂不加权。"
      },
      {
        role: "技术分析员",
        score: Math.round(Math.max(0, Math.min(99, technicalScore))),
        view: `现价${price}，涨跌幅${changePct}%，相对日内高点${closeToHighPct.toFixed(2)}%，MA5 ${ma5.toFixed(2)} / MA10 ${ma10.toFixed(2)}。`
      },
      {
        role: "资金分析员",
        score: Math.round(Math.max(0, Math.min(99, flowScore))),
        view: `主力净流入${moneyWan(mainFlow)}万元，最近变化${moneyWan(mainFlowTrend)}万元，量比${volumeRatio}。`
      },
      {
        role: "风险经理",
        score: Math.round(Math.max(0, Math.min(99, riskScore))),
        view: `振幅${amplitude}%，换手${turnover}%，防守位${stop.toFixed(2)}，利润保护位${protect.toFixed(2)}。`
      },
      {
        role: "交易员",
        score: composite,
        view: `综合结论：${action}。突破${resistance.toFixed(2)}看强，跌破${stop.toFixed(2)}优先风控。`
      }
    ]
  };
}

async function tradingAgents(reqUrl) {
  const code = reqUrl.searchParams.get("code");
  const cost = reqUrl.searchParams.get("cost");
  const shares = reqUrl.searchParams.get("shares");
  const secid = secidFromCode(code);
  if (!secid) {
    return { error: "请输入 6 位 A 股代码" };
  }
  const [quoteResult, klineResult, flowResult] = await Promise.allSettled([
    quoteDetail(code),
    dailyKlines(code, 30),
    minuteFundFlow(code, 12)
  ]);
  const quoteData = quoteResult.status === "fulfilled" ? quoteResult.value : null;
  const klines = klineResult.status === "fulfilled" ? klineResult.value : [];
  const flows = flowResult.status === "fulfilled" ? flowResult.value : [];
  if (!quoteData) {
    throw new Error(quoteResult.reason?.message || "没有查到这只股票");
  }
  const chan = chanAnalysisFromKlines(klines);
  const decision = tradingDecision({ quote: quoteData, klines, flows, cost, shares, chan });
  return {
    source: "TradingAgents-compatible local adapter",
    upstream: {
      project: "TauricResearch/TradingAgents",
      url: "https://github.com/TauricResearch/TradingAgents",
      ticker: yahooTickerFromCode(code),
      note: "当前使用本地兼容适配器处理 A 股实时行情；官方 Python 框架可作为后续深度研究后端接入。"
    },
    dataWarnings: [
      ...(klineResult.status === "rejected" ? ["日线数据暂不可用，已用实时行情降级分析。"] : []),
      ...(flowResult.status === "rejected" ? ["分钟资金流暂不可用，已用价格、量比和日线降级分析。"] : [])
    ],
    quote: quoteData,
    chan,
    flows,
    klines: klines.slice(-8),
    ...decision
  };
}

async function klineApi(reqUrl) {
  const code = reqUrl.searchParams.get("code");
  const limit = Math.max(5, Math.min(120, Number(reqUrl.searchParams.get("limit") || 40)));
  const period = ["day", "week", "month"].includes(reqUrl.searchParams.get("period"))
    ? reqUrl.searchParams.get("period")
    : "day";
  if (!secidFromCode(code)) {
    return { error: "请输入 6 位 A 股代码" };
  }
  const [quoteData, klines] = await Promise.all([
    quoteDetail(code),
    dailyKlines(code, limit, period)
  ]);
  return { quote: quoteData, klines, period, chan: chanAnalysisFromKlines(klines) };
}

async function chanAnalysisApi(reqUrl) {
  const code = reqUrl.searchParams.get("code");
  const limit = Math.max(30, Math.min(160, Number(reqUrl.searchParams.get("limit") || 80)));
  if (!secidFromCode(code)) {
    return { error: "请输入 6 位 A 股代码" };
  }
  const klines = await dailyKlines(code, limit);
  return { code, chan: chanAnalysisFromKlines(klines), klines: klines.slice(-8) };
}

function fallbackFlowPoints(item, period, pointLimit) {
  const target = num(item.mainNetInflow);
  const count = Math.max(3, pointLimit);
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const progress = count === 1 ? 1 : index / (count - 1);
    const seed = String(item.code || "BK0000").charCodeAt(2) || 0;
    const wave = Math.sin(progress * Math.PI * 2 + seed) * 0.08;
    const main = Math.round(target * Math.max(0.05, 0.18 + progress * 0.82 + wave));
    let time;
    if (period === "day") {
      const start = new Date(now);
      start.setHours(9, 15, 0, 0);
      start.setMinutes(start.getMinutes() + Math.round(progress * 345));
      time = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")} ${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
    } else {
      const date = new Date(now);
      date.setDate(date.getDate() - (count - 1 - index) * (period === "week" ? 7 : 1));
      time = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }
    return {
      time,
      main,
      super: Math.round(main * 0.72),
      large: Math.round(main * 0.28),
      medium: -Math.round(main * 0.55),
      small: -Math.round(main * 0.45),
      estimated: true
    };
  });
}

function withTimeout(promise, timeoutMs) {
  let timeout;
  const timer = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(timeout));
}

async function sectorFlowLines(reqUrl) {
  const limit = Math.max(3, Math.min(12, Number(reqUrl.searchParams.get("limit") || 8)));
  const period = ["day", "week", "month"].includes(reqUrl.searchParams.get("period"))
    ? reqUrl.searchParams.get("period")
    : "day";
  const pointLimit = period === "day" ? 241 : period === "week" ? 5 : 22;
  const flowRows = await fundFlow("sector");
  const selected = flowRows
    .filter((item) => /^BK\d{4}$/.test(item.code))
    .sort((a, b) => Math.abs(num(b.mainNetInflow)) - Math.abs(num(a.mainNetInflow)))
    .slice(0, limit);
  const seriesResults = await Promise.allSettled(selected.map(async (item) => {
    const request = period === "day"
      ? sectorMinuteFundFlow(item.code, pointLimit)
      : sectorDailyFundFlow(item.code, pointLimit);
    const points = await withTimeout(request, 5000).catch(() => []);
    return {
      code: item.code,
      name: item.name,
      period,
      currentMainNetInflow: item.mainNetInflow,
      mainNetRatio: item.mainNetRatio,
      estimated: item.estimated || !points.length,
      points: points.length ? points : fallbackFlowPoints(item, period, pointLimit)
    };
  }));
  return seriesResults
    .filter((result) => result.status === "fulfilled" && result.value.points.length)
    .map((result) => result.value);
}

function extractStockCode(text) {
  const match = String(text || "").match(/\b\d{6}\b/);
  return match ? match[0] : null;
}

function buildStockChatAnswer({ message, analysis, cost, shares }) {
  const quoteData = analysis.quote || {};
  const levels = analysis.levels || {};
  const agents = analysis.agents || [];
  const price = num(quoteData.price);
  const changePct = num(quoteData.changePct);
  const high = num(quoteData.high);
  const low = num(quoteData.low);
  const mainAgent = agents.find((agent) => agent.role.includes("交易")) || agents.at(-1);
  const riskAgent = agents.find((agent) => agent.role.includes("风险"));
  const flowAgent = agents.find((agent) => agent.role.includes("资金"));
  const costValue = num(cost);
  const sharesValue = num(shares);
  const pnlText = costValue && sharesValue
    ? `按成本 ${costValue}、${sharesValue} 股估算，当前浮盈亏约 ${((price - costValue) * sharesValue).toFixed(2)} 元。`
    : "未填写成本/股数，暂不计算持仓盈亏。";
  const lowerMessage = String(message || "");
  const asksBuy = /买|抄底|能进|可买吗|加仓|选/.test(lowerMessage);
  const asksSell = /卖|止盈|止损|减仓|走吗|清仓/.test(lowerMessage);

  let action = analysis.action || "等待确认";
  if (asksBuy && /不买|减仓/.test(action)) action = "不建议买入";
  if (asksBuy && analysis.composite < 62) action = "暂不买，等确认";
  if (asksSell && analysis.composite < 62) action = "偏向减仓/保护利润";

  const lines = [
    `${quoteData.name || ""} ${quoteData.code || ""} 当前 ${price}，涨跌幅 ${changePct}%，日内区间 ${low}-${high}。`,
    `多智能体综合分 ${analysis.composite}，结论：${action}。`,
    pnlText,
    `关键位：支撑 ${levels.support ?? "--"}，压力 ${levels.resistance ?? "--"}，利润保护 ${levels.profitProtect ?? "--"}，风控止损 ${levels.stop ?? "--"}。`
  ];

  if (flowAgent) lines.push(`资金面：${flowAgent.view}`);
  if (riskAgent) lines.push(`风险面：${riskAgent.view}`);
  if (mainAgent) lines.push(`交易计划：${mainAgent.view}`);
  if (analysis.dataWarnings?.length) lines.push(`数据提示：${analysis.dataWarnings.join(" ")}`);
  lines.push("执行边界：我只给分析和条件，不自动下单；买卖需要你本人在交易软件确认。");
  return lines.join("\n");
}

async function stockChat(req, reqUrl) {
  if (req.method !== "POST") {
    return { error: "请使用 POST 提交问题" };
  }
  const body = await readJsonBody(req);
  const message = String(body.message || "").trim();
  const context = body.context || {};
  const code = extractStockCode(message) || context.code || reqUrl.searchParams.get("code");
  const cost = body.cost ?? context.cost ?? reqUrl.searchParams.get("cost") ?? "";
  const shares = body.shares ?? context.shares ?? reqUrl.searchParams.get("shares") ?? "";

  if (!message) {
    return { answer: "请输入问题，例如：京东方A现在要不要卖？或者输入股票代码让我分析。" };
  }
  if (!code || !secidFromCode(code)) {
    return {
      answer: "我需要股票代码才能结合实时行情分析。请先选择一只股票，或在问题里写 6 位代码，例如 000725。"
    };
  }

  const analysisUrl = new URL("http://local/api/trading-agents");
  analysisUrl.searchParams.set("code", code);
  if (cost) analysisUrl.searchParams.set("cost", cost);
  if (shares) analysisUrl.searchParams.set("shares", shares);
  const analysis = await tradingAgents(analysisUrl);
  return {
    answer: buildStockChatAnswer({ message, analysis, cost, shares }),
    analysis
  };
}

async function savePredictionSnapshot(req) {
  const body = await readJsonBody(req);
  const today = body.date || chinaDate();
  const targetDate = body.targetDate || nextTradeDate(today);
  const predictions = normalizePredictions(body.predictions || []);
  if (!predictions.length) {
    return { error: "没有可保存的预测记录" };
  }
  const history = await readPredictionHistory();
  const snapshot = {
    date: today,
    targetDate,
    savedAt: new Date().toISOString(),
    status: "pending",
    modelVersion: "local-limit-v1",
    settings: body.settings || {},
    predictions
  };
  const index = history.snapshots.findIndex((item) => item.date === today && item.modelVersion === snapshot.modelVersion);
  if (index >= 0) history.snapshots[index] = { ...history.snapshots[index], ...snapshot };
  else history.snapshots.unshift(snapshot);
  history.snapshots = history.snapshots
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 60);
  await writePredictionHistory(history);
  return { ok: true, snapshot, summary: summarizeAccuracy(history.snapshots) };
}

async function saveHighOpenSnapshot(req) {
  const body = await readJsonBody(req);
  const today = body.date || chinaDate();
  const targetDate = body.targetDate || nextTradeDate(today);
  const predictions = normalizeHighOpenPredictions(body.predictions || []);
  if (!predictions.length) {
    return { error: "没有可保存的冲高预测记录" };
  }
  const history = await readHighOpenHistory();
  const sampleType = body.sampleType === "preview" ? "preview" : "close30";
  const snapshot = {
    date: today,
    targetDate,
    savedAt: new Date().toISOString(),
    status: "pending",
    sampleType,
    predictionWindow: body.predictionWindow || {},
    modelVersion: body.modelVersion || (sampleType === "close30" ? "high-rush-close30-v5" : "high-rush-preview-v5"),
    settings: body.settings || {},
    predictions
  };
  const index = history.snapshots.findIndex((item) => item.date === today && item.modelVersion === snapshot.modelVersion && (item.sampleType || "close30") === sampleType);
  if (index >= 0) history.snapshots[index] = { ...history.snapshots[index], ...snapshot };
  else history.snapshots.unshift(snapshot);
  history.snapshots = history.snapshots
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 60);
  await writeHighOpenHistory(history);
  return { ok: true, snapshot, summary: summarizeHighOpenAccuracy(history.snapshots) };
}

async function saveOvernightSnapshot(req) {
  const body = await readJsonBody(req);
  const today = body.date || chinaDate();
  const targetDate = body.targetDate || nextTradeDate(today);
  const predictions = normalizeOvernightPredictions(body.predictions || []);
  if (!predictions.length) {
    return { error: "没有可保存的一夜持股预测记录" };
  }
  const history = await readOvernightHistory();
  const snapshot = {
    date: today,
    targetDate,
    savedAt: new Date().toISOString(),
    status: "pending",
    modelVersion: body.modelVersion || "overnight-tail-v1",
    predictionWindow: body.predictionWindow || {},
    settings: body.settings || {},
    predictions
  };
  const index = history.snapshots.findIndex((item) => item.date === today && item.modelVersion === snapshot.modelVersion);
  if (index >= 0) history.snapshots[index] = { ...history.snapshots[index], ...snapshot };
  else history.snapshots.unshift(snapshot);
  history.snapshots = history.snapshots
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 80);
  await writeOvernightHistory(history);
  return { ok: true, snapshot, summary: summarizeOvernightAccuracy(history.snapshots) };
}

async function predictionHistory() {
  const history = await readPredictionHistory();
  let changed = false;
  const snapshots = [];
  for (const item of history.snapshots) {
    try {
      const settled = await settlePredictionSnapshot(item);
      if (settled !== item) changed = true;
      snapshots.push(settled);
    } catch {
      snapshots.push(item);
    }
  }
  const nextHistory = { snapshots };
  if (changed) await writePredictionHistory(nextHistory);
  return {
    summary: summarizeAccuracy(snapshots),
    snapshots: snapshots.slice(0, 20)
  };
}

async function highOpenHistory() {
  const history = await readHighOpenHistory();
  let changed = false;
  const snapshots = [];
  for (const item of history.snapshots) {
    try {
      const settled = await settleHighOpenSnapshot(item);
      if (settled !== item) changed = true;
      snapshots.push(settled);
    } catch {
      snapshots.push(item);
    }
  }
  const nextHistory = { snapshots };
  if (changed) await writeHighOpenHistory(nextHistory);
  return {
    summary: summarizeHighOpenAccuracy(snapshots),
    snapshots: snapshots.slice(0, 20)
  };
}

async function overnightHistory() {
  const history = await readOvernightHistory();
  let changed = false;
  const snapshots = [];
  for (const item of history.snapshots) {
    try {
      const settled = await settleOvernightSnapshot(item);
      if (settled !== item) changed = true;
      snapshots.push(settled);
    } catch {
      snapshots.push(item);
    }
  }
  const nextHistory = { snapshots };
  if (changed) await writeOvernightHistory(nextHistory);
  return {
    summary: summarizeOvernightAccuracy(snapshots),
    snapshots: snapshots.slice(0, 30)
  };
}

async function limitUpPoolByDate(dateText = chinaDate()) {
  const date = compactDate(dateText);
  const url = `https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=120&sort=fbt:asc&date=${date}`;
  const data = await fetchJson(url);
  return (data?.data?.pool || []).map((row) => ({
    code: row.c,
    name: row.n,
    price: row.p / 1000,
    changePct: row.zdp,
    amount: row.amount,
    floatMarketCap: row.ltsz,
    turnover: row.hs,
    boardCount: row.lbc,
    firstLimitTime: row.fbt,
    lastLimitTime: row.lbt,
    sealFund: row.fund,
    brokenCount: row.zbc,
    industry: row.hybk,
    days: row.zttj?.days,
    countInDays: row.zttj?.ct
  }));
}

async function limitUpPool() {
  return limitUpPoolByDate(chinaDate());
}

async function quoteWithFallback(reqUrl) {
  try {
    return await quote(reqUrl);
  } catch {
    const cleanCode = String(reqUrl.searchParams.get("code") || "").replace(/\D/g, "").slice(0, 6);
    const fallback = fallbackStocks.find((item) => item.code === cleanCode);
    return fallback ? { ...fallback, estimated: true } : { error: "行情源暂不可用，且没有本地备用数据" };
  }
}

async function limitUpPoolWithFallback() {
  try {
    return await limitUpPool();
  } catch {
    return fallbackStocks
      .filter((item) => Number(item.changePct || 0) >= 4)
      .map((item, index) => ({
        ...item,
        boardCount: index === 0 ? 2 : 1,
        firstLimitTime: 93000 + index * 500,
        lastLimitTime: 140000 + index * 300,
        sealFund: Math.round(Number(item.amount || 0) * 0.08),
        brokenCount: index % 2,
        industry: index % 2 ? "新能源" : "科技",
        estimated: true
      }));
  }
}

function fallbackKlinesForCode(code, limit = 60) {
  const cleanCode = String(code || "").replace(/\D/g, "").slice(0, 6);
  const stock = fallbackStocks.find((item) => item.code === cleanCode) || fallbackStocks[0];
  const count = Math.max(12, Math.min(80, Number(limit) || 60));
  const start = Number(stock.previousClose || stock.price || 10);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.now() + 8 * 60 * 60 * 1000);
    date.setDate(date.getDate() - (count - 1 - index));
    const drift = 1 + Math.sin(index / 4) * 0.025 + (index - count / 2) * 0.0015;
    const open = start * drift;
    const close = index === count - 1 ? Number(stock.price || open) : open * (1 + Math.cos(index / 5) * 0.012);
    const high = Math.max(open, close) * 1.018;
    const low = Math.min(open, close) * 0.982;
    const previous = index ? start * (1 + Math.sin((index - 1) / 4) * 0.025 + (index - 1 - count / 2) * 0.0015) : start;
    return {
      date: date.toISOString().slice(0, 10),
      open: Number(open.toFixed(2)),
      close: Number(close.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      volume: 0,
      amount: Number(stock.amount || 0),
      amplitude: Number((((high - low) / previous) * 100).toFixed(2)),
      changePct: Number((((close - previous) / previous) * 100).toFixed(2)),
      change: Number((close - previous).toFixed(2)),
      turnover: Number(stock.turnover || 0),
      estimated: true
    };
  });
}

async function klineApiWithFallback(reqUrl) {
  try {
    return await klineApi(reqUrl);
  } catch {
    const code = reqUrl.searchParams.get("code");
    const limit = Math.max(5, Math.min(120, Number(reqUrl.searchParams.get("limit") || 40)));
    const period = ["day", "week", "month"].includes(reqUrl.searchParams.get("period"))
      ? reqUrl.searchParams.get("period")
      : "day";
    const quoteData = await quoteWithFallback(reqUrl);
    const klines = fallbackKlinesForCode(code, limit);
    return { quote: quoteData, klines, period, chan: chanAnalysisFromKlines(klines), estimated: true };
  }
}

async function routeApi(req, reqUrl, res) {
  try {
    const routes = {
      "/api/quote": () => quoteWithFallback(reqUrl),
      "/api/indices": () => indices(),
      "/api/sectors": () => sectors(reqUrl.searchParams.get("type") || "industry"),
      "/api/movers": () => movers(),
      "/api/active-stocks": () => activeStocks(),
      "/api/limit-up": () => limitUpPoolWithFallback(),
      "/api/overnight-candidates": () => overnightCandidates(),
      "/api/fund-flow": () => fundFlow(reqUrl.searchParams.get("type") || "sector"),
      "/api/trading-agents": () => tradingAgents(reqUrl),
      "/api/kline": () => klineApiWithFallback(reqUrl),
      "/api/chan-analysis": () => chanAnalysisApi(reqUrl),
      "/api/sector-flow-lines": () => sectorFlowLines(reqUrl),
      "/api/stock-chat": () => stockChat(req, reqUrl),
      "/api/prediction-history": () => predictionHistory(),
      "/api/prediction-history/save": () => savePredictionSnapshot(req),
      "/api/high-open-history": () => highOpenHistory(),
      "/api/high-open-history/save": () => saveHighOpenSnapshot(req),
      "/api/overnight-history": () => overnightHistory(),
      "/api/overnight-history/save": () => saveOvernightSnapshot(req)
    };
    const handler = routes[reqUrl.pathname];
    if (!handler) {
      send(res, 404, JSON.stringify({ error: "接口不存在" }), jsonHeaders);
      return;
    }
    send(res, 200, JSON.stringify(await handler()), jsonHeaders);
  } catch (error) {
    send(res, 502, JSON.stringify({ error: error.message || "数据源暂时不可用" }), jsonHeaders);
  }
}

async function routeStatic(reqUrl, res) {
  const requestPath = reqUrl.pathname === "/" ? "/index.html" : reqUrl.pathname;
  const safePath = normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) {
    send(res, 403, "Forbidden");
    return;
  }
  try {
    const body = await readFile(filePath);
    send(res, 200, body, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store"
    });
  } catch {
    send(res, 404, "Not found");
  }
}

http.createServer((req, res) => {
  const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (req.method === "OPTIONS") {
    send(res, 204, "", jsonHeaders);
    return;
  }
  if (reqUrl.pathname.startsWith("/api/")) {
    routeApi(req, reqUrl, res);
    return;
  }
  routeStatic(reqUrl, res);
}).listen(port, () => {
  console.log(`Stock AI Assistant running at http://localhost:${port}`);
});
