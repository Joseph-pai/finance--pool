-- ==========================================
-- Migration 007: Fix transactions RLS Policy
-- ==========================================

-- 先刪除先前由 initial_schema 建立的 transactions_read policy
DROP POLICY IF EXISTS "transactions_read" ON transactions;

-- 1. 所有家庭成員都可以看到（SELECT）所有同家庭的交易資訊
CREATE POLICY "transactions_read" 
ON transactions FOR SELECT 
USING (family_id = get_my_family_id());

-- 2. 系統管理員 (admin) 可以對同家庭的所有交易進行完整操作 (INSERT/UPDATE/DELETE)
CREATE POLICY "transactions_admin_all" 
ON transactions FOR ALL 
USING (family_id = get_my_family_id() AND is_admin());

-- 3. 湖泊管理員與一般家庭成員只能對「自己的交易 (user_id = 自己)」進行操作
CREATE POLICY "transactions_self_write" 
ON transactions FOR ALL 
USING (family_id = get_my_family_id() AND user_id = auth.uid());
