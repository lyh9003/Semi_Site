import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET: 현재 차트 이미지 목록 반환 (공개)
export async function GET() {
  const service = getServiceClient();
  const { data } = await service
    .from("chart_images")
    .select("slot, url")
    .order("slot");
  return NextResponse.json(data ?? []);
}

// POST: 이미지 업로드 (관리자 전용)
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const slot = Number(formData.get("slot"));
  const file = formData.get("file") as File | null;

  if (!file || slot !== 1) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const service = getServiceClient();

  // 기존 파일 삭제
  const { data: current } = await service
    .from("chart_images")
    .select("url")
    .eq("slot", slot)
    .single();

  if (current?.url) {
    // URL에서 파일 경로 추출 (버킷 경로 부분)
    const urlParts = current.url.split("/chart-images/");
    if (urlParts[1]) {
      const oldPath = urlParts[1].split("?")[0];
      await service.storage.from("chart-images").remove([oldPath]);
    }
  }

  // 새 파일 업로드 (타임스탬프로 캐시 버스팅)
  const ext = file.name.split(".").pop() ?? "png";
  const path = `chart-${slot}-${Date.now()}.${ext}`;
  const bytes = await file.arrayBuffer();

  const { error: uploadError } = await service.storage
    .from("chart-images")
    .upload(path, bytes, { contentType: file.type });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: { publicUrl } } = service.storage
    .from("chart-images")
    .getPublicUrl(path);

  await service
    .from("chart_images")
    .upsert({ slot, url: publicUrl, updated_at: new Date().toISOString() });

  return NextResponse.json({ url: publicUrl });
}

// DELETE: 이미지 삭제 (관리자 전용)
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slot } = await req.json();
  if (slot !== 1) {
    return NextResponse.json({ error: "Invalid slot" }, { status: 400 });
  }

  const service = getServiceClient();

  const { data: current } = await service
    .from("chart_images")
    .select("url")
    .eq("slot", slot)
    .single();

  if (current?.url) {
    const urlParts = current.url.split("/chart-images/");
    if (urlParts[1]) {
      const oldPath = urlParts[1].split("?")[0];
      await service.storage.from("chart-images").remove([oldPath]);
    }
  }

  await service
    .from("chart_images")
    .upsert({ slot, url: null, updated_at: new Date().toISOString() });

  return NextResponse.json({ success: true });
}
