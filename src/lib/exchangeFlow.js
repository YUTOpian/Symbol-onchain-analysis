// exchangeFlow.js
// Symbol-tomato-wallet の js/exchangeFlow.js から、
// 「データ画面の取引所フロー分析」機能のロジックだけを抽出し、
// DOM直接操作をやめてReactから使いやすい形(値を返す関数群)に移植したもの。
//
// onchainAnalysis.js がブロック高範囲を丸ごと走査するのに対し、こちらは
// REST APIの address フィルタ(そのアドレスが送信者 or 受信者のトランザクション
// のみを返す)を使うため、対象アドレスが少数の場合ずっと軽量に集計できる。
//
// 判定方法:
//   recipientAddress が対象アドレスと一致          → 流入(取引所への入金)
//   一致しない(=そのトランザクションの送信者側)     → 流出(取引所からの出金)
//
// 対象取引所アドレスは固定リスト(EXCHANGES)で管理する。

import { getXymMosaicIdHex } from "./config";
import { downloadCsv } from "./utils";
import { computeHeightRange, formatUtcJstFromMs, validateSpecificDate, getExplorerUrl } from "./onchainAnalysis";

const TRANSFER_TYPE = 16724; // Transfer Transaction
const AGGREGATE_COMPLETE_TYPE = 16705;
const AGGREGATE_BONDED_TYPE = 16961;
const SCAN_PAGE_SIZE = 100;
const SCAN_MAX_PAGES = 200; // 安全のための上限(アドレス1件あたり最大 20,000 件)

// 送金でモザイクを「symbol.xym」というネームスペース名義で指定した場合、
// REST APIは解決済みの実モザイクID(6BED913FA20223F8等)ではなく、
// ネームスペース自体のID(解決前のID)をそのまま返す。取引所はこの
// ネームスペース経由の指定を使うことが多いため、両方を「XYM」として
// 認識できるようにしておく。値はSDKで動的計算し、失敗時のみ既知の
// 定数値(ネットワークに依存しない固定値)にフォールバックする。
const SYMBOL_XYM_NAMESPACE_ID_HEX_FALLBACK = "E74B99BA41F4AFEE";

// 個別取引の強調表示しきい値(XYM)
const MID_AMOUNT_THRESHOLD_XYM = 100000; // これ以上は黄色
const HIGH_AMOUNT_THRESHOLD_XYM = 1000000; // これ以上は赤色

// 詳細画面に表示する取引の最大件数(新しい順)
export const DETAIL_MAX_SHOW = 300;

// 各取引所は1つ以上のアドレスをグループとして持つ(例: 入金用/出金用が
// 分かれている取引所)。同じグループ内アドレス同士のXYM移動(社内での
// 資金移動)は、外部との流入・流出としてはカウントしない(scanExchangeGroup参照)。
export const EXCHANGES = [
  {
    id: "bitbank",
    label: "Bitbank",
    addresses: [
      { label: "入金用 (deposits)", address: "NDURU3U7Y7KKTPC2VVVF6U3VJIU5HDWSHQZCS4Q" },
      { label: "出金用 (withdrawals)", address: "NAIJUACP6BKCMFV7C7IDSZSAD7UNBMAE3TM7JKY" },
    ],
  },
  {
    id: "zaif",
    label: "Zaif",
    addresses: [
      { label: "出金用 (withdrawals)", address: "NA2NFUHQWYIASA5BHFJBM6OBQDEZDI34RUMNDHA" },
      { label: "入金用 (deposits)", address: "NBVU44NKAED5MLPEY4Y7Z5OMUAUXLYI7HOIKNSY" },
    ],
  },
  { id: "bitflyer", label: "bitFlyer", addresses: [{ label: null, address: "NDLSY2ZHQO5BR7SYC6I3YCGAW4WYZCFUCX6PIZY" }] },
  { id: "mexc", label: "MEXC", addresses: [{ label: null, address: "NABGDANLKUZ3D2SQOUEKPGYI6OAUFHEDW233FKY" }] },
  { id: "gateio", label: "Gate.io", addresses: [{ label: null, address: "NBWKVE7QG7TNNPSHRKUP2BYQWMOGJBHI3DO4OTY" }] },
];

// 「全取引所合計」を、個別の取引所と同じ仕組みで扱うための仮想ID
export const COMBINED_EXCHANGE_ID = "__combined__";

