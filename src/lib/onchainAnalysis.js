// onchainAnalysis.js
// Symbol-tomato-wallet の js/onchainAnalysis.js から、
// 「データ画面のオンチェーン分析」機能のロジックだけを抽出し、
// DOM直接操作をやめてReactから使いやすい形(値を返す関数群)に移植したもの。
//
// 元の設計方針(コメント)はそのまま踏襲している:
// バックエンドを持たず、都度接続中のノードへ問い合わせるだけの構成のため、
// 「今」の状態を集計できるものだけを対象にしている(過去の残高推移や、
// 取引所アドレス一覧が前提になるような指標は対象外)。
//
// 集計期間は3種類から選べる:
//   - 過去24時間(rolling24h): 現在時刻から遡って24時間
//   - 昨日(yesterday): UTCでの昨日 0:00〜24:00 の固定1日分
//   - 指定日(custom): 指定した1日(UTC/JST基準 0:00〜24:00)
//
// 集計対象:
//   - アクティブアドレス数(期間中、何らかのトランザクション(全種別・埋め込み含む)を
//     「送信元」として出したアドレスの延べ数)
//   - 新規アドレス作成数(上記のうち、REST APIで遡れる範囲でこの期間より前に
//     一度もトランザクションを出した履歴がないアドレスの数。近似値)
//   - 平均ブロック生成間隔(期間中の実測値)
//   - XYM移動量(総移動量・XYM送金件数・送金元/送金先アドレス数)
//   - モザイク送信件数(XYMを含む、何らかのモザイクを伴う送金の件数)
//   - 大口送金一覧(閾値以上のXYM送金)

import { getXymMosaicIdHex, NetworkType } from "./config";
import { downloadCsv } from "./utils";
import { getHistoricalXymJpyRate, getHistoricalXymUsdRate } from "./priceRates";

const TRANSFER_TYPE = 16724; // Transfer Transaction
export const WHALE_THRESHOLD_XYM = 10000; // 大口送金とみなす閾値(この金額以上を一覧に含める)
export const WHALE_MID_THRESHOLD_XYM = 100000; // 一覧内での強調表示: これ以上は黄色
export const WHALE_HIGH_THRESHOLD_XYM = 1000000; // 一覧内での強調表示: これ以上は赤色
const SCAN_PAGE_SIZE = 100;
const SCAN_MAX_PAGES = 200; // 安全のための上限(最大 20,000 件 / 20,000 ブロック)
const NEW_ADDRESS_CHECK_CONCURRENCY = 10; // 新規アドレス判定(初回トランザクション確認)の並列数

/* ============================================================
   REST APIのアドレス表現(16進 or base32)を統一する
============================================================ */
function normalizeMaybeHexAddress(addr, sdkSymbol) {
  if (!addr || typeof addr !== "string") return null;
  if (addr.length === 39) return addr.toUpperCase();
  if (addr.length === 48 && /^[0-9A-Fa-f]+$/.test(addr) && sdkSymbol) {
    try {
      const bytes = [];
      for (let c = 0; c < addr.length; c += 2) bytes.push(parseInt(addr.substr(c, 2), 16));
      return new sdkSymbol.Address(new Uint8Array(bytes)).toString();
    } catch {
      return addr.toUpperCase();
    }
  }
  return addr.toUpperCase();
}

function publicKeyToAddress(publicKeyHex, ctx) {
  const pub = new ctx.sdkCore.PublicKey(publicKeyHex);
  const account = ctx.facade.createPublicAccount(pub);
  return account.address.toString();
}

export function resolveWhaleSenderAddress(whale, ctx) {
  try {
    return whale.senderPublicKey ? publicKeyToAddress(whale.senderPublicKey, ctx) : "---";
  } catch {
    return "---";
  }
}

export function getExplorerUrl(hash, networkType) {
  return networkType === NetworkType.TESTNET
    ? `https://testnet.symbol.fyi/transactions/${hash}`
    : `https://symbol.fyi/transactions/${hash}`;
}

