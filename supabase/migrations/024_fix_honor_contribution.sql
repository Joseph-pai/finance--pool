-- Migration 024: 修正湖泊直接收入的什一奉獻與資料庫計算邏輯
-- 1. 修正舊有因為收入目標是 lake，但 honor_contribution 來源卻記成 pond_a 的交易
-- 2. 修正 fn_recalc_pond_a，只加總 destination = 'pond_a' 的收入
-- 3. 修正 fn_recalc_lake，加入 destination = 'lake' 的收入，並扣除 honor_contribution (source='lake') 和 lake_balance_adjustment

-- 步驟 1：修正歷史錯誤交易
UPDATE transactions t
SET source = 'lake'
FROM income_items i
WHERE t.type = 'honor_contribution'
  AND t.reference_id = i.id
  AND i.destination = 'lake'
  AND t.source = 'pond_a';

-- 步驟 2：修正 Pond A 函數
CREATE OR REPLACE FUNCTION fn_recalc_pond_a(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE pond_a
    SET current_balance = GREATEST(0,
        -- 已確認到帳收入 (只計算目標為 pond_a 的)
        COALESCE((
            SELECT SUM(COALESCE(actual_amount, amount))
            FROM income_items
            WHERE user_id = p_user_id AND status = 'confirmed' AND destination = 'pond_a'
        ), 0)
        -- 減去從 pond_a 轉出的所有交易
        - COALESCE((
            SELECT SUM(amount)
            FROM transactions
            WHERE user_id = p_user_id
              AND source = 'pond_a'
              AND type IN ('transfer_to_lake', 'transfer_to_pond_b', 'honor_contribution')
        ), 0)
    ),
    updated_at = NOW()
    WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- 步驟 3：修正 Lake 函數
CREATE OR REPLACE FUNCTION fn_recalc_lake(p_family_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE lake
    SET current_balance = GREATEST(0,
        -- 注入湖泊的總額 (來自轉帳)
        COALESCE((
            SELECT SUM(amount)
            FROM transactions
            WHERE family_id = p_family_id AND type = 'transfer_to_lake'
        ), 0)
        -- PLUS: 注入湖泊的總額 (來自 B 池退款)
        + COALESCE((
            SELECT SUM(amount)
            FROM transactions
            WHERE family_id = p_family_id AND type = 'transfer_from_pond_b' AND destination = 'lake'
        ), 0)
        -- PLUS: 直接入帳到湖泊的收入
        + COALESCE((
            SELECT SUM(COALESCE(actual_amount, amount))
            FROM income_items
            WHERE family_id = p_family_id AND destination = 'lake' AND status = 'confirmed'
        ), 0)
        -- PLUS: 管理員手動校正 (增加)
        + COALESCE((
            SELECT SUM(amount)
            FROM transactions
            WHERE family_id = p_family_id AND type = 'lake_balance_adjustment' AND source = 'adjustment_add'
        ), 0)
        -- MINUS: 管理員手動校正 (減少)
        - COALESCE((
            SELECT SUM(amount)
            FROM transactions
            WHERE family_id = p_family_id AND type = 'lake_balance_adjustment' AND source = 'adjustment_subtract'
        ), 0)
        -- MINUS: 減去從湖泊撥給成員的總額
        - COALESCE((
            SELECT SUM(amount)
            FROM transactions
            WHERE family_id = p_family_id AND type = 'lake_to_member'
        ), 0)
        -- MINUS: 減去湖泊支出的總額
        - COALESCE((
            SELECT SUM(amount)
            FROM transactions
            WHERE family_id = p_family_id AND type = 'lake_expense'
        ), 0)
        -- MINUS: 減去從湖泊扣除的什一奉獻
        - COALESCE((
            SELECT SUM(amount)
            FROM transactions
            WHERE family_id = p_family_id AND type = 'honor_contribution' AND source = 'lake'
        ), 0)
    ),
    updated_at = NOW()
    WHERE family_id = p_family_id;
END;
$$ LANGUAGE plpgsql;

-- 步驟 4：手動觸發一次全部重算
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
