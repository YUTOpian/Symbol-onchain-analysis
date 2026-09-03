export default function ControlPanel({
  disabled,
  runningMode,
  statusText,
  onRunRolling,
  onRunYesterday,
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
        <button
          type="button"
          className="btn btn-primary"
          disabled={disabled || isBusy}
          onClick={onRunRolling}
        >
          {runningMode === "rolling24h" ? "集計中…" : "過去24時間で集計"}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={disabled || isBusy}
          onClick={onRunYesterday}
        >
          {runningMode === "yesterday" ? "集計中…" : "昨日(UTC)で集計"}
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
        アクティブアドレス数はSymbolの全トランザクション種別(埋め込み含む)を対象に、送信元となったアドレスの延べ数を集計します。
        新規アドレス作成数は、この期間より前に送信・受信いずれの履歴もないアドレスが、期間中に初めて何らかのトランザクションの関係先になった数と、
        初めてトランザクションを送った数の合算です(REST APIで遡れる範囲での近似値。両方に該当するアドレスは2件としてカウントされます)。
        ブロックを遡って集計するため、対象アドレスが多い期間ほど時間がかかることがあります。
      </p>
    </section>
  );
}
