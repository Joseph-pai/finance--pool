-- ==========================================
-- Migration 015: 修正 Pond A 負值問題與收入刪除同步
-- 執行時間：2026-05-24
-- ==========================================

-- 1. 重新定義 Pond A 重算函數，確保所有一路徑皆使用 GREATEST(0, ...)
CREATE OR REPLACE FUNCTION fn_recalc_pond_a(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE pond_a
    SET current_balance = GREATEST(0,
        -- 已確認到帳且目的地為個人收入池的收入
        COALESCE((
            SELECT SUM(COALESCE(actual_amount, amount))
            FROM income_items
            WHERE user_id = p_user_id
              AND status = 'confirmed'
              AND destination = 'pond_a'
        ), 0)
        -- 加上來自其他來源的補入
        + COALESCE((
            SELECT SUM(amount)
            FROM transactions
            WHERE user_id = p_user_id
              AND destination = 'pond_a'
              AND type = 'transfer_from_pond_b'
        ), 0)
        -- 減去從 pond_a 轉出的所有交易
        - COALESCE((
            SELECT SUM(amount)
            FROM transactions
            WHERE user_id = p_user_id
              AND source = 'pond_a'
              AND type IN ('transfer_to_lake', 'transfer_to_pond_b')
        ), 0)
    ),
    updated_at = NOW()
    WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. 重新定義收入觸發器，讓刪除收入時同時重算 Pond A 與 Lake
CREATE OR REPLACE FUNCTION fn_trigger_income_changed()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM fn_recalc_pond_a(COALESCE(NEW.user_id, OLD.user_id));
    PERFORM fn_recalc_lake(COALESCE(NEW.family_id, OLD.family_id));
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_income_changed ON income_items;
CREATE TRIGGER trg_income_changed
AFTER INSERT OR UPDATE OR DELETE ON income_items
FOR EACH ROW EXECUTE FUNCTION fn_trigger_income_changed();

-- 3. 重新校正所有現有 Pond A 與 Lake 內容
DO $$
DECLARE
    r_user RECORD;
    r_family RECORD;
BEGIN
    FOR r_user IN SELECT id FROM profiles LOOP
        PERFORM fn_recalc_pond_a(r_user.id);
    END LOOP;

    FOR r_family IN SELECT id FROM families LOOP
        PERFORM fn_recalc_lake(r_family.id);
    END LOOP;
END $$;
