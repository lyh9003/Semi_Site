import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_TIME: new Date().toLocaleString("ko-KR", {
      month: "numeric", day: "numeric",
      hour: "2-digit", minute: "2-digit",
      timeZone: "Asia/Seoul",
    }),
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.naver.com" },
      { protocol: "https", hostname: "**.kakao.com" },
    ],
  },
};

export default nextConfig;