export const RANGE_LABELS = {
  "24h": "過去24時間",
  "7d": "過去7日間",
  "30d": "過去30日間",
};
export const RANGE_HOURS = {
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
};

/* ============================================================
   REST APIのアドレス表現(16進 or base32)を統一する
   (onchainAnalysis.jsと同じ考え方)
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

/* ============================================================
   「symbol.xym」ネームスペースのID(16進)を計算する。
   モザイクを直接IDでなくネームスペース名義で指定した送金では、
   REST APIがこのIDを(解決前の)モザイクIDとして返してくるため、
   XYM判定にはこの値も含める必要がある。
============================================================ */
function computeSymbolXymNamespaceIdHex(ctx) {
  try {
    const path = ctx.sdkSymbol.generateNamespacePath("symbol.xym");
    const idValue = path[path.length - 1];
    return idValue.toString(16).toUpperCase().padStart(16, "0");
  } catch (e) {
    console.warn("exchangeFlow: symbol.xym 名前空間IDの計算に失敗しました:", e);
    return null;
  }
}

/* ============================================================
   「これはXYMか」の判定に使う、許容するモザイクID一式を組み立てる。
============================================================ */
function buildXymMosaicIdSet(ctx) {
  const ids = new Set();
  ids.add(getXymMosaicIdHex(ctx.networkType));

  const namespaceIdHex = computeSymbolXymNamespaceIdHex(ctx);
  ids.add(namespaceIdHex || SYMBOL_XYM_NAMESPACE_ID_HEX_FALLBACK);

  return ids;
}

/* ============================================================
   アグリゲート詳細取得の並列数(元アプリと同じ考え方)
============================================================ */
const AGGREGATE_DETAIL_CONCURRENCY = 8;

async function fetchAggregateInnerTxs(hash, ctx) {
  try {
    const res = await fetch(`${ctx.node}/transactions/confirmed/${hash}`);
    if (!res.ok) return { hash, error: true, innerTxs: [] };
    const detail = await res.json();
    return { hash, error: false, innerTxs: detail.transaction?.transactions ?? [] };
  } catch (e) {
    console.warn(`exchangeFlow: アグリゲート詳細の取得に失敗しました (${hash}):`, e);
    return { hash, error: true, innerTxs: [] };
  }
}

async function fetchAggregateInnerTxsPooled(hashes, ctx) {
  const results = new Array(hashes.length);
  let cursor = 0;

  async function worker() {
    while (cursor < hashes.length) {
      const i = cursor++;
      results[i] = await fetchAggregateInnerTxs(hashes[i], ctx);
    }
  }

  const workers = Array.from({ length: Math.min(AGGREGATE_DETAIL_CONCURRENCY, hashes.length) }, worker);
  await Promise.all(workers);
  return results;
}

