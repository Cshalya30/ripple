import { palettes, type Palette } from '../lib/theme'
import { useApp } from '../context/AppContext'

export function usePalette(): Palette {
  const { theme } = useApp()
  return palettes[theme]
}
