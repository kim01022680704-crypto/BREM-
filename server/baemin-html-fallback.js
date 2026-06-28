function extractJsonFromHtml(html) {
  const text = String(html || '');
  if (!text) return null;

  const patterns = [
    /window\.__(?:INITIAL|PRELOADED)_(?:STATE|DATA)__\s*=\s*(\{[\s\S]*?\});/i,
    /"data"\s*:\s*(\[[\s\S]*?\])\s*,\s*"totalPage"/i,
    /(\{"data"\s*:\s*\[[\s\S]*?\]\s*,\s*"totalPage"\s*:\s*\d+\})/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed && (Array.isArray(parsed) || Array.isArray(parsed.data))) return parsed;
    } catch {
      // try next pattern
    }
  }

  return null;
}

function extractTableRowsFromHtml(html) {
  const text = String(html || '');
  const rowMatches = text.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const rows = [];

  rowMatches.forEach(rowHtml => {
    const cells = (rowHtml.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || [])
      .map(cell => cell.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (cells.length >= 2) rows.push({ cells, rawHtml: rowHtml.slice(0, 500) });
  });

  return rows.length ? rows : null;
}

module.exports = {
  extractJsonFromHtml,
  extractTableRowsFromHtml
};
