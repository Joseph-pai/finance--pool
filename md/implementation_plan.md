# 家庭財務管理共享 APP — 設計說明與實施計劃

## 專案概述

**應用名稱**：FamilyPool（暫定）  
**核心隱喻**：湖泊（家庭資金池）＋ 每位成員的兩個小池塘（收入池塘A / 支出池塘B）  
**技術架構**：Next.js + Supabase + PWA  
**部署目標**：Vercel / Netlify + GitHub  
**貨幣**：台幣（TWD，符號 $）  
**湖泊初始金額**：$0（由管理員手動輸入實際當前餘額啟動）

---

## 系統角色定義

| 角色 | 英文代號 | 權限說明 |
|------|----------|----------|
| 湖泊管理員 | `admin` | 增刪改家庭成員帳號、管理湖泊所有支出項目、審批成員申請、查看並編輯湖泊數據 |
| 家庭成員 | `member` | 使用管理員提供的帳號密碼登入、管理自己的池塘A/B、申請湖泊調撥、**可查看所有人的詳細記錄（僅自己數據可編輯）** |

### ✅ 已確認的權限規則

| 操作 | 管理員 | 成員 |
|------|--------|------|
| 查看所有人數據（湖泊+所有池塘+交易記錄） | ✅ | ✅ |
| 編輯湖泊支出項目 | ✅ | ❌ |
| 審批調撥申請 | ✅ | ❌ |
| 增刪改家庭成員帳號 | ✅ | ❌ |
| 編輯自己的池塘A/B（收入/支出） | ✅ | ✅（僅自己） |
| 確認自己的收入到帳 | ✅ | ✅（僅自己） |
| 提交湖泊調撥申請 | ✅ | ✅ |

---

## 核心比喻對照表

| 視覺元素 | 財務含義 |
|----------|----------|
| 🌊 湖泊（Lake） | 家庭共同資金池（總餘額） |
| 💧 池塘A（Pond A） | 個人收入池（賺錢進來） |
| 💸 池塘B（Pond B） | 個人支出池（花錢出去） |
| 注水（Water In） | 收入 / 轉入湖泊 |
| 出水（Water Out） | 支出 / 從湖泊提款 |
| 乾涸預測 | 資金耗盡日期預測 |

---

## 功能模塊詳細說明

### 模塊一：儀表板（Dashboard）

- **湖泊水位動態視覺化**：動態波浪動畫顯示湖泊當前水量比例
- **每位成員的池塘A與池塘B**：小型水池動畫，顯示各自水量
- **乾涸預測線**：基於現有支出計劃，計算湖泊/個人池塘預計耗盡日期
- **家庭成員列表**：顯示每位成員的池塘概況（僅限管理員可見所有人）

---

### 模塊二：收入管理（Income / 池塘A 注水）

每位成員可以（**僅限操作自己的數據**）：
1. 新增預期收入項目（名稱、到帳日期、金額）
2. 到期後確認是否實際到帳：
   - **✅ 已到帳** → 池塘A水位升高（動畫顯示），餘額即時更新
   - **❌ 未到帳** → 可修改日期/金額或刪除
3. 設定注入湖泊的金額（池塘A水位降低，湖泊水位升高，系統記錄轉帳）
4. 所有成員可**查看**其他人的收入記錄（唯讀）

---

### 模塊三：支出管理（Expense / 池塘B 出水）

每位成員可以（**僅限操作自己的數據**）：
1. 新增預估支出項目（名稱、預估日期、金額）
2. 選擇資金來源：
   - **池塘A（個人收入）** → 池塘A餘額直接減少
   - **湖泊** → 自動轉為調撥申請，等待管理員審批
3. 查看自己池塘B的未來支出時間線
4. 所有成員可**查看**其他人的支出記錄（唯讀）

---

### 模塊四：湖泊調撥申請（Lake Request）

