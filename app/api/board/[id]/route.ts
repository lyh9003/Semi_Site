import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function getIpHash(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

// GET: 게시글 상세 + 중복 없는 조회수 증가 (공개)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = getServiceClient();

  const { data, error } = await service
    .from("board_posts")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "게시글을 찾을 수 없습니다." }, { status: 404 });
  }

  // 동일 IP 중복 조회 방지 (upsert로 이미 존재하면 무시)
  const ipHash = getIpHash(req);
  const { error: viewError } = await service
    .from("board_views")
    .insert({ post_id: Number(id), ip_hash: ipHash })
    .select();

  if (!viewError) {
    // 새로운 조회자 → views 증가
    await service
      .from("board_posts")
      .update({ views: data.views + 1 })
      .eq("id", id);
    return NextResponse.json({ data: { ...data, views: data.views + 1 } });
  }

  // 이미 조회한 IP → views 그대로
  return NextResponse.json({ data });
}

// PUT: 게시글 수정 (관리자 전용)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { title, content, images, attachments } = await req.json();

  if (!title?.trim() || !content?.trim()) {
    return NextResponse.json({ error: "제목과 내용을 입력해주세요." }, { status: 400 });
  }

  const service = getServiceClient();
  const { data, error } = await service
    .from("board_posts")
    .update({ title: title.trim(), content: content.trim(), images: images ?? [], attachments: attachments ?? [], updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

// DELETE: 게시글 삭제 (관리자 전용)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = getServiceClient();
  const { error } = await service.from("board_posts").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
