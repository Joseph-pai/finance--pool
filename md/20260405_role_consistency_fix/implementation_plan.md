# 池塘邏輯修正與功能增強計畫 (A/B 池同步與注水)

本計畫旨在解決 Joseph 帳號中出現的負數餘額問題，並落實使用者要求的「收入池 (A)」與「支出池 (B)」核心邏輯，包含新增「收入池注水至支出池」的功能。

## 使用者確認事項

> [!IMPORTANT]
> **核心邏輯規範：**
> 1. **收入池 (Pond A)**：僅包含「已到帳」收入減去「轉出金額」。**餘額必須恆大於等於 0**。
> 2. **支出池 (Pond B)**：包含「已完成」支出（負值）加上「來自 A 池的注水」。**餘額必須恆小於等於 0**。
> 3. **連動機制**：
>    - 刪除已到帳收入：扣回 A 池餘額（若餘額不足則設為 0）。
>    - 刪除已完成支出：補回 B 池餘額（使其趨近於 0）。
>    - A 池注水至 B 池：A 池減少，B 池數值增加（趨近於 0）。

## 擬議變更

### 1. 資料庫層面 (Database & Migration)

#### [NEW] [fix_pond_constraints.sql](file:///Users/joseph/Downloads/Finance/family-pool/supabase/migrations/002_fix_pond_logic.sql)
- **增加約束**：為 `pond_a` 增加 `CHECK (current_balance >= 0)`，為 `pond_b` 增加 `CHECK (current_balance <= 0)`。
- **重寫/修正觸發器**：
    - 確保 `DELETE ON income_items` 時，使用 `GREATEST(0, current_balance - amount)`。
    - 確保 `DELETE ON expense_items` 時，使用 `LEAST(0, current_balance + amount)`。
    - 修正現有 -870 錯誤：將低於 0 的 A 池餘額歸零。

### 2. 資料類型 (Types)

#### [MODIFY] [index.ts](file:///Users/joseph/Downloads/Finance/family-pool/src/types/index.ts)
- `TransactionType` 增加 `transfer_to_pond_b`。

### 3. 個人池塘頁面 (My Ponds)

#### [MODIFY] [my-ponds/page.tsx](file:///Users/joseph/Downloads/Finance/family-pool/src/app/my-ponds/page.tsx)
- **支出池顯示修正**：不再使用 `sum(items)` 計算，改為讀取 `pond_b.current_balance`。
- **新增功能**：在 A 池卡片增加「注入支出池」按鈕與彈窗，允許輸入金額並執行轉帳。

### 4. 收入與支出管理 (Income & Expenses)

#### [MODIFY] [income/page.tsx](file:///Users/joseph/Downloads/Finance/family-pool/src/app/income/page.tsx)
- 確保所有餘額操作均符合「不為負數」原則。

---

## 驗證計畫

### 自動化檢查
- 嘗試刪除大於餘額的收入記錄，確認 SQL 觸發器能正確擋住或歸零而非產生負數。

### 手動驗證
1. **注入測試**：從 A 池轉 1000 至 B 池，確認 A 池減少 1000，B 池（負數）增加 1000。
2. **零點測試**：確認 B 池注滿後不可變為正數，A 池扣完後不可變為負數。

### 背景分析 (-870 原因)
根據交易記錄，系統自動扣除了 $117,500。由於之前可能沒有進行 `Math.max(0, ...)` 的檢查，且 A 池餘額在扣除前不足 $117,500，導致產生了 $-870 的異象。本修復將強制校正此數值。