成員申請流程：
1. 成員在新增支出時選擇「使用湖泊資金」，系統自動生成申請
2. 或直接在「申請」頁面提交（項目名稱、金額、所需日期、說明）
3. 管理員收到通知，查看申請詳情
4. 管理員操作：
   - **✅ 批准**：設定從湖泊流入的實際金額與到帳日期
   - **❌ 拒絕**：附上拒絕原因（成員可修改後重新申請）

---

### 模塊五：湖泊管理（Lake Management — 僅管理員）

管理員可以：
1. **設定湖泊初始金額**（首次啟動時輸入當前實際餘額，初始為 $0）
2. **增刪改家庭必要支出項目**（房租、水電費、保險等）：
   - 名稱、預估日期、金額、是否循環（每月/每季/每年）
3. 查看湖泊總水量及未來出水時間線圖表
4. 審批成員的湖泊調撥申請（可調整金額與日期）
5. **增刪改家庭成員帳號**（Email + 密碼，指定角色）
6. 查看湖泊乾涸預測結果

---

### 模塊六：乾涸預測引擎（Drying Prediction Engine — 自動動態計算）

**計算邏輯**（即時自動重算，每次數據變動觸發）：
```
湖泊乾涸日期 = 
  當前湖泊餘額（$0 起始，隨轉入/支出滾動更新）
  - Σ 湖泊已計劃支出（按預估日期排序）
  - Σ 已批准的成員調撥申請（按核准日期排序）
  → 找到累積支出超過餘額的日期 = 乾涸日
```

**顯示內容**：
- 🌊 湖泊預計乾涸日（倒數天數 + 具體日期）
- 📊 未來30/60/90天的水位預測曲線圖
- 💧 每個成員池塘A的預計耗盡日期
- 🚨 動態警示顏色（綠色≥60天 / 黃色30-59天 / 橙色15-29天 / 紅色<15天）

---

### 模塊七：通知系統（App 內通知）

- 📅 收入到帳提醒（到期當天提醒確認）
- 📨 成員提交調撥申請 → 通知管理員
- ✅/❌ 申請審批結果 → 通知申請成員
- ⚠️ 湖泊水量低警示（低於設定閾值）
- 🚨 乾涸臨近警示（15天內預計乾涸）
- 👥 管理員新增/修改成員帳號通知

---

## 技術架構

### 前端技術棧

| 技術 | 用途 |
|------|------|
| **Next.js 14** (App Router) | 主框架，SSR + CSR 混合渲染 |
| **Vanilla CSS + CSS Variables** | 自定義設計系統，不使用Tailwind |
| **Canvas API / CSS Animation** | 水波動畫、水位動態效果 |
| **PWA (Manifest + Service Worker)** | iOS PWA支持、離線緩存 |
| **Responsive Design** | 跨設備、屏幕旋轉自適應 |

### 後端技術棧

| 技術 | 用途 |
|------|------|
| **Supabase** | 數據庫（PostgreSQL）、認證（Auth）、實時訂閱（Realtime） |
| **Supabase Row Level Security (RLS)** | 數據權限控制（成員只能看自己的數據） |
| **Supabase Auth** | 用戶登入（Email/Password，可擴展Google）|
| **Supabase Realtime** | 水位變化即時同步到所有家庭成員設備 |

### 部署架構

```
GitHub Repository
    ↓
Vercel / Netlify (自動 CI/CD)
    ↓
Next.js App
    ↓
Supabase (Database + Auth)
```

---

## 數據庫設計（Supabase PostgreSQL）

### 表格結構

#### `families` — 家庭
```sql
id, name, created_at
```

#### `profiles` — 用戶資料
```sql
id (= auth.users.id), family_id, display_name, role (admin/member), avatar_url, created_at
```

#### `lake` — 湖泊（每個家庭一個）
```sql
id, family_id, 
current_balance (numeric, default 0),  -- 初始為0，管理員可設定起始金額
dry_date (date, nullable),              -- 自動計算的乾涸預估日期
created_at, updated_at
```