/* ============================================================
   指定した高さのブロックタイムスタンプ(UnixMs)を取得する
============================================================ */
async function fetchBlockTimestampMs(height, ctx) {
  const res = await fetch(new URL("/blocks/" + height, ctx.node));
  const json = await res.json();
  return Number(ctx.epochAdjustment) * 1000 + Number(json.block.timestamp);
}

/* ============================================================
   指定したUnix時刻(ms)以降で最初のブロック高を二分探索で特定する
============================================================ */
async function findHeightForTimestamp(targetMs, currentHeight, currentTimestampMs, ctx) {
  const estimatedBlocksAgo = Math.max(0, Math.round((currentTimestampMs - targetMs) / 30000));
  let lo = Math.max(1, currentHeight - estimatedBlocksAgo - 500);
  let hi = currentHeight;

  let safetyCounter = 0;
  while (lo > 1 && safetyCounter < 10) {
    const loTs = await fetchBlockTimestampMs(lo, ctx);
    if (loTs <= targetMs) break;
    hi = lo;
    lo = Math.max(1, lo - (hi - lo || 1000) * 2);
    safetyCounter++;
  }

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const ts = await fetchBlockTimestampMs(mid, ctx);
    if (ts < targetMs) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/* ============================================================
   トランザクション本体(tx)から、署名者(送信者)以外の「関係先アドレス」を
   できるだけ広く抽出する(受信ベースの新規アドレス判定用)。
============================================================ */
const TARGET_ADDRESS_FIELDS = ["recipientAddress", "targetAddress", "address", "sourceAddress"];
const TARGET_ADDRESS_ARRAY_FIELDS = ["addressAdditions", "addressDeletions"];
const LINKED_PUBLIC_KEY_FIELDS = ["linkedPublicKey"];

function extractTargetAddresses(tx, ctx) {
  const addrs = [];

  for (const field of TARGET_ADDRESS_FIELDS) {
    const raw = tx[field];
    if (typeof raw === "string" && raw) {
      const a = normalizeMaybeHexAddress(raw, ctx.sdkSymbol);
      if (a) addrs.push(a);
    }
  }

  for (const field of TARGET_ADDRESS_ARRAY_FIELDS) {
    const arr = tx[field];
    if (Array.isArray(arr)) {
      for (const raw of arr) {
        if (typeof raw !== "string") continue;
        const a = normalizeMaybeHexAddress(raw, ctx.sdkSymbol);
        if (a) addrs.push(a);
      }
    }
  }

  for (const field of LINKED_PUBLIC_KEY_FIELDS) {
    const raw = tx[field];
    if (typeof raw === "string" && raw && !/^0+$/.test(raw)) {
      try {
        addrs.push(publicKeyToAddress(raw, ctx));
      } catch {
        // 変換できない場合は無視する
      }
    }
  }

  return addrs;
}

/* ============================================================
   指定した高さ範囲内の全トランザクション(埋め込み含む)を1回のスキャンで
   走査し、アクティブアドレス・新規アドレス判定用候補・XYM送金・
   モザイク送金件数・大口送金一覧をまとめて集計する。
============================================================ */
async function scanBlockRangeCombined(fromHeight, toHeight, xymMosaicIdHex, ctx, onProgress) {
  const whaleThresholdAtomic = BigInt(WHALE_THRESHOLD_XYM) * 1_000_000n;

  let pageNumber = 1;
  let totalAmount = 0n;
  let transferCount = 0;
  let mosaicTransferCount = 0;
  const signerPublicKeys = new Set();
  const targetAddresses = new Set();
  const whales = [];
  let truncated = false;

  while (pageNumber <= SCAN_MAX_PAGES) {
    const params = new URLSearchParams({
      fromHeight: String(fromHeight),
      toHeight: String(toHeight),
      embedded: "true",
      pageSize: String(SCAN_PAGE_SIZE),
      pageNumber: String(pageNumber),
      order: "asc",
    });

    const res = await fetch(`${ctx.node}/transactions/confirmed?${params}`);
    const json = await res.json();
    const items = json.data ?? [];
    if (items.length === 0) break;

    for (const item of items) {
      const tx = item.transaction;
      if (!tx) continue;

      if (tx.signerPublicKey) signerPublicKeys.add(tx.signerPublicKey);

      for (const addr of extractTargetAddresses(tx, ctx)) {
        targetAddresses.add(addr);
      }

      if (Number(tx.type) !== TRANSFER_TYPE) continue;

      const mosaics = tx.mosaics || [];
      if (mosaics.length > 0) mosaicTransferCount++;

      const xymEntry = mosaics.find((m) => String(m.id).toUpperCase() === xymMosaicIdHex);
      if (!xymEntry) continue;

      const amount = BigInt(xymEntry.amount);
      totalAmount += amount;
      transferCount++;

      const recipientAddr = normalizeMaybeHexAddress(tx.recipientAddress, ctx.sdkSymbol);

      if (amount >= whaleThresholdAtomic) {
        whales.push({
          senderPublicKey: tx.signerPublicKey,
          recipientAddress: recipientAddr,
          amount,
          hash: item.meta?.aggregateHash ?? item.meta?.hash,
          height: item.meta?.height,
          timestampRaw: item.meta?.timestamp,
        });
      }
    }

    onProgress?.(pageNumber);

    if (items.length < SCAN_PAGE_SIZE) break;
    pageNumber++;
  }

  if (pageNumber > SCAN_MAX_PAGES) truncated = true;

  return {
    totalAmount,
    transferCount,
    mosaicTransferCount,
    signerPublicKeys,
    targetAddresses,
    whales,
    truncated,
  };
}

/* ============================================================
   「新規アドレス」の判定: 指定したアドレスについて、この期間より前に
   送信・受信いずれのトランザクション履歴も一切ないかどうかを確認する。
============================================================ */
async function countNewAddressesByAddress(addresses, fromHeight, ctx, onProgress) {
  const targets = [...addresses];

  let failCount = 0;
  let doneCount = 0;
  const resultByAddress = new Map();

  async function checkOne(address) {
    try {
      const params = new URLSearchParams({ address, order: "asc", pageSize: "1" });
      const res = await fetch(`${ctx.node}/transactions/confirmed?${params}`);
      if (!res.ok) {
        failCount++;
        resultByAddress.set(address, "failed");
        return;
      }
      const json = await res.json();
      const first = (json.data ?? [])[0];
      const firstHeight = Number(first?.meta?.height ?? 0);
      const isNew = firstHeight >= fromHeight;
      resultByAddress.set(address, isNew ? "new" : "not-new");
    } catch (e) {
      console.warn("countNewAddressesByAddress: 初回関与トランザクション確認に失敗しました:", address, e);
      failCount++;
      resultByAddress.set(address, "failed");
    } finally {
      doneCount++;
      onProgress?.(doneCount, targets.length);
    }
  }

  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const i = cursor++;
      await checkOne(targets[i]);
    }
  }

  const workers = Array.from({ length: Math.min(NEW_ADDRESS_CHECK_CONCURRENCY, targets.length) }, worker);
  await Promise.all(workers);

  return { failCount, checkedCount: targets.length, resultByAddress };
}

