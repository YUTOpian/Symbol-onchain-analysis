// priceRates.js
// 元アプリ(js/priceRates.js)から、オンチェーン分析が使う「過去レート取得」部分を
// そのまま移植したもの。取引所の公開API(認証不要)を直接ブラウザから叩く。

// dateStr("YYYY-MM-DD", UTC) → rate|null
const jpyHistoricalCache = new Map();
// dateStr("YYYY-MM-DD", UTC) → { rate, source }|null
const usdHistoricalCache = new Map();
// year(number) → Map(dateStr → closeRate) | null(取得失敗)
const bitbankYearCandleCache = new Map();

function utcDateStrFromMs(unixMs) {
  const d = new Date(unixMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ============================================================
   bitbankの日足ローソク足データ(年単位でまとめて返ってくる)を取得し、
   「その年の日付 → 終値」のマップを作ってキャッシュする。
============================================================ */
async function ensureBitbankYearCandles(year) {
  if (bitbankYearCandleCache.has(year)) {
    return bitbankYearCandleCache.get(year);
  }

  try {
    const res = await fetch(`https://public.bitbank.cc/xym_jpy/candlestick/1day/${year}`);
    const json = await res.json();
    const ohlcv = json?.data?.candlestick?.[0]?.ohlcv ?? [];

    const map = new Map();
    for (const c of ohlcv) {
      // c: [open, high, low, close, volume, timestampMs]
      const closeRate = Number(c[3]);
      const tsMs = Number(c[5]);
      if (Number.isFinite(closeRate) && closeRate > 0 && Number.isFinite(tsMs)) {
        map.set(utcDateStrFromMs(tsMs), closeRate);
      }
    }

    bitbankYearCandleCache.set(year, map);
    return map;
  } catch (e) {
    console.warn(`bitbank 日足データ取得失敗(${year}年):`, e);
    bitbankYearCandleCache.set(year, null);
    return null;
  }
}

/* ============================================================
   指定時刻(unixMs)が属するUTC暦日の、XYM/JPY終値を返す(bitbank日足)
   取得できなければ null
============================================================ */
export async function getHistoricalXymJpyRate(unixMs) {
  const dateStr = utcDateStrFromMs(unixMs);
  if (jpyHistoricalCache.has(dateStr)) {
    return jpyHistoricalCache.get(dateStr);
  }

  const year = new Date(unixMs).getUTCFullYear();
  const yearMap = await ensureBitbankYearCandles(year);
  const rate = yearMap ? yearMap.get(dateStr) ?? null : null;

  jpyHistoricalCache.set(dateStr, rate);
  return rate;
}

/* ============================================================
   指定時刻(unixMs)が属するUTC暦日の、XYM/USDレートを返す(CoinGecko)
   戻り値: { rate: number, source: "CoinGecko" } | null
============================================================ */
export async function getHistoricalXymUsdRate(unixMs) {
  const dateStr = utcDateStrFromMs(unixMs);
  if (usdHistoricalCache.has(dateStr)) {
    return usdHistoricalCache.get(dateStr);
  }

  const [y, m, d] = dateStr.split("-");
  const coingeckoDate = `${d}-${m}-${y}`; // CoinGeckoは DD-MM-YYYY 形式

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/symbol/history?date=${coingeckoDate}&localization=false`
    );
    const json = await res.json();
    const rate = Number(json?.market_data?.current_price?.usd);
    const result = Number.isFinite(rate) && rate > 0 ? { rate, source: "CoinGecko" } : null;

    usdHistoricalCache.set(dateStr, result);
    return result;
  } catch (e) {
    console.warn(`CoinGecko 過去レート取得失敗(${dateStr}):`, e);
    usdHistoricalCache.set(dateStr, null);
    return null;
  }
}
