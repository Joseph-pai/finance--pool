import { LakeExpense, LakeRequest, DryPrediction, IncomeItem, ExpenseItem } from '@/types';
import { addDays, differenceInDays, parseISO, format, isBefore, isAfter } from 'date-fns';

/**
 * 截止日資金分析結果
 */
export interface BalanceToDateResult {
  end_date: string;
  starting_balance: number;
  total_inflow: number;
  total_outflow: number;
  ending_balance: number;
  /** true 表示充裕（ending_balance >= 0），false 表示缺口 */
  is_surplus: boolean;
  /** 正數 = 充裕結餘，負數 = 資金缺口 */
  gap_or_surplus_amount: number;
  events: { date: string; name: string; amount: number; type: 'inflow' | 'outflow' }[];
}

/**
 * 計算湖泊乾涸預測
 * @param currentBalance 當前湖泊餘額
 * @param lakeExpenses 湖泊計劃支出列表（管理員設定）
 * @param approvedRequests 已批准的成員調撥申請
 * @param incomeItems 所有收入項目（預計模式下使用）
 * @param mode 預估模式：'current' (當前餘額) 或 'estimated' (包含預估餘額)
 */
export function calculateLakeDryDate(
  currentBalance: number,
  lakeExpenses: LakeExpense[],
  approvedRequests: LakeRequest[],
  incomeItems: IncomeItem[] = [],
  mode: 'current' | 'estimated' = 'current',
  /** 自訂起始日期（預設為今天），讓用戶可以試算不同起始日的安全到期日 */
  fromDate?: Date
): DryPrediction {
  const today = fromDate ?? new Date();
  today.setHours(0, 0, 0, 0);

  // 合併所有未來收支事件，按日期排序
  const events: { date: string; name: string; amount: number; type: 'inflow' | 'outflow' }[] = [];

  // 1. 支出 (Outflows)
  lakeExpenses
    .filter(e => e.status === 'active' && e.amount > 0)
    .forEach(e => {
      events.push({ date: e.expected_date, name: e.name, amount: e.amount, type: 'outflow' });
      // 處理循環支出，預測未來365天
      if (e.is_recurring && e.recurrence_rule) {
        let nextDate = parseISO(e.expected_date);
        for (let i = 0; i < 24; i++) {
          if (e.recurrence_rule === 'monthly') {
            nextDate = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, nextDate.getDate());
          } else if (e.recurrence_rule === 'quarterly') {
            nextDate = new Date(nextDate.getFullYear(), nextDate.getMonth() + 3, nextDate.getDate());
          } else if (e.recurrence_rule === 'yearly') {
            nextDate = new Date(nextDate.getFullYear() + 1, nextDate.getMonth(), nextDate.getDate());
          }
          const futureDate = format(nextDate, 'yyyy-MM-dd');
          if (differenceInDays(nextDate, addDays(today, 365)) > 0) break;
          events.push({ date: futureDate, name: e.name, amount: e.amount, type: 'outflow' });
        }
      }
    });

  // 2. 申請 (Outflows)
  approvedRequests
    .filter(r => r.status === 'approved' && r.approved_date && r.approved_amount)
    .forEach(r => {
      events.push({
        date: r.approved_date!,
        name: `申請：${r.item_name}`,
        amount: r.approved_amount!,
        type: 'outflow',
      });
    });

  // 3. 預計收入 (Inflows - 僅在估算模式下)
  if (mode === 'estimated' && incomeItems) {
    incomeItems
      .filter(r => r.status === 'pending' && r.destination === 'lake' && r.amount > 0)
      .forEach(r => {
        events.push({
          date: r.expected_date,
          name: `預計收入：${r.name}`,
          amount: r.amount,
          type: 'inflow',
        });
      });
  }

  // 只取未來的事件，按日期升序排序。若日期相同，則流入(inflow)優先，避免假乾涸
  const todayStr = format(today, 'yyyy-MM-dd');
  const futureEvents = events
    .filter(e => e.date >= todayStr)
    .sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      if (a.type === b.type) return 0;
      return a.type === 'inflow' ? -1 : 1; // inflow comes first
    });

  // 累計計算，找到餘額歸零的日期
  let remaining = currentBalance;
  const scheduled: (DryPrediction['scheduled_outflows'][0] & { type?: 'inflow' | 'outflow' })[] = [];
  let dryDate: string | null = null;
  let deficitAtDryDate = 0; // 在乾涸日當天記錄短缺金額
  let lastOutflowDate: string | null = null; // 追蹤上一筆支出日

  for (const event of futureEvents) {
    if (event.type === 'inflow') {
      remaining += event.amount;
    } else {
      remaining -= event.amount;
    }

    scheduled.push({
      date: event.date,
      name: event.name,
      amount: event.amount,
      cumulative: currentBalance - remaining, // 累計淨支出
      type: event.type,
    } as any);

    if (remaining < 0 && !dryDate) {
      // 乾涸日 = 付款後剩餘不足以支付下一筆支出的那天（即上一筆支出日）
      dryDate = lastOutflowDate ?? event.date;
      deficitAtDryDate = Math.abs(remaining); // 記錄短缺金額
    }

    // 記錄本筆支出日，供下次迭代判斷「上一筆支出」
    if (event.type === 'outflow') {
      lastOutflowDate = event.date;
    }
  }

  if (dryDate) {
    const daysRemaining = differenceInDays(parseISO(dryDate), today);
    return {
      dry_date: dryDate,
      days_remaining: daysRemaining,
      warning_level: getWarningLevel(daysRemaining),
      scheduled_outflows: scheduled,
      deficit_amount: deficitAtDryDate,
    };
  }


  // 沒有找到乾涸日期
  return {
    dry_date: null,
    days_remaining: null,
    warning_level: 'safe',
    scheduled_outflows: scheduled,
    deficit_amount: 0,
  };

}

