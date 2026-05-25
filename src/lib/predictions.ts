import { LakeExpense, LakeRequest, DryPrediction, IncomeItem } from '@/types';
import { addDays, differenceInDays, parseISO, format } from 'date-fns';

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
  mode: 'current' | 'estimated' = 'current'
): DryPrediction {
  const today = new Date();
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

    if (remaining <= 0 && !dryDate) {
      dryDate = event.date;
    }
  }

  if (dryDate) {
    const daysRemaining = differenceInDays(parseISO(dryDate), today);
    // 計算到期時資金短缺金額（remaining 為負值代表短缺）
    const deficitAmount = remaining < 0 ? Math.abs(remaining) : 0;
    return {
      dry_date: dryDate,
      days_remaining: daysRemaining,
      warning_level: getWarningLevel(daysRemaining),
      scheduled_outflows: scheduled,
      deficit_amount: deficitAmount,
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
