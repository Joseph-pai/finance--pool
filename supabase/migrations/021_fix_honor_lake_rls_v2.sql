-- ==========================================
-- Migration 021 (v2): Fix honor_lake, honor_expenses & transactions RLS
-- 執行時間：2026-05-25
--
-- 問題 1：honor_lake 與 honor_expenses 的 RLS policies 缺少 is_admin() bypass，
--         導致確認收入（自動提撥什一奉獻）時會觸發 42501 錯誤。
-- 問題 2：transactions 的寫入 policy 僅限 admin，但一般成員在確認收入時需
--         插入 honor_contribution 交易，同樣會觸發 42501。
--
-- 修復方式：
--   - honor_lake / honor_expenses：比照 pond_a / pond_b 模式，
--     在所有 policy 中加入 OR is_admin() 豁免。
--   - transactions：新增 self-insert policy，
--     讓同一家庭的成員可以插入 user_id = auth.uid() 的交易。
-- ==========================================

-- 1. 修復 honor_lake RLS policies
DROP POLICY IF EXISTS "honor_lake_select" ON honor_lake;
DROP POLICY IF EXISTS "honor_lake_insert" ON honor_lake;
DROP POLICY IF EXISTS "honor_lake_update" ON honor_lake;

CREATE POLICY "honor_lake_select" ON honor_lake
  FOR SELECT
  USING (
    family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid())
    OR is_admin()
  );

CREATE POLICY "honor_lake_insert" ON honor_lake
  FOR INSERT
  WITH CHECK (
    family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid())
    OR is_admin()
  );

CREATE POLICY "honor_lake_update" ON honor_lake
  FOR UPDATE
  USING (
    family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid())
    OR is_admin()
  )
  WITH CHECK (
    family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid())
    OR is_admin()
  );

-- 2. 修復 honor_expenses RLS policies
DROP POLICY IF EXISTS "honor_expenses_select" ON honor_expenses;
DROP POLICY IF EXISTS "honor_expenses_insert" ON honor_expenses;
DROP POLICY IF EXISTS "honor_expenses_update" ON honor_expenses;
DROP POLICY IF EXISTS "honor_expenses_delete" ON honor_expenses;

CREATE POLICY "honor_expenses_select" ON honor_expenses
  FOR SELECT
  USING (
    family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid())
    OR is_admin()
  );

CREATE POLICY "honor_expenses_insert" ON honor_expenses
  FOR INSERT
  WITH CHECK (
    family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid())
    OR is_admin()
  );

CREATE POLICY "honor_expenses_update" ON honor_expenses
  FOR UPDATE
  USING (
    family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid())
    OR is_admin()
  )
  WITH CHECK (
    family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid())
    OR is_admin()
  );

CREATE POLICY "honor_expenses_delete" ON honor_expenses
  FOR DELETE
  USING (
    family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid())
    OR is_admin()
  );

-- 3. 修復 transactions RLS：允許一般成員插入自己的交易
--    原有 policy: transactions_manager_all (admin 才能寫入)
--    新增 policy: 同家庭成員可插入 user_id = auth.uid() 的交易
DROP POLICY IF EXISTS "transactions_write" ON transactions;
CREATE POLICY "transactions_write" ON transactions
  FOR INSERT
  WITH CHECK (
    family_id = get_my_family_id()
    AND (
      user_id = auth.uid()
      OR is_admin()
    )
  );
