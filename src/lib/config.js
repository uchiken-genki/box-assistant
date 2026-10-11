export const BOX_AUTHORIZE_URL = "https://account.box.com/api/oauth2/authorize";
export const BOX_TOKEN_URL = "https://api.box.com/oauth2/token";
export const BOX_REVOKE_URL = "https://api.box.com/oauth2/revoke";
export const BOX_API_BASE = "https://api.box.com/2.0";

export const SEARCH_FIELDS = [
  "id",
  "type",
  "name",
  "extension",
  "modified_at",
  "size",
  "description",
  "path_collection",
  "parent"
].join(",");

export const FOLDER_ITEM_FIELDS = [
  "id",
  "type",
  "name",
  "extension",
  "modified_at",
  "size",
  "description",
  "path_collection",
  "parent"
].join(",");

export const ASK_PROMPTS = [
  { id: "find-docs", label: "この会社に関する資料を探して" },
  { id: "past-proposal", label: "過去の提案資料を探して" },
  { id: "sales-docs", label: "関連する営業資料を探して" },
  { id: "internal-explain", label: "社内資料ではどう説明している？" },
  { id: "faq", label: "関連するFAQを探して" },
  { id: "summarize", label: "この資料を3行で要約して" }
];

export const FOLDER_PROMPTS = [
  { id: "whats-inside", label: "このフォルダには何が入っている？" },
  { id: "summarize-folder", label: "このフォルダの資料を要約して" },
  { id: "top-3", label: "重要な資料を3つ選んで" },
  { id: "old-files", label: "古い資料を教えて" },
  { id: "missing-metadata", label: "Metadataが未設定のファイルを教えて" },
  { id: "by-customer", label: "顧客別に整理して" },
  { id: "related-folder", label: "このフォルダに関連する資料を探して" }
];

export const METADATA_LABELS = {
  customer: "顧客名",
  customer_name: "顧客名",
  customerName: "顧客名",
  account: "顧客名",
  account_name: "顧客名",
  client: "顧客名",
  industry: "業界",
  sector: "業界",
  stage: "案件ステージ",
  deal_stage: "案件ステージ",
  opportunity_stage: "案件ステージ",
  owner: "担当者",
  owner_name: "担当者",
  assignee: "担当者",
  sales_rep: "担当者",
  product: "製品",
  products: "製品",
  theme: "提案テーマ",
  proposal_theme: "提案テーマ",
  topic: "提案テーマ",
  updated: "更新日",
  updated_at: "更新日",
  last_updated: "更新日"
};
