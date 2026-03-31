import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const supabaseAdmin = createClient(
      supabaseUrl,
      serviceRoleKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { user_id } = await request.json();

    if (!user_id) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    // 在 Supabase Auth 刪除用戶。根據資料庫設定（ON DELETE CASCADE），
    // profiles, pond_a, pond_b 相關資料會隨之被連動刪除，或是把 transactions 的 user_id 設為 null。
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.deleteUser(user_id);

    if (authError || !authData.user) {
      return NextResponse.json({ error: authError?.message || '刪除帳號失敗' }, { status: 400 });
    }

    return NextResponse.json({ success: true, user: authData.user });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
