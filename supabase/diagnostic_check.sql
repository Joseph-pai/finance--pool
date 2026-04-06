-- ================================================================
-- FamilyPool 資料庫完整診斷腳本
-- 用途：一鍵在 Supabase SQL Editor 執行，驗證所有設定是否正確
-- ================================================================

-- ============================================================
-- 第 1 區：檢查所有資料表是否存在
-- ============================================================
SELECT '=== 第 1 區：資料表存在性檢查 ===' AS section;

SELECT
    table_name,
    CASE WHEN table_name IN (
        'families','profiles','lake','pond_a','pond_b',
        'income_items','expense_items','lake_expenses',
        'lake_requests','transactions','notifications'
    ) THEN '✅ 存在' ELSE '❌ 非預期資料表' END AS status
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- ============================================================
-- 第 2 區：確認 11 張必要資料表是否全部到齊
-- ============================================================
SELECT '=== 第 2 區：缺少的資料表 ===' AS section;

WITH required_tables AS (
    SELECT unnest(ARRAY[
        'families','profiles','lake','pond_a','pond_b',
        'income_items','expense_items','lake_expenses',
        'lake_requests','transactions','notifications'
    ]) AS table_name
),
existing_tables AS (
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
)
SELECT r.table_name, '❌ 缺少此資料表！' AS status
FROM required_tables r
LEFT JOIN existing_tables e ON r.table_name = e.table_name
WHERE e.table_name IS NULL;

-- ============================================================
-- 第 3 區：檢查觸發器是否存在
-- ============================================================
SELECT '=== 第 3 區：觸發器檢查 ===' AS section;

WITH required_triggers AS (
    SELECT unnest(ARRAY[
        'trg_lake_updated_at',
        'trg_pond_a_updated_at',
        'trg_pond_b_updated_at',
        'trg_income_updated_at',
        'trg_expense_updated_at',
        'trg_lake_expense_updated_at',
        'trg_lake_request_updated_at',
        'trg_income_changed',
        'trg_expense_changed',
        'trg_transaction_changed'
    ]) AS trigger_name
),
existing_triggers AS (
    SELECT trigger_name FROM information_schema.triggers
    WHERE trigger_schema = 'public'
)
SELECT
    r.trigger_name,
    CASE WHEN e.trigger_name IS NOT NULL THEN '✅ 存在' ELSE '❌ 缺少！' END AS status
FROM required_triggers r
LEFT JOIN existing_triggers e ON r.trigger_name = e.trigger_name
ORDER BY r.trigger_name;

-- ============================================================
-- 第 4 區：檢查函數是否存在
-- ============================================================
SELECT '=== 第 4 區：函數檢查 ===' AS section;

WITH required_functions AS (
    SELECT unnest(ARRAY[
        'update_updated_at',
        'get_my_family_id',
        'is_admin',
        'is_lake_manager',
        'fn_recalc_pond_a',
        'fn_recalc_pond_b',
        'fn_recalc_lake',
        'fn_trigger_income_changed',
        'fn_trigger_expense_changed',
        'fn_trigger_transaction_changed'
    ]) AS func_name
),
existing_funcs AS (
    SELECT routine_name FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_type = 'FUNCTION'
)
SELECT
    r.func_name,
    CASE WHEN e.routine_name IS NOT NULL THEN '✅ 存在' ELSE '❌ 缺少！' END AS status
FROM required_functions r
LEFT JOIN existing_funcs e ON r.func_name = e.routine_name
ORDER BY r.func_name;

-- ============================================================
-- 第 5 區：檢查 RLS 是否啟用
-- ============================================================
SELECT '=== 第 5 區：RLS 開啟狀態 ===' AS section;

SELECT
    tablename,
    CASE WHEN rowsecurity THEN '✅ RLS 已啟用' ELSE '❌ RLS 未啟用！' END AS rls_status
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'families','profiles','lake','pond_a','pond_b',
    'income_items','expense_items','lake_expenses',
    'lake_requests','transactions','notifications'
  )
ORDER BY tablename;

-- ============================================================
-- 第 6 區：檢查 RLS Policies 數量
-- ============================================================
SELECT '=== 第 6 區：RLS Policy 清單 ===' AS section;