function getWarningLevel(days: number): DryPrediction['warning_level'] {
  if (days < 15) return 'critical';
  if (days < 30) return 'danger';
  if (days < 60) return 'warning';
  return 'safe';
}

/**
 * 格式化台幣金額
 */
export function formatTWD(amount: number): string {
  return `$${Math.round(amount).toLocaleString('zh-TW')}`;
}

/**
 * 計算水位百分比（0~100）
 * @param balance 當前餘額
 * @param maxBalance 參考最大值（用於顯示比例）
 */
export function calcWaterLevel(balance: number, maxBalance: number): number {
  if (maxBalance <= 0) return 0;
  return Math.min(100, Math.max(0, (balance / maxBalance) * 100));
}

/**
 * 計算從今天到截止日期間，湖泊的資金缺口或充裕結餘
 * @param currentBalance 當前湖泊餘額（當前模式使用）
 * @param lakeExpenses 湖泊計劃支出列表
 * @param approvedRequests 已批准的成員調撥申請
 * @param incomeItems 所有收入項目
 * @param endDate 截止日期（用戶選擇）
 * @param expenseItems 所有個人計劃支出（含 source='lake' 的支出）
 * @param mode 模式: 'current' (起始=當前餘額) 或 'estimated' (起始=預估餘額)
 * @param pendingLakeIncomeTotal 待入帳收入合計（用於起始餘額調整）
 * @param activeLakeExpensesTotal 啟用中支出合計（用於起始餘額調整）
 * @param approvedRequestsTotal 已批准申請合計（用於起始餘額調整）
 */