/* ============================================================
   大口移動1件分の金額に応じた強調色
============================================================ */
export function whaleAmountColor(amount) {
  const xymValue = Number(amount) / 1_000_000;
  if (xymValue >= WHALE_HIGH_THRESHOLD_XYM) return "#f87171";
  if (xymValue >= WHALE_MID_THRESHOLD_XYM) return "#facc15";
  return "#e5e7eb";
}

/* ============================================================
   Unix時刻(ms)を、UTC・JST(日本標準時)併記の文字列にする
============================================================ */
export function formatUtcJstFromMs(unixMs) {
  if (unixMs == null || Number.isNaN(unixMs)) return null;
  const date = new Date(unixMs);
  if (Number.isNaN(date.getTime())) return null;

  const utcText = date.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const jstText =
    date
      .toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
      .replace(/\//g, "-") + " JST";

  return `${utcText} ／ ${jstText}`;
}

export function formatWhaleTime(timestampRaw, epochAdjustment) {
  if (timestampRaw == null || !epochAdjustment) return null;
  const unixMs = Number(epochAdjustment) * 1000 + Number(timestampRaw);
  return formatUtcJstFromMs(unixMs);
}

export function formatJpyValue(value) {
  return Math.round(value).toLocaleString("ja-JP") + "円";
}
export function formatUsdValue(value) {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "ドル";
}

export function utcDateKeyFromMs(unixMs) {
  return new Date(unixMs).toISOString().slice(0, 10);
}

async function buildHistoricalRateMap(unixMsList) {
  const rateMap = new Map();
  const uniqueDates = new Map();

  for (const unixMs of unixMsList) {
    if (unixMs == null) continue;
    const key = utcDateKeyFromMs(unixMs);
    if (!uniqueDates.has(key)) uniqueDates.set(key, unixMs);
  }

  await Promise.all(
    [...uniqueDates.entries()].map(async ([key, unixMs]) => {
      const [jpyRate, usdResult] = await Promise.all([
        getHistoricalXymJpyRate(unixMs),
        getHistoricalXymUsdRate(unixMs),
      ]);
      rateMap.set(key, { jpyRate, usdResult });
    })
  );

  return rateMap;
}

export function fiatTextFromRates(xymAmountAtomic, rates) {
  if (!rates) return "(価格取得失敗)";
  const xymValue = Number(xymAmountAtomic) / 1_000_000;
  const jpyText = rates.jpyRate != null ? formatJpyValue(xymValue * rates.jpyRate) : "円: 取得失敗";
  const usdText = rates.usdResult?.rate != null ? formatUsdValue(xymValue * rates.usdResult.rate) : "ドル: 取得失敗";
  return `(${jpyText} / ${usdText})`;
}

/* ============================================================
   ジェネシスブロック(高さ1)のタイムスタンプをキャッシュ付きで取得する
============================================================ */
let cachedGenesisTimestampMs = null;
let cachedGenesisNodeUrl = null;

async function getGenesisTimestampMs(ctx) {
  if (cachedGenesisTimestampMs != null && cachedGenesisNodeUrl === ctx.node) {
    return cachedGenesisTimestampMs;
  }
  const ts = await fetchBlockTimestampMs(1, ctx);
  cachedGenesisTimestampMs = ts;
  cachedGenesisNodeUrl = ctx.node;
  return ts;
}

/* ============================================================
   「特定の日付」用: "YYYY-MM-DD" 文字列を、指定した基準タイムゾーン
   (UTC/JST)でのその日 0:00 のUnix時刻(ms)に変換する
============================================================ */
function parseDateInputToMs(dateStr, timezone) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const utcMidnightMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  if (Number.isNaN(utcMidnightMs)) return null;

  const offsetMs = timezone === "JST" ? -9 * 60 * 60 * 1000 : 0;
  return utcMidnightMs + offsetMs;
}

