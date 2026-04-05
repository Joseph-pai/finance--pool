-- ==========================================
-- 池塘與湖泊同步邏輯修正與增強 (v2)
-- 包含：負數保護、自動同步、以及 A->B 注水功能支援
-- ==========================================

-- 1. 增加約束：確保池塘水位符合物理邏輯
-- 收入池 (Pond A) 必須為正數或零
ALTER TABLE pond_a ADD CONSTRAINT pond_a_no_negative CHECK (current_balance >= 0);
-- 支出池 (Pond B) 必須為負數或零
ALTER TABLE pond_b ADD CONSTRAINT pond_b_no_positive CHECK (current_balance <= 0);

-- 2. 清理 Joseph 目前的異常數值 (歸零)
UPDATE pond_a SET current_balance = 0 WHERE current_balance < 0;

-- 3. 定義統一的餘額同步函數 (Income -> Pond A)
CREATE OR REPLACE FUNCTION fn_sync_income_to_pond_a()
RETURNS TRIGGER AS $$
DECLARE
    old_amount NUMERIC := 0;
    new_amount NUMERIC := 0;
    diff NUMERIC := 0;
BEGIN
    -- 處理刪除或修改 (舊值)
    IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') THEN
        IF OLD.status = 'confirmed' THEN
            old_amount := COALESCE(OLD.actual_amount, OLD.amount);
        END IF;
    END IF;

    -- 處理新增或修改 (新值)
    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
        IF NEW.status = 'confirmed' THEN
            new_amount := COALESCE(NEW.actual_amount, NEW.amount);
        END IF;
    END IF;

    diff := new_amount - old_amount;

    IF diff <> 0 THEN
        -- 更新 Pond A
        UPDATE pond_a 
        SET current_balance = GREATEST(0, current_balance + diff),
            updated_at = NOW()
        WHERE user_id = COALESCE(NEW.user_id, OLD.user_id);

        -- 如果是刪除或大幅修改，自動建立一筆系統交易記錄以供追蹤
        IF TG_OP = 'DELETE' AND old_amount > 0 THEN
            INSERT INTO transactions (family_id, user_id, type, amount, destination, note, transaction_date)
            VALUES (OLD.family_id, OLD.user_id, 'expense', old_amount, 'pond_a', '系統自動扣除：刪除已到帳收入「' || OLD.name || '」', CURRENT_DATE);
        ELSIF TG_OP = 'UPDATE' AND old_amount <> new_amount AND old_amount > 0 THEN
             INSERT INTO transactions (family_id, user_id, type, amount, destination, note, transaction_date)
            VALUES (NEW.family_id, NEW.user_id, 'income', diff, 'pond_a', '系統自動修正：修改已到帳收入「' || NEW.name || '」金額', CURRENT_DATE);
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

-- 4. 定義統一的餘額同步函數 (Expense -> Pond B & Pond A)
CREATE OR REPLACE FUNCTION fn_sync_expense_to_poids()
RETURNS TRIGGER AS $$
DECLARE
    old_amount_b NUMERIC := 0;
    new_amount_b NUMERIC := 0;
    old_amount_a NUMERIC := 0;
    new_amount_a NUMERIC := 0;
    diff_b NUMERIC := 0;
    diff_a NUMERIC := 0;
BEGIN
    -- 處理支出池 (Pond B) - 只要是已完成的支出都算
    IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') THEN
        IF OLD.status = 'completed' THEN old_amount_b := OLD.amount; END IF;
    END IF;
    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
        IF NEW.status = 'completed' THEN new_amount_b := NEW.amount; END IF;
    END IF;
    diff_b := old_amount_b - new_amount_b;

    -- 處理收入池 (Pond A) - 僅限來源為 pond_a 且已完成的支出
    IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') THEN
        IF OLD.status = 'completed' AND OLD.source = 'pond_a' THEN old_amount_a := OLD.amount; END IF;
    END IF;
    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
        IF NEW.status = 'completed' AND NEW.source = 'pond_a' THEN new_amount_a := NEW.amount; END IF;
    END IF;
    diff_a := old_amount_a - new_amount_a; -- 原 $100 改為 $200, diff_a 為 -100

    -- 同步 Pond B
    IF diff_b <> 0 THEN
        UPDATE pond_b SET current_balance = LEAST(0, current_balance + diff_b), updated_at = NOW()
        WHERE user_id = COALESCE(NEW.user_id, OLD.user_id);
    END IF;

    -- 同步 Pond A
    IF diff_a <> 0 THEN
        UPDATE pond_a SET current_balance = GREATEST(0, current_balance + diff_a), updated_at = NOW()
        WHERE user_id = COALESCE(NEW.user_id, OLD.user_id);
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

-- 5. 綁定觸發器
DROP TRIGGER IF EXISTS trg_income_sync ON income_items;
CREATE TRIGGER trg_income_sync
AFTER INSERT OR UPDATE OR DELETE ON income_items
FOR EACH ROW EXECUTE FUNCTION fn_sync_income_to_pond_a();

DROP TRIGGER IF EXISTS trg_expense_sync ON expense_items;
CREATE TRIGGER trg_expense_sync
AFTER INSERT OR UPDATE OR DELETE ON expense_items
FOR EACH ROW EXECUTE FUNCTION fn_sync_expense_to_poids();

