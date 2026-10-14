/** Hex values mirrored from CSS variables, for libraries that need real colours (charts, flow edges). */
export interface Palette {
  brand: string
  brandSoft: string
  gain: string
  gainSoft: string
  loss: string
  lossSoft: string
  warn: string
  warnSoft: string
  ink: string
  muted: string
  line: string
  surface: string
}

export const palettes: Record<'light' | 'dark', Palette> = {
  light: {
    brand: '#2B3490',
    brandSoft: '#E8EAFA',
    gain: '#0C7D58',
    gainSoft: '#E1F5EC',
    loss: '#C62F3D',
    lossSoft: '#FCE8EA',
    warn: '#945800',
    warnSoft: '#FFF1D6',
    ink: '#0F1634',
    muted: '#5D6784',
    line: '#E3E6F1',
    surface: '#FFFFFF',
  },
  dark: {
    brand: '#8E9BFF',
    brandSoft: '#1D2656',
    gain: '#3DDC97',
    gainSoft: '#0F3329',
    loss: '#FF6B78',
    lossSoft: '#3A1620',
    warn: '#FFB84D',
    warnSoft: '#3A2A0C',
    ink: '#EDF0FF',
    muted: '#A0A9C9',
    line: '#252E56',
    surface: '#131A38',
  },
}
