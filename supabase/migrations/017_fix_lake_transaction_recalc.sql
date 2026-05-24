-- ==========================================
-- Migration 017: Fix lake recalculation on transaction changes
-- ==========================================

-- 1. 重新定義 Lake 重算函數，涵蓋所有影響湖泊餘額的交易與收入來源
CREATE OR REPLACE FUNCTION fn_recalc_lake(p_family_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE lake
    SET current_balance = GREATEST(0,
        -- 注入湖泊的總額（pond_a 轉入）
        COALESCE((SELECT SUM(amount) FROM transactions WHERE family_id = p_family_id AND type = 'transfer_to_lake'), 0)
        -- B 池退款轉入湖泊的總額
        + COALESCE((SELECT SUM(amount) FROM transactions WHERE family_id = p_family_id AND type = 'transfer_from_pond_b' AND destination = 'lake'), 0)
        -- 直接確認到帳且目標為湖泊的收入
        + COALESCE((SELECT SUM(COALESCE(actual_amount, amount)) FROM income_items WHERE family_id = p_family_id AND status = 'confirmed' AND destination = 'lake'), 0)
        -- 減去湖泊撥給成員的總額
        - COALESCE((SELECT SUM(amount) FROM transactions WHERE family_id = p_family_id AND type = 'lake_to_member'), 0)
        -- 減去湖泊支出的總額
        - COALESCE((SELECT SUM(amount) FROM transactions WHERE family_id = p_family_id AND type = 'lake_expense'), 0)
    ),
    updated_at = NOW()
    WHERE family_id = p_family_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. 重新定義 transactions 變動觸發器，讓所有影響 pond_a/pond_b/lake 的交易變更都會正確重算
CREATE OR REPLACE FUNCTION fn_trigger_transaction_changed()
RETURNS TRIGGER AS $$
DECLARE
    v_user_id   UUID;
    v_family_id UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_user_id   := OLD.user_id;
        v_family_id := OLD.family_id;
    ELSE
        v_user_id   := NEW.user_id;
        v_family_id := NEW.family_id;
    END IF;

    IF v_user_id IS NOT NULL THEN
        IF (TG_OP = 'DELETE' AND (OLD.source = 'pond_a' OR OLD.destination = 'pond_a')) OR
           (TG_OP != 'DELETE' AND (NEW.source = 'pond_a' OR NEW.destination = 'pond_a')) THEN
            PERFORM fn_recalc_pond_a(v_user_id);
        END IF;

        IF (TG_OP = 'DELETE' AND (OLD.source = 'pond_b' OR OLD.destination = 'pond_b')) OR
           (TG_OP != 'DELETE' AND (NEW.source = 'pond_b' OR NEW.destination = 'pond_b')) THEN
            PERFORM fn_recalc_pond_b(v_user_id);
        END IF;
    END IF;

    IF v_family_id IS NOT NULL THEN
        IF (TG_OP = 'DELETE' AND OLD.type IN ('transfer_to_lake', 'lake_to_member', 'lake_expense', 'transfer_from_pond_b')) OR
           (TG_OP != 'DELETE' AND NEW.type IN ('transfer_to_lake', 'lake_to_member', 'lake_expense', 'transfer_from_pond_b')) THEN
            PERFORM fn_recalc_lake(v_family_id);
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_transaction_changed ON transactions;
CREATE TRIGGER trg_transaction_changed
AFTER INSERT OR UPDATE OR DELETE ON transactions
FOR EACH ROW EXECUTE FUNCTION fn_trigger_transaction_changed();

-- 3. 全系統重算，確保現有 Pond A / Pond B / Lake 與此次 trigger 修正一致
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
