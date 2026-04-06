# FamilyPool 邏輯檢查 & 使用者體驗優化計劃

## 摘要

經過全面審查 6 個頁面和所有核心組件後，發現以下問題：
- **3 個邏輯缺陷**（資料不一致、功能殘缺）
- **4 個 UX 問題**（操作流程模糊、缺乏保護）
- **1 個新功能**（hover tooltip 輸入說明標籤）

---

## 🚨 邏輯問題（Critical）

### 問題 1：支出(pond_a 來源)永遠無法「完成」

**位置：** `expenses/page.tsx`

**現況：** 支出列表中，`source='pond_a'` 的支出只有「編輯」和「刪除」按鈕，**沒有「完成支出」按鈕**。  
由於觸發器只在 `status = 'completed'` 時同步 Pond B，所以 Pond B 餘額（支出池）永遠不會因為 pond_a 支出而減少。  
唯一例外是 `source='lake'` 的支出（由管理員批准），但完成後也沒有被標記 completed。

**修復方案：** 在 expenses 列表中加入「✓ 完成」按鈕，讓 `planned/approved` 狀態的支出可以被標記為 `completed`，觸發 `fn_recalc_pond_b`。

---

### 問題 2：收入頁面注入操作缺乏金額驗證

**位置：** `income/page.tsx`  

**現況：** `handleTransferToLake` 和 `handleTransferToPondBFromIncome` 函數只檢查金額是否為空，**沒有驗證是否超過 pond_a 餘額**。  
my-ponds 頁面有這個驗證（`amt > pondABalance`），但 income 頁面沒有，可能導致負餘額。

**修復方案：** 在兩個 transfer 函數中加入 `if (amt > pondABalance)` 驗證，並顯示錯誤。

---

### 問題 3：「調整餘額」繞過交易記錄系統

**位置：** `lake/page.tsx`，`handleSetBalance` 函數

**現況：** 管理員「調整餘額」直接 `UPDATE lake SET current_balance = xxx`，完全繞過交易系統。  
這會導致湖泊餘額和 `transactions` 表不一致，讓「計算值 vs 儲存值」驗證永遠失敗，也無法追蹤是誰做了調整。

**修復方案：** 改為插入一筆 `type='income'` 的調整交易，並更新 `fn_recalc_lake` 的公式加入此類型（或使用差值補正），保留完整稽核軌跡。  
*（此功能涉及 migration，需再確認是否要執行，暫列為討論項）*

---

## ⚠️ UX 問題（Important）

### 問題 4：刪除操作沒有確認提示

**位置：** `income/page.tsx`、`expenses/page.tsx`

**現況：** 刪除按鈕直接執行，沒有「確定要刪除？」二次確認。一旦誤按無法恢復。

**修復方案：** 加入刪除確認 modal（彈窗確認），並顯示項目名稱。

---

### 問題 5：轉帳金額輸入框沒有顯示上限提示

**位置：** `income/page.tsx` 的轉帳輸入框、`my-ponds` 的各 Modal

**現況：** 用戶不知道目前的可用金額上限，容易輸入錯誤。

**修復方案：** 在金額輸入框的 label 旁邊顯示「最多可用：NT$xxx」。

---

### 問題 6：支出池（Pond B）顯示邏輯令人困惑

**位置：** `dashboard/page.tsx` 和 `my-ponds/page.tsx`

**現況：** Pond B 是「欠款模型」（負值代表已支出），但 dashboard 顯示水位時用 `Math.abs(bRawBalance)` 計算，造成正/負值都顯示高水位，意義模糊。

**修復方案：** 在 Pond B 卡片上加一個小說明標籤（例如「負值代表已支出金額」），搭配顏色（紅=欠款中、綠=有預付餘額）說明語意。

---

### 問題 7：刪除確認 + 「調整餘額」沒有警告文字

**位置：** `lake/page.tsx`

**現況：** 調整餘額 modal 直接修改，缺乏警告說明（此操作會導致與交易記錄不一致）。

**修復方案：** 加入警告提示文字，建議使用者改用轉帳功能取代直接調整。

---

## ✨ 新功能：Hover Tooltip 輸入說明標籤

### 功能描述

所有表單輸入框、選擇框，當鼠標移入時（hover 或 focus），顯示一個小說明標籤。

- 顯示方式：浮動小卡片（bubble），含 ℹ️ 圖示
- 觸發方式：hover 或 focus 時出現，移開消失
- 位置：輸入框右上角或下方
- 設計風格：半透明深色背景，一致設計系統

---

## 修改範圍

### 新建組件

#### [NEW] `src/components/ui/Tooltip.tsx`
通用 tooltip 組件，props: `text`, `children`。

### 修改頁面

#### [MODIFY] `src/app/expenses/page.tsx`
- 加入「完成」按鈕（planned/approved 狀態）
- 加入刪除確認 modal
- 為每個 input field 加 tooltip

#### [MODIFY] `src/app/income/page.tsx`
- `handleTransferToLake` / `handleTransferToPondBFromIncome` 加入餘額上限驗證
- 在轉帳 input label 上顯示可用餘額
- 加入刪除確認 modal
- 為每個 input field 加 tooltip

#### [MODIFY] `src/app/lake/page.tsx`
- 在「調整餘額」modal 加入⚠️警告說明
- 建議用戶使用轉帳功能代替直接調整
- 為每個 input field 加 tooltip

#### [MODIFY] `src/app/my-ponds/page.tsx`
- Pond B 卡片加說明標籤
- 為每個 modal input 加 tooltip

#### [MODIFY] `src/app/requests/page.tsx`
- 審批 modal input 加 tooltip

---

## 驗證計劃

1. 新增一筆 pond_a 支出 → 確認「完成」按鈕出現 → 點擊後 Pond B 餘額正確減少
2. 在 income 頁面輸入超過 pond_a 餘額的金額 → 確認出現錯誤提示不送出
3. 點擊刪除 → 確認出現確認 modal → 取消不刪除、確認才刪除
4. Hover 每個輸入框 → 確認 tooltip 正確顯示說明文字

---

## 開放問題

> [!IMPORTANT]
> **問題 3（調整餘額繞過交易系統）** 修復涉及 `fn_recalc_lake` 和 migration，是否要一併修復？  
> 若是，湖泊餘額計算會改變，需要執行新的 migration 013。

> [!NOTE]  
> Tooltip 樣式風格確認：是否要跟目前 globals.css 深色主題一致？（建議是）
