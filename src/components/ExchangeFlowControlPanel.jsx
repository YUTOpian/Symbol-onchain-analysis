export default function ExchangeFlowControlPanel({
  disabled,
  runningMode,
  statusText,
  onRun24h,
  onRun7d,
  onRun30d,
  onRunCustom,
  customDate,
  onCustomDateChange,
  customTimezone,
  onCustomTimezoneChange,
  customError,
}) {
  const isBusy = runningMode != null;

  return (
    <section className="panel">
      <div className="panel-row">
        <button type="button" className="btn btn-primary" disabled={disabled || isBusy} onClick={onRun24h}>
          {runningMode === "24h" ? "集計中…" : "過去24時間で集計"}
        </button>
        <button type="button" className="btn btn-primary" disabled={disabled || isBusy} onClick={onRun7d}>
          {runningMode === "7d" ? "集計中…" : "過去7日間で集計"}
        </button>
        <button type="button" className="btn btn-primary" disabled={disabled || isBusy} onClick={onRun30d}>
          {runningMode === "30d" ? "集計中…" : "過去30日間で集計"}
        </button>
      </div>

      <div className="panel-divider" />

      <div className="panel-custom">
        <p className="panel-custom-label">指定した日付(0:00〜24:00)で集計</p>
        <div className="panel-custom-row">
          <label className="field">
            <span className="field-label">日付</span>
            <input
              type="date"
              value={customDate}
              onChange={(e) => onCustomDateChange(e.target.value)}
              disabled={disabled || isBusy}
            />
          </label>
          <label className="field">
            <span className="field-label">基準</span>
            <select
              value={customTimezone}
              onChange={(e) => onCustomTimezoneChange(e.target.value)}
              disabled={disabled || isBusy}
            >
              <option value="UTC">UTC</option>
              <option value="JST">JST(日本標準時)</option>
            </select>
          </label>
          <button type="button" className="btn btn-secondary" disabled={disabled || isBusy} onClick={onRunCustom}>
            {runningMode === "custom" ? "集計中…" : "この日で集計"}
          </button>
        </div>
        {customError && <p className="field-error">{customError}</p>}
      </div>

      {statusText && <p className="panel-status">{statusText}</p>}

      <p className="panel-note">
        主要取引所の追跡対象アドレス(入出金用)宛て・発の送金をアドレス単位で集計します。同じ取引所グループ内アドレス同士の移動(内部振替)は流入・流出から除外しています。
        取引所間の移動を二重計上しないよう、「全取引所合計」は追跡対象の全アドレスをまとめて1グループとみなして計算しています。
      </p>
    </section>
  );
}
