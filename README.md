# FamilyPool — 家庭財務管理視覺化 APP

FamilyPool 是一個讓家庭成員共享並按權限操作的家庭資金池視覺化應用程式。以「湖泊」與「池塘」的水循環概念，讓每位成員直觀地了解家庭財務健康度，以及個人的收支狀況。

## 🌟 核心特色

- **🌊 動態水位視覺化**：首創「湖泊與池塘」概念，用流動的水波動畫顯示資金多寡。
- **🔮 乾涸預測引擎**：自動根據未來定期支出與單次申請，計算出家庭資金池預估乾涸日期。
- **🛡️ 權限與隱私分離**：管理員統籌管理湖泊開支與成員審核；成員管理自己的收支池塘。
- **📱 跨平台與 PWA 支持**：適應各種螢幕尺寸、支援螢幕旋轉，並可安裝到 iOS/Android 桌面。
- **⚡ 即時同步**：運用 Supabase Realtime 技術，多設備無縫即時更新水位變化。

## 🛠️ 技術架構

- **前端**：Next.js 14 (App Router) + React + TypeScript
- **後端與資料庫**：Supabase (PostgreSQL, Auth, RLS, Realtime)
- **UI/UX**：純手工 Vanilla CSS + CSS Variables（不使用 Tailwind），確保高度客製化與效能
- **動畫**：Html5 Canvas API 水波動畫生成器

## 🚀 部署與啟動指南

### 第一步：設定 Supabase 資料庫

1. 到 [Supabase](https://supabase.com/) 建立一個新專案。
2. 進入 `SQL Editor`，開啟專案中 `supabase/migrations/001_initial_schema.sql` 檔案。
3. 把 SQL 語法貼上並完整執行，建立所需表格、RLS 權限政策及觸發器。

### 第二步：設定環境變數

在專案根目錄下，複製 `.env.local.example` 成為 `.env.local`：

```bash
cp .env.local.example .env.local
```

填入您在 Supabase 專案設定中取得的 API 金鑰：
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`（在 API Settings 的 Service role secret，用於管理員 API）

### 第三步：本地開發測試

1. 安裝依賴庫：
   ```bash
   npm install
   ```

2. 啟動開發伺服器：
   ```bash
   npm run dev
   ```

3. 在瀏覽器打開 `http://localhost:3000`

### 第四步：部署到 Vercel 或 Netlify

1. 將代碼推送到您的 GitHub 儲存庫。
2. 進入 Vercel / Netlify 匯入專案。
3. 在環境變數設定區塊，填入剛剛上述的 3 個 Supabase 環境變數字串。
4. 部署完成後，即可隨時安裝至手機版 PWA 應用。

## 👥 第一位管理員建立方式

系統未開放自由註冊，第一位管理員需要手動進入 Supabase 後台建立：
1. 到 Supabase -> `Authentication` -> `Add User` -> `Create new user`。
2. 輸入您的 Email 和密碼。
3. 到 Supabase -> `Table Editor`，開啟 `families` 資料表。
   - 點擊 Insert row，建立一個新家庭（例如 Name: `我的家庭`），記下產生的 `id` (family_id)。
4. 開啟 `profiles` 資料表，為剛才建立的 User 加入一筆資料：
   - `id`: 請填入 Auth 產生的 User ID
   - `family_id`: 剛才記下的 family_id
   - `display_name`: 您的稱呼（例如：爸爸）
   - `role`: 輸入 `admin`（這很重要，必須是 admin 才能擁有後台管理權限！）
5. 完成後回到 APP，使用您的 Email 與密碼登入，即可開始加入其他家庭成員。

---
*Developed by AI Agent Coding Assistant via Advanced Web Development Workflow.*