/* ============================================================
   1つの取引所アドレスについて、指定ブロック高範囲のXYM流入/流出を集計する。
   個々の取引(方向・金額・相手アドレス・高さ・ハッシュ)もすべて記録し、
   詳細表示にそのまま使えるようにする。
============================================================ */
async function scanExchangeAddress(address, fromHeight, toHeight, xymMosaicIds, ownAddressSet, ctx, onProgress) {
  let pageNumber = 1;
  let inflowAmount = 0n;
  let outflowAmount = 0n;
  let inflowCount = 0;
  let outflowCount = 0;
  let truncated = false;
  let errored = false;
  let errorDetail = null;
  const transactions = [];

  function recordTransfer(tx, hash, height, timestampRaw) {
    const mosaics = tx.mosaics || [];
    const xymEntry = mosaics.find((m) => xymMosaicIds.has(String(m.id).toUpperCase()));
    if (!xymEntry) return; // XYMを含まない送金(他モザイクのみ)は対象外

    const amount = BigInt(xymEntry.amount);
    const recipientAddr = normalizeMaybeHexAddress(tx.recipientAddress, ctx.sdkSymbol);
    const isInflow = recipientAddr === address;

    let counterpartyAddress = null;
    if (isInflow) {
      try {
        counterpartyAddress = tx.signerPublicKey ? publicKeyToAddress(tx.signerPublicKey, ctx) : null;
      } catch {
        counterpartyAddress = null;
      }
    } else {
      counterpartyAddress = recipientAddr;
    }

    // 相手が同じ取引所グループ内の別アドレス(例: 入金用⇔出金用)の場合、
    // それは取引所内部での資金移動であり、外部との流入・流出ではないため
    // カウントしない(件数・金額どちらも対象外)。
    if (counterpartyAddress && ownAddressSet.has(counterpartyAddress)) return;

    if (isInflow) {
      inflowAmount += amount;
      inflowCount++;
    } else {
      outflowAmount += amount;
      outflowCount++;
    }

    transactions.push({ direction: isInflow ? "in" : "out", amount, counterpartyAddress, hash, height, timestampRaw, ownAddress: address });
  }

  while (pageNumber <= SCAN_MAX_PAGES) {
    // typeによるサーバー側フィルタは指定しない。取引所の入出金はアグリゲート
    // トランザクション経由のことが多く、typeで絞ると中に埋め込まれた送金ごと
    // 丸ごと除外されてしまうため。種別判定・アグリゲートの展開はすべて
    // クライアント側で行う。
    const params = new URLSearchParams({
      address,
      fromHeight: String(fromHeight),
      toHeight: String(toHeight),
      pageSize: String(SCAN_PAGE_SIZE),
      pageNumber: String(pageNumber),
      order: "asc",
    });

    const url = `${ctx.node}/transactions/confirmed?${params}`;
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      console.warn(`exchangeFlow: ${address} への通信に失敗しました:`, e);
      errored = true;
      errorDetail = `通信エラー: ${e.message || e}`;
      break;
    }

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      console.warn(`exchangeFlow: ${address} の取得に失敗しました (HTTP ${res.status}):`, bodyText);
      errored = true;
      errorDetail = `HTTP ${res.status}${bodyText ? `: ${bodyText.slice(0, 200)}` : ""}`;
      break;
    }

    const json = await res.json();
    const items = json.data ?? [];
    if (items.length === 0) break;

    const aggregateItems = []; // { hash, height, timestampRaw } のリスト(このページ分)

    for (const item of items) {
      const tx = item.transaction;
      const hash = item.meta?.hash;
      const height = item.meta?.height;
      const timestampRaw = item.meta?.timestamp;
      const type = Number(tx.type);

      if (type === TRANSFER_TYPE) {
        recordTransfer(tx, hash, height, timestampRaw);
        continue;
      }

      if (type === AGGREGATE_COMPLETE_TYPE || type === AGGREGATE_BONDED_TYPE) {
        aggregateItems.push({ hash, height, timestampRaw });
      }
    }

    // 取引所の入出金は複数操作をまとめたアグリゲートで行われることが多いため、
    // このページ分のアグリゲートをまとめて並列取得し、中の埋め込み送金を展開する
    if (aggregateItems.length > 0) {
      const detailResults = await fetchAggregateInnerTxsPooled(aggregateItems.map((a) => a.hash), ctx);

      detailResults.forEach((detailResult, i) => {
        if (detailResult.error) return;
        const { height, timestampRaw } = aggregateItems[i];
        for (const inner of detailResult.innerTxs) {
          const innerTx = inner.transaction;
          if (!innerTx || Number(innerTx.type) !== TRANSFER_TYPE) continue;

          // このアグリゲートの埋め込み送金のうち、走査対象アドレス(address)が
          // 実際に関与するもの(送信者 or 受信者)だけを対象にする。そうしないと、
          // 例えば「取引所Aが取引所Bを含む複数の相手にまとめて送金」した場合、
          // Bのアドレスをスキャンしているにもかかわらず、B宛て以外(他の受取人)
          // への送金まで誤って計上されてしまう。
          const innerRecipient = normalizeMaybeHexAddress(innerTx.recipientAddress, ctx.sdkSymbol);
          let innerSigner = null;
          try {
            innerSigner = innerTx.signerPublicKey ? publicKeyToAddress(innerTx.signerPublicKey, ctx) : null;
          } catch {
            innerSigner = null;
          }

          if (innerRecipient !== address && innerSigner !== address) continue;

          recordTransfer(innerTx, detailResult.hash, height, timestampRaw);
        }
      });
    }

    onProgress?.(pageNumber);

    // 新しいcatapult-restではpagination.totalPagesが廃止されているため、
    // 「フルページ未満が返ってきたら最終ページ」という判定で継続/終了を決める
    if (items.length < SCAN_PAGE_SIZE) break;
    pageNumber++;
  }

  if (pageNumber > SCAN_MAX_PAGES) truncated = true;

  return { inflowAmount, outflowAmount, inflowCount, outflowCount, truncated, errored, errorDetail, transactions };
}

