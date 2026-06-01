export const dynamic = 'force-dynamic'

export default function EvaluationPage({ params }: { params: { id: string } }) {
  return <div>Evaluation {params.id}</div>
}
