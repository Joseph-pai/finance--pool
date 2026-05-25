-- Migration 019: 榮耀歸主湖泊
-- 新增 honor_lake 表格、honor_expenses 表格、
-- income_items 加什一欄位、放寬 transactions 約束

-- 1. 新增 honor_lake 表格（每家庭一筆）
CREATE TABLE IF NOT EXISTS honor_lake (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID REFERENCES families(id) NOT NULL UNIQUE,
  current_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE honor_lake ENABLE ROW LEVEL SECURITY;

CREATE POLICY "honor_lake_select"
  ON honor_lake FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "honor_lake_insert"
  ON honor_lake FOR INSERT
  WITH CHECK (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "honor_lake_update"
  ON honor_lake FOR UPDATE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

-- 2. 新增 honor_expenses 表格
CREATE TABLE IF NOT EXISTS honor_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID REFERENCES families(id) NOT NULL,
  recipient TEXT NOT NULL,              -- 支出對象名稱
  amount NUMERIC(12,2) NOT NULL,        -- 支出金額
  expense_date DATE NOT NULL,           -- 支出日期
  note TEXT,                            -- 說明
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE honor_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "honor_expenses_select"
  ON honor_expenses FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "honor_expenses_insert"
  ON honor_expenses FOR INSERT
  WITH CHECK (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "honor_expenses_update"
  ON honor_expenses FOR UPDATE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "honor_expenses_delete"
  ON honor_expenses FOR DELETE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

-- 3. income_items 加什一欄位
ALTER TABLE income_items
  ADD COLUMN IF NOT EXISTS tithe_percentage NUMERIC(5,2) NOT NULL DEFAULT 10.00;

ALTER TABLE income_items
  ADD COLUMN IF NOT EXISTS tithe_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

-- 4. 放寬 transactions 約束
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_type_check
  CHECK (type IN ('income','expense','transfer_to_lake','lake_expense',
                  'lake_to_member','transfer_to_pond_b','transfer_from_pond_b',
                  'honor_contribution','honor_expense'));

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_source_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_source_check
  CHECK (source IS NULL OR source IN ('lake','pond_a','pond_b','honor_lake'));

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_destination_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_destination_check
  CHECK (destination IS NULL OR destination IN ('lake','pond_a','pond_b','honor_lake'));
