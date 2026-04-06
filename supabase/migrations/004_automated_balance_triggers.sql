-- ==========================================
-- 自動化水位同步觸發器 (Migration 004)
-- ==========================================

-- 1. 收入項目異動引發池塘 A 水位更新
CREATE OR REPLACE FUNCTION fn_sync_pond_a_from_income()
RETURNS TRIGGER AS $$
BEGIN
    -- 當狀態變更為 confirmed 或修改金額時，重新計算池塘 A 餘額
    UPDATE pond_a p
    SET current_balance = GREATEST(0, 
        COALESCE((SELECT SUM(COALESCE(actual_amount, amount)) FROM income_items WHERE user_id = p.user_id AND status = 'confirmed'), 0) -
        COALESCE((SELECT SUM(amount) FROM transactions 
                  WHERE user_id = p.user_id 
                  AND source = 'pond_a' 
                  AND note NOT LIKE '系統自動扣除%'), 0)
    )
    WHERE user_id = COALESCE(NEW.user_id, OLD.user_id);
    
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_income_to_pond_a ON income_items;
CREATE TRIGGER trg_income_to_pond_a 
AFTER INSERT OR UPDATE OR DELETE ON income_items
FOR EACH ROW EXECUTE FUNCTION fn_sync_pond_a_from_income();

-- 2. 支出項目異動引發池塘 B 水位更新
CREATE OR REPLACE FUNCTION fn_sync_pond_b_from_expense()
RETURNS TRIGGER AS $$
BEGIN
    -- 當狀態變更為 completed 或修改金額時，重新計算池塘 B 餘額
    UPDATE pond_b p
    SET current_balance = LEAST(0, 
        COALESCE((SELECT SUM(amount) * -1 FROM expense_items WHERE user_id = p.user_id AND status = 'completed'), 0) +
        COALESCE((SELECT SUM(amount) FROM transactions 
                  WHERE user_id = p.user_id 
                  AND destination = 'pond_b' 
                  AND (type = 'transfer_to_pond_b' OR type = 'lake_to_member')), 0)
    )
    WHERE user_id = COALESCE(NEW.user_id, OLD.user_id);
    
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_expense_to_pond_b ON expense_items;
CREATE TRIGGER trg_expense_to_pond_b
AFTER INSERT OR UPDATE OR DELETE ON expense_items
FOR EACH ROW EXECUTE FUNCTION fn_sync_pond_b_from_expense();

-- 3. 執行一次全系統對齊
DO $$
DECLARE
    u_id UUID;
BEGIN
    FOR u_id IN SELECT id FROM profiles LOOP
        -- 更新池塘 A
        UPDATE pond_a p SET current_balance = GREATEST(0, 
            COALESCE((SELECT SUM(COALESCE(actual_amount, amount)) FROM income_items WHERE user_id = u_id AND status = 'confirmed'), 0) -
            COALESCE((SELECT SUM(amount) FROM transactions WHERE user_id = u_id AND source = 'pond_a' AND note NOT LIKE '系統自動扣除%'), 0)
        ) WHERE user_id = u_id;

        -- 更新池塘 B
        UPDATE pond_b p SET current_balance = LEAST(0, 
            COALESCE((SELECT SUM(amount) * -1 FROM expense_items WHERE user_id = u_id AND status = 'completed'), 0) +
            COALESCE((SELECT SUM(amount) FROM transactions WHERE user_id = u_id AND destination = 'pond_b' AND (type = 'transfer_to_pond_b' OR type = 'lake_to_member')), 0)
        ) WHERE user_id = u_id;
    END LOOP;
END $$;
