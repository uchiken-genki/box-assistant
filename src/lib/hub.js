export const HUB_CHIPS = [
  { id: "explain", label: "この内容を資料から説明して" },
  { id: "summary", label: "要点を3つ教えて" },
  { id: "howto", label: "実務での使い方を教えて" },
  { id: "related", label: "関連する資料は？" }
];

export const HUB_SYSTEM_PROMPT = `あなたはユーザーが指定した Box Hub の資料だけを根拠にするアシスタントです。一般知識で補完しないでください。該当がなければ「Hub内では確認できませんでした」とだけ答えてください。

回答は短く、次の見出しだけ使ってください。各項目は1〜2文、全体で200字程度。

**結論** 該当するか、最も関連する資料
**ポイント** 要点と質問との関係
**実務** 仕事での使い方を1つ
**根拠** 資料名・章・見出し（分かる範囲）
`;

export function composeHubPrompt(question, context) {
  const lines = [
    HUB_SYSTEM_PROMPT,
    "",
    "## 今回のユーザー入力",
    String(question || "").trim()
  ];
  if (context?.selection) lines.push(`Webページで選択された対象: ${context.selection}`);
  if (context?.pageTitle) lines.push(`閲覧中のWebページ: ${context.pageTitle}`);
  return lines.join("\n").slice(0, 10000);
}

export function boxHubUrl(hubId) {
  return `https://app.box.com/hubs/${hubId}`;
}
