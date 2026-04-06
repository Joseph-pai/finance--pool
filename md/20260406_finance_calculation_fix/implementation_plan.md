# FamilyPool 全面邏輯錯誤修正計劃

全面分析所有頁面代碼與資料庫觸發器後，發現多個計算邏輯錯誤。以下是完整的問題診斷與修正方案。

---

## 一、問題診斷總覽

### 🔴 問題 1：總覽頁面收入池 (Pond A) 數值不正確

**根本原因：**
`dashboard/page.tsx` 中，對成員卡片的**收入池**顯示的是 `pond_a.current_balance`（資料庫已儲存的實際餘額），**沒有加上待入帳的預計收入**。

**正確邏輯應是：**
- 收入池顯示 = `pond_a.current_balance`（已到帳並扣除注入湖泊後的實際餘額）
- **額外顯示**：「預計到帳」加總（`income_items` 中 `status='pending'` 的項目）

**關於「注入湖泊後數值應減少」的問題：**
- 收入管理頁 (`income/page.tsx`) 的 `handleTransferToLake()` 是正確的：直接從 `pond_a` 的 `current_balance` 減去注入金額，再增加到 `lake`。
- **然而**，`pond_a.current_balance` 的值**本身**是由資料庫觸發器 `fn_sync_pond_a_from_income()` (migration 004) 計算的，計算公式是：
  ```
  SUM(已確認收入) - SUM(transactions where source='pond_a')
  ```
  當手動更新 `pond_a.current_balance` 後，觸發器只在 `income_items` 有變動時才重新計算，導致**直接更新的值被下次 income_items 觸發器覆蓋**。

---

### 🔴 問題 2：總覽頁面支出池 (Pond B) 沒有顯示預計支出金額

**根本原因：**
`dashboard/page.tsx` 的 Pond B 顯示直接用 `pond_b.current_balance`（資料庫值，僅包含 `status='completed'` 的支出），**完全沒有將 `status='planned'` 或 `status='approved'` 的預計支出納入計算**。

**正確邏輯應是：**
- Pond B 當前值 = 資料庫的 `pond_b.current_balance`（已完成支出）
- **調節後水量（前端計算）** = `pond_b.current_balance` - 計畫中支出總額

---

### 🔴 問題 3：收入管理注入湖泊後剩餘金額計算錯誤

**根本原因：**
`income/page.tsx` 的 `handleTransferToLake()` 函數同時：
1. 直接更新 `pond_a.current_balance` (減去金額)
2. 直接更新 `lake.current_balance` (加上金額)

**但是**，`transactions` 表的觸發器 `fn_sync_lake_from_transactions()` (migration 003) 會在插入 `transfer_to_lake` 交易記錄後，**再次自動更新** `lake.current_balance`，導致**湖泊餘額被加了兩次**。

而 `pond_a` 的觸發器 `fn_sync_pond_a_from_income()` (migration 004) 在下次 `income_items` 有任何變動時，會**用公式重新覆蓋** `pond_a.current_balance`，可能使直接設定的值被還原。

**雙重更新衝突**導致數據不一致。

---

### 🔴 問題 4：我的池塘頁面三個卡片數值計算錯誤

**Card 1 — 收入池 (池塘A)：**
- 顯示 `pondA.current_balance`（資料庫實際值），這本身是對的
- **但問題是**：資料庫的 `pond_a.current_balance` 可能因為觸發器衝突（問題1、3）而不正確

**Card 2 — 支出池 (池塘B)：**
- 顯示 `pondB.current_balance`（資料庫實際值）
- **問題**：資料庫 `pond_b.current_balance` 設計為負數（`LEAST(0,...)`），但 `handleTransferToPondB()` 使用 `Math.min(0, pondB.current_balance + amt)` 邏輯有誤：把「注入」做成「增加負數」計算，應為「減少欠款」

**Card 3 — 調節後水量：**
- 計算公式：`adjustedBalance = totalIncome - totalExpense`
- `totalIncome` = 所有收入（已確認用actual_amount，待確認用amount）
- `totalExpense` = 所有支出金額
- **問題**：「調節後水量」應基於**收入池實際餘額**（`pond_a.current_balance`）再調整未來預計收入/支出，而不是重新計算所有歷史收入減所有支出（這樣會與 `pond_a.current_balance` 產生矛盾）

---

### 🟡 其他代碼邏輯問題

