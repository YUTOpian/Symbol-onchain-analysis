import { useCallback, useEffect, useRef, useState } from "react";
import { selectNode } from "./lib/nodeSelector";
import { connectToNode } from "./lib/sdk";
import { NetworkType } from "./lib/config";
import { runOnchainAnalysis, exportOnchainAnalysisCsv } from "./lib/onchainAnalysis";
import { runExchangeFlowAnalysis, exportExchangeFlowCsv } from "./lib/exchangeFlow";
import ConnectionBar from "./components/ConnectionBar.jsx";
import ControlPanel from "./components/ControlPanel.jsx";
import SummaryGrid from "./components/SummaryGrid.jsx";
import WhaleList from "./components/WhaleList.jsx";
import ExchangeFlowControlPanel from "./components/ExchangeFlowControlPanel.jsx";
import ExchangeFlowList from "./components/ExchangeFlowList.jsx";
import ExchangeFlowDetail from "./components/ExchangeFlowDetail.jsx";

function todayDateStr() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function App() {
  const [isTestnet, setIsTestnet] = useState(false);
  const [connection, setConnection] = useState({ status: "connecting", node: null, error: null });
  const ctxRef = useRef(null);

  const [runningMode, setRunningMode] = useState(null); // "rolling24h" | "yesterday" | "custom" | null
  const [statusText, setStatusText] = useState("");
  const [customDate, setCustomDate] = useState(todayDateStr());
  const [customTimezone, setCustomTimezone] = useState("UTC");
  const [customError, setCustomError] = useState("");

  const [result, setResult] = useState(null);
  const [resultError, setResultError] = useState(null);
  const [whaleListOpen, setWhaleListOpen] = useState(false);

  // 取引所フロー分析
  const [exRunningMode, setExRunningMode] = useState(null); // "24h" | "7d" | "30d" | "custom" | null
  const [exStatusText, setExStatusText] = useState("");
  const [exCustomDate, setExCustomDate] = useState(todayDateStr());
  const [exCustomTimezone, setExCustomTimezone] = useState("UTC");
  const [exCustomError, setExCustomError] = useState("");
  const [exResult, setExResult] = useState(null);
  const [exResultError, setExResultError] = useState(null);
  const [exSelectedId, setExSelectedId] = useState(null);

  const connect = useCallback(async (testnet) => {
    setConnection({ status: "connecting", node: null, error: null });
    setResult(null);
    setResultError(null);
    setExResult(null);
    setExResultError(null);
    setExSelectedId(null);
    ctxRef.current = null;
    try {
      const { nodeOrigin, usedFallback } = await selectNode(testnet);
      const ctx = await connectToNode(nodeOrigin);
      ctxRef.current = ctx;
      setConnection({ status: "connected", node: nodeOrigin, usedFallback, error: null });
    } catch (e) {
      console.error("接続に失敗しました:", e);
      setConnection({ status: "error", node: null, error: e.message || String(e) });
    }
  }, []);

  useEffect(() => {
    connect(isTestnet);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTestnet]);

  const handleRun = useCallback(
    async (mode) => {
      const ctx = ctxRef.current;
      if (!ctx) return;

      if (mode === "custom") setCustomError("");
      setRunningMode(mode);
      setResultError(null);
      setStatusText("");

      try {
        const customRange = mode === "custom" ? { dateStr: customDate, timezone: customTimezone } : undefined;
        const summary = await runOnchainAnalysis(ctx, mode, customRange, (text) => setStatusText(text || ""));
        setResult(summary);
        setWhaleListOpen(false);
      } catch (e) {
        console.error("オンチェーン分析の取得に失敗しました:", e);
        if (e.isValidationError) {
          setCustomError(e.message);
        } else {
          setResultError(e.message || "オンチェーン分析の取得に失敗しました。");
        }
      } finally {
        setRunningMode(null);
        setStatusText("");
      }
    },
    [customDate, customTimezone]
  );

  const handleExportCsv = useCallback(() => {
    if (!result || !ctxRef.current) return;
    exportOnchainAnalysisCsv(result, ctxRef.current);
  }, [result]);

  const handleRunExchangeFlow = useCallback(
    async (mode) => {
      const ctx = ctxRef.current;
      if (!ctx) return;

      if (mode === "custom") setExCustomError("");
      setExRunningMode(mode);
      setExResultError(null);
      setExStatusText("");
      setExSelectedId(null);

      try {
        const customRange = mode === "custom" ? { dateStr: exCustomDate, timezone: exCustomTimezone } : undefined;
        const summary = await runExchangeFlowAnalysis(ctx, mode, customRange, (text) => setExStatusText(text || ""));
        setExResult(summary);
      } catch (e) {
        console.error("取引所フロー分析の取得に失敗しました:", e);
        if (e.isValidationError) {
          setExCustomError(e.message);
        } else {
          setExResultError(e.message || "取引所フロー分析の取得に失敗しました。");
        }
      } finally {
        setExRunningMode(null);
        setExStatusText("");
      }
    },
    [exCustomDate, exCustomTimezone]
  );

  const handleExportExchangeFlowCsv = useCallback(() => {
    if (!exResult) return;
    exportExchangeFlowCsv(exResult);
  }, [exResult]);

  return (
    <div className="page">
      <header className="hero">
        <p className="hero-eyebrow">Symbol blockchain / read-only</p>
        <h1 className="hero-title">オンチェーン分析</h1>
        <p className="hero-lede">
          Symbol(XYM)ネットワークに直接問い合わせて、指定期間の送金量・アクティブアドレス・大口移動・主要取引所の入出金を集計します。
          バックエンドは持たず、集計のたびにノードへ問い合わせる構成です。
        </p>
      </header>

      <ConnectionBar
        isTestnet={isTestnet}
        onToggleNetwork={setIsTestnet}
        connection={connection}
        onRetry={() => connect(isTestnet)}
      />

      <ControlPanel
        disabled={connection.status !== "connected"}
        runningMode={runningMode}
        statusText={statusText}
        onRunRolling={() => handleRun("rolling24h")}
        onRunYesterday={() => handleRun("yesterday")}
        onRunCustom={() => handleRun("custom")}
        customDate={customDate}
        onCustomDateChange={setCustomDate}
        customTimezone={customTimezone}
        onCustomTimezoneChange={setCustomTimezone}
        customError={customError}
      />

      {resultError && <div className="alert alert-error">{resultError}</div>}

      {result && (
        <section className="results">
          <div className="results-heading">
            <div>
              <p className="results-range-title">{result.rangeTitle}</p>
              <p className="results-range-label">{result.rangeLabel}</p>
            </div>
            <button type="button" className="btn btn-ghost" onClick={handleExportCsv}>
              CSVでダウンロード
            </button>
          </div>

          {result.genesisNote && <p className="genesis-note">※ {result.genesisNote}</p>}

          <SummaryGrid result={result} onOpenWhales={() => setWhaleListOpen((v) => !v)} whalesOpen={whaleListOpen} />

          {whaleListOpen && (
            <WhaleList
              whales={result.whales}
              rateMap={result.rateMap}
              ctx={ctxRef.current}
              networkType={ctxRef.current?.networkType ?? NetworkType.MAINNET}
              epochAdjustment={ctxRef.current?.epochAdjustment}
            />
          )}
        </section>
      )}

      <section className="section-block">
        <header className="section-heading">
          <h2 className="section-title">取引所フロー分析</h2>
          <p className="section-lede">
            主要取引所の追跡対象アドレスへのXYM流入(デポジット)・流出(出金)を、アドレス単位で集計します。
          </p>
        </header>

        <ExchangeFlowControlPanel
          disabled={connection.status !== "connected"}
          runningMode={exRunningMode}
          statusText={exStatusText}
          onRun24h={() => handleRunExchangeFlow("24h")}
          onRun7d={() => handleRunExchangeFlow("7d")}
          onRun30d={() => handleRunExchangeFlow("30d")}
          onRunCustom={() => handleRunExchangeFlow("custom")}
          customDate={exCustomDate}
          onCustomDateChange={setExCustomDate}
          customTimezone={exCustomTimezone}
          onCustomTimezoneChange={setExCustomTimezone}
          customError={exCustomError}
        />

        {exResultError && <div className="alert alert-error">{exResultError}</div>}

        {exResult && (
          <section className="results">
            <div className="results-heading">
              <div>
                <p className="results-range-title">取引所フロー分析</p>
                <p className="results-range-label">{exResult.rangeLabel}</p>
              </div>
              <button type="button" className="btn btn-ghost" onClick={handleExportExchangeFlowCsv}>
                CSVでダウンロード
              </button>
            </div>

            <div className="exchange-flow-body">
              <ExchangeFlowList
                results={exResult.results}
                combinedResult={exResult.combinedResult}
                selectedExchangeId={exSelectedId}
                onSelectExchange={(id) => setExSelectedId(id)}
              />

              {exSelectedId && (
                <ExchangeFlowDetail
                  exId={exSelectedId}
                  rangeLabel={exResult.rangeLabel}
                  result={exResult.resultsById[exSelectedId]}
                  networkType={ctxRef.current?.networkType ?? NetworkType.MAINNET}
                  epochAdjustment={ctxRef.current?.epochAdjustment}
                  onClose={() => setExSelectedId(null)}
                />
              )}
            </div>
          </section>
        )}
      </section>

      <footer className="footer-note">
        <p>
          Symbol-tomato-wallet の「データ」画面にあるオンチェーン分析・取引所フロー分析機能のみを抽出したスタンドアロン版です。
          ノードへの問い合わせだけで完結し、秘密鍵やアカウント情報は一切扱いません。
        </p>
      </footer>
    </div>
  );
}