/* ============================================================
   「特定の日付」の入力値を検証する。
============================================================ */
export async function validateSpecificDate(dateStr, timezone, ctx) {
  const tz = timezone === "JST" ? "JST" : "UTC";
  const fromMs = parseDateInputToMs(dateStr, tz);

  if (fromMs == null) {
    return { ok: false, error: "日付を正しく指定してください。" };
  }

  const toMs = fromMs + 24 * 60 * 60 * 1000;

  if (!ctx.node || !ctx.epochAdjustment) {
    return { ok: false, error: "ノードへの接続完了後にご利用いただけます。" };
  }

  let genesisTimestampMs, currentHeight, currentTimestampMs;
  try {
    const [genesisTs, chainInfo] = await Promise.all([
      getGenesisTimestampMs(ctx),
      fetch(new URL("/chain/info", ctx.node)).then((r) => r.json()),
    ]);
    genesisTimestampMs = genesisTs;
    currentHeight = Number(chainInfo.height);
    currentTimestampMs = await fetchBlockTimestampMs(currentHeight, ctx);
  } catch (e) {
    console.warn("validateSpecificDate: 日付の妥当性確認に失敗しました:", e);
    return { ok: false, error: "日付の確認中に通信エラーが発生しました。時間をおいて再度お試しください。" };
  }

  if (toMs <= genesisTimestampMs) {
    const genesisText = formatUtcJstFromMs(genesisTimestampMs);
    return {
      ok: false,
      error: `指定した日付はジェネシスブロック生成より前です。ジェネシスブロックの生成日時（${genesisText}）以降の日付を指定してください。`,
    };
  }

  if (fromMs > currentTimestampMs) {
    const nowText = formatUtcJstFromMs(currentTimestampMs);
    return {
      ok: false,
      error: `指定した日付はまだ訪れていません(現在時刻: ${nowText})。`,
    };
  }

  return { ok: true, fromMs, toMs, timezone: tz };
}

