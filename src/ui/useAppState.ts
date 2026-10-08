import { useEffect, useState } from 'preact/hooks'
import type { AppController, AppState } from '../app/AppController'

export function useAppState(controller: AppController): AppState {
  const [state, setState] = useState(controller.getState)
  useEffect(() => {
    setState(controller.getState())
    return controller.subscribe(() => setState(controller.getState()))
  }, [controller])
  return state
}
