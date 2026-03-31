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

const ALLOWED_EXTENSIONS = [
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "txt", "csv", "zip", "hwp", "jpg", "jpeg", "png", "gif", "webp",
];

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.email?.trim() !== ADMIN_EMAIL?.trim()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return NextResponse.json({ error: "지원하지 않는 파일 형식입니다." }, { status: 400 });
  }

  // 저장 경로는 ASCII만 허용 — 표시 이름(file.name)은 별도 보존
  const path = `attachments/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const bytes = await file.arrayBuffer();

  const service = getServiceClient();
  const { error: uploadError } = await service.storage
    .from("board-images")
    .upload(path, bytes, { contentType: file.type });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: { publicUrl } } = service.storage
    .from("board-images")
    .getPublicUrl(path);

  return NextResponse.json({ url: publicUrl, name: file.name, size: file.size });
}
