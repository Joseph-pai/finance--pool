-- Migration 023: 獨立預估餘額調整
-- 新增 lake_estimated_adjustment 到 transactions_type_check
-- 新增 estimated_add 和 estimated_subtract 到 transactions_source_check

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_type_check
  CHECK (type IN (
    'income',
    'expense',
    'transfer_to_lake',
    'lake_expense',
    'lake_to_member',
    'transfer_to_pond_b',
    'transfer_from_pond_b',
    'honor_contribution',
    'honor_expense',
    'lake_balance_adjustment',
    'lake_estimated_adjustment' -- 新增：專門給預估餘額用的調整
  ));

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_source_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_source_check
  CHECK (source IS NULL OR source IN (
    'lake',
    'pond_a',
    'pond_b',
    'honor_lake',
    'adjustment_add',
    'adjustment_subtract',
    'estimated_add',      -- 新增：預估餘額調升
    'estimated_subtract'  -- 新增：預估餘額調降
  ));
