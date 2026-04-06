-- ============================================================
-- Migration 012: 修復 Lake 計算缺漏 & RLS Admin 寫入權限
-- 執行時間：2026-04-06
-- ============================================================

-- ============================================================
-- 修復 1：fn_recalc_lake
-- 加入 transfer_from_pond_b（B 池退款→湖泊）的計入
-- ============================================================
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
-- 修復 2：fn_trigger_transaction_changed
-- 讓 transfer_from_pond_b 也觸發湖泊重算
-- ============================================================
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

    -- 同步 Pond A（source 或 destination 涉及 pond_a）
    IF v_user_id IS NOT NULL THEN
        IF (TG_OP = 'DELETE' AND (OLD.source = 'pond_a' OR OLD.destination = 'pond_a')) OR
           (TG_OP != 'DELETE' AND (NEW.source = 'pond_a' OR NEW.destination = 'pond_a')) THEN
            PERFORM fn_recalc_pond_a(v_user_id);
        END IF;

        -- 同步 Pond B（source 或 destination 涉及 pond_b）
        IF (TG_OP = 'DELETE' AND (OLD.source = 'pond_b' OR OLD.destination = 'pond_b')) OR
           (TG_OP != 'DELETE' AND (NEW.source = 'pond_b' OR NEW.destination = 'pond_b')) THEN
            PERFORM fn_recalc_pond_b(v_user_id);
        END IF;
    END IF;

    -- 同步 Lake（涵蓋所有影響湖泊的交易類型，含 transfer_from_pond_b→lake）
    IF v_family_id IS NOT NULL THEN
        IF (TG_OP = 'DELETE' AND OLD.type IN (
                'transfer_to_lake', 'lake_to_member', 'lake_expense', 'transfer_from_pond_b'
            )) OR
           (TG_OP != 'DELETE' AND NEW.type IN (
                'transfer_to_lake', 'lake_to_member', 'lake_expense', 'transfer_from_pond_b'
            )) THEN
            PERFORM fn_recalc_lake(v_family_id);
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 修復 3：pond_a RLS — 加回 Admin 寫入權限
-- ============================================================
DROP POLICY IF EXISTS "pond_a_self_write" ON pond_a;
CREATE POLICY "pond_a_self_write" ON pond_a
    FOR ALL USING (user_id = auth.uid() OR is_admin());

-- ============================================================
-- 修復 4：pond_b RLS — 加回 Admin 寫入權限
-- ============================================================
DROP POLICY IF EXISTS "pond_b_self_write" ON pond_b;
CREATE POLICY "pond_b_self_write" ON pond_b
    FOR ALL USING (user_id = auth.uid() OR is_admin());

-- ============================================================
-- 修復 5：全系統重算，讓 Lake 從 175,000 回到正確值 176,000
-- ============================================================
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

-- ============================================================
-- 驗證查詢（執行後應顯示所有 ✅ 一致）
-- ============================================================
SELECT
    f.name AS family_name,
    l.current_balance AS stored_balance,
    GREATEST(0,
        COALESCE((SELECT SUM(amount) FROM transactions WHERE family_id = l.family_id AND type = 'transfer_to_lake'), 0)
        + COALESCE((SELECT SUM(amount) FROM transactions WHERE family_id = l.family_id AND type = 'transfer_from_pond_b' AND destination = 'lake'), 0)
        - COALESCE((SELECT SUM(amount) FROM transactions WHERE family_id = l.family_id AND type = 'lake_to_member'), 0)
        - COALESCE((SELECT SUM(amount) FROM transactions WHERE family_id = l.family_id AND type = 'lake_expense'), 0)
    ) AS calculated_balance,
    CASE
        WHEN ABS(l.current_balance - GREATEST(0,
            COALESCE((SELECT SUM(amount) FROM transactions WHERE family_id = l.family_id AND type = 'transfer_to_lake'), 0)
            + COALESCE((SELECT SUM(amount) FROM transactions WHERE family_id = l.family_id AND type = 'transfer_from_pond_b' AND destination = 'lake'), 0)
            - COALESCE((SELECT SUM(amount) FROM transactions WHERE family_id = l.family_id AND type = 'lake_to_member'), 0)
            - COALESCE((SELECT SUM(amount) FROM transactions WHERE family_id = l.family_id AND type = 'lake_expense'), 0)
        )) < 1 THEN '✅ 已修正，一致'
        ELSE '❌ 仍不一致，請再查'
    END AS check_result
FROM lake l
JOIN families f ON f.id = l.family_id;
