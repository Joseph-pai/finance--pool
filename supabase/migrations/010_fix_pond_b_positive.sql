-- ============================================================
-- Migration 010: 解除 Pond B 只能是負數 (欠款模型) 的限制，允許正數 (預付餘額)
-- ============================================================

CREATE OR REPLACE FUNCTION fn_recalc_pond_b(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE pond_b
    -- 移除原本的 LEAST(0, ...) 限制，讓它能夠顯示為正數
    SET current_balance = (
        -- 已完成支出（負值）
        COALESCE((
            SELECT SUM(amount) * -1
            FROM expense_items
            WHERE user_id = p_user_id AND status = 'completed'
        ), 0)
        -- 加上已注入的金額（從 A 池或湖泊撥入）
        + COALESCE((
            SELECT SUM(amount)
            FROM transactions
            WHERE user_id = p_user_id
              AND destination = 'pond_b'
              AND type IN ('transfer_to_pond_b', 'lake_to_member')
        ), 0)
    ),
    updated_at = NOW()
    WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- 自動觸發一次所有成員的池塘 B 重算，把之前被吃掉的錢還原出來！
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT id FROM profiles LOOP
        PERFORM fn_recalc_pond_b(r.id);
    END LOOP;
END $$;
