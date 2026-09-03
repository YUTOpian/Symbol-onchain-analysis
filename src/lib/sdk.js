// sdk.js
// Symbol SDK v3 の読み込みとオンライン初期化(元アプリ js/sdk.js の initSdk 相当)。
// SDK本体はCDN(unpkg)からブラウザ上で動的import する。

const SDK_VERSION = "3.3.0";

let sdkCore = null;
let sdkSymbol = null;
let sdkLoadPromise = null;

async function ensureSdkModuleLoaded() {
  if (sdkCore && sdkSymbol) return { sdkCore, sdkSymbol };
  if (!sdkLoadPromise) {
    sdkLoadPromise = import(
      /* @vite-ignore */ `https://unpkg.com/symbol-sdk@${SDK_VERSION}/dist/bundle.web.js`
    ).then((sdk) => {
      sdkCore = sdk.core;
      sdkSymbol = sdk.symbol;
      return { sdkCore, sdkSymbol };
    });
  }
  return sdkLoadPromise;
}

/**
 * 指定したノードに問い合わせて、オンチェーン分析に必要な接続コンテキストを作る。
 * @param {string} node - ノードのオリジン(例: https://xxx:3001)
 * @returns {Promise<{node:string, sdkCore:any, sdkSymbol:any, facade:any,
 *   epochAdjustment:number, generationHash:string, networkType:number}>}
 */
export async function connectToNode(node) {
  if (!node) throw new Error("NODE が未設定です");

  const { sdkCore, sdkSymbol } = await ensureSdkModuleLoaded();

  const props = await fetch(new URL("/network/properties", node)).then((r) => r.json());

  const epochAdjustment = Number(String(props.network.epochAdjustment).replace("s", ""));
  const generationHash = props.network.generationHashSeed;
  const identifier = props.network.identifier;
  const facade = new sdkSymbol.SymbolFacade(identifier);
  const networkType = identifier === "testnet" ? 152 : 104;

  return { node, sdkCore, sdkSymbol, facade, epochAdjustment, generationHash, networkType };
}
