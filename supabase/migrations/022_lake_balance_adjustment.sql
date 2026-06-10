-- Migration 022: 新增 lake_balance_adjustment 校正交易類型
-- 放寬 transactions 表格的 type 和 source 約束，以支援管理員手動調整湖泊餘額的功能

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
    'lake_balance_adjustment' -- 新增
  ));

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_source_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_source_check
  CHECK (source IS NULL OR source IN (
    'lake',
    'pond_a',
    'pond_b',
    'honor_lake',
    'adjustment_add',      -- 新增：調升餘額
    'adjustment_subtract'  -- 新增：調降餘額
  ));
