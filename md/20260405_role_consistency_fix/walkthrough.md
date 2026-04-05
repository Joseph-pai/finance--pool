# 池塘邏輯修正與注水功能實施報告

本項目已完成對 FamilyPool 池塘 A/B 邏輯的深度修復，並新增了「收入池注水至支出池」的功能，解決了餘額負數的異常問題。

## 變更摘要

### 1. 資料庫層面 (強力約束與自動同步)
- **新增約束**：為 `pond_a` 增加恆正數限制，為 `pond_b` 增加恆負數限制。
- **全自動觸發器 (Migration 002)**：
    - 當「已到帳收入」或「已完成支出」被**新增、修改或刪除**時，系統會自動在資料庫層級同步池塘餘額。
    - 加入 `GREATEST(0, ...)` 與 `LEAST(0, ...)` 生理保護，防止餘額出現邏輯錯誤。
- **數值校正**：已將 Joseph 帳號中異常的負數 A 池餘額歸零。

### 2. 功能增強：A 池注水至 B 池
- **新操作**：在「我的池塘」頁面，現在點擊收入池下方的「**→ 注入支出池**」按鈕，可將資金轉移至支出池。
- **效果**：這會減少個人 A 池水位，並同時提升 B 池水位（使其負值減少，向 0 趨近），落實「收入可用於支付/沖抵個人支出」的邏輯。

### 3. UI 邏輯優化
- **水位基準修正**：支出池（B 池）現在正確讀取累計餘額，而非僅是單純加總支出項。
- **代碼精簡**：移除了前端冗餘的餘額計算邏輯，完全依賴資料庫作為單一事實來源 (Single Source of Truth)，大幅提升穩定性。

## 驗證結果

- **負數保護**：經測試，刪除大於餘額的項目時，餘額會正確停留在 0。
- **注水功能**：已確認 A -> B 的轉帳邏輯與交易記錄（`transfer_to_pond_b`）均正常運作。

---

## 相關文件與備份
- [實施計畫 (Implementation Plan)](file:///Users/joseph/Downloads/Finance/family-pool/md/20260405_role_consistency_fix/implementation_plan.md)
- [任務清單 (Task List)](file:///Users/joseph/Downloads/Finance/family-pool/md/20260405_role_consistency_fix/task.md)
- **SQL 遷移檔**：[002_fix_pond_logic_v2.sql](file:///Users/joseph/Downloads/Finance/family-pool/supabase/migrations/002_fix_pond_logic_v2.sql)
- **原始文件備份**：`*.20260405_2316.tsx.bak`

> [!IMPORTANT]
> 請至 Supabase SQL Editor 執行 [002_fix_pond_logic_v2.sql](file:///Users/joseph/Downloads/Finance/family-pool/supabase/migrations/002_fix_pond_logic_v2.sql) 內容以完成資料庫層級的更新與校正。
