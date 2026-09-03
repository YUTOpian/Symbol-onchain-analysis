import { formatMosaicAmount } from "../lib/utils";
import { COMBINED_EXCHANGE_ID, netColorOf } from "../lib/exchangeFlow";

function addressListText(ex) {
  return ex.addresses.map((a) => (a.label ? `${a.label}: ${a.address}` : a.address));
}

function CombinedRow({ combinedResult, erroredExchanges, selected, onClick }) {
  const totalNet = combinedResult.inflowAmount - combinedResult.outflowAmount;
  const netText = (totalNet > 0n ? "+" : "") + formatMosaicAmount(totalNet, 6) + " XYM";

  return (
    <button
      type="button"
      className={`exchange-row exchange-row-combined ${selected ? "is-selected" : ""}`}
      onClick={onClick}
    >
      <div className="exchange-row-title">
        全取引所合計{erroredExchanges.length > 0 ? "（取得失敗分を除く）" : ""}
      </div>
      <div className="exchange-row-line">
        合計流入: <b className="exchange-row-in">{formatMosaicAmount(combinedResult.inflowAmount, 6)} XYM</b>（
        {combinedResult.inflowCount.toLocaleString("ja-JP")}件）
      </div>
      <div className="exchange-row-line">
        合計流出: <b className="exchange-row-out">{formatMosaicAmount(combinedResult.outflowAmount, 6)} XYM</b>（
        {combinedResult.outflowCount.toLocaleString("ja-JP")}件）
      </div>
      <div className="exchange-row-line">
        合計純増減: <b style={{ color: netColorOf(totalNet) }}>{netText}</b>
      </div>
      {combinedResult.truncated && (
        <div className="exchange-row-warn">一部のアドレスで件数が多いため集計が打ち切られています</div>
      )}
      {erroredExchanges.length > 0 && (
        <div className="exchange-row-warn">⚠️ 取得に失敗しました: {erroredExchanges.join("、")}</div>
      )}
      <div className="exchange-row-link">クリックで取引履歴を見る →</div>
    </button>
  );
}

function ExchangeRow({ ex, result, selected, onClick }) {
  if (result.errored) {
    return (
      <button type="button" className={`exchange-row ${selected ? "is-selected" : ""}`} onClick={onClick}>
        <div className="exchange-row-title">{ex.label}</div>
        {addressListText(ex).map((line, i) => (
          <div key={i} className="exchange-row-address">
            {line}
          </div>
        ))}
        <div className="exchange-row-warn">⚠️ 取得に失敗しました(ノードへの問い合わせエラー)</div>
        {result.errorDetail && <div className="exchange-row-warn-detail">詳細: {result.errorDetail}</div>}
      </button>
    );
  }

  const net = result.inflowAmount - result.outflowAmount;
  const netText = (net > 0n ? "+" : "") + formatMosaicAmount(net, 6) + " XYM";
  const suffix = result.truncated ? " 以上(件数が多いため打ち切り)" : "";

  return (
    <button type="button" className={`exchange-row ${selected ? "is-selected" : ""}`} onClick={onClick}>
      <div className="exchange-row-title">{ex.label}</div>
      {addressListText(ex).map((line, i) => (
        <div key={i} className="exchange-row-address">
          {line}
        </div>
      ))}
      <div className="exchange-row-line">
        流入: <b className="exchange-row-in">{formatMosaicAmount(result.inflowAmount, 6)} XYM</b>（
        {result.inflowCount.toLocaleString("ja-JP")}件）{suffix}
      </div>
      <div className="exchange-row-line">
        流出: <b className="exchange-row-out">{formatMosaicAmount(result.outflowAmount, 6)} XYM</b>（
        {result.outflowCount.toLocaleString("ja-JP")}件）{suffix}
      </div>
      <div className="exchange-row-line">
        純増減: <b style={{ color: netColorOf(net) }}>{netText}</b>
      </div>
      <div className="exchange-row-link">クリックで取引履歴を見る →</div>
    </button>
  );
}

export default function ExchangeFlowList({ results, combinedResult, selectedExchangeId, onSelectExchange }) {
  const erroredExchanges = results.filter((r) => r.result.errored).map((r) => r.ex.label);

  return (
    <div className="exchange-list">
      <CombinedRow
        combinedResult={combinedResult}
        erroredExchanges={erroredExchanges}
        selected={selectedExchangeId === COMBINED_EXCHANGE_ID}
        onClick={() => onSelectExchange(COMBINED_EXCHANGE_ID)}
      />
      {results.map(({ ex, result }) => (
        <ExchangeRow
          key={ex.id}
          ex={ex}
          result={result}
          selected={selectedExchangeId === ex.id}
          onClick={() => onSelectExchange(ex.id)}
        />
      ))}
    </div>
  );
}
