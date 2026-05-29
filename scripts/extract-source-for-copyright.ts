import * as fs from 'fs';
import * as path from 'path';

const OUTPUT_DIR = 'source-code-copyright';
const TARGET_LINES_PER_PART = 1500; // 30 pages × 50 lines

// File extraction config: [filePath, maxLines?]
// If maxLines is undefined, include full file
// If maxLines is a number, include first N lines (for files where business logic is at top)
const FRONTEND_FILES: [string, number?][] = [
  ['app/(dashboard)/project/[id]/workflow/page.tsx', 400],
  ['app/(dashboard)/project/[id]/storyboard/page.tsx', undefined],
  ['app/(dashboard)/project/[id]/storyboard/_components/StoryboardTable.tsx', 350],
  ['components/ui/ClickToEdit.tsx', undefined],
  ['app/(dashboard)/dashboard/page.tsx', undefined],
];

const BACKEND_FILES: [string, number?][] = [
  ['app/api/projects/[id]/steps/style/route.ts', 100],
  ['app/api/projects/[id]/steps/character/route.ts', 80],
  ['app/api/projects/[id]/steps/concept/route.ts', 80],
  ['app/api/projects/[id]/steps/storyboard/route.ts', 80],
  ['app/api/projects/[id]/steps/keyframes/route.ts', 80],
  ['app/api/projects/[id]/steps/framework/route.ts', 80],
  ['app/api/projects/[id]/steps/ideation/route.ts', 50],
  ['lib/api-clients/xiaomi.ts', 140],
  ['lib/api-clients/mock-video.ts', 90],
  ['lib/workflow-executor.ts', undefined],
  ['lib/models-config.ts', 80],
  ['lib/prompts.ts', undefined],
  ['lib/prisma.ts', 50],
  ['lib/r2.ts', undefined],
  ['lib/queue.ts', undefined],
];

const CONFIG_FILES: [string, number?][] = [
  ['prisma/schema.prisma', 150],
  ['lib/workflow.ts', 80],
];

function sanitizeCode(content: string): string {
  // 1. 删除 sk- 开头的 API Key
  content = content.replace(/sk-[a-zA-Z0-9]{20,}/g, 'YOUR_API_KEY_HERE');

  // 2. 删除本地绝对路径 (Windows 风格 C:\... 或 D:\...)
  content = content.replace(/[A-Z]:\\[^\s\"\']+/g, '/local/path');

  // 3. 删除真实数据库 URL（保留结构）
  content = content.replace(/postgresql:\/\/[^:\s\"\']+:[^@\s\"\']+@[^\s\"\']+/g, 'postgresql://user:pass@host');

  // 4. 删除 R2 真实凭证占位符中的真实值（如果有）
  content = content.replace(/(R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|R2_ACCOUNT_ID)=\s*["'][^"']+["']/g, '$1="YOUR_VALUE_HERE"');

  // 5. 删除包含 password/secret/token/key 的硬编码字符串值（保留变量名）
  content = content.replace(/(password|secret|token|key)\s*[:=]\s*["'][^"']{8,}["']/gi, '$1: "YOUR_VALUE_HERE"');

  // 6. 删除 .env 文件中的真实值
  content = content.replace(/^(\w+(?:_\w+)*=)(?!\s*["']?YOUR_)([^\s"']+)$/gmi, '$1YOUR_VALUE_HERE');

  return content;
}

function extractFile(filePath: string, maxLines?: number): { content: string; lines: number } | null {
  const fullPath = path.join(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) {
    console.log(`[SKIP] 文件不存在: ${filePath}`);
    return null;
  }

  let content = fs.readFileSync(fullPath, 'utf-8');
  content = sanitizeCode(content);

  let lines = content.split('\n');
  const totalLines = lines.length;

  if (maxLines && totalLines > maxLines) {
    // 截取前 maxLines 行，并添加截断提示
    lines = lines.slice(0, maxLines);
    lines.push(`\n// ===== [截断] 原文件共 ${totalLines} 行，此处截取前 ${maxLines} 行用于软著材料 =====`);
    content = lines.join('\n');
  }

  const fileHeader = `\n// ============================================================\n// FILE: ${filePath}\n// ============================================================\n\n`;
  const finalContent = fileHeader + content;
  const finalLines = finalContent.split('\n').length;

  return { content: finalContent, lines: finalLines };
}

function buildPart(files: [string, number?][], partName: string): { content: string; totalLines: number } {
  const output: string[] = [];
  let totalLines = 0;

  for (const [filePath, maxLines] of files) {
    const result = extractFile(filePath, maxLines);
    if (result) {
      output.push(result.content);
      totalLines += result.lines;
      console.log(`[EXTRACT] ${filePath}: ${result.lines} lines (total: ${totalLines})`);
    }
  }

  return { content: output.join('\n'), totalLines };
}

function main() {
  // 创建输出目录
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('=== 开始提取前端代码 (Part 1) ===\n');
  const part1 = buildPart(FRONTEND_FILES, 'Part 1 - Frontend');

  console.log('\n=== 开始提取后端代码 (Part 2) ===\n');
  const part2 = buildPart([...BACKEND_FILES, ...CONFIG_FILES], 'Part 2 - Backend');

  // 写入文件
  const header = `// FilmFlow 影视工作流系统 V1.0\n// 源代码文档（用于软件著作权申请）\n// 生成日期: ${new Date().toISOString().split('T')[0]}\n\n`;

  fs.writeFileSync(path.join(OUTPUT_DIR, 'source-code-part1-frontend.txt'), header + part1.content);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'source-code-part2-backend.txt'), header + part2.content);

  // 汇总信息
  const summary = `FilmFlow 影视工作流系统 V1.0 - 源代码文档汇总
================================================
生成日期: ${new Date().toISOString().split('T')[0]}

Part 1 - 前端代码
  文件数: ${FRONTEND_FILES.length}
  总行数: ${part1.totalLines}
  预估页数: ${Math.ceil(part1.totalLines / 50)} 页 (按每页50行计)

Part 2 - 后端代码 + 配置
  文件数: ${BACKEND_FILES.length + CONFIG_FILES.length}
  总行数: ${part2.totalLines}
  预估页数: ${Math.ceil(part2.totalLines / 50)} 页 (按每页50行计)

总计: ${part1.totalLines + part2.totalLines} 行, ${Math.ceil((part1.totalLines + part2.totalLines) / 50)} 页
目标: 3000 行 / 60 页
`;

  fs.writeFileSync(path.join(OUTPUT_DIR, 'README.txt'), summary);

  console.log('\n=== 提取完成 ===');
  console.log(summary);
}

main();
