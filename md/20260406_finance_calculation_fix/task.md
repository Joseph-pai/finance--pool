# FamilyPool 邏輯錯誤修正任務

## 階段 1：備份
- [x] 備份 dashboard/page.tsx
- [x] 備份 income/page.tsx
- [x] 備份 my-ponds/page.tsx
- [x] 備份 expenses/page.tsx

## 階段 2：資料庫層
- [x] 建立 005_fix_all_logic.sql（清除舊觸發器、重建統一邏輯）

## 階段 3：前端修改
- [x] 修改 dashboard/page.tsx（收入池加待入帳、支出池加計畫支出、修正 totalExpense 篩選）
- [x] 修改 income/page.tsx（移除直接更新 pond_a/lake，只寫 transaction）
- [x] 修改 my-ponds/page.tsx（修正三個卡片計算）
- [x] 修改 expenses/page.tsx（修正 totalPlanned 包含 approved，新增完成支出合計）

## 階段 4：驗證
- [x] TypeScript 編譯無錯誤（tsc --noEmit 通過）
- [x] 在 Supabase SQL Editor 執行 005_fix_all_logic.sql
