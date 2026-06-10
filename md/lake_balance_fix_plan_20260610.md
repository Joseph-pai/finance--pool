# 修復湖泊「調整餘額」功能 — 完整修改計劃

## 問題背景

**根本原因**：畫面顯示的湖泊餘額（`computedLakeBalance`）是從 `transactions` + `income_items` **動態計算**的，但 `handleSetBalance` 只更新 `lake.current_balance` 欄位，而這個欄位根本沒有被計算邏輯讀取。結果：資料庫更新了，畫面紋絲不動。

---

## 技術方案

**寫入「校正交易」（`lake_balance_adjustment`）**：計算出 delta（新值 − 現有值），將差額以特殊 transaction type 寫入 `transactions` 表。
- 計算邏輯只需額外讀取這類交易，畫面立刻反映
- 不需修改資料庫 schema
- 有完整稽核記錄

---

## 正確業務邏輯確認

| 操作 | 說明 |
|------|------|
| 調整**當前餘額** | 計算 `delta = 目標值 − computedLakeBalance`，寫入校正交易 |
| 調整**預估餘額** | 計算 `delta = 目標值 − estimatedLakeBalance`，寫入校正交易（delta 會影響當前餘額基礎） |
| 金額增加 | delta > 0 → `source: 'adjustment_add'`，正數加到餘額 |
| 金額減少 | delta < 0 → `source: 'adjustment_subtract'`，負數從餘額扣除 |
| **減少時的衝突檢查** | 若新餘額 < 已批准申請合計 + 已注入收入池待確認合計，則提示警告，列出衝突項目 |
| 10% 榮耀湖泊 | **不自動扣除**，此為內部調控 |

---

## 修改範圍（3 個檔案）

---

### 一、[MODIFY] `src/app/lake/page.tsx`

#### 1. 新增 State 變數

```ts
const [balanceType, setBalanceType] = useState<'current' | 'estimated'>('current');
const [balanceStep, setBalanceStep] = useState<1 | 2>(1); // 1=選類型, 2=輸入數值
const [conflictWarning, setConflictWarning] = useState<{
  approvedRequests: LakeRequest[];
  injectedIncomes: IncomeItem[];
  totalConflict: number;
} | null>(null);
```

#### 2. 修改 `computedLakeBalance` 計算（在 `load()` 函式內）

在現有計算後面加入讀取校正交易：

```ts
const computedLakeBalance = Math.max(0,
  // ...現有計算（transfer_to_lake, transfer_from_pond_b, income confirmed, etc.）...

  // ✅ 新增：讀取管理員校正交易
  + txData
      .filter(t => t.type === 'lake_balance_adjustment' && t.source === 'adjustment_add')
      .reduce((sum, t) => sum + t.amount, 0)
  - txData
      .filter(t => t.type === 'lake_balance_adjustment' && t.source === 'adjustment_subtract')
      .reduce((sum, t) => sum + t.amount, 0)
);
```

#### 3. 修改 `handleSetBalance` 函式

```ts
const handleSetBalance = async () => {
  if (!lake || !newBalance || !profile?.family_id) return;
  setSaving(true);

  const targetValue = Number(newBalance);
  const baseValue = balanceType === 'current' ? computedLakeBalance : estimatedLakeBalance;
  const delta = targetValue - baseValue;

  // 若沒有變化，直接關閉
  if (delta === 0) {
    setModal(null);
    setNewBalance('');
    setSaving(false);
    return;
  }

  // 寫入校正交易
  const { error } = await supabase.from('transactions').insert({
    family_id: profile.family_id,
    user_id: profile.id,
    type: 'lake_balance_adjustment',
    amount: Math.abs(delta),
    source: delta > 0 ? 'adjustment_add' : 'adjustment_subtract',
    destination: 'lake',
    note: `管理員調整${balanceType === 'current' ? '當前' : '預估'}餘額（${formatTWD(baseValue)} → ${formatTWD(targetValue)}，差額 ${delta > 0 ? '+' : ''}${formatTWD(delta)}）`,
    transaction_date: new Date().toISOString().substring(0, 10),
  });

  if (error) {
    alert('更新失敗：' + error.message);
    setSaving(false);
    return;
  }

  setSaving(false);
  setModal(null);
  setNewBalance('');
  setBalanceStep(1);
  setConflictWarning(null);
  load();
};
```

#### 4. 新增衝突檢查函式（減少餘額時觸發）

在使用者輸入數值後按「下一步」或「確認更新」前，先檢查：

```ts
const checkConflicts = (targetValue: number) => {
  const baseValue = balanceType === 'current' ? computedLakeBalance : estimatedLakeBalance;
  const delta = targetValue - baseValue;

  if (delta >= 0) {
    // 增加餘額，沒有衝突
    setConflictWarning(null);
    return;
  }

  // 減少餘額：檢查已批准申請
  const approvedRequests = lakeRequests; // 已批准狀態的申請
  const approvedTotal = approvedRequests.reduce(
    (sum, r) => sum + (r.approved_amount ?? r.requested_amount), 0
  );

  // 已注入收入池但尚未確認到帳的 income_items（source='lake', status='pending'）
  const injectedIncomes = incomes.filter(
    i => i.source === 'lake' && i.status === 'pending'
  );
  const injectedTotal = injectedIncomes.reduce((sum, i) => sum + i.amount, 0);

  const totalConflict = approvedTotal + injectedTotal;

  if (targetValue < totalConflict) {
    setConflictWarning({ approvedRequests, injectedIncomes, totalConflict });
  } else {
    setConflictWarning(null);
  }
};
```

#### 5. 彈窗 UI 改為兩步驟

**第一步：選擇調整類型**