export function calculateLakeBalanceToDate(
  currentBalance: number,
  lakeExpenses: LakeExpense[],
  approvedRequests: LakeRequest[],
  incomeItems: IncomeItem[],
  endDate: Date,
  expenseItems: ExpenseItem[] = [],
  mode: 'current' | 'estimated' = 'current',
  pendingLakeIncomeTotal: number = 0,
  activeLakeExpensesTotal: number = 0,
  approvedRequestsTotal: number = 0,
): BalanceToDateResult {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = format(today, 'yyyy-MM-dd');
  const endStr = format(endDate, 'yyyy-MM-dd');

  // 合併所有收支事件，按日期排序
  const events: { date: string; name: string; amount: number; type: 'inflow' | 'outflow' }[] = [];

  // 計算起始餘額
  const startingBalance = mode === 'estimated'
    ? (currentBalance + pendingLakeIncomeTotal - activeLakeExpensesTotal - approvedRequestsTotal)
    : currentBalance;

  // 1. 支出 (Outflows) — 固定支出（管理員設定的家庭必要支出）
  lakeExpenses
    .filter(e => e.status === 'active' && e.amount > 0)
    .forEach(e => {
      // 預估模式下，首次支出已含在起始餘額中，所以只加第 2 次以後的循環
      const isFirst = (e.expected_date >= todayStr && e.expected_date <= endStr);
      if (isFirst && mode !== 'estimated') {
        events.push({ date: e.expected_date, name: e.name, amount: e.amount, type: 'outflow' });
      }
      // 處理循環支出（第 2 次以後）
      if (e.is_recurring && e.recurrence_rule) {
        let nextDate = parseISO(e.expected_date);
        for (let i = 0; i < 48; i++) {
          if (e.recurrence_rule === 'monthly') {
            nextDate = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, nextDate.getDate());
          } else if (e.recurrence_rule === 'quarterly') {
            nextDate = new Date(nextDate.getFullYear(), nextDate.getMonth() + 3, nextDate.getDate());
          } else if (e.recurrence_rule === 'yearly') {
            nextDate = new Date(nextDate.getFullYear() + 1, nextDate.getMonth(), nextDate.getDate());
          }
          const futureDate = format(nextDate, 'yyyy-MM-dd');
          if (futureDate > endStr) break;
          if (futureDate >= todayStr) {
            events.push({ date: futureDate, name: e.name, amount: e.amount, type: 'outflow' });
          }
        }
      }
    });

  // 2. 個人計劃支出 (Outflows) — source='lake' 且狀態為 planned/approved（含循環）
  expenseItems
    .filter(e => e.source === 'lake' && (e.status === 'planned' || e.status === 'approved') && e.amount > 0)
    .forEach(e => {
      // 預估模式下，首次支出已含在起始餘額中
      const isFirst = (e.expected_date >= todayStr && e.expected_date <= endStr);
      if (isFirst && mode !== 'estimated') {
        events.push({ date: e.expected_date, name: e.name, amount: e.amount, type: 'outflow' });
      }
      // 處理循環支出（第 2 次以後）
      if (e.is_recurring && e.recurrence_rule) {
        let nextDate = parseISO(e.expected_date);
        for (let i = 0; i < 48; i++) {
          if (e.recurrence_rule === 'monthly') {
            nextDate = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, nextDate.getDate());
          } else if (e.recurrence_rule === 'quarterly') {
            nextDate = new Date(nextDate.getFullYear(), nextDate.getMonth() + 3, nextDate.getDate());
          } else if (e.recurrence_rule === 'yearly') {
            nextDate = new Date(nextDate.getFullYear() + 1, nextDate.getMonth(), nextDate.getDate());
          }
          const futureDate = format(nextDate, 'yyyy-MM-dd');
          if (futureDate > endStr) break;
          if (futureDate >= todayStr) {
            events.push({ date: futureDate, name: e.name, amount: e.amount, type: 'outflow' });
          }
        }
      }
    });

  // 3. 已批准的申請 (Outflows) — 預估模式下已含在起始餘額中
  if (mode !== 'estimated') {
    approvedRequests
      .filter(r => r.status === 'approved' && r.approved_date && r.approved_amount)
      .forEach(r => {
        const d = r.approved_date!;
        if (d >= todayStr && d <= endStr) {
          events.push({
            date: d,
            name: `申請：${r.item_name}`,
            amount: r.approved_amount!,
            type: 'outflow',
          });
        }
      });
  }

  // 4. 預計收入 (Inflows) — 預估模式下已含在起始餘額中
  if (mode !== 'estimated') {
    incomeItems
      .filter(inc => inc.status === 'pending' && inc.destination === 'lake' && inc.amount > 0)
      .forEach(inc => {
        const d = inc.expected_date;
        if (d >= todayStr && d <= endStr) {
          events.push({
            date: d,
            name: `預計收入：${inc.name}`,
            amount: inc.amount,
            type: 'inflow',
          });
        }
      });
  }

  // 按日期排序
  events.sort((a, b) => a.date.localeCompare(b.date));

  // 從起始餘額開始，累計計算
  let remaining = startingBalance;
  let totalInflow = 0;
  let totalOutflow = 0;

  for (const event of events) {
    if (event.type === 'inflow') {
      remaining += event.amount;
      totalInflow += event.amount;
    } else {
      remaining -= event.amount;
      totalOutflow += event.amount;
    }
  }

  return {
    end_date: endStr,
    starting_balance: startingBalance,
    total_inflow: totalInflow,
    total_outflow: totalOutflow,
    ending_balance: remaining,
    is_surplus: remaining >= 0,
    gap_or_surplus_amount: remaining,
    events,
  };
}
