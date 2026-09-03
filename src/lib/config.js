// config.js
// 元アプリ(js/config.js)から、オンチェーン分析に必要な定数だけを抽出したもの

export const MAINNET_NODEWATCH_URL =
  "https://nodewatch.symbol.tools/api/symbol/nodes/peer?only_ssl=true&limit=10&order=random";

export const TESTNET_NODEWATCH_URL =
  "https://nodewatch.symbol.tools/testnet/api/symbol/nodes/peer?only_ssl=true&limit=10&order=random";

export const MAINNET_FALLBACK_NODES = [
  "https://sym-main-01.opening-line.jp:3001",
  "https://sym-main-02.opening-line.jp:3001",
  "https://sym-main-03.opening-line.jp:3001",
  "https://symbol-mikun.net:3001",
];

export const TESTNET_FALLBACK_NODES = [
  "https://401-sai-dual.symboltest.net:3001",
  "https://201-sai-dual.symboltest.net:3001",
  "https://2.dusanjp.com:3001",
  "https://vmi831828.contaboserver.net:3001",
  "https://testnet1.symbol-mikun.net:3001",
  "https://testnet2.symbol-mikun.net:3001",
  "https://sym-test-01.opening-line.jp:3001",
  "https://sym-test-03.opening-line.jp:3001",
  "https://symbol-azure.0009.co:3001",
  "https://t.sakia.harvestasya.com:3001",
];

export const XYM_MOSAIC_ID = {
  MAINNET: "6BED913FA20223F8",
  TESTNET: "72C0212E67A08BCE",
};

export const NetworkType = {
  MAINNET: 104,
  TESTNET: 152,
};

export function getXymMosaicIdHex(networkType) {
  return networkType === NetworkType.TESTNET ? XYM_MOSAIC_ID.TESTNET : XYM_MOSAIC_ID.MAINNET;
}
