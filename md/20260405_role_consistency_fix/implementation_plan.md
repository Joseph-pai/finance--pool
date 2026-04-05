# 全站操作權限與名稱一致性審計及修復計畫

經過對全站代碼的初步審計，發現了幾處權限範圍不當以及名稱尚未完全統一的地方。本計畫將修正這些問題，確保「系統管理員」與「湖泊管理員」的權限與名稱符合設計預期。

## 使用者確認事項

> [!IMPORTANT]
> **主要修復內容：**
> 1. **開放湖泊管理權限**：目前「湖泊管理」頁面錯誤地限制僅「系統管理員」可進入。我們將開放給「湖泊管理員」進入。
> 2. **優化通知邏輯**：當成員申請湖泊資金時，目前僅通知「系統管理員」。我們將同時通知「湖泊管理員」。
> 3. **純化名稱**：將設定頁面彈窗中殘留的「管理者」改為「管理員」。

## 擬議變更

### 1. 權限範圍修正

#### [MODIFY] [lake/page.tsx](file:///Users/joseph/Downloads/Finance/family-pool/src/app/lake/page.tsx)
- 修正 `useEffect` 中的權限檢查：將 `profile.role !== 'admin'` 改為使用 `!canManageLake`。
- 確保「湖泊管理員」可以查看並操作湖泊餘額與循環支出。

#### [MODIFY] [expenses/page.tsx](file:///Users/joseph/Downloads/Finance/family-pool/src/app/expenses/page.tsx)
- 修正通知發送邏輯：在建立湖泊申請時，查詢所有具有 `admin` 或 `lake_manager` 角色的用戶並發送通知。

### 2. 名稱標籤統一

#### [MODIFY] [settings/page.tsx](file:///Users/joseph/Downloads/Finance/family-pool/src/app/settings/page.tsx)
- 修正新增/編輯成員彈窗中的選項標籤：
    - 「🌊 湖泊管理者」➔ 「**🌊 湖泊管理員**」
    - 「🛡️ 系統管理者」➔ 「**🛡️ 系統管理員**」

---

## 驗證計畫

### 手動驗證
1. **角色切換測試**：
    - 以 `Hadassah` (湖泊管理員) 身份登入，確認可進入「湖泊管理」頁面。
    - 以 `Johnny` (一般成員) 身份登入，確認提交湖泊支出申請後，系統會同時通知 `Joseph` 與 `Hadassah`。
2. **UI 檢查**：
    - 檢查「設定」中的下拉選單，確認沒有「管理者」字樣出現。

### 安全保障
- 修改前將為涉及的文件建立 `_20260405_2224.tsx.bak` 備份。
