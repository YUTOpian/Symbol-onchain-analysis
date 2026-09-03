// utils.js
// 元アプリ(js/utils.js)から、オンチェーン分析に必要な部分だけを抽出したもの

export function formatMosaicAmount(amount, divisibility = 0) {
  const value = Number(amount) / 10 ** divisibility;
  return value.toLocaleString("ja-JP", { maximumFractionDigits: divisibility });
}

function csvEscapeCell(cell) {
  const s = cell == null ? "" : String(cell);
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function downloadCsv(filename, rows) {
  const csvContent = rows.map((row) => row.map(csvEscapeCell).join(",")).join("\r\n");
  const bom = "\uFEFF";
  const blob = new Blob([bom + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
