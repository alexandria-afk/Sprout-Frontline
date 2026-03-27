import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/services/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ user: data.user, session: data.session });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
