export const dynamic = 'force-dynamic'

export default async function ExportPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <div>Export {params.id}</div>
}