SELECT
    tablename,
    policyname,
    cmd AS operation,
    qual AS using_expression
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- ============================================================
-- 第 7 區：查看 transactions 的 CHECK constraint
-- ============================================================
SELECT '=== 第 7 區：transactions type 允許值 ===' AS section;

SELECT
    con.conname AS constraint_name,
    pg_get_constraintdef(con.oid) AS constraint_definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public'
  AND rel.relname = 'transactions'
  AND con.contype = 'c';

-- ============================================================
-- 第 8 區：目前所有數據概覽
-- ============================================================
SELECT '=== 第 8 區：資料筆數概覽 ===' AS section;

SELECT 'families' AS table_name, COUNT(*) AS record_count FROM families
UNION ALL SELECT 'profiles', COUNT(*) FROM profiles
UNION ALL SELECT 'lake', COUNT(*) FROM lake
UNION ALL SELECT 'pond_a', COUNT(*) FROM pond_a
UNION ALL SELECT 'pond_b', COUNT(*) FROM pond_b
UNION ALL SELECT 'income_items', COUNT(*) FROM income_items
UNION ALL SELECT 'expense_items', COUNT(*) FROM expense_items
UNION ALL SELECT 'lake_expenses', COUNT(*) FROM lake_expenses
UNION ALL SELECT 'lake_requests', COUNT(*) FROM lake_requests
UNION ALL SELECT 'transactions', COUNT(*) FROM transactions
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications
ORDER BY table_name;

-- ============================================================
-- 第 9 區：成員與池塘詳細狀態
-- ============================================================
SELECT '=== 第 9 區：成員資料 ===' AS section;

SELECT
    p.id,
    p.display_name,
    p.role,
    f.name AS family_name,
    pa.current_balance AS pond_a_balance,
    pb.current_balance AS pond_b_balance
FROM profiles p
LEFT JOIN families f ON f.id = p.family_id
LEFT JOIN pond_a pa ON pa.user_id = p.id
LEFT JOIN pond_b pb ON pb.user_id = p.id
ORDER BY p.role, p.display_name;

-- ============================================================
-- 第 10 區：Lake 湖泊狀態
-- ============================================================
SELECT '=== 第 10 區：Lake 湖泊狀態 ===' AS section;

SELECT
    l.id,
    f.name AS family_name,
    l.current_balance,
    l.dry_date,
    l.updated_at
FROM lake l
JOIN families f ON f.id = l.family_id;

-- ============================================================
-- 第 11 區：財務一致性驗證（計算值 vs 儲存值）
-- ============================================================
SELECT '=== 第 11 區：Pond A 餘額一致性驗證 ===' AS section;

SELECT
    p.display_name,
    pa.current_balance AS stored_balance,
    GREATEST(0,
        COALESCE((SELECT SUM(COALESCE(actual_amount, amount)) FROM income_items WHERE user_id = p.id AND status = 'confirmed'), 0)
        + COALESCE((SELECT SUM(amount) FROM transactions WHERE user_id = p.id AND destination = 'pond_a' AND type = 'transfer_from_pond_b'), 0)
        - COALESCE((SELECT SUM(amount) FROM transactions WHERE user_id = p.id AND source = 'pond_a' AND type IN ('transfer_to_lake','transfer_to_pond_b')), 0)
    ) AS calculated_balance,
    CASE
        WHEN ABS(
            pa.current_balance - GREATEST(0,
                COALESCE((SELECT SUM(COALESCE(actual_amount, amount)) FROM income_items WHERE user_id = p.id AND status = 'confirmed'), 0)
                + COALESCE((SELECT SUM(amount) FROM transactions WHERE user_id = p.id AND destination = 'pond_a' AND type = 'transfer_from_pond_b'), 0)
                - COALESCE((SELECT SUM(amount) FROM transactions WHERE user_id = p.id AND source = 'pond_a' AND type IN ('transfer_to_lake','transfer_to_pond_b')), 0)
            )
        ) < 1 THEN '✅ 一致'
        ELSE '❌ 不一致！有誤差'
    END AS check_result
FROM profiles p
JOIN pond_a pa ON pa.user_id = p.id
ORDER BY p.display_name;

