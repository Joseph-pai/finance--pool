-- ==========================================
-- Migration 013: 循環收支與權限功能擴展
-- 執行時間：2026-05-23
-- ==========================================

-- 1. 欄位新增：為 income_items 新增目標與循環屬性
ALTER TABLE income_items 
ADD COLUMN IF NOT EXISTS destination TEXT NOT NULL CHECK (destination IN ('pond_a', 'lake')) DEFAULT 'pond_a',
ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS recurrence_rule TEXT CHECK (recurrence_rule IN ('monthly', 'quarterly', 'yearly')),
ADD COLUMN IF NOT EXISTS recurrence_start_date DATE,
ADD COLUMN IF NOT EXISTS recurrence_end_date DATE,
ADD COLUMN IF NOT EXISTS recurrence_group_id UUID;

-- 2. 欄位新增：為 expense_items 新增循環屬性
ALTER TABLE expense_items 
ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS recurrence_rule TEXT CHECK (recurrence_rule IN ('monthly', 'quarterly', 'yearly')),
ADD COLUMN IF NOT EXISTS recurrence_start_date DATE,
ADD COLUMN IF NOT EXISTS recurrence_end_date DATE,
ADD COLUMN IF NOT EXISTS recurrence_group_id UUID;

-- 3. 重建 Pond A 重算函數 (SECURITY DEFINER + 區分目的地)
CREATE OR REPLACE FUNCTION fn_recalc_pond_a(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE pond_a
    SET current_balance = GREATEST(0,
        -- 已確認到帳且目的地為個人收入池的收入
        COALESCE((
            SELECT SUM(COALESCE(actual_amount, amount))
            FROM income_items
            WHERE user_id = p_user_id AND status = 'confirmed' AND destination = 'pond_a'
        ), 0)
        -- 加上從另外的池子或系統（如B池）內部匯入的零星款項
        + COALESCE((
            SELECT SUM(amount)
            FROM transactions
            WHERE user_id = p_user_id
              AND destination = 'pond_a'
              AND type = 'transfer_from_pond_b'
        ), 0)
        -- 減去從 pond_a 轉出的所有交易（注入湖泊、注入支出池）
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

-- 4. 重建 Pond B 重算函數 (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION fn_recalc_pond_b(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE pond_b
    SET current_balance = (
        -- 已完成支出（負值）
        COALESCE((
            SELECT SUM(amount) * -1
            FROM expense_items
            WHERE user_id = p_user_id AND status = 'completed'
        ), 0)
        -- 加上「被注入到 B 池」的金額
        + COALESCE((
            SELECT SUM(amount)
            FROM transactions
            WHERE user_id = p_user_id
              AND destination = 'pond_b'
              AND type IN ('transfer_to_pond_b', 'lake_to_member')
        ), 0)
        -- 減去「從 B 池轉出去」的金額
        - COALESCE((
            SELECT SUM(amount)
            FROM transactions
            WHERE user_id = p_user_id
              AND source = 'pond_b'
              AND type IN ('transfer_to_lake', 'transfer_from_pond_b')
        ), 0)
    ),
    updated_at = NOW()
    WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. 重建 Lake 重算函數 (SECURITY DEFINER + 加回直接確認注入的收入)
CREATE OR REPLACE FUNCTION fn_recalc_lake(p_family_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE lake
    SET current_balance = GREATEST(0,
        -- 注入湖泊的總額（pond_a 轉入）
        COALESCE((
            SELECT SUM(amount)
            FROM transactions
            WHERE family_id = p_family_id AND type = 'transfer_to_lake'
        ), 0)
        -- B 池退款轉入湖泊的總額
        + COALESCE((
            SELECT SUM(amount)
            FROM transactions
            WHERE family_id = p_family_id
              AND type = 'transfer_from_pond_b'
              AND destination = 'lake'
        ), 0)
        -- 加上直接確認到帳且目標為湖泊的收入
        + COALESCE((
            SELECT SUM(COALESCE(actual_amount, amount))
            FROM income_items
            WHERE family_id = p_family_id AND status = 'confirmed' AND destination = 'lake'
        ), 0)
        -- 減去從湖泊撥給成員的總額
        - COALESCE((
            SELECT SUM(amount)
            FROM transactions
            WHERE family_id = p_family_id AND type = 'lake_to_member'
        ), 0)
        -- 減去湖泊支出的總額
        - COALESCE((
            SELECT SUM(amount)
            FROM transactions
            WHERE family_id = p_family_id AND type = 'lake_expense'
        ), 0)
    ),
    updated_at = NOW()
    WHERE family_id = p_family_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. 更新 fn_trigger_income_changed (SECURITY DEFINER + 同步觸發湖泊重算)
CREATE OR REPLACE FUNCTION fn_trigger_income_changed()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM fn_recalc_pond_a(COALESCE(NEW.user_id, OLD.user_id));
    PERFORM fn_recalc_lake(COALESCE(NEW.family_id, OLD.family_id));
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. 更新 RLS 安全層政策

-- 7-1. income_items (允許湖泊管理員寫入所有成員資料)
DROP POLICY IF EXISTS "income_self_write" ON income_items;
DROP POLICY IF EXISTS "income_write" ON income_items;
CREATE POLICY "income_write" ON income_items 
FOR ALL USING (user_id = auth.uid() OR is_lake_manager());

-- 7-2. expense_items (允許湖泊管理員寫入所有成員資料)
DROP POLICY IF EXISTS "expense_self_write" ON expense_items;
DROP POLICY IF EXISTS "expense_write" ON expense_items;
CREATE POLICY "expense_write" ON expense_items 
FOR ALL USING (user_id = auth.uid() OR is_lake_manager());

-- 7-3. lake_requests (加回管理員完整控制政策以利編輯/刪除)
DROP POLICY IF EXISTS "lake_requests_admin_all" ON lake_requests;
CREATE POLICY "lake_requests_admin_all" ON lake_requests 
FOR ALL USING (is_admin());

-- 7-4. transactions (允許湖泊管理員進行任意撥款與餘額微調交易)
DROP POLICY IF EXISTS "transactions_admin_all" ON transactions;
DROP POLICY IF EXISTS "transactions_manager_all" ON transactions;
CREATE POLICY "transactions_manager_all" ON transactions 
FOR ALL USING (family_id = get_my_family_id() AND is_lake_manager());

-- 8. 建立 lake_requests 自動交易同步觸發器
CREATE OR REPLACE FUNCTION fn_trigger_lake_request_transaction_sync()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- 刪除申請時，同步刪除對應交易
        DELETE FROM transactions WHERE reference_id = OLD.id;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.status = 'approved' THEN
            -- 批准時，建立或更新交易紀錄
            IF EXISTS (SELECT 1 FROM transactions WHERE reference_id = NEW.id) THEN
                UPDATE transactions 
                SET amount = COALESCE(NEW.approved_amount, NEW.requested_amount),
                    transaction_date = COALESCE(NEW.approved_date, NEW.requested_date),
                    note = NEW.item_name
                WHERE reference_id = NEW.id;
            ELSE
                INSERT INTO transactions (family_id, user_id, type, amount, source, destination, reference_id, note, transaction_date)
                VALUES (NEW.family_id, NEW.requester_id, 'lake_to_member', COALESCE(NEW.approved_amount, NEW.requested_amount), 'lake', 'pond_b', NEW.id, NEW.item_name, COALESCE(NEW.approved_date, NEW.requested_date));
            END IF;
        ELSE
            -- 狀態被拒絕或改回 Pending 時，同步刪除對應交易
            DELETE FROM transactions WHERE reference_id = NEW.id;
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_lake_request_transaction_sync ON lake_requests;
CREATE TRIGGER trg_lake_request_transaction_sync
AFTER UPDATE OR DELETE ON lake_requests
FOR EACH ROW EXECUTE FUNCTION fn_trigger_lake_request_transaction_sync();

-- 9. 重新校正對齊一次現有數據
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
