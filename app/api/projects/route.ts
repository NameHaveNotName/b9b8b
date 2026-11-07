export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { getCurrentUser, getCurrentUserId } from '@/lib/auth-helpers';
import { projectDashboardSelect, projectCoreSelect } from '@/lib/db/project-select';
import { ensureProjectAssetSnapshot } from '@/lib/project-asset-snapshots';
import { selectConstraintPayload } from '@/lib/structured-assets';
import { buildInitialAssetConstraintSpecs, normalizeInitialAssetIds, supportsInitialProjectImport } from '@/lib/project-asset-imports';
import { buildInitialWorkflowSteps } from '@/lib/workflow-steps';

export async function GET() {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: 'AUTH_001' }, { status: 401 });
    }

    console.log('[GET /api/projects] userId:', userId)

    const projects = await prisma.project.findMany({
      where: { userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      select: projectDashboardSelect,
    });

    console.log('[GET /api/projects] found projects:', projects.length)
    return NextResponse.json({ projects });
  } catch (error: any) {
    console.error('[GET /api/projects] error:', error)
    return NextResponse.json(
      { error: 'SERVER_001', message: error?.message || '服务器内部错误' },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'AUTH_001' }, { status: 401 });
    }

    console.log('[POST /api/projects] userId:', user.id)

    const body = await req.json().catch(() => ({}));

    const title = body?.title || body?.rawIdea;
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json({ error: 'VALID_001', message: '项目标题不能为空' }, { status: 400 });
    }

    const trimmedTitle = title.trim();

    const initialAssetIds = normalizeInitialAssetIds(body?.initialAssetIds);
    const initialAssets = initialAssetIds.length > 0
      ? await prisma.userAsset.findMany({
          where: { id: { in: initialAssetIds }, userId: user.id, deletedAt: null },
          select: { id: true, contentType: true, structuredPayload: true, currentRevisionId: true },
        })
      : [];
    if (initialAssets.length !== initialAssetIds.length || initialAssets.some((asset) => !supportsInitialProjectImport(asset.contentType) || !asset.structuredPayload || !asset.currentRevisionId)) {
      return NextResponse.json({ error: 'ASSET_IMPORT_INVALID', message: '所选资产已失效或不适合在项目创建时导入' }, { status: 400 });
    }

    const project = await prisma.project.create({
      data: {
        userId: user.id,
        title: trimmedTitle,
        rawIdea: body?.rawIdea && typeof body.rawIdea === 'string' ? body.rawIdea : '',
        status: 'ACTIVE',
      },
      select: projectCoreSelect,
    });

    console.log('[POST /api/projects] created project:', project.id, 'with userId:', user.id)

    // 自动初始化 9 步 WorkflowStep 记录（全部 PENDING）
    const existingSteps = await prisma.workflowStep.findMany({
      where: { projectId: project.id },
      select: { stepType: true },
    });
    const existingTypes = new Set(existingSteps.map((s: any) => s.stepType));
    const stepsToCreate = buildInitialWorkflowSteps(project.id)
      .filter((s: any) => !existingTypes.has(s.stepType));

    if (stepsToCreate.length > 0) {
      await prisma.workflowStep.createMany({ data: stepsToCreate });
    }

    let importedAssetCount = 0;
    const assetImportWarnings: Array<{ assetId: string; error: string }> = [];
    for (const source of initialAssets) {
      try {
        const snapshot = await ensureProjectAssetSnapshot({ projectId: project.id, userAssetId: source.id, actorId: user.id });
        const payloadSnapshot = selectConstraintPayload(source.contentType, source.structuredPayload);
        if (Object.keys(payloadSnapshot).length === 0) throw new Error('NO_USABLE_FIELDS');
        for (const spec of buildInitialAssetConstraintSpecs()) {
          await prisma.projectAssetConstraint.upsert({
            where: { projectId_assetId_targetStep_targetKey: { projectId: project.id, assetId: snapshot.asset.id, targetStep: spec.targetStep, targetKey: spec.targetKey } },
            create: { projectId: project.id, assetId: snapshot.asset.id, ...spec, selectedFields: Object.keys(payloadSnapshot), payloadSnapshot: payloadSnapshot as any, createdById: user.id },
            update: { ...spec, selectedFields: Object.keys(payloadSnapshot), payloadSnapshot: payloadSnapshot as any, enabled: true, createdById: user.id },
          });
        }
        importedAssetCount += 1;
      } catch (error: any) {
        console.error('[POST /api/projects] initial asset import failed:', source.id, error?.message || error);
        assetImportWarnings.push({ assetId: source.id, error: 'ASSET_IMPORT_FAILED' });
      }
    }

    revalidatePath('/dashboard')
    return NextResponse.json({ project, importedAssetCount, assetImportWarnings })
  } catch (error: any) {
    console.error('[POST /api/projects] error:', error)
    return NextResponse.json(
      { error: 'SERVER_001', message: error?.message || '服务器内部错误' },
      { status: 500 }
    )
  }
}