/* ============================================================
   取引所グループ(1つ以上のアドレス)をまとめてスキャンし、結果を合算する。
   グループ内アドレス同士(例: 入金用⇔出金用)の移動は、各アドレスの
   scanExchangeAddress側で自動的に除外されるため、ここでは単純に
   各アドレスの結果を足し合わせるだけでよい。
============================================================ */
async function scanExchangeGroup(addressEntries, fromHeight, toHeight, xymMosaicIds, ctx, onProgress) {
  const ownAddressSet = new Set(addressEntries.map((a) => a.address.toUpperCase()));

  let inflowAmount = 0n;
  let outflowAmount = 0n;
  let inflowCount = 0;
  let outflowCount = 0;
  let truncated = false;
  let errored = false;
  const errorDetails = [];
  const transactions = [];

  for (const entry of addressEntries) {
    const r = await scanExchangeAddress(entry.address.toUpperCase(), fromHeight, toHeight, xymMosaicIds, ownAddressSet, ctx, onProgress);

    inflowAmount += r.inflowAmount;
    outflowAmount += r.outflowAmount;
    inflowCount += r.inflowCount;
    outflowCount += r.outflowCount;
    truncated = truncated || r.truncated;
    transactions.push(...r.transactions);

    if (r.errored) {
      errored = true;
      errorDetails.push(`${entry.label ? entry.label + ": " : ""}${r.errorDetail ?? "不明なエラー"}`);
    }
  }

  return {
    inflowAmount,
    outflowAmount,
    inflowCount,
    outflowCount,
    truncated,
    errored,
    errorDetail: errorDetails.length > 0 ? errorDetails.join(" / ") : null,
    transactions,
  };
}

/* ============================================================
   純増減の色・個別取引の強調色(UIコンポーネントから使う)
============================================================ */
export function netColorOf(net) {
  if (net > 0n) return "#4ade80";
  if (net < 0n) return "#f87171";
  return "#94a3b8";
}

export function amountHighlightColor(amount) {
  const xymValue = Number(amount) / 1_000_000;
  if (xymValue >= HIGH_AMOUNT_THRESHOLD_XYM) return "#f87171";
  if (xymValue >= MID_AMOUNT_THRESHOLD_XYM) return "#facc15";
  return "#e5e7eb";
}

export { getExplorerUrl };

/* ============================================================
   分析本体。
   ctx: { node, sdkCore, sdkSymbol, facade, epochAdjustment, networkType }
   mode: "24h" | "7d" | "30d" | "custom"
   customRange: mode==="custom" の場合のみ { dateStr, timezone }
   onStatus: 進捗メッセージのコールバック(string | null)
============================================================ */
export async function runExchangeFlowAnalysis(ctx, mode, customRange, onStatus) {
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

  const hours = RANGE_HOURS[mode] ?? 24;
  const rangeLabelBase =
    mode === "custom"
      ? `指定日（${resolvedCustomRange.dateStr}, ${resolvedCustomRange.timezone}基準 0:00〜24:00）`
      : RANGE_LABELS[mode] ?? "過去24時間";

  onStatus?.("集計対象のブロック範囲を特定しています...");

  const { fromHeight, toHeight, fromTimestampMs, toTimestampMs, toIsNow } =
    mode === "custom"
      ? await computeHeightRange("custom", customMs, ctx)
      : await computeHeightRange("rollingHours", undefined, ctx, hours);

  const xymMosaicIds = buildXymMosaicIdSet(ctx);

  const fromText = formatUtcJstFromMs(fromTimestampMs);
  const toText = formatUtcJstFromMs(toTimestampMs);
  const rangeLabel = toIsNow ? `${rangeLabelBase}（${fromText} 〜 現在）` : `${rangeLabelBase}（${fromText} 〜 ${toText}）`;

  // 各取引所は互いに独立した(別アドレスへの)問い合わせのため、
  // 順番に待つのではなくまとめて並列実行して待ち時間を短縮する。
  // 「全取引所合計」は、各取引所ごとの数字を後から足し引きするのではなく、
  // 追跡対象の全アドレスを最初から1つのグループとみなしてスキャンする
  // (取引所の垣根を越えたアドレス同士の移動もすべて「内部移動」として
  //  除外できるため、個別取引所の集計と食い違いが発生しない)。
  onStatus?.(`${EXCHANGES.length}取引所を集計中...`);

  const allAddressEntries = EXCHANGES.flatMap((ex) => ex.addresses);

  const [results, combinedResult] = await Promise.all([
    Promise.all(
      EXCHANGES.map(async (ex) => {
        let result;
        try {
          result = await scanExchangeGroup(ex.addresses, fromHeight, toHeight, xymMosaicIds, ctx, () => {});
        } catch (e) {
          console.error(`exchangeFlow: ${ex.label} の集計中にエラーが発生しました:`, e);
          result = {
            inflowAmount: 0n,
            outflowAmount: 0n,
            inflowCount: 0,
            outflowCount: 0,
            truncated: false,
            errored: true,
            errorDetail: `例外: ${e.message || e}`,
            transactions: [],
          };
        }
        return { ex, result };
      })
    ),
    (async () => {
      try {
        return await scanExchangeGroup(allAddressEntries, fromHeight, toHeight, xymMosaicIds, ctx, () => {});
      } catch (e) {
        console.error("exchangeFlow: 全取引所合計の集計中にエラーが発生しました:", e);
        return {
          inflowAmount: 0n,
          outflowAmount: 0n,
          inflowCount: 0,
          outflowCount: 0,
          truncated: false,
          errored: true,
          errorDetail: `例外: ${e.message || e}`,
          transactions: [],
        };
      }
    })(),
  ]);

  onStatus?.(null);

  const resultsById = {};
  for (const { ex, result } of results) resultsById[ex.id] = result;
  resultsById[COMBINED_EXCHANGE_ID] = combinedResult;

  return {
    rangeLabelBase,
    rangeLabel,
    fromHeight,
    toHeight,
    results,
    combinedResult,
    resultsById,
  };
}