**問題5：觸發器衝突 — migration 002 vs 004**
- Migration 002 建立了 `trg_income_sync` (使用 `fn_sync_income_to_pond_a`)
- Migration 004 建立了 `trg_income_to_pond_a` (使用 `fn_sync_pond_a_from_income`)
- 兩個觸發器**同時作用在 `income_items` 上**，兩個函數**邏輯不同**：
  - 002 用差值增量方式更新
  - 004 用全量重算方式更新
- 這會導致每次 `income_items` 變動時觸發兩次更新，產生不一致結果

**問題6：expenses/page.tsx 的 pond_a 更新缺失**
- 新增支出（來源 pond_a）時，建立了交易記錄，但沒有觸發器自動從 `pond_a` 扣除金額
- Migration 002 的 `fn_sync_expense_to_poids` 會在 `expense_items` 狀態變成 `completed` 時更新 `pond_a`，但這發生在同一個交易內，可能有時序問題

**問題7：Lake 校正公式錯誤 (migration 003)**
- 校正湖泊的 SQL 公式：`transfer_to_lake` + `lake_to_member` - `approved` 
- `lake_to_member` 應該是**負的**（從湖泊撥出），不應該加總

**問題8：dashboard/page.tsx 的 totalExpense 計算**
- `const sum = pExpenses.reduce((acc, curr) => acc + curr.amount, 0);`
- 沒有篩選狀態，把 `rejected` 的支出也算進去了

---

## 二、修正方案設計

### 核心原則（重新明確定義）

| 池塘 | 資料庫值 | 前端顯示 |
|------|---------|---------|
| **Pond A（收入池）** | 已確認到帳收入 - 已轉出金額（注入湖泊 + 注入支出池） | 資料庫值 + 標示待入帳合計 |
| **Pond B（支出池）** | 已完成支出的負值（-1 * completed expenses） + 已注入金額 | 資料庫值 + 標示計畫中支出 |
| **Lake（湖泊）** | 所有注入 - 所有撥出 | 直接顯示資料庫值 |
| **調節後水量** | 前端計算 | Pond A + 待入帳收入 - 計畫中支出 |

---

## 三、需要修改的文件

### A. 資料庫層 (新 SQL Migration — 005_fix_all_logic.sql)

**目標：清理觸發器衝突，統一計算邏輯**

1. **刪除舊觸發器** (migration 002 和 004 的重複觸發器)
2. **重建統一的 Pond A 同步觸發器**：
   - 觸發條件：`income_items` INSERT/UPDATE/DELETE
   - 計算：`SUM(actual_amount where confirmed) - SUM(transactions.amount where source='pond_a')`
3. **重建統一的 Pond B 同步觸發器**：
   - 觸發條件：`expense_items` INSERT/UPDATE/DELETE + `transactions` INSERT/UPDATE/DELETE
   - 計算：`-SUM(expense_items.amount where completed) + SUM(transactions.amount where destination='pond_b')`
4. **修正 Lake 同步觸發器**：
   - 只由 `transactions` 觸發（transfer_to_lake 加、lake_to_member 減、lake_expense 減）
   - 移除 income/page.tsx 手動更新 lake 的做法
5. **移除 `income/page.tsx` 的直接更新邏輯**（只需插入 transaction 記錄即可）
6. **修正 Lake 校正 SQL**

### B. 前端修改

#### [MODIFY] dashboard/page.tsx
- 每次開啟自動重新載入（已有 `loadDashboard`，保持）
- 加入 `income_items` 查詢（取得各成員的 pending income）
- **Pond A 卡片**：顯示 `pond_a.current_balance`，另外標示「預計到帳 +XXX」
- **Pond B 卡片**：顯示 `pond_b.current_balance`（已完成），另外標示「計畫中 -XXX」
- **totalExpense 計算**：排除 `rejected` 狀態

#### [MODIFY] income/page.tsx (handleTransferToLake)
- **移除** 直接更新 `pond_a` 和 `lake` 的代碼
- **只插入** `transactions` 記錄（`transfer_to_lake` 類型）
- 交由資料庫觸發器自動同步兩個池塘

#### [MODIFY] my-ponds/page.tsx
- **Card 1 (Pond A)**：顯示 `pondA.current_balance`，加上 pending income 合計說明
- **Card 2 (Pond B)**：顯示 `pond_b.current_balance`（負值顯示），加上 planned expense 合計說明
- **Card 3 (調節後水量)**：計算 `pondA.current_balance + pendingIncomeTotal - plannedExpenseTotal`
- **修正 handleTransferToPondB**：邏輯改為 Pond B 應加上注入金額（減少欠款）

