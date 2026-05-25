-- ==========================================
-- Migration 020: Fix honor_lake RLS + pond_a honor_contribution deduction
-- 執行時間：2026-05-25
-- ==========================================

-- 1. 修復 honor_lake UPDATE policy：補上 WITH CHECK
--    缺少 WITH CHECK 會導致 PostgREST 靜默阻擋 update()
DROP POLICY IF EXISTS "honor_lake_update" ON honor_lake;
CREATE POLICY "honor_lake_update" ON honor_lake
  FOR UPDATE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

-- 2. 更新 Pond A 重算函數：加入 honor_contribution 扣除
--    這樣當 transactions 插入 honor_contribution 時，
--    fn_trigger_transaction_changed 觸發重算 pond_a 就能正確扣除什一奉獻
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
        -- 減去從 pond_a 轉出的所有交易（含 honor_contribution）
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 全系統重新校正 Pond A
--    讓已存在的 honor_contribution 交易能被正確反映到 pond_a 餘額
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT id FROM profiles LOOP
        PERFORM fn_recalc_pond_a(r.id);
    END LOOP;
END $$;