#### `pond_a` — 個人收入池（池塘A）
```sql
id, user_id, family_id, 
current_balance (numeric, default 0),
dry_date (date, nullable),              -- 此成員池塘A預計耗盡日
created_at, updated_at
```

#### `pond_b` — 個人支出池（池塘B）
```sql
id, user_id, family_id,
current_balance (numeric, default 0),
created_at, updated_at
```

#### `income_items` — 收入項目
```sql
id, user_id, family_id, 
name, expected_date, amount (numeric),
status (pending/confirmed/failed),
actual_amount (numeric, nullable),
confirmed_at (timestamptz, nullable),
created_at, updated_at
```

#### `expense_items` — 支出項目
```sql
id, user_id, family_id,
name, expected_date, amount (numeric),
source (pond_a/lake),
status (planned/approved/rejected/completed),
created_at, updated_at
-- 當 source=lake 時自動建立 lake_requests 記錄
```

#### `lake_expenses` — 湖泊必要支出（管理員增刪改）
```sql
id, family_id,
name, expected_date, amount (numeric),
is_recurring (boolean),
recurrence_rule (monthly/quarterly/yearly, nullable),
status (active/paused/completed),
created_at, updated_at
```

#### `lake_requests` — 湖泊調撥申請
```sql
id, requester_id, family_id,
item_name, requested_amount (numeric), requested_date,
reason,
status (pending/approved/rejected),
approved_amount (numeric, nullable),
approved_date (date, nullable),
admin_note,
reviewed_at (timestamptz, nullable),
created_at, updated_at
```

#### `transactions` — 實際流水記錄（台幣，TWD）
```sql
id, family_id, user_id,
type (income/expense/transfer_to_lake/lake_expense/lake_to_member),
amount (numeric),             -- 台幣金額
source (lake/pond_a/pond_b),
destination (lake/pond_a/pond_b),
reference_id (uuid, nullable), -- 關聯的 income/expense/request id
note,
transaction_date (date),
created_at
```

#### `notifications` — 通知記錄
```sql
id, user_id, family_id,
type, title, message,
is_read (boolean, default false),
reference_id (uuid, nullable),
created_at
```

---

## UI/UX 設計系統

### 視覺風格

- **主題**：深海藍 + 水波綠，呈現水生態系統質感
- **動畫**：SVG/Canvas 水波動畫，水位變化時有流動動效
- **水位顯示**：漸進式填充動畫，顏色隨水位變化（藍→黃→橙→紅）
- **字體**：Google Fonts — Noto Sans TC（繁體中文）+ Inter（數字/金額）
- **金額格式**：`$1,234,567`（台幣，千分位，無小數）

### 色彩系統

| 元素 | 顏色 |
|------|------|
| 湖泊（健康） | `#1a6e9c` 深藍 |
| 湖泊（警告） | `#d4943a` 琥珀 |
| 湖泊（危險） | `#c0392b` 深紅 |
| 池塘A（收入） | `#27ae60` 翠綠 |
| 池塘B（支出） | `#8e44ad` 深紫 |
| 背景 | `#0d1b2a` 深夜藍 |
| 卡片 | `rgba(255,255,255,0.05)` 玻璃態 |

### 頁面結構

```
/ (登入頁)
/dashboard (家庭儀表板 — 湖泊 + 所有成員池塘視覺化)
/my-ponds (我的池塘 — 池塘A收入管理 + 池塘B支出管理)
/income (新增/管理收入項目)
/expenses (新增/管理支出項目)
/requests (調撥申請列表)
/lake (湖泊管理 — 僅管理員)
/notifications (通知中心)
/settings (設定)
```

---

## PWA 支持（iOS）

- `manifest.json`：圖標、顯示模式（standalone）、方向（any）
- Service Worker：離線緩存策略
- Meta tags：`apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`
- 屏幕旋轉：CSS `orientation` media query + viewport meta

---

## 動畫設計說明

