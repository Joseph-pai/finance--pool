-- ==========================================
-- FamilyPool 診斷與手動對齊命令 (006_diagnostic.sql)
-- 目的：強制重新計算所有的池塘餘額，並列出最近五筆交易與 Pond A 金額供除錯用
-- ==========================================

-- 1. 強制讓資料庫重新重算所有的餘額（005 的對齊邏輯）
DO $$
DECLARE
    v_user   RECORD;
    v_family RECORD;
BEGIN
    FOR v_user IN SELECT id FROM profiles LOOP
        PERFORM fn_recalc_pond_a(v_user.id);
        PERFORM fn_recalc_pond_b(v_user.id);
    END LOOP;
    FOR v_family IN SELECT id FROM families LOOP
        PERFORM fn_recalc_lake(v_family.id);
    END LOOP;
END $$;

-- 2. 顯示最近的 5 筆交易（看看您的 80000 到底有沒有寫進來）
SELECT amount, type, source, destination, created_at 
FROM transactions 
ORDER BY created_at DESC 
LIMIT 5;

-- 3. 顯示你收入池的最新狀態
SELECT current_balance FROM pond_a;
