export default function ConnectionBar({ isTestnet, onToggleNetwork, connection, onRetry }) {
  return (
    <section className="connection-bar">
      <div className="network-switch" role="group" aria-label="ネットワーク切替">
        <button
          type="button"
          className={`network-switch-btn ${!isTestnet ? "is-active" : ""}`}
          onClick={() => onToggleNetwork(false)}
        >
          Mainnet
        </button>
        <button
          type="button"
          className={`network-switch-btn ${isTestnet ? "is-active" : ""}`}
          onClick={() => onToggleNetwork(true)}
        >
          Testnet
        </button>
      </div>

      <div className="connection-status">
        {connection.status === "connecting" && (
          <span className="status-dot status-dot-pending" />
        )}
        {connection.status === "connected" && <span className="status-dot status-dot-ok" />}
        {connection.status === "error" && <span className="status-dot status-dot-error" />}

        {connection.status === "connecting" && <span>ノードに接続しています…</span>}
        {connection.status === "connected" && (
          <span>
            接続中: <code className="node-url">{connection.node}</code>
            {connection.usedFallback && <span className="node-fallback-note">(fallback)</span>}
          </span>
        )}
        {connection.status === "error" && (
          <span>
            接続に失敗しました: {connection.error}{" "}
            <button type="button" className="btn-link" onClick={onRetry}>
              再試行
            </button>
          </span>
        )}
      </div>
    </section>
  );
}