SELECT '=== 第 11 區：Pond B 餘額一致性驗證 ===' AS section;

SELECT
    p.display_name,
    pb.current_balance AS stored_balance,
    (
        COALESCE((SELECT SUM(amount) * -1 FROM expense_items WHERE user_id = p.id AND status = 'completed'), 0)
        + COALESCE((SELECT SUM(amount) FROM transactions WHERE user_id = p.id AND destination = 'pond_b' AND type IN ('transfer_to_pond_b','lake_to_member')), 0)
        - COALESCE((SELECT SUM(amount) FROM transactions WHERE user_id = p.id AND source = 'pond_b' AND type IN ('transfer_to_lake','transfer_from_pond_b')), 0)
    ) AS calculated_balance,
    CASE
        WHEN ABS(
            pb.current_balance - (
                COALESCE((SELECT SUM(amount) * -1 FROM expense_items WHERE user_id = p.id AND status = 'completed'), 0)
                + COALESCE((SELECT SUM(amount) FROM transactions WHERE user_id = p.id AND destination = 'pond_b' AND type IN ('transfer_to_pond_b','lake_to_member')), 0)
                - COALESCE((SELECT SUM(amount) FROM transactions WHERE user_id = p.id AND source = 'pond_b' AND type IN ('transfer_to_lake','transfer_from_pond_b')), 0)
            )
        ) < 1 THEN '✅ 一致'
        ELSE '❌ 不一致！有誤差'
    END AS check_result
FROM profiles p
JOIN pond_b pb ON pb.user_id = p.id
ORDER BY p.display_name;

SELECT '=== 第 11 區：Lake 餘額一致性驗證 ===' AS section;

SELECT
    f.name AS family_name,
    l.current_balance AS stored_balance,
    GREATEST(0,
        COALESCE((SELECT SUM(amount) FROM transactions WHERE family_id = l.family_id AND type = 'transfer_to_lake'), 0)
        - COALESCE((SELECT SUM(amount) FROM transactions WHERE family_id = l.family_id AND type = 'lake_to_member'), 0)
        - COALESCE((SELECT SUM(amount) FROM transactions WHERE family_id = l.family_id AND type = 'lake_expense'), 0)
    ) AS calculated_balance,
    CASE
        WHEN ABS(l.current_balance - GREATEST(0,
            COALESCE((SELECT SUM(amount) FROM transactions WHERE family_id = l.family_id AND type = 'transfer_to_lake'), 0)
            - COALESCE((SELECT SUM(amount) FROM transactions WHERE family_id = l.family_id AND type = 'lake_to_member'), 0)
            - COALESCE((SELECT SUM(amount) FROM transactions WHERE family_id = l.family_id AND type = 'lake_expense'), 0)
        )) < 1 THEN '✅ 一致'
        ELSE '❌ 不一致！有誤差'
    END AS check_result
FROM lake l
JOIN families f ON f.id = l.family_id;

-- ============================================================
-- 第 12 區：最近 20 筆交易記錄
-- ============================================================
SELECT '=== 第 12 區：最近 20 筆 Transactions ===' AS section;

SELECT
    t.transaction_date,
    t.type,
    t.amount,
    t.source,
    t.destination,
    p.display_name AS member,
    t.note
FROM transactions t
LEFT JOIN profiles p ON p.id = t.user_id
ORDER BY t.created_at DESC
LIMIT 20;

-- ============================================================
-- 第 13 區：Realtime 訂閱狀態
-- ============================================================
SELECT '=== 第 13 區：Realtime 訂閱狀態 ===' AS section;

SELECT
    pt.tablename,
    CASE WHEN pt.tablename IS NOT NULL THEN '✅ 已加入 Realtime' ELSE '❌ 未訂閱' END AS realtime_status
FROM pg_publication_tables ppt
JOIN pg_tables pt ON pt.tablename = ppt.tablename
WHERE ppt.pubname = 'supabase_realtime'
  AND pt.schemaname = 'public'
ORDER BY pt.tablename;

-- ================================================================
-- 診斷完成！請查看各區的 ✅/❌ 標記來了解問題所在
-- ================================================================
