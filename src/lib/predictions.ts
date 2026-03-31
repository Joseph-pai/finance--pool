import { LakeExpense, LakeRequest, DryPrediction } from '@/types';
import { addDays, differenceInDays, parseISO, format } from 'date-fns';

/**
 * 計算湖泊乾涸預測
 * @param currentBalance 當前湖泊餘額
 * @param lakeExpenses 湖泊計劃支出列表（管理員設定）
 * @param approvedRequests 已批准的成員調撥申請
 */
export function calculateLakeDryDate(
  currentBalance: number,
  lakeExpenses: LakeExpense[],
  approvedRequests: LakeRequest[]
): DryPrediction {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 合併所有未來出水事件，按日期排序
  const outflows: { date: string; name: string; amount: number }[] = [];

  lakeExpenses
    .filter(e => e.status === 'active' && e.amount > 0)
    .forEach(e => {
      outflows.push({ date: e.expected_date, name: e.name, amount: e.amount });
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
          outflows.push({ date: futureDate, name: e.name, amount: e.amount });
        }
      }
    });

  approvedRequests
    .filter(r => r.status === 'approved' && r.approved_date && r.approved_amount)
    .forEach(r => {
      outflows.push({
        date: r.approved_date!,
        name: `申請：${r.item_name}`,
        amount: r.approved_amount!,
      });
    });

  // 只取未來的支出，按日期升序
  const futureOutflows = outflows
    .filter(o => o.date >= format(today, 'yyyy-MM-dd'))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 累計計算，找到餘額歸零的日期
  let remaining = currentBalance;
  const scheduled: DryPrediction['scheduled_outflows'] = [];

  for (const outflow of futureOutflows) {
    remaining -= outflow.amount;
    scheduled.push({
      date: outflow.date,
      name: outflow.name,
      amount: outflow.amount,
      cumulative: currentBalance - remaining,
    });
    if (remaining <= 0) {
      const dryDate = outflow.date;
      const daysRemaining = differenceInDays(parseISO(dryDate), today);
      return {
        dry_date: dryDate,
        days_remaining: daysRemaining,
        warning_level: getWarningLevel(daysRemaining),
        scheduled_outflows: scheduled,
      };
    }
  }

  // 沒有找到乾涸日期
  return {
    dry_date: null,
    days_remaining: null,
    warning_level: 'safe',
    scheduled_outflows: scheduled,
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
