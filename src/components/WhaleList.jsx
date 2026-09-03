import { useMemo } from "react";
import { formatMosaicAmount } from "../lib/utils";
import {
  whaleAmountColor,
  formatWhaleTime,
  fiatTextFromRates,
  utcDateKeyFromMs,
  resolveWhaleSenderAddress,
  getExplorerUrl,
} from "../lib/onchainAnalysis";

export default function WhaleList({ whales, rateMap, ctx, networkType, epochAdjustment }) {
  const sorted = useMemo(() => [...whales].sort((a, b) => Number(b.height) - Number(a.height)), [whales]);

  if (sorted.length === 0) {
    return (
      <div className="whale-panel">
        <p className="whale-empty">該当する大口移動はありませんでした</p>
      </div>
    );
  }

  return (
    <div className="whale-panel">
      <ul className="whale-list">
        {sorted.map((w, i) => {
          const color = whaleAmountColor(w.amount);
          const timeText = formatWhaleTime(w.timestampRaw, epochAdjustment);
          const senderAddr = ctx ? resolveWhaleSenderAddress(w, ctx) : "---";

          let fiatText = "";
          if (epochAdjustment && w.timestampRaw != null) {
            const unixMs = Number(epochAdjustment) * 1000 + Number(w.timestampRaw);
            const rates = rateMap?.get(utcDateKeyFromMs(unixMs));
            fiatText = fiatTextFromRates(w.amount, rates);
          }

          return (
            <li key={`${w.hash ?? w.height}-${i}`} className="whale-row">
              <div className="whale-row-amount" style={{ color }}>
                {formatMosaicAmount(w.amount, 6)} XYM
                {fiatText && <span className="whale-row-fiat">{fiatText}</span>}
              </div>
              <div className="whale-row-detail">送信元: {senderAddr}</div>
              <div className="whale-row-detail">送信先: {w.recipientAddress ?? "---"}</div>
              <div className="whale-row-meta">
                <span>高さ: {w.height}</span>
                {timeText && <span>{timeText}</span>}
                {w.hash && (
                  <a
                    href={getExplorerUrl(w.hash, networkType)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="whale-row-link"
                  >
                    Explorerで見る ↗
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