```
┌─ 調整湖泊餘額 ────────────────────────────────────────────┐
│  請選擇要調整的餘額類型：                                  │
│                                                            │
│  ◉ 調整當前餘額    當前：$100,000                         │
│    （實際已確認收入 − 支出）                               │
│                                                            │
│  ○ 調整預估餘額    預估：$90,000                          │
│    （含待入帳收入、已批准申請、啟用中支出）                │
│                                                            │
│                            [取消]  [下一步 →]             │
└────────────────────────────────────────────────────────────┘
```

**第二步：輸入目標數值**

```
┌─ 調整當前餘額 ─────────────────────────────────────────────┐
│  目前當前餘額：$100,000                                    │
│                                                            │
│  目標金額（台幣）：[__________]                           │
│                                                            │
│  ← 輸入後即時顯示差額                                      │
│  例：輸入 80,000 → 將減少 $20,000                         │
│      輸入 120,000 → 將增加 $20,000                        │
│                                                            │
│  ⚠️ [衝突警告區塊（如有）]                                 │
│                                                            │
│  ⚠️ 此操作不會自動扣除10%到榮耀歸於主湖泊                 │
│                                                            │
│           [← 上一步]  [取消]  [確認更新]                  │
└────────────────────────────────────────────────────────────┘
```

**衝突警告 UI（當減少後餘額不足時顯示）**

```
┌─ ⚠️ 餘額不足警告 ─────────────────────────────────────────┐
│  調整後湖泊餘額（$80,000）低於以下待付項目合計（$95,000）  │
│  建議先處理以下項目再調整：                                │
│                                                            │
│  📋 已批准調撥申請（共 $50,000）：                        │
│   • 小明 — 買電腦  $30,000（2026/06/15 到帳）             │
│   • 小花 — 旅遊費  $20,000（2026/07/01 到帳）             │
│                                                            │
│  💸 已注入收入池待確認（共 $45,000）：                    │
│   • 小明 — 湖泊資金撥入  $45,000（待確認）                │
│                                                            │
│  您仍可選擇強制確認更新（餘額將為負數風險）。              │
│                                                            │
│  [取消]  [強制確認（不建議）]                              │
└────────────────────────────────────────────────────────────┘
```

---

### 二、[MODIFY] `src/app/dashboard/page.tsx`

在 `loadDashboard()` 的 `computedLakeBalance` 計算中，同步加入讀取校正交易：

```ts
const computedLakeBalance = Math.max(0,
  // ...現有計算...

  // ✅ 新增：讀取管理員校正交易
  + transactionsData
      .filter(t => t.type === 'lake_balance_adjustment' && t.source === 'adjustment_add')
      .reduce((sum, t) => sum + t.amount, 0)
  - transactionsData
      .filter(t => t.type === 'lake_balance_adjustment' && t.source === 'adjustment_subtract')
      .reduce((sum, t) => sum + t.amount, 0)
);
```

---

### 三、[MODIFY] `src/types/index.ts`

在 `TransactionType` 中加入新類型：

```ts
// 修改前：
export type TransactionType = 'income' | 'expense' | 'transfer_to_lake' | 'lake_expense' | 'lake_to_member' | 'transfer_to_pond_b' | 'transfer_from_pond_b' | 'honor_contribution' | 'honor_expense';

// 修改後：
export type TransactionType = 'income' | 'expense' | 'transfer_to_lake' | 'lake_expense' | 'lake_to_member' | 'transfer_to_pond_b' | 'transfer_from_pond_b' | 'honor_contribution' | 'honor_expense' | 'lake_balance_adjustment';
```

---

## 不需要修改的部分

| 檔案 | 原因 |
|------|------|
| `predictions.ts` | 以 `computedLakeBalance` 為輸入，修正後自動反映 |
| `requests/page.tsx` | 管理員已可在此頁手動退回申請，不需額外修改 |
| 資料庫 schema | `transactions.type` 是 `text` 欄位，直接支援新類型 |
| 10% 榮耀湖泊扣除 | 本次不實作，確認為內部調控 |

---

## 完整操作流程

```
管理員點擊「調整餘額」
         ↓
   Step 1：選擇類型
   ┌─ 當前餘額 ─┐  or  ┌─ 預估餘額 ─┐
   └───────────┘       └───────────┘
         ↓
   Step 2：輸入目標數值
         ↓
   即時顯示差額（增加/減少）
         ↓
   [若減少] → 衝突檢查
        ├─ 無衝突 → 正常顯示確認按鈕
        └─ 有衝突 → 顯示衝突清單 + 強制確認選項
         ↓
   確認更新
         ↓
   寫入 lake_balance_adjustment 交易（delta 差額）
         ↓
   load() 重新計算，畫面即時更新
   （湖泊管理頁 + 總覽 Dashboard 同步更新）
```

---

## 驗證計劃

### 情境 1：增加餘額
1. 當前餘額 $100,000 → 調整至 $120,000
2. 確認：湖泊管理頁當前餘額顯示 $120,000 ✅
3. 確認：Dashboard 湖泊卡片更新 ✅
4. 確認：乾涸預測重新計算 ✅

### 情境 2：減少餘額（無衝突）
1. 當前餘額 $100,000 → 調整至 $80,000（無待付申請）
2. 確認：直接更新，無警告 ✅

### 情境 3：減少餘額（有衝突）
1. 當前餘額 $100,000，已有 $95,000 的批准申請
2. 調整至 $80,000
3. 確認：顯示衝突警告，列出具體申請項目 ✅
4. 選擇強制確認 → 仍可更新 ✅

### 情境 4：調整預估餘額
1. 預估餘額 $90,000 → 調整至 $70,000
2. 確認：預估餘額顯示 $70,000 ✅
3. 確認：當前餘額也因 delta 而調整 ✅
