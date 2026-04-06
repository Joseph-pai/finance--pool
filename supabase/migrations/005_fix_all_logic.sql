-- ==========================================
-- FamilyPool 全面邏輯修正 (Migration 005)
-- 目標：清除衝突觸發器，重建統一計算邏輯
-- 執行時間：2026-04-06
-- ==========================================

-- ============================================================
-- 步驟 1：刪除所有舊觸發器（避免衝突）
-- ============================================================

-- 刪除 income_items 上的舊觸發器 (002 + 004 的衝突)
DROP TRIGGER IF EXISTS trg_income_sync ON income_items;
DROP TRIGGER IF EXISTS trg_income_to_pond_a ON income_items;

-- 刪除 expense_items 上的舊觸發器 (002 + 004 的衝突)
DROP TRIGGER IF EXISTS trg_expense_sync ON expense_items;
DROP TRIGGER IF EXISTS trg_expense_to_pond_b ON expense_items;

-- 刪除 transactions 上的舊觸發器 (003)
DROP TRIGGER IF EXISTS trg_transactions_lake_sync ON transactions;
DROP TRIGGER IF EXISTS trg_transactions_pond_b_sync ON transactions;

-- 刪除舊函數
DROP FUNCTION IF EXISTS fn_sync_income_to_pond_a() CASCADE;
DROP FUNCTION IF EXISTS fn_sync_expense_to_poids() CASCADE;
DROP FUNCTION IF EXISTS fn_sync_lake_from_transactions() CASCADE;
DROP FUNCTION IF EXISTS fn_sync_pond_b_from_transactions() CASCADE;
DROP FUNCTION IF EXISTS fn_sync_pond_a_from_income() CASCADE;
DROP FUNCTION IF EXISTS fn_sync_pond_b_from_expense() CASCADE;

