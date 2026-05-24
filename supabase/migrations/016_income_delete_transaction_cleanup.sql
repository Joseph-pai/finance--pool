-- ==========================================
-- Migration 016: Income delete transaction cleanup
-- ==========================================

-- 1. 當 income_items 被刪除時，同步清理與該收入項目關聯的 transactions
--    並且維持 Pond A / Lake 的自動重算一致性。
CREATE OR REPLACE FUNCTION fn_trigger_income_changed()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        DELETE FROM transactions WHERE reference_id = OLD.id;
    END IF;

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

-- 2. 重新校正現有 Pond A / Pond B / Lake，使 trigger 修正後的邏輯立刻生效
DO $$
DECLARE
    r RECORD;
    f RECORD;
BEGIN
    FOR r IN SELECT id FROM profiles LOOP
        PERFORM fn_recalc_pond_a(r.id);
        PERFORM fn_recalc_pond_b(r.id);
    END LOOP;

    FOR f IN SELECT id FROM families LOOP
        PERFORM fn_recalc_lake(f.id);
    END LOOP;
END $$;
