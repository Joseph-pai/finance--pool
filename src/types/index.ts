// TypeScript 類型定義 — FamilyPool APP

export type UserRole = 'admin' | 'lake_manager' | 'member';

export type IncomeStatus = 'pending' | 'confirmed' | 'failed';
export type ExpenseSource = 'pond_a' | 'lake';
export type ExpenseStatus = 'planned' | 'approved' | 'rejected' | 'completed';
export type RequestStatus = 'pending' | 'approved' | 'rejected';
export type TransactionType = 'income' | 'expense' | 'transfer_to_lake' | 'lake_expense' | 'lake_to_member' | 'transfer_to_pond_b' | 'transfer_from_pond_b';
export type RecurrenceRule = 'monthly' | 'quarterly' | 'yearly';
export type LakeExpenseStatus = 'active' | 'paused' | 'completed';
export type NotificationSource = 'lake' | 'pond_a' | 'pond_b';

export interface Family {
  id: string;
  name: string;
  created_at: string;
}

export interface Profile {
  id: string;
  family_id: string;
  display_name: string;
  role: UserRole;
  avatar_url?: string;
  created_at: string;
}

export interface Lake {
  id: string;
  family_id: string;
  current_balance: number;
  dry_date?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PondA {
  id: string;
  user_id: string;
  family_id: string;
  current_balance: number;
  dry_date?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PondB {
  id: string;
  user_id: string;
  family_id: string;
  current_balance: number;
  created_at: string;
  updated_at: string;
}

export interface IncomeItem {
  id: string;
  user_id: string;
  family_id: string;
  name: string;
  expected_date: string;
  amount: number;
  status: IncomeStatus;
  source?: 'external' | 'lake';
  actual_amount?: number | null;
  confirmed_at?: string | null;
  created_at: string;
  updated_at: string;
  profile?: Profile;
}

export interface ExpenseItem {
  id: string;
  user_id: string;
  family_id: string;
  name: string;
  expected_date: string;
  amount: number;
  source: ExpenseSource;
  status: ExpenseStatus;
  created_at: string;
  updated_at: string;
  profile?: Profile;
}

export interface LakeExpense {
  id: string;
  family_id: string;
  name: string;
  expected_date: string;
  amount: number;
  is_recurring: boolean;
  recurrence_rule?: RecurrenceRule | null;
  status: LakeExpenseStatus;
  created_at: string;
  updated_at: string;
}

export interface LakeRequest {
  id: string;
  requester_id: string;
  family_id: string;
  item_name: string;
  requested_amount: number;
  requested_date: string;
  reason?: string;
  status: RequestStatus;
  approved_amount?: number | null;
  approved_date?: string | null;
  admin_note?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  updated_at: string;
  profile?: Profile;
}

export interface Transaction {
  id: string;
  family_id: string;
  user_id?: string;
  type: TransactionType;
  amount: number;
  source?: NotificationSource | null;
  destination?: NotificationSource | null;
  reference_id?: string | null;
  note?: string;
  transaction_date: string;
  created_at: string;
  profile?: Profile;
}

export interface Notification {
  id: string;
  user_id: string;
  family_id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  reference_id?: string | null;
  created_at: string;
}

// 乾涸預測計算結果
export interface DryPrediction {
  dry_date: string | null;       // 預計乾涸日期，null 表示不會乾涸
  days_remaining: number | null; // 剩餘天數
  warning_level: 'safe' | 'warning' | 'danger' | 'critical'; // 警示等級
  scheduled_outflows: { date: string; name: string; amount: number; cumulative: number }[];
}

// 儀表板用的成員池塘摘要
export interface MemberPondSummary {
  profile: Profile;
  pond_a: PondA;
  pond_b: PondB;
  pending_income: number;   // 未確認的待入帳收入總額
  planned_expense: number;  // 未來計劃支出總額
}
