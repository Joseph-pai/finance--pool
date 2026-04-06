# 支援「支出池」退款 / 轉出資金 實作計畫

此計畫將在「我的池塘 (My Ponds)」頁面中，為正數（有預付款）的「支出池 (Pond B)」新增一個「**退回/轉出**」的功能按鈕，讓成員能將預放在支出池的錢退回給 **湖泊** 或是自己的 **收入池 (Pond A)**。

## 變更項目

### 1. 資料庫更新 (Migration 011)
由於資金的流動方向從原本的 `A -> B`、`Lake -> A/B` 額外擴展了 `B -> A` 與 `B -> Lake`，我們需要更新資料庫重新結算的邏輯與過濾條件。

#### `011_pond_b_refunds.sql`
- **放寬 Transaction Type 限制**：在 `transactions` 表的 `transactions_type_check` 中，加入一種新的交易類型：`'transfer_from_pond_b'`（從 B 池轉出）。
- **更新 `fn_recalc_pond_b`**：當 B 池有款項轉出（不管是退給湖泊，還是退給 A 池），算式中必須**自動扣除**這筆轉出交易。
- **更新 `fn_recalc_pond_a`**：原本 A 池的餘額只有在填寫「收入 (Income)」時才會增加；我們需要加上一段邏輯，讓 A 池自動**加上目標為 `pond_a` 且來自 B 池退回的那些交易**，這樣才能保持餘額守恆。

### 2. 前端介面更新

#### `src/app/my-ponds/page.tsx`
- **前端邏輯與 UI 調整**：
  - 在「支出池 (池塘 B)」的卡片區塊，當 `pondBBalance > 0` 時，新增一顆 **「退回/轉出資金」** 的按鈕。
  - 新增一個專屬的 Modal (彈出視窗)：
    - 操作者可選擇目標：「退回湖泊」或「退回收入池」。
    - 可選擇金額（最大值鎖定為支出池的當前正餘額）。
  - **API 發送邏輯**：
    - 若退回湖泊：發送一筆 `transaction` (type=`'transfer_to_lake'`, source=`'pond_b'`, dest=`'lake'`)。
    - 若退回收入池：發送一筆 `transaction` (type=`'transfer_from_pond_b'`, source=`'pond_b'`, dest=`'pond_a'`)。
  - 前端將自動捕捉任何發生在這些過程中的權限或邏輯錯誤並顯示。

### 3. TypeScript 定義更新
- `src/types/index.ts` 中的 `TransactionType` 加入 `'transfer_from_pond_b'` 以便編譯器防錯。

---
## User Review Required

> [!IMPORTANT]
> 關於退回資金到 **收入池 (Pond A)**：
> 這次的作法會讓退回的這筆錢，純粹反映在「A池總餘額變多」以及「歷史交易紀錄」上。它**不會**在「收入管理」頁面中顯示為一筆 "已確認收入"。
> 這通常符合直覺（因為它是內部左邊口袋換到右邊口袋，而非實質的外部薪資收入）。請確認這樣的動線是否符合您的使用需求？若沒問題，我們就可以馬上開始撰寫代碼！
