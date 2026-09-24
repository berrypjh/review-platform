//@ts-check

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 16.3의 AGENTS.md · CLAUDE.md 자동 생성을 끈다. 그 파일은 이 저장소가 직접 쓴다 (apps/web/AGENTS.md).
  agentRules: false,
};

module.exports = nextConfig;
