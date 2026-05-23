-- ==========================================
-- Migration 014: 開啟管理員最高特權模式與同步數據修復
-- 執行時間：2026-05-23
-- 目標：移除無效的 is_lake_manager 判斷，套用 is_admin() 最高特權，並確保刪除或編輯紀錄時會同步重算 Lake
-- ==========================================

-- 1. 修正 RLS：income_items (賦予 admin 完整控制權限)
DROP POLICY IF EXISTS "income_write" ON income_items;
CREATE POLICY "income_write" ON income_items 
FOR ALL USING (
    user_id = auth.uid() OR 
    (family_id = get_my_family_id() AND is_admin())
);

-- 2. 修正 RLS：expense_items (賦予 admin 完整控制權限)
DROP POLICY IF EXISTS "expense_write" ON expense_items;
CREATE POLICY "expense_write" ON expense_items 
FOR ALL USING (
    user_id = auth.uid() OR 
    (family_id = get_my_family_id() AND is_admin())
);

-- 3. 修正 RLS：transactions (賦予 admin 完整控制權限)
DROP POLICY IF EXISTS "transactions_manager_all" ON transactions;
CREATE POLICY "transactions_manager_all" ON transactions 
FOR ALL USING (
    family_id = get_my_family_id() AND is_admin()
);

-- 4. 強化同步觸發器：fn_trigger_income_changed
-- 確保任何收入紀錄的變動，都會同步觸發 Pond A 與 Lake 重算
CREATE OR REPLACE FUNCTION fn_trigger_income_changed()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM fn_recalc_pond_a(COALESCE(NEW.user_id, OLD.user_id));
    PERFORM fn_recalc_lake(COALESCE(NEW.family_id, OLD.family_id));
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. 強化同步觸發器：fn_trigger_expense_changed
-- 確保任何支出紀錄的變動，都會同步觸發 Pond B 與 Lake 重算
CREATE OR REPLACE FUNCTION fn_trigger_expense_changed()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM fn_recalc_pond_b(COALESCE(NEW.user_id, OLD.user_id));
    PERFORM fn_recalc_lake(COALESCE(NEW.family_id, OLD.family_id));
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. 重新校正對齊一次現有數據，確保刪除過或有差異的數據同步
DO $$
DECLARE
    r_user   RECORD;
    r_family RECORD;
BEGIN
    FOR r_user IN SELECT id FROM profiles LOOP
        PERFORM fn_recalc_pond_a(r_user.id);
        PERFORM fn_recalc_pond_b(r_user.id);
    END LOOP;

    FOR r_family IN SELECT id FROM families LOOP
        PERFORM fn_recalc_lake(r_family.id);
    END LOOP;
END $$;
