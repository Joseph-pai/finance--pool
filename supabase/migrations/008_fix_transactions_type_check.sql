-- ==========================================
-- Migration 008: 取消 type 的錯誤限制，允許轉移到 pond_b
-- ==========================================

DO $$ 
DECLARE 
  constraint_name text;
BEGIN
  -- 尋找 transactions 表中有關 type 的 CHECK constraint
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public' 
    AND rel.relname = 'transactions' 
    AND con.contype = 'c' 
    AND pg_get_constraintdef(con.oid) LIKE '%type%';

  -- 如果有找到，就刪除它
  IF constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE transactions DROP CONSTRAINT ' || quote_ident(constraint_name);
  END IF;
  
  -- 新增正確的 CHECK constraint，加入 transfer_to_pond_b
  ALTER TABLE transactions ADD CONSTRAINT transactions_type_check 
  CHECK (type IN ('income', 'expense', 'transfer_to_lake', 'transfer_to_pond_b', 'lake_expense', 'lake_to_member'));
END $$;