/* ============================================================
   集計対象のブロック高範囲を決定する
   mode: "rolling24h" | "yesterday" | "custom"
         | "rollingHours"(現在時刻から過去 hours 時間。exchangeFlow.js 等の
            他モジュールから任意の期間で呼び出すために用意)
   hours: mode==="rollingHours" の場合のみ使う時間数
============================================================ */
export async function computeHeightRange(mode, customRange, ctx, hours) {
  const chainInfo = await fetch(new URL("/chain/info", ctx.node)).then((r) => r.json());
  const currentHeight = Number(chainInfo.height);
  const currentTimestampMs = await fetchBlockTimestampMs(currentHeight, ctx);

  const now = new Date();
  const todayMidnightMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);

  let fromMs, toHeight;

  if (mode === "custom") {
    fromMs = customRange.fromMs;
    if (customRange.toMs >= currentTimestampMs) {
      toHeight = currentHeight;
    } else {
      const boundaryHeight = await findHeightForTimestamp(customRange.toMs, currentHeight, currentTimestampMs, ctx);
      toHeight = Math.max(1, boundaryHeight - 1);
    }
  } else if (mode === "yesterday") {
    fromMs = todayMidnightMs - 24 * 60 * 60 * 1000;
    const boundaryHeight = await findHeightForTimestamp(todayMidnightMs, currentHeight, currentTimestampMs, ctx);
    toHeight = Math.max(1, boundaryHeight - 1);
  } else if (mode === "rollingHours") {
    fromMs = now.getTime() - (Number(hours) || 24) * 60 * 60 * 1000;
    toHeight = currentHeight;
  } else {
    fromMs = now.getTime() - 24 * 60 * 60 * 1000;
    toHeight = currentHeight;
  }

  const fromHeight = await findHeightForTimestamp(fromMs, currentHeight, currentTimestampMs, ctx);
  const fromTimestampMs = await fetchBlockTimestampMs(fromHeight, ctx);
  const toTimestampMs = toHeight === currentHeight ? currentTimestampMs : await fetchBlockTimestampMs(toHeight, ctx);

  return { fromHeight, toHeight, fromTimestampMs, toTimestampMs, toIsNow: toHeight === currentHeight };
}