#### [NEW] supabase/migrations/005_fix_all_logic.sql
- 完整的觸發器重建腳本（詳見下方）

---

## 四、詳細修改內容

### 005_fix_all_logic.sql 關鍵邏輯

```sql
-- Pond A = 已確認收入合計 - 已轉出合計
-- (全量計算，每次 income_items 變動時重算)
fn_sync_pond_a() ON income_items → UPDATE pond_a

-- Pond B = -(已完成支出合計) + 已注入合計
-- (全量計算，每次 expense_items 或 transactions 變動時重算)
fn_sync_pond_b() ON expense_items/transactions → UPDATE pond_b

-- Lake = 不變，由 transactions 觸發器維護
-- 移除直接更新 lake 的前端代碼
```

### income/page.tsx 的修正

```typescript
// 舊代碼（有問題）
const newPondA = Math.max(0, (pondA?.current_balance ?? 0) - amt);
await supabase.from('pond_a').update({ current_balance: newPondA }).eq('user_id', targetUserId);
const newLake = (lake?.current_balance ?? 0) + amt;
await supabase.from('lake').update({ current_balance: newLake }).eq('id', lake?.id);

// 新代碼（只需插入交易，觸發器自動處理）
await supabase.from('transactions').insert({
  type: 'transfer_to_lake', amount: amt, source: 'pond_a', destination: 'lake', ...
});
// 觸發器 fn_sync_lake_from_transactions() 自動更新 lake
// 觸發器 fn_sync_pond_a_from_income() 在下次 income_items 觸發時更新 pond_a
// ⚠️ 問題：pond_a 無法即時更新，需要新增 transactions 觸發器同步 pond_a
```

> [!IMPORTANT]
> 需要新增 transactions 觸發器：當 `transfer_to_lake` 或 `transfer_to_pond_b` 交易插入時，自動扣減 `pond_a.current_balance`

### my-ponds/page.tsx 的 Pond B 說明

```
Pond B 資料庫 current_balance 設計為 ≤ 0：
- 初始值：0（無欠款）
- 每完成一筆支出：減去金額（變更負）
- 每次從 Pond A 注入：加回金額（往 0 靠近）

所以 handleTransferToPondB 的 Math.min(0, current_balance + amt) 是正確的
但 WaterWave 顯示需要用 Math.abs(bBalance) 計算水位
```

---

## 五、修改檔案清單

| 文件 | 類型 | 修改內容 |
|------|------|---------|
| `supabase/migrations/005_fix_all_logic.sql` | NEW | 清理觸發器衝突，重建統一邏輯 |
| `src/app/dashboard/page.tsx` | MODIFY | 加入 income_items 查詢，修正卡片顯示 |
| `src/app/income/page.tsx` | MODIFY | 移除直接更新 pond_a/lake，只寫 transaction |
| `src/app/my-ponds/page.tsx` | MODIFY | 修正三個卡片的計算和顯示邏輯 |
| `src/app/expenses/page.tsx` | MODIFY | 統一支出邏輯（source=pond_a 時不直接改 pond_a） |

---

## 六、驗證計劃

1. 在 Supabase SQL Editor 執行 `005_fix_all_logic.sql`
2. 確認觸發器列表中舊觸發器已刪除、新觸發器已建立
3. 在收入管理新增一筆「已到帳」收入 → 確認 pond_a 自動更新
4. 在收入管理注入湖泊 → 確認 pond_a 減少、lake 增加（各只變動一次）
5. 在支出管理新增支出 → 確認 pond_b 正確反映
6. 在總覽頁面確認各成員卡片的收入池和支出池數值正確

---

## 七、開放問題

> [!IMPORTANT]
> **Pond A 的觸發器設計選擇**：
> 目前計畫採用「全量重算」方式（每次 income_items 或 transactions 有涉及 pond_a 的記錄變動時，重新計算整個 pond_a 餘額）。
> 另一種方式是「增量更新」（只計算差值）。
> 全量重算更可靠但每次稍慢；增量更新較快但容易有累積誤差。
> **建議使用全量重算**，確保數據一致性。

> [!WARNING]
> **Migration 002 的約束**：`pond_b_no_positive CHECK (current_balance <= 0)` 和 `pond_a_no_negative CHECK (current_balance >= 0)` 這兩個約束會限制資料庫值，需確保新觸發器計算結果符合約束。

