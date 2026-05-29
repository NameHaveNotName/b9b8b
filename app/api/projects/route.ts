import { NextResponse } from 'next/server';
import { auth, isDemoMode, DEMO_USER } from '@/auth';
import { prisma } from '@/lib/prisma';
import { WorkflowStepType } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/auth-helpers';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 });
  }

  // 调试日志
  console.log('[GET /api/projects] session.userId:', session.user.id)
  console.log('[GET /api/projects] isDemoMode:', isDemoMode)

  // Demo 模式下，兼容三种可能的 userId 来源：session.user.id、DEMO_USER.id、历史 demo 用户
  let whereClause: any = { status: 'ACTIVE' }
  if (isDemoMode) {
    whereClause.OR = [
      { userId: session.user.id },
      { userId: DEMO_USER.id },
    ]
    console.log('[GET /api/projects] demo mode - using OR clause:', whereClause)
  } else {
    whereClause.userId = session.user.id
  }

  const projects = await prisma.project.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { steps: true, assets: true } },
    },
  });

  console.log('[GET /api/projects] found projects:', projects.length)
  projects.forEach(p => {
    console.log(`- ${p.id}: userId=${p.userId}, title=${p.title}, status=${p.status}`)
  })

  return NextResponse.json({ projects });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 });
  }

  // 统一使用 getCurrentUser() 返回的 userId，确保 Demo/真实模式一致
  const userId = user.id;
  console.log('[POST /api/projects] userId:', userId, 'isDemoMode:', isDemoMode)

  // Demo 模式下确保 demo 用户存在于数据库（mock 层也需要用户记录做关联）
  if (isDemoMode) {
    const existingDemoUser = await prisma.user.findUnique({
      where: { id: DEMO_USER.id },
    });
    if (!existingDemoUser) {
      console.log('[POST /api/projects] creating demo user...')
      await prisma.user.create({
        data: {
          id: DEMO_USER.id,
          email: DEMO_USER.email,
          name: DEMO_USER.name,
        },
      });
    }
  }

  const { rawIdea } = await req.json();
  if (!rawIdea || typeof rawIdea !== 'string') {
    return NextResponse.json({ error: 'VALID_001' }, { status: 400 });
  }

  const project = await prisma.project.create({
    data: {
      userId,
      rawIdea,
      title: rawIdea.slice(0, 20) + (rawIdea.length > 20 ? '...' : ''),
      status: 'ACTIVE',
    },
  });

  console.log('[POST /api/projects] created project:', project.id, 'with userId:', userId)

  // 自动初始化 12 步 WorkflowStep 记录（全部 PENDING）
  const stepTypes: WorkflowStepType[] = [
    'IDEATION',
    'FRAMEWORK',
    'STYLE',
    'CHARACTER',
    'CONCEPT',
    'TRAILER',
    'STORYBOARD',
    'KEYFRAMES',
    'VIDEO_DIRECT',
    'VIDEO_RENDER',
    'CAMERA',
    'REVIEW',
  ];

  // 防止重复初始化：先检查项目是否已有步骤（理论上不应有，但 demo HMR 会触发重复调用）
  const existingSteps = await prisma.workflowStep.findMany({
    where: { projectId: project.id },
    select: { stepType: true },
  });
  const existingTypes = new Set(existingSteps.map((s) => s.stepType));
  const stepsToCreate = stepTypes
    .map((type, idx) => ({ projectId: project.id, stepType: type, order: idx, status: 'PENDING' as const }))
    .filter((s) => !existingTypes.has(s.stepType));

  if (stepsToCreate.length > 0) {
    await prisma.workflowStep.createMany({ data: stepsToCreate });
  }

  // 重新验证仪表盘缓存，确保项目列表立即更新
  revalidatePath('/dashboard')

  return NextResponse.json({ project })
}
