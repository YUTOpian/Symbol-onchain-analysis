import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// npm run build:single 用の設定。
// 通常の `vite build`(vite.config.js)はサーバーに置く前提の
// 複数ファイル出力(dist/assets/*.js 等)を作る。
// こちらはJS・CSSをすべて1枚のHTMLに埋め込み、ダブルクリックで
// そのまま(file:// で)開けるようにするための設定。
//
// Symbol SDK(unpkg.com)・NodeWatch・取引所レートAPI・Symbolノードへの
// 通信はいずれも実行時のhttps通信のため、file://で開いても問題なく動く。
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "dist-single",
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
  },
});
