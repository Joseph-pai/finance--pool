# 支出池與編輯權限調整實作計畫

## 目標說明
1. **支出池數值顯示為負值並調整水位機制**：將所有支出（無論是否完成）的金額加總，顯示在 Dashboard 與 My Ponds 的支出池（池塘B）中間，並且以負數顯示。負數的絕對值越大，水位越高。
2. **所有狀態皆可編輯/刪除**：在「收入管理」與「支出管理」中，只要是個人的項目，無論狀態是「計畫中」、「已批准」還是「已完成」，均開放編輯與刪除權限。

## 用戶審閱需求
> [!IMPORTANT]
> - 請確認「總支出加總」是否意味著過去所有的支出記錄都會一直累加？如果一直累加，水位未來可能會非常高。
> - 修改已完成（Completed）或已確認（Confirmed）項目時，是否需要同步調整已經扣除或增加的真實池子餘額？本次計畫**僅開放 UI 的編輯/刪除權限以及更新單筆項目的屬性**，並未包含重新結算池子餘額的複雜邏輯。如果您需要重新結算，請告訴我。
> - 在修改代碼前，我會先備份 `src/app/dashboard/page.tsx`、`src/app/my-ponds/page.tsx`、`src/app/expenses/page.tsx` 以及 `src/app/income/page.tsx`，文件名稱會加上當前時間。

## 擬議變更

---

### Dashboard (儀表板)

#### [MODIFY] `src/app/dashboard/page.tsx`
- **變更點**：
  1. 在讀取資料時，額外獲取所有成員的 `expense_items` 資料。
  2. 計算每位成員的 `totalExpense`（加總該成員所有的 `expense_items` 金額）。
  3. `bLevel` 變更為依據 `totalExpense` 計算（數值越大，水位越高）。
  4. 顯示數值變更為 `-{formatTWD(totalExpense)}`，呈現在畫面中。

---

### 我的池塘 (My Ponds)

#### [MODIFY] `src/app/my-ponds/page.tsx`
- **變更點**：
  1. 請求 `expense_items` 時取得該用戶的所有支出資料並做加總，放入 `totalExpense`。
  2. 計算 `bLevel` 用 `totalExpense` 取代原本的 `pondB.current_balance`。
  3. 顯示數值變更為 `-{formatTWD(totalExpense)}`。

---

### 支出與收入管理 (Expenses & Income)

#### [MODIFY] `src/app/expenses/page.tsx`
- **變更點**：
  1. 移除介面上渲染 Edit/Delete 按鈕的 `item.status !== 'completed'` 條件。
  2. 保證使用者可以隨時編輯或刪除屬於自己的記錄。

#### [MODIFY] `src/app/income/page.tsx`
- **變更點**：
  1. 移除 Edit/Delete 按鈕僅在 `item.status === 'pending'` 或 `failed` 時顯示的條件。
  2. 讓「編輯」與「刪除」按鈕固定呈現在動作區域供使用者操作。

---

## 驗證計畫
### 人工驗證
1. 前往「Dashboard」，確認支出池的水位與負數金額顯示是否正確反映了所有支出的加總。
2. 前往「我的池塘」，確認池塘B (支出池) 的負數總和與水位變更。
3. 前往「收入管理」與「支出管理」，確認已完成/已確認的項目中，是否都正確出現了「編輯」與「刪除」按鈕並可正常點擊操作。
