# 에이전트 시황 채팅 서버 실행 스크립트
# 사용법: PowerShell에서 .\start_agents.ps1

Write-Host "==================================" -ForegroundColor Cyan
Write-Host " AI 에이전트 시황 채팅 서버 시작" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "모델  : Qwen2.5:3b (Ollama)" -ForegroundColor Yellow
Write-Host "포트  : http://localhost:8765" -ForegroundColor Yellow
Write-Host "에이전트: 10명 (황소/곰/차트맨/펀더/매크로/기자/애널리/퀀트/리스크/개미)" -ForegroundColor Yellow
Write-Host ""
Write-Host "웹앱 접속: http://localhost:3000/agents" -ForegroundColor Green
Write-Host ""
Write-Host "서버를 중지하려면 Ctrl+C 를 누르세요."
Write-Host ""

Set-Location $PSScriptRoot
$env:PYTHONIOENCODING = "utf-8"
python agents_server.py