/* ============================================================
   分析本体。
   ctx: { node, sdkCore, sdkSymbol, facade, epochAdjustment, networkType }
   mode: "rolling24h" | "yesterday" | "custom"
   customRange: mode==="custom" の場合のみ { dateStr, timezone }
   onStatus: 進捗メッセージのコールバック(string | null)
============================================================ */
export async function runOnchainAnalysis(ctx, mode, customRange, onStatus) {
  if (!ctx?.node || !ctx?.epochAdjustment || !ctx?.facade) {
    throw new Error("接続完了後にご利用いただけます。");
  }

  let customMs = null;
  let resolvedCustomRange = customRange;
  if (mode === "custom") {
    onStatus?.("日付を確認しています...");
    const validation = await validateSpecificDate(customRange?.dateStr, customRange?.timezone, ctx);
    if (!validation.ok) {
      const err = new Error(validation.error);
      err.isValidationError = true;
      throw err;
    }
    customMs = { fromMs: validation.fromMs, toMs: validation.toMs };
    resolvedCustomRange = { ...customRange, timezone: validation.timezone };
  }

  onStatus?.(
    (mode === "yesterday" ? "昨日(UTC)の" : mode === "custom" ? "指定日の" : "過去24時間の") +
      "集計対象のブロック範囲を特定しています..."
  );

  const rangeTitle =
    mode === "yesterday"
      ? "昨日(UTC 0:00〜24:00)"
      : mode === "custom"
      ? `指定日（${resolvedCustomRange.dateStr}, ${resolvedCustomRange.timezone}基準 0:00〜24:00）`
      : "過去24時間(現在時刻基準)";

  const { fromHeight, toHeight, fromTimestampMs, toTimestampMs, toIsNow } = await computeHeightRange(
    mode,
    customMs,
    ctx
  );

  const blockCount = toHeight - fromHeight;
  const avgBlockIntervalSec = blockCount > 0 ? (toTimestampMs - fromTimestampMs) / 1000 / blockCount : null;

  // 高さ1(ジェネシス/ネメシスブロック)はSymbolネットワーク開始時点の初期配布を
  // 1ブロックにまとめて記録しているため、通常の1日分とは桁違いのデータを含む。
  // 集計対象の範囲に高さ1が含まれる場合は、実際のスキャン対象からは除外する。
  const includesGenesisBlock = fromHeight <= 1;
  const scanFromHeight = includesGenesisBlock ? 2 : fromHeight;

  const xymId = getXymMosaicIdHex(ctx.networkType);

  onStatus?.("ブロック範囲を集計中...");
  const result = await scanBlockRangeCombined(scanFromHeight, toHeight, xymId, ctx, (page) => {
    onStatus?.(`ブロック範囲を集計中...(${page}ページ目)`);
  });

  if (result.whales.length > 0) onStatus?.("大口移動の価格情報を取得中...");
  const whaleUnixMsList = result.whales
    .filter((w) => ctx.epochAdjustment && w.timestampRaw != null)
    .map((w) => Number(ctx.epochAdjustment) * 1000 + Number(w.timestampRaw));
  const rateMap = await buildHistoricalRateMap(whaleUnixMsList);

  // 新規アドレス作成数: 受信ベース候補と送信ベース候補の和集合に対して
  // 1回だけ問い合わせ、結果をそれぞれの集合に振り分ける(重複問い合わせの省略)
  const recipientCandidates = result.targetAddresses;
  const senderCandidateAddresses = new Set();
  for (const pubKey of result.signerPublicKeys) {
    try {
      senderCandidateAddresses.add(publicKeyToAddress(pubKey, ctx));
    } catch {
      // 変換に失敗した場合は新規アドレス判定の対象から除外する
    }
  }
  const combinedCandidates = new Set([...recipientCandidates, ...senderCandidateAddresses]);

  let recipientNewCount = 0;
  let senderNewCount = 0;
  let newAddressFailCount = 0;

  if (combinedCandidates.size > 0) {
    const combinedResult = await countNewAddressesByAddress(combinedCandidates, scanFromHeight, ctx, (done, total) => {
      onStatus?.(`新規アドレスを確認中...(${done.toLocaleString("ja-JP")} / ${total.toLocaleString("ja-JP")} アドレス)`);
    });

    newAddressFailCount = combinedResult.failCount;
    for (const [address, status] of combinedResult.resultByAddress) {
      if (status !== "new") continue;
      if (recipientCandidates.has(address)) recipientNewCount++;
      if (senderCandidateAddresses.has(address)) senderNewCount++;
    }
  }

  const newAddressTotal = recipientNewCount + senderNewCount;

  const fromText = formatUtcJstFromMs(fromTimestampMs);
  const toText = formatUtcJstFromMs(toTimestampMs);
  const rangeLabel = toIsNow ? `${fromText} 〜 現在` : `${fromText} 〜 ${toText}`;

  const genesisNote = includesGenesisBlock
    ? "高さ1(ジェネシスブロック)はSymbolネットワーク開始時の初期配布による大量データを含むため、集計対象から除外しています。"
    : null;

  onStatus?.(null);

  return {
    rangeTitle,
    rangeLabel,
    scanFromHeight,
    toHeight,
    includesGenesisBlock,
    genesisNote,
    avgBlockIntervalSec,
    transferCount: result.transferCount,
    totalAmountAtomic: result.totalAmount,
    truncated: result.truncated,
    mosaicTransferCount: result.mosaicTransferCount,
    activeAddressCount: result.signerPublicKeys.size,
    newAddressTotal,
    newAddressFailCount,
    whaleCount: result.whales.length,
    whales: result.whales,
    rateMap,
  };
}

