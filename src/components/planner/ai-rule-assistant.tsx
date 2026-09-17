import { SeraAssistant } from '@/components/sera/sera-assistant'

interface AIRuleAssistantProps {
  scope: 'global' | 'team' | 'program' | 'patient'
  patientId?: string | null
  programTemplateId?: string | null
  teamOwnerId?: string | null
  onRuleCreated: () => void
  onScopeChange?: (scope: string) => void
  showScopeSelector?: boolean
  isPatientSelfService?: boolean
  patientName?: string
}

export function AIRuleAssistant(props: AIRuleAssistantProps) {
    return <SeraAssistant {...props} requireApproval={false} />
}
