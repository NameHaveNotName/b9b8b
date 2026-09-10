export const dynamic = 'force-dynamic'

export default async function EvaluationPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <div>Evaluation {params.id}</div>
}
