export const dynamic = 'force-dynamic'

export default function ExportPage({ params }: { params: { id: string } }) {
  return <div>Export {params.id}</div>
}
