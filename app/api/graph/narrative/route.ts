import { NextRequest } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

interface RelEdge {
  neighborName: string;
  neighborType: string;
  direction: "outgoing" | "incoming";
  relation_type?: string;
  relation_desc?: string;
  weight: number;
}

export async function POST(req: NextRequest) {
  const { entityName, entityType, relations } = await req.json() as {
    entityName: string;
    entityType: string;
    relations: RelEdge[];
  };

  if (!entityName || !relations?.length) {
    return new Response("params required", { status: 400 });
  }

  const typeLabel: Record<string, string> = {
    company: "기업", product: "제품/기술", metric: "지표",
    event: "이벤트", sector: "섹터",
  };
  const dirLabel = (d: string) => d === "outgoing" ? "→" : "←";

  const relLines = relations
    .filter(r => r.relation_type && r.relation_type !== "무관계")
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 15)
    .map(r =>
      `${dirLabel(r.direction)} ${r.neighborName}(${typeLabel[r.neighborType] ?? r.neighborType})` +
      ` [${r.relation_type}] ${r.relation_desc ? `— ${r.relation_desc}` : ""}`
    )
    .join("\n");

  if (!relLines) {
    return new Response("관계 데이터가 아직 없습니다. 잠시 후 다시 시도해주세요.", { status: 200 });
  }

  const prompt = `엔티티: ${entityName} (${typeLabel[entityType] ?? entityType})

연결된 관계:
${relLines}

위 관계 구조를 바탕으로 "${entityName}"을 중심으로 한 현재 반도체 시황 흐름을 3~4문장으로 설명해줘.
- "A가 B에 ~하는 구조" 형태로 인과 흐름을 명확히
- 투자·산업 관점에서 핵심 의미 포함
- 한국어로`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: "너는 반도체 시황 분석 전문가야. 지식 그래프 관계를 바탕으로 시황 흐름을 명확하게 설명한다." },
          { role: "user", content: prompt },
        ],
        stream: true,
        max_tokens: 400,
        temperature: 0.3,
      });
      for await (const chunk of completion) {
        const text = chunk.choices[0]?.delta?.content ?? "";
        if (text) controller.enqueue(encoder.encode(text));
      }
      controller.close();
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
