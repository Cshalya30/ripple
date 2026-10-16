import { ErrorNote, Skeleton, SkeletonRows } from '../components/ui'
import { errorText } from '../lib/api'
import { useGuard } from '../lib/queries'
import { PaymentFlow } from './PaymentFlow'

export function GatewayView() {
  const guard = useGuard(650)

  if (guard.isLoading) return <div><Skeleton h={200} /><Skeleton h={400} style={{ marginTop: 16 }} /><SkeletonRows rows={3} /></div>
  if (guard.isError || !guard.data) return <ErrorNote text={`Couldn't reach the engine. ${errorText(guard.error)}`} retry={() => guard.refetch()} />

  return <PaymentFlow guard={guard.data} />
}
