import { useMemo } from "react";
import { formatMosaicAmount } from "../lib/utils";
import { formatUtcJstFromMs } from "../lib/onchainAnalysis";
import {
  EXCHANGES,
  COMBINED_EXCHANGE_ID,
  DETAIL_MAX_SHOW,
  netColorOf,
  amountHighlightColor,
  getExplorerUrl,
} from "../lib/exchangeFlow";

function TxRow({ tx, networkType, epochAdjustment }) {
  const color = amountHighlightColor(tx.amount);
  const dirLabel = tx.direction === "in" ? "↙ 流入" : "↗ 流出";
  const dirColorClass = tx.direction === "in" ? "exchange-row-in" : "exchange-row-out";
  const senderAddress = tx.direction === "in" ? tx.counterpartyAddress : tx.ownAddress;
  const recipientAddress = tx.direction === "in" ? tx.ownAddress : tx.counterpartyAddress;
  const timeText =
    tx.timestampRaw != null && epochAdjustment
      ? formatUtcJstFromMs(Number(epochAdjustment) * 1000 + Number(tx.timestampRaw))
      : null;

  return (
    <li className="exchange-tx-row">
      <div className="exchange-tx-row-head">
        <span className={dirColorClass}>{dirLabel}</span>
        <span style={{ color, fontWeight: "bold" }}>{formatMosaicAmount(tx.amount, 6)} XYM</span>
      </div>
      <div className="exchange-tx-row-detail">送信元: {senderAddress ?? "---"}</div>
      <div className="exchange-tx-row-detail">送信先: {recipientAddress ?? "---"}</div>
      <div className="exchange-tx-row-meta">
        <span>高さ: {tx.height ?? "---"}</span>
        {timeText && <span>{timeText}</span>}
        {tx.hash && (
          <a href={getExplorerUrl(tx.hash, networkType)} target="_blank" rel="noopener noreferrer" className="exchange-row-link-a">
            Explorerで見る ↗
          </a>
        )}
      </div>
    </li>
  );
}

export default function ExchangeFlowDetail({ exId, rangeLabel, result, networkType, epochAdjustment, onClose }) {
  const isCombined = exId === COMBINED_EXCHANGE_ID;
  const ex = isCombined ? null : EXCHANGES.find((e) => e.id === exId);

  const sorted = useMemo(
    () => [...(result?.transactions ?? [])].sort((a, b) => Number(b.height ?? 0) - Number(a.height ?? 0)),
    [result]
  );

  if (!isCombined && !ex) return null;

  const title = isCombined ? "全取引所合計 の流入・流出履歴" : `${ex.label} の流入・流出履歴`;

  return (
    <div className="exchange-detail">
      <div className="exchange-detail-head">
        <div>
          <p className="exchange-detail-title">{title}</p>
          <p className="exchange-detail-range">{rangeLabel}</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          閉じる
        </button>
      </div>

      {isCombined && (
        <p className="exchange-detail-note">
          追跡対象取引所同士の移動は除外しているため、ここに表示されるのはすべて
          <b>プライベートウォレット(追跡対象外のアドレス)との間の流入・流出</b>です。
        </p>
      )}

      {result.errored ? (
        <div className="alert alert-error">
          ⚠️ 取得に失敗しました(ノードへの問い合わせエラー)。集計を再度実行してください。
          {result.errorDetail && <div className="exchange-row-warn-detail">詳細: {result.errorDetail}</div>}
        </div>
      ) : (
        <>
          <div className="exchange-detail-summary">
            <div>
              流入合計: <b className="exchange-row-in">{formatMosaicAmount(result.inflowAmount, 6)} XYM</b>（
              {result.inflowCount.toLocaleString("ja-JP")}件）
            </div>
            <div>
              流出合計: <b className="exchange-row-out">{formatMosaicAmount(result.outflowAmount, 6)} XYM</b>（
              {result.outflowCount.toLocaleString("ja-JP")}件）
            </div>
            <div>
              純増減:{" "}
              <b style={{ color: netColorOf(result.inflowAmount - result.outflowAmount) }}>
                {(result.inflowAmount - result.outflowAmount > 0n ? "+" : "") +
                  formatMosaicAmount(result.inflowAmount - result.outflowAmount, 6)}{" "}
                XYM
              </b>
            </div>
            {result.truncated && <div className="exchange-row-warn">件数が多いため集計が打ち切られています</div>}
          </div>

          {sorted.length === 0 ? (
            <p className="whale-empty">この期間の取引はありませんでした</p>
          ) : (
            <>
              <ul className="exchange-tx-list">
                {sorted.slice(0, DETAIL_MAX_SHOW).map((tx, i) => (
                  <TxRow key={`${tx.hash ?? tx.height}-${i}`} tx={tx} networkType={networkType} epochAdjustment={epochAdjustment} />
                ))}
              </ul>
              {sorted.length > DETAIL_MAX_SHOW && (
                <p className="exchange-detail-more">
                  他 {sorted.length - DETAIL_MAX_SHOW} 件（新しい順に{DETAIL_MAX_SHOW}件のみ表示）
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
