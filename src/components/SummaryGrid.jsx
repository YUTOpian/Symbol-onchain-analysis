import { formatMosaicAmount } from "../lib/utils";
import { WHALE_THRESHOLD_XYM } from "../lib/onchainAnalysis";

function withSuffix(text, truncated) {
  return truncated ? `${text} 以上` : text;
}

export default function SummaryGrid({ result, onOpenWhales, whalesOpen }) {
  const {
    avgBlockIntervalSec,
    totalAmountAtomic,
    transferCount,
    mosaicTransferCount,
    activeAddressCount,
    newAddressTotal,
    newAddressFailCount,
    whaleCount,
    truncated,
  } = result;

  return (
    <div className="metric-grid">
      <div className="metric-card">
        <p className="metric-label">平均ブロック生成間隔</p>
        <p className="metric-value">{avgBlockIntervalSec != null ? `${avgBlockIntervalSec.toFixed(1)} 秒` : "---"}</p>
      </div>

      <div className="metric-card">
        <p className="metric-label">XYM総移動量</p>
        <p className="metric-value">{withSuffix(`${formatMosaicAmount(totalAmountAtomic, 6)} XYM`, truncated)}</p>
      </div>

      <div className="metric-card">
        <p className="metric-label">XYM送金件数</p>
        <p className="metric-value">{withSuffix(`${transferCount.toLocaleString("ja-JP")} 件`, truncated)}</p>
      </div>

      <div className="metric-card">
        <p className="metric-label">モザイク送信件数(XYM含む)</p>
        <p className="metric-value">{withSuffix(`${mosaicTransferCount.toLocaleString("ja-JP")} 件`, truncated)}</p>
      </div>

      <div className="metric-card">
        <p className="metric-label">アクティブアドレス数</p>
        <p className="metric-value">{withSuffix(`${activeAddressCount.toLocaleString("ja-JP")} アドレス`, truncated)}</p>
        <p className="metric-hint">全トランザクション種別・送信元ベース</p>
      </div>

      <div className="metric-card">
        <p className="metric-label">新規アドレス作成数</p>
        <p className="metric-value">
          {withSuffix(`${newAddressTotal.toLocaleString("ja-JP")} アドレス`, truncated)}
          {newAddressFailCount > 0 && <span className="metric-value-note">（{newAddressFailCount}件確認失敗）</span>}
        </p>
        <p className="metric-hint">ネットワーク上で新しく認知されたアドレス数</p>
      </div>

      <button type="button" className="metric-card metric-card-clickable" onClick={onOpenWhales}>
        <p className="metric-label">大口XYM移動件数({WHALE_THRESHOLD_XYM.toLocaleString("ja-JP")} XYM以上)</p>
        <p className="metric-value">{withSuffix(`${whaleCount.toLocaleString("ja-JP")} 件`, truncated)}</p>
        <p className="metric-hint metric-hint-link">{whalesOpen ? "一覧を閉じる ↑" : "クリックで一覧を見る ↓"}</p>
      </button>
    </div>
  );
}
