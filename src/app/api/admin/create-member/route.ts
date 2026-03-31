import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // 使用 Service Role Key 建立 Admin Client，以越過 RLS 操作 Auth 用戶
    const supabaseAdmin = createClient(
      supabaseUrl,
      serviceRoleKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { email, password, display_name, role, family_id } = await request.json();

    if (!email || !password || !display_name || !family_id) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    // 1. 在 Supabase Auth 建立帳號
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError || !authData.user) {
      return NextResponse.json({ error: authError?.message || '建立帳號失敗' }, { status: 400 });
    }

    const userId = authData.user.id;

    // 2. 寫入 profiles
    const { error: profileError } = await supabaseAdmin.from('profiles').insert({
      id: userId,
      family_id,
      display_name,
      role: role || 'member',
    });

    if (profileError) {
      // 若 profile 建立失敗，退回 auth 用戶
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: '建立個人資料失敗' }, { status: 500 });
    }

    // 3. 建立對應的 Pond A 和 Pond B
    await supabaseAdmin.from('pond_a').insert({ user_id: userId, family_id, current_balance: 0 });
    await supabaseAdmin.from('pond_b').insert({ user_id: userId, family_id, current_balance: 0 });

    return NextResponse.json({ success: true, user: authData.user });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
