import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { paymentKey, orderId, amount } = await req.json();

  if (!paymentKey || !orderId || !amount) {
    return NextResponse.json({ error: "필수 파라미터가 누락됐습니다." }, { status: 400 });
  }

  const secretKey = process.env.TOSS_SECRET_KEY!;
  const encodedKey = Buffer.from(`${secretKey}:`).toString("base64");

  // 토스페이먼츠 결제 승인 API 호출
  const tossRes = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
    method: "POST",
    headers: {
      Authorization: `Basic ${encodedKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ paymentKey, orderId, amount }),
  });

  if (!tossRes.ok) {
    const err = await tossRes.json();
    console.error("토스 결제 승인 오류:", err);
    return NextResponse.json({ error: err.message ?? "결제 승인 실패" }, { status: 502 });
  }

  const payData = await tossRes.json();

  // Supabase에 구독 정보 저장
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  const { error: dbError } = await supabase.from("subscriptions").insert({
    user_id: user.id,
    kakao_tid: payData.paymentKey,
    status: "active",
    expires_at: expiresAt.toISOString(),
  });

  if (dbError) {
    console.error("구독 저장 오류:", dbError);
    return NextResponse.json({ error: "구독 정보 저장 실패" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
