/**
 * Backfill stable R2 storage keys into WorkflowStep.outputData.
 *
 * Default mode is read-only. Pass --apply to persist only uniquely resolved keys.
 * Writes use WorkflowStep.updatedAt as an optimistic-lock guard so an active
 * generation cannot be overwritten by this maintenance script.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DIRECT_URL or DATABASE_URL is required");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});
const apply = process.argv.includes("--apply");

type MediaAsset = {
  id: string;
  projectId: string;
  storageKey: string;
  url: string;
  metadata: unknown;
};

type Counters = {
  stepsScanned: number;
  stepsChanged: number;
  stepsWritten: number;
  conflicts: number;
  firstFrameResolved: number;
  lastFrameResolved: number;
  shotAssetResolved: number;
  unresolvedFirst: number;
  unresolvedLast: number;
};

const counters: Counters = {
  stepsScanned: 0,
  stepsChanged: 0,
  stepsWritten: 0,
  conflicts: 0,
  firstFrameResolved: 0,
  lastFrameResolved: 0,
  shotAssetResolved: 0,
  unresolvedFirst: 0,
  unresolvedLast: 0,
};

function sameAct(a: unknown, b: unknown): boolean {
  return Number(a || 0) === Number(b || 0);
}

function uniqueKey(assets: MediaAsset[]): string | null {
  const keys = [
    ...new Set(assets.map((asset) => asset.storageKey).filter(Boolean)),
  ];
  return keys.length === 1 ? keys[0] : null;
}

function metadataOf(asset: MediaAsset): Record<string, any> {
  return asset.metadata && typeof asset.metadata === "object"
    ? (asset.metadata as Record<string, any>)
    : {};
}

async function retryRead<T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      const delayMs = attempt * 1000;
      console.error(
        `${label} failed (attempt ${attempt}/${maxAttempts}); retrying in ${delayMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`${label} exhausted retries`);
}

async function main() {
  // Query project ids first, then process one project at a time. Loading every
  // historical Asset and every large outputData JSON in one query puts too much
  // pressure on the production pooler.
  const projectRows = await retryRead("load project ids", () =>
    prisma.workflowStep.findMany({
      where: { stepType: { in: ["STORYBOARD", "KEYFRAMES"] } },
      select: { projectId: true },
      distinct: ["projectId"],
    }),
  );

  for (
    let projectIndex = 0;
    projectIndex < projectRows.length;
    projectIndex += 1
  ) {
    const projectId = projectRows[projectIndex].projectId;
    const [steps, rawAssets] = await retryRead(
      `load project ${projectId}`,
      () =>
        Promise.all([
          prisma.workflowStep.findMany({
            where: { projectId, stepType: { in: ["STORYBOARD", "KEYFRAMES"] } },
            select: {
              id: true,
              projectId: true,
              stepType: true,
              outputData: true,
              updatedAt: true,
            },
          }),
          prisma.asset.findMany({
            where: { projectId, type: "IMAGE" },
            select: {
              id: true,
              projectId: true,
              storageKey: true,
              url: true,
              metadata: true,
            },
          }),
        ]),
    );
    const projectAssets = rawAssets as MediaAsset[];
    const assetById = new Map(projectAssets.map((asset) => [asset.id, asset]));
    const storyboardStep = steps.find((step) => step.stepType === "STORYBOARD");
    const storyboardOutput = (storyboardStep?.outputData || {}) as Record<
      string,
      any
    >;
    const storyboardShots = Array.isArray(storyboardOutput.shots)
      ? storyboardOutput.shots
      : [];

    for (const step of steps) {
      counters.stepsScanned += 1;
      const output = structuredClone(
        (step.outputData || {}) as Record<string, any>,
      );
      let changed = false;

      if (step.stepType === "STORYBOARD") {
        const shotAssets = Array.isArray(output.shotAssets)
          ? output.shotAssets
          : [];
        const shots = Array.isArray(output.shots) ? output.shots : [];

        for (const ref of shotAssets) {
          if (!ref?.url || ref.storageKey) continue;
          const byId = ref.assetId ? assetById.get(ref.assetId) : null;
          const key =
            byId?.projectId === step.projectId
              ? byId.storageKey
              : uniqueKey(
                  projectAssets.filter((asset) => asset.url === ref.url),
                );
          if (key) {
            ref.storageKey = key;
            counters.shotAssetResolved += 1;
            changed = true;
          }
        }

        for (const shot of shots) {
          if (!shot?.firstFrameUrl || shot.firstFrameStorageKey) continue;
          const direct = shot.firstFrameAssetId
            ? assetById.get(shot.firstFrameAssetId)
            : null;
          const ref = shotAssets.find(
            (item: any) =>
              item?.shotId === shot.shotId &&
              sameAct(item?.actNumber, shot.actNumber),
          );
          const exactUrlKey = uniqueKey(
            projectAssets.filter((asset) => asset.url === shot.firstFrameUrl),
          );
          const key =
            direct?.projectId === step.projectId
              ? direct.storageKey
              : ref?.storageKey || exactUrlKey;
          if (key) {
            shot.firstFrameStorageKey = key;
            counters.firstFrameResolved += 1;
            changed = true;
          } else {
            counters.unresolvedFirst += 1;
          }
        }
      }

      if (step.stepType === "KEYFRAMES") {
        const field = Array.isArray(output.keyframes) ? "keyframes" : "results";
        const frames = Array.isArray(output[field]) ? output[field] : [];
        for (const frame of frames) {
          if (frame?.firstFrameUrl && !frame.firstFrameStorageKey) {
            const storyboardShot = storyboardShots.find(
              (shot: any) =>
                shot?.shotId === frame.shotId &&
                sameAct(shot?.actNumber, frame.actNumber),
            );
            const exactUrlKey = uniqueKey(
              projectAssets.filter(
                (asset) => asset.url === frame.firstFrameUrl,
              ),
            );
            const key = storyboardShot?.firstFrameStorageKey || exactUrlKey;
            if (key) {
              frame.firstFrameStorageKey = key;
              counters.firstFrameResolved += 1;
              changed = true;
            } else {
              counters.unresolvedFirst += 1;
            }
          }

          if (frame?.lastFrameUrl && !frame.lastFrameStorageKey) {
            const exactUrlKey = uniqueKey(
              projectAssets.filter((asset) => asset.url === frame.lastFrameUrl),
            );
            const metadataMatches = projectAssets.filter((asset) => {
              const meta = metadataOf(asset);
              return meta.frameType === "last" && meta.pairId === frame.shotId;
            });
            const key = exactUrlKey || uniqueKey(metadataMatches);
            if (key) {
              frame.lastFrameStorageKey = key;
              counters.lastFrameResolved += 1;
              changed = true;
            } else {
              counters.unresolvedLast += 1;
            }
          }
        }

        // Some records keep separate results/keyframes arrays. Keep both aligned
        // when they are aliases with the same composite shot identities.
        if (field === "keyframes" && Array.isArray(output.results)) {
          const keyByShot = new Map(
            frames.map((frame: any) => [
              `${frame.actNumber || 0}:${frame.shotId}`,
              frame,
            ]),
          );
          output.results = output.results.map((result: any) => {
            const match = keyByShot.get(
              `${result.actNumber || 0}:${result.shotId}`,
            );
            return match
              ? {
                  ...result,
                  firstFrameStorageKey:
                    result.firstFrameStorageKey || match.firstFrameStorageKey,
                  lastFrameStorageKey:
                    result.lastFrameStorageKey || match.lastFrameStorageKey,
                }
              : result;
          });
        }
      }

      if (!changed) continue;
      counters.stepsChanged += 1;
      if (!apply) continue;

      const updated = await prisma.workflowStep.updateMany({
        where: { id: step.id, updatedAt: step.updatedAt },
        data: { outputData: output },
      });
      if (updated.count === 1) counters.stepsWritten += 1;
      else counters.conflicts += 1;
    }

    if (
      (projectIndex + 1) % 10 === 0 ||
      projectIndex + 1 === projectRows.length
    ) {
      console.error(
        `progress ${projectIndex + 1}/${projectRows.length} projects`,
      );
    }
  }

  console.log(
    JSON.stringify({ mode: apply ? "apply" : "dry-run", ...counters }, null, 2),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
