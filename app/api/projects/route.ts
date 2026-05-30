import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { WorkflowStepType } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { getCurrentUser, getCurrentUserId } from '@/lib/auth-helpers';

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 });
  }

  console.log('[GET /api/projects] userId:', userId)

  const projects = await prisma.project.findMany({
    where: { userId, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { steps: true, assets: true } },
    },
  });

  console.log('[GET /api/projects] found projects:', projects.length)
  return NextResponse.json({ projects });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 });
  }

  console.log('[POST /api/projects] userId:', user.id)

  const { rawIdea } = await req.json();
  if (!rawIdea || typeof rawIdea !== 'string') {
    return NextResponse.json({ error: 'VALID_001' }, { status: 400 });
  }

  const project = await prisma.project.create({
    data: {
      userId: user.id,
      rawIdea,
      title: rawIdea.slice(0, 20) + (rawIdea.length > 20 ? '...' : ''),
      status: 'ACTIVE',
    },
  });

  console.log('[POST /api/projects] created project:', project.id, 'with userId:', user.id)

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

  revalidatePath('/dashboard')
  return NextResponse.json({ project })
}