/* ============================================================
   オンチェーン分析の結果をCSVとして書き出す。
============================================================ */
export function exportOnchainAnalysisCsv(summary, ctx) {
  if (!summary) return;

  const truncatedText = (v) => (v ? "はい(打ち切りあり)" : "いいえ");

  const rows = [
    ["オンチェーン分析 集計結果"],
    ["集計範囲", summary.rangeLabel],
    ["対象ブロック高", `${summary.scanFromHeight} 〜 ${summary.toHeight}`],
    ["ジェネシスブロックを除外", summary.includesGenesisBlock ? "はい" : "いいえ"],
    ["平均ブロック生成間隔(秒)", summary.avgBlockIntervalSec != null ? summary.avgBlockIntervalSec.toFixed(1) : ""],
    ["XYM送金件数", summary.transferCount, "打ち切り", truncatedText(summary.truncated)],
    ["XYM総移動量", Number(summary.totalAmountAtomic) / 1_000_000, "打ち切り", truncatedText(summary.truncated)],
    ["モザイク送信件数(XYM含む)", summary.mosaicTransferCount, "打ち切り", truncatedText(summary.truncated)],
    ["アクティブアドレス数", summary.activeAddressCount, "打ち切り", truncatedText(summary.truncated)],
    ["新規アドレス作成数", summary.newAddressTotal, "確認失敗件数", summary.newAddressFailCount],
    ["大口XYM移動件数", summary.whaleCount, "打ち切り", truncatedText(summary.truncated)],
    [],
    ["大口XYM移動一覧"],
    ["時刻(UTC)", "時刻(JST)", "送信元", "送信先", "金額(XYM)", "円換算", "ドル換算", "高さ", "Explorerハッシュ"],
  ];

  const sortedWhales = [...summary.whales].sort((a, b) => Number(b.height) - Number(a.height));
  const rateMap = summary.rateMap;

  for (const w of sortedWhales) {
    const senderAddr = resolveWhaleSenderAddress(w, ctx);

    let utcText = "";
    let jstText = "";
    let jpyValue = "";
    let usdValue = "";
    if (ctx.epochAdjustment && w.timestampRaw != null) {
      const unixMs = Number(ctx.epochAdjustment) * 1000 + Number(w.timestampRaw);
      const date = new Date(unixMs);
      utcText = date.toISOString().replace("T", " ").slice(0, 19) + " UTC";
      jstText =
        date
          .toLocaleString("ja-JP", {
            timeZone: "Asia/Tokyo",
            hour12: false,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
          .replace(/\//g, "-") + " JST";

      const rates = rateMap?.get(utcDateKeyFromMs(unixMs));
      const xymValue = Number(w.amount) / 1_000_000;
      if (rates?.jpyRate != null) jpyValue = Math.round(xymValue * rates.jpyRate);
      if (rates?.usdResult?.rate != null) usdValue = (xymValue * rates.usdResult.rate).toFixed(2);
    }

    rows.push([
      utcText,
      jstText,
      senderAddr,
      w.recipientAddress ?? "---",
      Number(w.amount) / 1_000_000,
      jpyValue,
      usdValue,
      w.height,
      w.hash ?? "",
    ]);
  }

  const dateStamp = new Date().toISOString().slice(0, 10);
  downloadCsv(`onchain-analysis-${dateStamp}.csv`, rows);
}
