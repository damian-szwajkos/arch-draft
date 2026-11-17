import { createContext, useContext } from 'react'
import type { Scenario } from '../../engine/types'

export interface WorkspaceContextValue {
  scenario?: Scenario
  domainLabel: (id: string) => string
}

export const WorkspaceContext = createContext<WorkspaceContextValue>({ domainLabel: (id) => id })
export const useWorkspaceContext = () => useContext(WorkspaceContext)
