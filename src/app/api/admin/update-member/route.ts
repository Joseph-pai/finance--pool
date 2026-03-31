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

    const { user_id, password } = await request.json();

    if (!user_id || !password) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    // 更新 Auth 密碼
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.updateUserById(
      user_id,
      { password }
    );

    if (authError || !authData.user) {
      return NextResponse.json({ error: authError?.message || '更新密碼失敗' }, { status: 400 });
    }

    return NextResponse.json({ success: true, user: authData.user });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
