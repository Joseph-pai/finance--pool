-- ==========================================
-- Migration 009: 支持湖泊注入收入池(Pond A) (無須自動扣除)
-- ==========================================

-- 幫 income_items 加上來源標記
-- 這個標記只是為了讓我們知道這筆收入來自湖泊 (lake) 還是外部 (external)
ALTER TABLE income_items ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'external' CHECK (source IN ('external', 'lake'));

-- 如果之前已經建立了不必要的 trigger（例如你在討論間草擬的版本），這裡將它清除確保安全
DROP TRIGGER IF EXISTS trg_lake_income_confirmed ON income_items;
DROP FUNCTION IF EXISTS fn_trigger_lake_income_confirmed();