/* ============================================================
   取引所フロー分析の結果をCSVとして書き出す。
   ・全取引所合計(合計流入・合計流出・合計純増減)
   ・取引所別内訳(流入・流出・純増減・件数)
   のみを対象とし、個別の取引履歴(流入・流出履歴)は含めない。
============================================================ */
export function exportExchangeFlowCsv(summary) {
  if (!summary) return;

  const { rangeLabel, results, combinedResult } = summary;

  // 「全取引所合計」は、追跡対象の全アドレスを1つのアドレスとみなして
  // 計算した正しい値(combinedResult)をそのまま使う。各取引所ごとの
  // 流入・流出をここで単純合算すると、取引所間の移動が二重計上されて
  // しまうため使わない。
  const totalInflow = combinedResult.inflowAmount;
  const totalOutflow = combinedResult.outflowAmount;
  const totalNet = totalInflow - totalOutflow;

  const toXym = (atomic) => Number(atomic) / 1_000_000;

  const rows = [
    ["取引所フロー分析 集計結果"],
    ["集計範囲", rangeLabel],
    [],
    ["全取引所合計"],
    ["合計流入(XYM)", toXym(totalInflow)],
    ["合計流入件数", combinedResult.inflowCount],
    ["合計流出(XYM)", toXym(totalOutflow)],
    ["合計流出件数", combinedResult.outflowCount],
    ["合計純増減(XYM)", toXym(totalNet)],
    [],
    ["取引所別内訳(参考: 各取引所単体で見た場合の流入・流出。取引所間の移動も含む)"],
    ["取引所", "アドレス", "流入(XYM)", "流入件数", "流出(XYM)", "流出件数", "純増減(XYM)", "打ち切り", "取得エラー"],
  ];

  for (const { ex, result } of results) {
    const addressText = ex.addresses.map((a) => (a.label ? `${a.label}: ${a.address}` : a.address)).join(" / ");

    if (result.errored) {
      rows.push([ex.label, addressText, "", "", "", "", "", "", result.errorDetail || "取得に失敗しました"]);
      continue;
    }

    const net = result.inflowAmount - result.outflowAmount;
    rows.push([
      ex.label,
      addressText,
      toXym(result.inflowAmount),
      result.inflowCount,
      toXym(result.outflowAmount),
      result.outflowCount,
      toXym(net),
      result.truncated ? "はい" : "いいえ",
      "",
    ]);
  }

  const dateStamp = new Date().toISOString().slice(0, 10);
  downloadCsv(`exchange-flow-analysis-${dateStamp}.csv`, rows);
}
