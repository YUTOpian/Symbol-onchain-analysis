# Symbol オンチェーン分析(スタンドアロン版)

[Symbol-tomato-wallet](https://github.com/) の「データ」画面にある**オンチェーン分析・取引所フロー分析機能**を抽出した、単独で動くReact(Vite)アプリです。
秘密鍵やアカウント管理などウォレット機能は一切含みません。ブラウザから直接Symbolのノードに問い合わせて完結する、読み取り専用のダッシュボードです。

## できること

### オンチェーン分析

- **過去24時間 / 昨日(UTC) / 指定した1日** の3パターンで期間を選んで集計
- 期間中の以下の指標を表示
  - 平均ブロック生成間隔
  - XYM総移動量・XYM送金件数
  - モザイク送信件数(XYM含む)
  - アクティブアドレス数(全トランザクション種別・送信元ベース)
  - 新規アドレス作成数(近似値)
  - 大口XYM移動件数(10,000 XYM以上)とその一覧(円/ドル換算つき)
- 集計結果のCSVダウンロード

### 取引所フロー分析

- 主要取引所(Bitbank・Zaif・bitFlyer・MEXC・Gate.io)の追跡対象アドレスへのXYM流入(デポジット)・流出(出金)を、アドレス単位のREST APIフィルタで集計
- **過去24時間 / 過去7日間 / 過去30日間 / 指定した1日** の4パターンで期間を選んで集計
- 取引所ごとの流入・流出・純増減に加え、取引所間の二重計上を避けた「全取引所合計」を表示
- 各取引所(および全取引所合計)をクリックすると、個別の流入・流出取引履歴を表示
- 集計結果(サマリーのみ、個別取引履歴は含まない)のCSVダウンロード

### 共通

- Mainnet / Testnet の切り替え(NodeWatchで優良ノードを自動選択、失敗時はfallbackノードを使用)

## セットアップ

```bash
npm install
npm run dev
```

ブラウザで表示されたURL(通常 http://localhost:5173 )を開いてください。

本番ビルドする場合:

```bash
npm run build
npm run preview
```

### ダブルクリックで開ける単一HTMLファイルとして使う

サーバーを立てず、ビルドしたファイルをダブルクリックしてそのままブラウザで開きたい場合は、
JS・CSSをすべて1枚のHTMLに埋め込んだビルドを作れます。

```bash
npm run build:single
```

`dist-single/index.html` が生成されるので、これをダブルクリックすればそのまま起動します(`file://` で開いても動作します)。
Symbol SDKの読み込みやノードへの問い合わせなどはすべてインターネット越しのhttps通信のため、ローカルファイルとして開いても問題なく動きます。
通常の `npm run build`(`dist/`)は複数ファイル出力になるため、サーバーに配置して使う場合はこちらを使ってください。

## 仕組み

- Symbol SDK v3(`symbol-sdk`)は `unpkg.com` からブラウザ上で動的に読み込みます(npmパッケージとしてはインストールしません)。
- ノード一覧の取得(NodeWatch)、価格情報(bitbank / CoinGecko)、Symbolのノードそのものへの通信はすべてブラウザから直接行います。そのため、実行にはインターネット接続が必要です。
- 集計対象のブロック範囲は、指定期間の開始・終了時刻をもとに二分探索でブロック高を特定し、`/transactions/confirmed` をページングしながら走査して算出しています。
- ブロック件数が多い期間(対象アドレスが多い場合や、集計ページ数が上限に達した場合)は時間がかかったり、「以上」として打ち切り表示になることがあります。

## ディレクトリ構成

```
src/
  lib/
    config.js          ノードURL・XYM Mosaic ID などの定数
    sdk.js              Symbol SDKの動的読み込みとノード接続
    nodeSelector.js     NodeWatchによるノード自動選択
    priceRates.js       XYM/JPY・XYM/USDの過去レート取得
    onchainAnalysis.js  オンチェーン分析の集計ロジック本体
    exchangeFlow.js     取引所フロー分析の集計ロジック本体
    utils.js            金額フォーマット・CSV書き出し
  components/
    ConnectionBar.jsx          ネットワーク切替・接続状態
    ControlPanel.jsx           オンチェーン分析: 集計期間の選択・実行ボタン
    SummaryGrid.jsx             オンチェーン分析: 集計結果のサマリーカード
    WhaleList.jsx                オンチェーン分析: 大口XYM移動の一覧
    ExchangeFlowControlPanel.jsx 取引所フロー分析: 集計期間の選択・実行ボタン
    ExchangeFlowList.jsx         取引所フロー分析: 取引所別・全体の流入出サマリー
    ExchangeFlowDetail.jsx       取引所フロー分析: 個別取引履歴の詳細表示
  App.jsx
  main.jsx
  styles.css
```

元のロジック(`js/onchainAnalysis.js` / `js/exchangeFlow.js` ほか)から、DOM直接操作の部分を取り除き、Reactの状態として値を返す形に移植しています。集計条件・閾値・注記文言は元の実装と同一です。
