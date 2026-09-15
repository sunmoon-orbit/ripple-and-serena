import { createContext, useContext } from 'react'
import { useStore } from '../../store'
export const ToolMemoryContext = createContext(null)
export function useToolMemory() {
  const scoped = useContext(ToolMemoryContext)
  const original = useStore(s => s.moonMemory)
  return scoped || original
}
