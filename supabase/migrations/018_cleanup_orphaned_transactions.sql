-- ==========================================
-- Migration 018: 清理孤兒交易記錄 & 強制重算
-- ==========================================

-- 1. 查看當前殘留的交易記錄
-- 以下為診斷用，可在 Supabase SQL Editor 執行
-- SELECT * FROM transactions;
-- SELECT * FROM income_items;
-- SELECT * FROM expense_items;
-- SELECT * FROM lake_requests;
-- SELECT * FROM notifications;

-- ==========================================
-- 2. 清理所有殘留的交易記錄
-- ==========================================

-- 清除所有 transaction 記錄（因為用戶已刪除所有收入/支出/申請）
-- 只有當用戶確定所有資料都已刪除時才執行
DELETE FROM transactions WHERE family_id IN (SELECT id FROM families);

-- 清除所有 notification 記錄
DELETE FROM notifications WHERE family_id IN (SELECT id FROM families);

-- 清除所有 lake_requests 記錄
DELETE FROM lake_requests WHERE family_id IN (SELECT id FROM families);

-- 清除所有 lake_expenses 記錄
DELETE FROM lake_expenses WHERE family_id IN (SELECT id FROM families);

-- 清除所有 expense_items 記錄
DELETE FROM expense_items WHERE family_id IN (SELECT id FROM families);

-- 清除所有 income_items 記錄
DELETE FROM income_items WHERE family_id IN (SELECT id FROM families);

-- ==========================================
-- 3. 強制重算 Lake / Pond A / Pond B 餘額
-- ==========================================
DO $$
DECLARE
    r RECORD;
    f RECORD;
BEGIN
    -- 重算所有 Pond A
    FOR r IN SELECT id FROM profiles LOOP
        PERFORM fn_recalc_pond_a(r.id);
    END LOOP;

    -- 重算所有 Pond B
    FOR r IN SELECT id FROM profiles LOOP
        PERFORM fn_recalc_pond_b(r.id);
    END LOOP;

    -- 重算所有 Lake
    FOR f IN SELECT id FROM families LOOP
        PERFORM fn_recalc_lake(f.id);
    END LOOP;
END $$;

-- ==========================================
-- 4. 確認重算後的結果
-- ==========================================
-- 可在 SQL Editor 執行以下查詢驗證
--
-- SELECT 'Lake' AS "項目", current_balance AS "餘額" FROM lake
-- UNION ALL
-- SELECT 'Pond A', pa.current_balance FROM pond_a pa JOIN profiles p ON p.id = pa.user_id WHERE p.display_name IS NOT NULL;