-- ============================================================
-- 步驟 2：定義 Pond A 全量重算函數
-- Pond A 餘額 = 已確認收入合計 - 已轉出合計（注入湖泊 + 注入支出池）
-- ============================================================
CREATE OR REPLACE FUNCTION fn_recalc_pond_a(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE pond_a
    SET current_balance = GREATEST(0,
        -- 已確認到帳收入
        COALESCE((
            SELECT SUM(COALESCE(actual_amount, amount))
            FROM income_items
            WHERE user_id = p_user_id AND status = 'confirmed'
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
$$ LANGUAGE plpgsql;

-- ============================================================
-- 步驟 3：定義 Pond B 全量重算函數
-- Pond B 餘額 = -(已完成支出合計) + 已注入合計（從 A 或湖泊撥入）
-- 設計為 ≤ 0（欠款模型）
-- ============================================================
CREATE OR REPLACE FUNCTION fn_recalc_pond_b(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE pond_b
    SET current_balance = LEAST(0,
        -- 已完成支出（負值）
        COALESCE((
            SELECT SUM(amount) * -1
            FROM expense_items
            WHERE user_id = p_user_id AND status = 'completed'
        ), 0)
        -- 加上已注入的金額（從 A 池或湖泊撥入）
        + COALESCE((
            SELECT SUM(amount)
            FROM transactions
            WHERE user_id = p_user_id
              AND destination = 'pond_b'
              AND type IN ('transfer_to_pond_b', 'lake_to_member')
        ), 0)
    ),
    updated_at = NOW()
    WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 步驟 4：定義 Lake 全量重算函數
-- Lake 餘額 = 所有注入交易 - 所有撥出交易
-- ============================================================
CREATE OR REPLACE FUNCTION fn_recalc_lake(p_family_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE lake
    SET current_balance = GREATEST(0,
        -- 注入湖泊的總額
        COALESCE((
            SELECT SUM(amount)
            FROM transactions
            WHERE family_id = p_family_id AND type = 'transfer_to_lake'
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
$$ LANGUAGE plpgsql;

-- ============================================================
-- 步驟 5：income_items 變動時同步 Pond A
-- ============================================================
CREATE OR REPLACE FUNCTION fn_trigger_income_changed()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM fn_recalc_pond_a(COALESCE(NEW.user_id, OLD.user_id));
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_income_changed
AFTER INSERT OR UPDATE OR DELETE ON income_items
FOR EACH ROW EXECUTE FUNCTION fn_trigger_income_changed();

-- ============================================================
-- 步驟 6：expense_items 變動時同步 Pond B
-- ============================================================
CREATE OR REPLACE FUNCTION fn_trigger_expense_changed()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM fn_recalc_pond_b(COALESCE(NEW.user_id, OLD.user_id));
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_expense_changed
AFTER INSERT OR UPDATE OR DELETE ON expense_items
FOR EACH ROW EXECUTE FUNCTION fn_trigger_expense_changed();

-- ============================================================
-- 步驟 7：transactions 變動時同步 Pond A、Pond B、Lake
-- ============================================================
CREATE OR REPLACE FUNCTION fn_trigger_transaction_changed()
RETURNS TRIGGER AS $$
DECLARE
    v_user_id   UUID;
    v_family_id UUID;
BEGIN
    -- 取得相關的 user_id 和 family_id
    IF TG_OP = 'DELETE' THEN
        v_user_id   := OLD.user_id;
        v_family_id := OLD.family_id;
    ELSE
        v_user_id   := NEW.user_id;
        v_family_id := NEW.family_id;
    END IF;

    -- 同步 Pond A（如果這筆交易涉及 pond_a 轉出）
    IF v_user_id IS NOT NULL THEN
        -- 只要涉及 pond_a 的交易類型，就重算 pond_a
        IF (TG_OP = 'DELETE' AND OLD.source = 'pond_a') OR
           (TG_OP != 'DELETE' AND NEW.source = 'pond_a') THEN
            PERFORM fn_recalc_pond_a(v_user_id);
        END IF;

        -- 只要涉及 pond_b 的交易類型，就重算 pond_b
        IF (TG_OP = 'DELETE' AND OLD.destination = 'pond_b') OR
           (TG_OP != 'DELETE' AND NEW.destination = 'pond_b') THEN
            PERFORM fn_recalc_pond_b(v_user_id);
        END IF;
    END IF;

    -- 同步 Lake（涉及湖泊的交易）
    IF v_family_id IS NOT NULL THEN
        IF (TG_OP = 'DELETE' AND OLD.type IN ('transfer_to_lake', 'lake_to_member', 'lake_expense')) OR
           (TG_OP != 'DELETE' AND NEW.type IN ('transfer_to_lake', 'lake_to_member', 'lake_expense')) THEN
            PERFORM fn_recalc_lake(v_family_id);
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_transaction_changed
AFTER INSERT OR UPDATE OR DELETE ON transactions
FOR EACH ROW EXECUTE FUNCTION fn_trigger_transaction_changed();

-- ============================================================
-- 步驟 8：執行一次全系統對齊（重置所有池塘到正確數值）
-- ============================================================
DO $$
DECLARE
    v_user   RECORD;
    v_family RECORD;
BEGIN
    -- 重算所有成員的 Pond A 和 Pond B
    FOR v_user IN SELECT id FROM profiles LOOP
        PERFORM fn_recalc_pond_a(v_user.id);
        PERFORM fn_recalc_pond_b(v_user.id);
    END LOOP;

    -- 重算所有家庭的 Lake
    FOR v_family IN SELECT id FROM families LOOP
        PERFORM fn_recalc_lake(v_family.id);
    END LOOP;
END $$;

-- ============================================================
-- 驗證：查看觸發器狀態
-- ============================================================
-- SELECT trigger_name, event_object_table, action_timing, event_manipulation
-- FROM information_schema.triggers
-- WHERE trigger_schema = 'public'
-- ORDER BY event_object_table, trigger_name;
