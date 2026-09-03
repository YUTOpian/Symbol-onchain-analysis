// nodeSelector.js
// NodeWatch を使って優良ノードを1つ選ぶ(元アプリ js/nodeSelector.js を移植)

import {
  MAINNET_NODEWATCH_URL,
  TESTNET_NODEWATCH_URL,
  MAINNET_FALLBACK_NODES,
  TESTNET_FALLBACK_NODES,
} from "./config";

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * @param {boolean} isTestnet
 * @param {(text: string) => void} [onStatus] 進捗メッセージのコールバック
 * @returns {Promise<{nodeOrigin: string, usedFallback: boolean}>}
 */
export async function selectNode(isTestnet, onStatus) {
  const NODEWATCH_URL = isTestnet ? TESTNET_NODEWATCH_URL : MAINNET_NODEWATCH_URL;
  const FALLBACKS = isTestnet ? TESTNET_FALLBACK_NODES : MAINNET_FALLBACK_NODES;

  onStatus?.("NodeWatch からノード選択中…");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1500);

  try {
    const res = await fetch(NODEWATCH_URL, { signal: controller.signal });
    clearTimeout(timeoutId);

    const nodes = await res.json();
    if (!Array.isArray(nodes) || nodes.length === 0) {
      throw new Error("NodeWatch empty");
    }

    // 高さでソートして一番進んでいるノードを採用
    nodes.sort((a, b) => b.height - a.height);
    const best = nodes[0];

    const u = new URL(best.endpoint);
    u.protocol = "https:";
    const nodeOrigin = u.origin;

    return { nodeOrigin, usedFallback: false };
  } catch (e) {
    clearTimeout(timeoutId);
    console.warn("NodeWatch 失敗 → fallback ノードを使用", e);
    const fallback = pickRandom(FALLBACKS);
    return { nodeOrigin: fallback, usedFallback: true };
  }
}
