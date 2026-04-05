-- ==========================================
-- 湖泊與個人池塘全自動同步觸發器 (Migration 003)
-- 包含：湖泊扣款自動化、個人 B 池補足自動化
-- ==========================================

-- 1. 湖泊水位同步函數 (由 Transactions 引發)
CREATE OR REPLACE FUNCTION fn_sync_lake_from_transactions()
RETURNS TRIGGER AS $$
DECLARE
    diff NUMERIC := 0;
BEGIN
    -- 只有涉及 lake 的交易才處理
    IF (TG_OP = 'INSERT') THEN
        IF NEW.type = 'transfer_to_lake' THEN
            diff := NEW.amount;
        ELSIF NEW.type = 'lake_to_member' THEN
            diff := -NEW.amount;
        END IF;
    ELSIF (TG_OP = 'DELETE') THEN
        IF OLD.type = 'transfer_to_lake' THEN
            diff := -OLD.amount;
        ELSIF OLD.type = 'lake_to_member' THEN
            diff := OLD.amount;
        END IF;
    ELSIF (TG_OP = 'UPDATE') THEN
        -- 處理金額修改
        IF OLD.type = 'transfer_to_lake' AND NEW.type = 'transfer_to_lake' THEN
            diff := NEW.amount - OLD.amount;
        ELSIF OLD.type = 'lake_to_member' AND NEW.type = 'lake_to_member' THEN
            diff := OLD.amount - NEW.amount;
        END IF;
    END IF;

    IF diff <> 0 THEN
        UPDATE lake 
        SET current_balance = GREATEST(0, current_balance + diff),
            updated_at = NOW()
        WHERE family_id = COALESCE(NEW.family_id, OLD.family_id);
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

-- 2. 個人支出池 B 水位同步函數 (由 Transactions 引發)
CREATE OR REPLACE FUNCTION fn_sync_pond_b_from_transactions()
RETURNS TRIGGER AS $$
DECLARE
    diff NUMERIC := 0;
BEGIN
    -- 只有注入 Pond B 的交易才處理 (A->B 或 Lake->B)
    IF (TG_OP = 'INSERT') THEN
        IF (NEW.type = 'transfer_to_pond_b' OR NEW.type = 'lake_to_member') AND NEW.destination = 'pond_b' THEN
            diff := NEW.amount;
        END IF;
    ELSIF (TG_OP = 'DELETE') THEN
        IF (OLD.type = 'transfer_to_pond_b' OR OLD.type = 'lake_to_member') AND OLD.destination = 'pond_b' THEN
            diff := -OLD.amount;
        END IF;
    ELSIF (TG_OP = 'UPDATE') THEN
        IF (NEW.type = 'transfer_to_pond_b' OR NEW.type = 'lake_to_member') AND NEW.destination = 'pond_b' THEN
            diff := NEW.amount - OLD.amount;
        END IF;
    END IF;

    IF diff <> 0 THEN
        UPDATE pond_b 
        SET current_balance = LEAST(0, current_balance + diff),
            updated_at = NOW()
        WHERE user_id = COALESCE(NEW.user_id, OLD.user_id);
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

-- 3. 綁定觸發器至 transactions 表
DROP TRIGGER IF EXISTS trg_transactions_lake_sync ON transactions;
CREATE TRIGGER trg_transactions_lake_sync
AFTER INSERT OR UPDATE OR DELETE ON transactions
FOR EACH ROW EXECUTE FUNCTION fn_sync_lake_from_transactions();

DROP TRIGGER IF EXISTS trg_transactions_pond_b_sync ON transactions;
CREATE TRIGGER trg_transactions_pond_b_sync
AFTER INSERT OR UPDATE OR DELETE ON transactions
FOR EACH ROW EXECUTE FUNCTION fn_sync_pond_b_from_transactions();

-- 4. 執行一次性全系統對齊 (Final Sync)
-- 校正 A 池 (排除系統自動刪除項目)
UPDATE pond_a p
SET current_balance = GREATEST(0, 
    COALESCE((SELECT SUM(COALESCE(actual_amount, amount)) FROM income_items WHERE user_id = p.user_id AND status = 'confirmed'), 0) -
    COALESCE((SELECT SUM(amount) FROM transactions 
              WHERE user_id = p.user_id 
              AND source = 'pond_a' 
              AND note NOT LIKE '系統自動扣除%'), 0)
);

-- 校正 B 池 (加入已完成支出與所有撥入紀錄)
UPDATE pond_b p
SET current_balance = LEAST(0, 
    COALESCE((SELECT SUM(amount) * -1 FROM expense_items WHERE user_id = p.user_id AND status = 'completed'), 0) +
    COALESCE((SELECT SUM(amount) FROM transactions 
              WHERE user_id = p.user_id 
              AND destination = 'pond_b' 
              AND (type = 'transfer_to_pond_b' OR type = 'lake_to_member')), 0)
);

-- 校正湖泊 (Lake)
UPDATE lake l
SET current_balance = GREATEST(0,
    COALESCE((SELECT SUM(amount) FROM transactions WHERE type = 'transfer_to_lake' AND family_id = l.family_id), 0) +
    COALESCE((SELECT SUM(amount) FROM transactions WHERE type = 'lake_to_member' AND family_id = l.family_id), 0) -
    COALESCE((SELECT SUM(approved_amount) FROM lake_requests WHERE family_id = l.family_id AND status = 'approved'), 0)
);
