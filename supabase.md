# Supabase 資料庫與權限設定指南

這份文件記錄了 **FamilyPool** 應用程式在 Supabase 上初始化資料庫的所有步驟與對應的 SQL 命令。

## 步驟一：執行初始化 SQL 指令

請登入您的 [Supabase 主控台](https://supabase.com/dashboard/)，進入您的專案後，點選左側選單的 **SQL Editor**。
接著點擊 **New Query**，將下方所有的 SQL 區塊完整複製，貼上並點擊 **Run**。

這些指令會為您建立：
- 11 張專案所需的關聯式資料表
- 所有的 `updated_at` 自動更新觸發器（Triggers）
- 行級安全政策（Row Level Security, RLS），確保成員無法越權讀寫他人資料
- 開啟 Realtime 廣播（Supabase Realtime），使得網頁端水波動畫能即時同步

```sql
-- FamilyPool 資料庫 Migration
-- 執行順序：在 Supabase SQL Editor 中執行此文件

-- ============================================================
-- 1. families（家庭）
-- ============================================================
CREATE TABLE IF NOT EXISTS families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. profiles（用戶資料，關聯 auth.users）
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  family_id UUID REFERENCES families(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'lake_manager', 'member')) DEFAULT 'member',
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. lake（湖泊，每個家庭一個）
-- ============================================================
CREATE TABLE IF NOT EXISTS lake (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  current_balance NUMERIC(15,0) NOT NULL DEFAULT 0,
  dry_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(family_id)
);

-- ============================================================
-- 4. pond_a（個人收入池）
-- ============================================================
CREATE TABLE IF NOT EXISTS pond_a (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  current_balance NUMERIC(15,0) NOT NULL DEFAULT 0,
  dry_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ============================================================
-- 5. pond_b（個人支出池）
-- ============================================================
CREATE TABLE IF NOT EXISTS pond_b (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  current_balance NUMERIC(15,0) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ============================================================
-- 6. income_items（收入項目）
-- ============================================================
CREATE TABLE IF NOT EXISTS income_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  expected_date DATE NOT NULL,
  amount NUMERIC(15,0) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'failed')) DEFAULT 'pending',
  actual_amount NUMERIC(15,0),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 7. expense_items（支出項目）
-- ============================================================
CREATE TABLE IF NOT EXISTS expense_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  expected_date DATE NOT NULL,
  amount NUMERIC(15,0) NOT NULL CHECK (amount > 0),
  source TEXT NOT NULL CHECK (source IN ('pond_a', 'lake')) DEFAULT 'pond_a',
  status TEXT NOT NULL CHECK (status IN ('planned', 'approved', 'rejected', 'completed')) DEFAULT 'planned',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8. lake_expenses（湖泊必要支出，管理員管理）
-- ============================================================
CREATE TABLE IF NOT EXISTS lake_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  expected_date DATE NOT NULL,
  amount NUMERIC(15,0) NOT NULL CHECK (amount > 0),
  is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
  recurrence_rule TEXT CHECK (recurrence_rule IN ('monthly', 'quarterly', 'yearly')),
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed')) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 9. lake_requests（湖泊調撥申請）
-- ============================================================
CREATE TABLE IF NOT EXISTS lake_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  requested_amount NUMERIC(15,0) NOT NULL CHECK (requested_amount > 0),
  requested_date DATE NOT NULL,
  reason TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  approved_amount NUMERIC(15,0),
  approved_date DATE,
  admin_note TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 10. transactions（實際流水記錄）
-- ============================================================
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer_to_lake', 'lake_expense', 'lake_to_member')),
  amount NUMERIC(15,0) NOT NULL,
  source TEXT CHECK (source IN ('lake', 'pond_a', 'pond_b')),
  destination TEXT CHECK (destination IN ('lake', 'pond_a', 'pond_b')),
  reference_id UUID,
  note TEXT,
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 11. notifications（通知）
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  reference_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- updated_at 自動更新觸發器
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lake_updated_at BEFORE UPDATE ON lake FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_pond_a_updated_at BEFORE UPDATE ON pond_a FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_pond_b_updated_at BEFORE UPDATE ON pond_b FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_income_updated_at BEFORE UPDATE ON income_items FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_expense_updated_at BEFORE UPDATE ON expense_items FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_lake_expense_updated_at BEFORE UPDATE ON lake_expenses FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_lake_request_updated_at BEFORE UPDATE ON lake_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Row Level Security (RLS) 安全層規則
-- ============================================================
ALTER TABLE families ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE lake ENABLE ROW LEVEL SECURITY;
ALTER TABLE pond_a ENABLE ROW LEVEL SECURITY;
ALTER TABLE pond_b ENABLE ROW LEVEL SECURITY;
ALTER TABLE income_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE lake_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE lake_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Helper function: 取得當前用戶的 family_id
CREATE OR REPLACE FUNCTION get_my_family_id()
RETURNS UUID AS $$
  SELECT family_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function: 判斷當前用戶是否為 admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin');
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function: 判斷當前用戶是否為湖泊管理者 (Admin 也具備此權限)
CREATE OR REPLACE FUNCTION is_lake_manager()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'lake_manager'));
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- families: 同家庭成員可讀，admin 可改
CREATE POLICY "family_read" ON families FOR SELECT USING (id = get_my_family_id());
CREATE POLICY "family_admin_write" ON families FOR ALL USING (id = get_my_family_id() AND is_admin());

-- profiles: 同家庭所有人可讀；只能自己或 admin 改
CREATE POLICY "profiles_read" ON profiles FOR SELECT USING (family_id = get_my_family_id());
CREATE POLICY "profiles_self_update" ON profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "profiles_admin_all" ON profiles FOR ALL USING (is_admin());

-- lake: 同家庭所有人可讀；admin 可寫
CREATE POLICY "lake_read" ON lake FOR SELECT USING (family_id = get_my_family_id());
CREATE POLICY "lake_admin_write" ON lake FOR ALL USING (family_id = get_my_family_id() AND is_admin());

-- pond_a, pond_b: 同家庭所有人可讀；只能自己寫自己的（Admin 可全改）
CREATE POLICY "pond_a_read" ON pond_a FOR SELECT USING (family_id = get_my_family_id());
CREATE POLICY "pond_a_self_write" ON pond_a FOR ALL USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "pond_b_read" ON pond_b FOR SELECT USING (family_id = get_my_family_id());
CREATE POLICY "pond_b_self_write" ON pond_b FOR ALL USING (user_id = auth.uid() OR is_admin());

-- income_items: 同家庭所有人可讀；只能自己寫自己的（Admin 可全改）
CREATE POLICY "income_read" ON income_items FOR SELECT USING (family_id = get_my_family_id());
CREATE POLICY "income_write" ON income_items FOR ALL USING (user_id = auth.uid() OR is_admin());

-- expense_items: 同家庭所有人可讀；只能自己寫自己的（Admin 可全改）
CREATE POLICY "expense_read" ON expense_items FOR SELECT USING (family_id = get_my_family_id());
CREATE POLICY "expense_write" ON expense_items FOR ALL USING (user_id = auth.uid() OR is_admin());

-- lake_expenses: 同家庭所有人可讀；admin/manager 可寫
CREATE POLICY "lake_expenses_read" ON lake_expenses FOR SELECT USING (family_id = get_my_family_id());
CREATE POLICY "lake_expenses_manager_write" ON lake_expenses FOR ALL USING (family_id = get_my_family_id() AND is_lake_manager());

-- lake_requests: 同家庭所有人可讀；自己可新增；admin/manager 可審批（UPDATE）
CREATE POLICY "lake_requests_read" ON lake_requests FOR SELECT USING (family_id = get_my_family_id());
CREATE POLICY "lake_requests_self_insert" ON lake_requests FOR INSERT WITH CHECK (requester_id = auth.uid());
CREATE POLICY "lake_requests_self_update" ON lake_requests FOR UPDATE USING (requester_id = auth.uid() AND status = 'pending');
CREATE POLICY "lake_requests_manager_update" ON lake_requests FOR UPDATE USING (is_lake_manager());

-- transactions: 同家庭所有人可讀；系統寫入（service role）
CREATE POLICY "transactions_read" ON transactions FOR SELECT USING (family_id = get_my_family_id());

-- notifications: 只能看自己的
CREATE POLICY "notifications_self" ON notifications FOR ALL USING (user_id = auth.uid());

-- ============================================================
-- Realtime 訂閱開放（啟動即時資料更新）
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE lake;
ALTER PUBLICATION supabase_realtime ADD TABLE pond_a;
ALTER PUBLICATION supabase_realtime ADD TABLE pond_b;
ALTER PUBLICATION supabase_realtime ADD TABLE lake_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
```

---

## 步驟二：建立第一位「管理員 (Admin)」帳號

因為應用程式沒有開放自由註冊，所以您需要依照下列步驟於後台建立第一位具有最高權限的主帳號。

1. **建立 Auth 驗證帳號**
   點擊左側導覽列的 **Authentication** > 點選 **Add User** > 選擇 **Create new user**，建立您的「電子郵件」與「密碼」。

2. **建立 家庭 (Family)**
   點擊左側導覽列的 **Table Editor** > 選擇 `families` 表格，點擊左上角的 **Insert row** 新增一筆記錄。
   - `name`: 輸入您家人的姓氏或名稱（例如 `我的家庭`）
   完成後點擊儲存，然後**記下系統自動產生的 `id` (family_id)**。

3. **建立 成員資料 (Profile) 並指派管理員權限**
   點擊左側導覽列的 **Table Editor** > 選擇 `profiles` 表格，點擊左上角的 **Insert row**：
   - `id`: 請填入步驟 1 中 Authentication 區域產生的 Auth User ID
   - `family_id`: 請填入步驟 2 中記下來的 家庭 ID
   - `display_name`: 輸入您的稱謂（例如：爸爸）
   - `role`: **請務必輸入 `admin`** （注意皆為小寫）
   
   > 💡 完成後，只要透過這個 Email 登入前台，就可以利用站內的「設定 > 帳戶管理」直接幫其他成員開新帳號了。
