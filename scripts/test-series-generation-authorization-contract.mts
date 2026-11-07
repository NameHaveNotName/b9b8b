import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

const schema = read('prisma/schema.prisma')
const migration = read('prisma/migrations/20261107023000_add_series_generation_authorizations/migration.sql')
const points = read('lib/points.ts')
const authorization = read('lib/series-generation-authorization.ts')

assert.match(schema, /consumedPoints\s+Int\s+@default\(0\)/)
assert.match(schema, /model SeriesGenerationAuthorization/)
assert.match(migration, /UNIQUE INDEX "series_generation_authorizations_operation_id_key"/)
assert.match(authorization, /consumedPoints: candidate\.consumedPoints/)
assert.match(authorization, /status: 'RESERVED'/)
assert.match(authorization, /isolationLevel: 'Serializable'/)
assert.match(points, /reserveSeriesGenerationAuthorization/)
assert.match(points, /finalizeSeriesGenerationAuthorization/)
assert.match(points, /releaseSeriesGenerationAuthorization/)

const routeRoot = path.join(root, 'app', 'api')
const routeFiles: string[] = []
function walk(directory: string) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(absolute)
    else if (entry.name === 'route.ts') routeFiles.push(absolute)
  }
}
walk(routeRoot)

const supplierCall = /\b(?:generateImage|generateDirectVideo|generateTrailer|generateMusic|generateVoiceover|textClient\.generate|getTextClient\(\))/
const projectSupplierRoutes = routeFiles.filter((file) => file.includes(`${path.sep}projects${path.sep}`) && supplierCall.test(fs.readFileSync(file, 'utf8')))
const missingCentralGate = projectSupplierRoutes.filter((file) => !/checkPoints\s*\(/.test(fs.readFileSync(file, 'utf8')))
assert.deepEqual(missingCentralGate, [], `supplier routes without central generation gate:\n${missingCentralGate.join('\n')}`)

console.log(`series generation authorization contract verified across ${projectSupplierRoutes.length} project supplier routes`)
