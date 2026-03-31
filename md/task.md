# FamilyPool — 開發任務追蹤

## Phase 1 — 基礎架構
- [x] 初始化 Next.js 14 專案（App Router, TypeScript）
- [x] 配置專案基礎依賴（supabase-js, date-fns）
- [x] 建立設計系統（globals.css — CSS Variables、字體、色彩、動畫）
- [x] 建立 Supabase 客戶端設定（lib/supabase.ts）
- [x] 建立 TypeScript 類型定義（types/index.ts）
- [x] 建立 Supabase migration SQL（所有表格 + RLS 策略）
- [x] PWA 配置（manifest.json + sw.js + icons）
- [x] 建立 Next.js 設定（next.config.js）
- [x] 建立 .env.local.example

## Phase 2 — 認證與佈局
- [x] 登入頁面（app/page.tsx）— 水波背景動畫
- [x] 應用主佈局（app/layout.tsx、各目錄 layout）— 側邊欄/底部導航
- [x] 認證邏輯（hooks/useAuth.tsx）
- [x] 水波動畫組件（components/animations/WaterWave.tsx）
- [x] 流動動畫組件（components/animations/FlowAnimation.tsx）

## Phase 3 — 核心頁面
- [x] 儀表板（app/dashboard/page.tsx）— 湖泊 + 所有成員池塘
- [x] 我的池塘（app/my-ponds/page.tsx）
- [x] 收入管理（app/income/page.tsx）
- [x] 支出管理（app/expenses/page.tsx）
- [x] 調撥申請（app/requests/page.tsx）
- [x] 通知中心（app/notifications/page.tsx）

## Phase 4 — 管理功能
- [x] 湖泊管理（app/lake/page.tsx）— 僅管理員
- [x] 設定頁面（含成員管理）（app/settings/page.tsx）— 僅管理員
- [x] Admin API 路由（建立/更新/刪除成員）
- [x] 乾涸預測引擎（lib/predictions.ts）
- [x] Supabase Realtime 即時同步

## Phase 5 — 完善與部署
- [x] 響應式設計調整（手機/平板/桌面）
- [x] 屏幕旋轉支持
- [x] iOS PWA 測試配置
- [x] README.md 更新部署教學
- [x] GitHub 倉庫推送準備與建置測試
