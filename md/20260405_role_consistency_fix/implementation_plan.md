# 角色顯示與權限一致性修復計畫

目前系統在儀表板與設定頁面中，對角色（admin, lake_manager, member）的標籤顯示不一致且有誤。本計畫旨在統一全站標籤，並修正邏輯錯誤。

## 使用者確認事項

> [!IMPORTANT]
> 角色標籤將統一如下：
> - `admin` ➔ **🛡️ 系統管理者**
> - `lake_manager` ➔ **🌊 湖泊管理員**
> - `member` ➔ **👤 家庭成員**

## 擬議變更

### 1. 前端邏輯修正

#### [MODIFY] [dashboard/page.tsx](file:///Users/joseph/Downloads/Finance/family-pool/src/app/dashboard/page.tsx)
- 修正成員列表中的角色顯示邏輯，從簡單的二選一改為三種角色完整顯示。
- 更新角色名稱。

#### [MODIFY] [settings/page.tsx](file:///Users/joseph/Downloads/Finance/family-pool/src/app/settings/page.tsx)
- 微調角色標籤（例如將「管理者」改為「管理員」），確保與儀表板一致。

### 2. 安全備份

修改前將建立時間戳備份（如 `page_20260405_2210.tsx.bak`）。

---

## 開放性問題
- **標籤用詞確認**：您更倾向於使用「管理員」還是「管理者」？目前計畫暫定為「管理員」。

---

## 驗證計畫
- 登入 `Joseph` (admin)，確認儀表板顯示為「🛡️ 系統管理者」。
- 確認 `Hadassah` (lake_manager) 在儀表板顯示為「🌊 湖泊管理員」。
- 確認 `Johnny` (member) 顯示為「👤 家庭成員」。
