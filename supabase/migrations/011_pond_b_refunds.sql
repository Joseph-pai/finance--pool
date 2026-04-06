-- ============================================================
-- Migration 011: 支援 Pond B (支出池) 退款 / 轉出資金
-- ============================================================

-- 1. 放寬 transactions_type_check 限制，加入 transfer_from_pond_b
DO $$ 
DECLARE 
  constraint_name text;
BEGIN
  -- 尋找 current CHECK constraint
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public' 
    AND rel.relname = 'transactions' 
    AND con.contype = 'c' 
    AND pg_get_constraintdef(con.oid) LIKE '%type%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE transactions DROP CONSTRAINT ' || quote_ident(constraint_name);
  END IF;
  
  -- 新增加入 transfer_from_pond_b 的 CHECK constraint
  ALTER TABLE transactions ADD CONSTRAINT transactions_type_check 
  CHECK (type IN ('income', 'expense', 'transfer_to_lake', 'transfer_to_pond_b', 'lake_expense', 'lake_to_member', 'transfer_from_pond_b'));
END $$;

-- 2. 更新 fn_recalc_pond_b
-- 當 B 池退回湖泊 (`type = 'transfer_to_lake' AND source='pond_b'`)
-- 或是退回 A 池 (`type = 'transfer_from_pond_b' AND source='pond_b'`) 時，要額外扣除
CREATE OR REPLACE FUNCTION fn_recalc_pond_b(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE pond_b
    SET current_balance = (
        -- 已完成支出（負值）
        COALESCE((
            SELECT SUM(amount) * -1
            FROM expense_items
            WHERE user_id = p_user_id AND status = 'completed'
        ), 0)
        -- 加上「被注入到 B 池」的金額（因為是錢進來，餘額上升）
        + COALESCE((
            SELECT SUM(amount)
            FROM transactions
            WHERE user_id = p_user_id
              AND destination = 'pond_b'
              AND type IN ('transfer_to_pond_b', 'lake_to_member')
        ), 0)
        -- 減去「從 B 池轉出去」的金額（因為是錢出去，餘額下降）
        - COALESCE((
            SELECT SUM(amount)
            FROM transactions
            WHERE user_id = p_user_id
              AND source = 'pond_b'
              AND type IN ('transfer_to_lake', 'transfer_from_pond_b')
        ), 0)
    ),
    updated_at = NOW()
    WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- 3. 更新 fn_recalc_pond_a
-- 若從 B 池退回 A 池 (`destination = 'pond_a' AND type = 'transfer_from_pond_b'`)
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
        -- 加上從另外的池子或系統（如B池）內部匯入的零星款項
        + COALESCE((
            SELECT SUM(amount)
            FROM transactions
            WHERE user_id = p_user_id
              AND destination = 'pond_a'
              AND type = 'transfer_from_pond_b'
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

-- 4. 更新 fn_trigger_transaction_changed
-- 確保當 source 或 destination 涉及 pond_a/pond_b 時，兩邊都會正確重算
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

    -- 同步 Pond A
    IF v_user_id IS NOT NULL THEN
        IF (TG_OP = 'DELETE' AND (OLD.source = 'pond_a' OR OLD.destination = 'pond_a')) OR
           (TG_OP != 'DELETE' AND (NEW.source = 'pond_a' OR NEW.destination = 'pond_a')) THEN
            PERFORM fn_recalc_pond_a(v_user_id);
        END IF;

        -- 同步 Pond B
        IF (TG_OP = 'DELETE' AND (OLD.source = 'pond_b' OR OLD.destination = 'pond_b')) OR
           (TG_OP != 'DELETE' AND (NEW.source = 'pond_b' OR NEW.destination = 'pond_b')) THEN
            PERFORM fn_recalc_pond_b(v_user_id);
        END IF;
    END IF;

    -- 同步 Lake
    IF v_family_id IS NOT NULL THEN
        IF (TG_OP = 'DELETE' AND OLD.type IN ('transfer_to_lake', 'lake_to_member', 'lake_expense')) OR
           (TG_OP != 'DELETE' AND NEW.type IN ('transfer_to_lake', 'lake_to_member', 'lake_expense')) THEN
            PERFORM fn_recalc_lake(v_family_id);
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

-- 5. 針對現在系統的所有人再重算一次池塘，確保數字正確
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT id FROM profiles LOOP
        PERFORM fn_recalc_pond_a(r.id);
        PERFORM fn_recalc_pond_b(r.id);
    END LOOP;
END $$;