### 水位動畫
- 使用 SVG `<path>` 搭配 CSS animation 實現波浪效果
- 水位高度用 CSS `clip-path` 或 `height` 動態變化
- 水位改變時：0.5秒流動填充/排水動畫

### 資金流動動畫
- 池塘→湖泊轉帳：顯示水流從小池塘流向湖泊的路徑動畫
- 湖泊→池塘：相反方向流動
- 使用 SVG `<animateMotion>` 沿路徑移動水滴粒子

### 乾涸警示動畫
- 水位低於20%：水面出現漣漪加速效果
- 水位低於10%：水面閃爍紅色警示邊框
- 乾涸：水面消失動畫 + 警示彈窗

---

## GitHub 倉庫結構

```
family-pool/
├── public/
│   ├── manifest.json
│   ├── sw.js (Service Worker)
│   └── icons/
├── src/
│   ├── app/ (Next.js App Router)
│   │   ├── layout.tsx
│   │   ├── page.tsx (登入)
│   │   ├── dashboard/
│   │   ├── my-ponds/
│   │   ├── income/
│   │   ├── expenses/
│   │   ├── requests/
│   │   ├── lake/
│   │   ├── notifications/
│   │   └── settings/
│   ├── components/
│   │   ├── ui/ (通用UI組件)
│   │   ├── lake/ (湖泊相關組件)
│   │   ├── pond/ (池塘相關組件)
│   │   └── animations/ (水波動畫組件)
│   ├── lib/
│   │   ├── supabase.ts (Supabase客戶端)
│   │   ├── predictions.ts (乾涸預測邏輯)
│   │   └── utils.ts
│   ├── hooks/ (自定義React hooks)
│   ├── types/ (TypeScript類型定義)
│   └── styles/
│       └── globals.css
├── supabase/
│   └── migrations/ (數據庫migration文件)
├── .env.local.example
├── next.config.js
├── package.json
└── README.md
```

---

## 開發階段計劃

### Phase 1 — 基礎架構（Week 1）
- [ ] 初始化 Next.js 專案
- [ ] 配置 Supabase（創建表格、RLS策略）
- [ ] 設計系統（CSS Variables、字體、色彩）
- [ ] 認證流程（登入/登出/家庭邀請）
- [ ] PWA 配置

### Phase 2 — 核心功能（Week 2）
- [ ] 儀表板水位動畫視覺化
- [ ] 收入管理（池塘A）
- [ ] 支出管理（池塘B）
- [ ] 池塘↔湖泊轉帳功能

### Phase 3 — 管理功能（Week 3）
- [ ] 湖泊管理面板（管理員）
- [ ] 調撥申請系統
- [ ] 乾涸預測引擎
- [ ] 即時同步（Supabase Realtime）

### Phase 4 — 完善與部署（Week 4）
- [ ] 通知系統
- [ ] 響應式設計調整
- [ ] 動畫優化
- [ ] GitHub 推送
- [ ] Vercel/Netlify 部署設定

---

## ✅ 已確認設計決策（2026-04-01）

| 項目 | 決定 |
|------|------|
| 成員帳號管理 | 由管理員在後台增刪改，使用 Supabase Admin API 建立用戶，成員直接用帳密登入 |
| 貨幣 | 統一台幣（TWD），符號 `$`，千分位格式 |
| 湖泊初始金額 | 初始為 $0，管理員啟動後手動輸入當前實際餘額 |
| 數據可見性 | **所有成員可看到所有人的詳細交易記錄**（公開透明） |
| 數據編輯權限 | 成員只能編輯自己的數據；管理員只能編輯湖泊支出與審批申請 |
| 乾涸計算 | **自動動態計算**，每次數據變動（支出/收入/申請審批）後立即重算 |

---

## 驗證計劃

- 在本地環境完整測試所有角色的操作流程
- 確認 Supabase RLS 權限正確隔離
- 測試 iOS Safari PWA 安裝與離線功能
- 測試屏幕旋轉與多種設備尺寸顯示
- 部署到 Vercel 後進行線上測試
