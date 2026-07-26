import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg'

export type LineIconName =
  | 'activity'
  | 'calendar'
  | 'calendarPlus'
  | 'catalogs'
  | 'chevronLeft'
  | 'chevronRight'
  | 'contact'
  | 'copy'
  | 'demo'
  | 'display'
  | 'edit'
  | 'eye'
  | 'goals'
  | 'identity'
  | 'import'
  | 'labels'
  | 'language'
  | 'logout'
  | 'message'
  | 'modules'
  | 'org'
  | 'personPlus'
  | 'phone'
  | 'plus'
  | 'subscription'
  | 'shield'
  | 'sync'
  | 'video'
  | 'whatsapp'

type Props = {
  name: LineIconName
  size?: number
  color: string
  strokeWidth?: number
}

export function LineIcon({ name, size = 18, color, strokeWidth = 2 }: Props) {
  const common = {
    fill: 'none',
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'identity' && (
        <>
          <Rect x="3" y="5" width="18" height="14" rx="2.5" {...common} />
          <Circle cx="9" cy="12" r="2" {...common} />
          <Path d="M6.5 17c.7-1.7 4.3-1.7 5 0" {...common} />
          <Line x1="14" y1="10" x2="18" y2="10" {...common} />
          <Line x1="14" y1="14" x2="18" y2="14" {...common} />
        </>
      )}
      {name === 'contact' && (
        <>
          <Circle cx="12" cy="12" r="7" {...common} />
          <Path d="M15 12a3 3 0 1 1-1-2.2V13a2 2 0 0 0 3.5 1.3" {...common} />
        </>
      )}
      {name === 'org' && (
        <>
          <Path d="M4 20V8l8-4 8 4v12" {...common} />
          <Path d="M9 20v-6h6v6" {...common} />
          <Line x1="8" y1="10" x2="8" y2="10.01" {...common} />
          <Line x1="16" y1="10" x2="16" y2="10.01" {...common} />
        </>
      )}
      {name === 'language' && (
        <>
          <Circle cx="12" cy="12" r="9" {...common} />
          <Path d="M3 12h18" {...common} />
          <Path d="M12 3a14 14 0 0 1 0 18" {...common} />
          <Path d="M12 3a14 14 0 0 0 0 18" {...common} />
        </>
      )}
      {name === 'activity' && (
        <>
          <Rect x="4" y="7" width="16" height="12" rx="2" {...common} />
          <Path d="M9 7V5h6v2" {...common} />
          <Path d="M4 12h16" {...common} />
        </>
      )}
      {name === 'modules' && (
        <>
          <Rect x="4" y="4" width="6" height="6" rx="1.5" {...common} />
          <Rect x="14" y="4" width="6" height="6" rx="1.5" {...common} />
          <Rect x="4" y="14" width="6" height="6" rx="1.5" {...common} />
          <Rect x="14" y="14" width="6" height="6" rx="1.5" {...common} />
        </>
      )}
      {name === 'labels' && (
        <>
          <Path d="M4 7.5V5h2.5L20 18.5 18.5 20 5 6.5Z" {...common} />
          <Line x1="9" y1="9" x2="14" y2="4" {...common} />
        </>
      )}
      {name === 'import' && (
        <>
          <Path d="M12 4v10" {...common} />
          <Polyline points="8 10 12 14 16 10" {...common} />
          <Path d="M5 18h14" {...common} />
        </>
      )}
      {name === 'eye' && (
        <>
          <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" {...common} />
          <Circle cx="12" cy="12" r="3" {...common} />
        </>
      )}
      {name === 'goals' && (
        <>
          <Circle cx="12" cy="12" r="8" {...common} />
          <Circle cx="12" cy="12" r="4" {...common} />
          <Circle cx="12" cy="12" r="1" {...common} />
        </>
      )}
      {name === 'calendar' && (
        <>
          <Rect x="4" y="5" width="16" height="15" rx="2" {...common} />
          <Line x1="8" y1="3" x2="8" y2="7" {...common} />
          <Line x1="16" y1="3" x2="16" y2="7" {...common} />
          <Line x1="4" y1="10" x2="20" y2="10" {...common} />
        </>
      )}
      {name === 'calendarPlus' && (
        <>
          <Rect x="4" y="5" width="16" height="15" rx="2" {...common} />
          <Line x1="8" y1="3" x2="8" y2="7" {...common} />
          <Line x1="16" y1="3" x2="16" y2="7" {...common} />
          <Line x1="4" y1="10" x2="20" y2="10" {...common} />
          <Line x1="12" y1="13" x2="12" y2="18" {...common} />
          <Line x1="9.5" y1="15.5" x2="14.5" y2="15.5" {...common} />
        </>
      )}
      {name === 'catalogs' && (
        <>
          <Path d="M12 3 4 7l8 4 8-4-8-4Z" {...common} />
          <Path d="M4 12l8 4 8-4" {...common} />
          <Path d="M4 17l8 4 8-4" {...common} />
        </>
      )}
      {name === 'display' && (
        <>
          <Rect x="4" y="5" width="16" height="11" rx="2" {...common} />
          <Path d="M9 20h6" {...common} />
          <Path d="M12 16v4" {...common} />
          <Circle cx="17" cy="9" r="1" {...common} />
        </>
      )}
      {name === 'demo' && (
        <>
          <Path d="M9 3v5l-4 8a3 3 0 0 0 2.7 5h8.6A3 3 0 0 0 19 16l-4-8V3" {...common} />
          <Path d="M8 3h8" {...common} />
          <Path d="M8 15h8" {...common} />
        </>
      )}
      {name === 'subscription' && (
        <>
          <Rect x="3" y="6" width="18" height="12" rx="2" {...common} />
          <Line x1="3" y1="10" x2="21" y2="10" {...common} />
          <Line x1="7" y1="15" x2="10" y2="15" {...common} />
        </>
      )}
      {name === 'shield' && (
        <>
          <Path d="M12 3 5 6v5c0 4.8 2.9 8.1 7 10 4.1-1.9 7-5.2 7-10V6l-7-3Z" {...common} />
          <Path d="m9 12 2 2 4-4" {...common} />
        </>
      )}
      {name === 'logout' && (
        <>
          <Path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" {...common} />
          <Path d="M14 8l4 4-4 4" {...common} />
          <Line x1="18" y1="12" x2="9" y2="12" {...common} />
        </>
      )}
      {name === 'sync' && (
        <>
          <Path d="M4 12a8 8 0 0 1 14-5.2M4 12a8 8 0 0 0 14 5.2" {...common} />
          <Polyline points="18 3 18 7 14 7" {...common} />
          <Polyline points="6 21 6 17 10 17" {...common} />
        </>
      )}
      {name === 'personPlus' && (
        <>
          <Circle cx="9" cy="7" r="4" {...common} />
          <Path d="M2 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" {...common} />
          <Line x1="19" y1="8" x2="19" y2="14" {...common} />
          <Line x1="16" y1="11" x2="22" y2="11" {...common} />
        </>
      )}
      {name === 'phone' && (
        <Path d="M6.6 10.8a15.5 15.5 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1.1-.2c1.2.5 2.5.7 3.8.7a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C11.6 21 3 12.4 3 2a1 1 0 0 1 1-1h3.3a1 1 0 0 1 1 1c0 1.3.2 2.6.7 3.8a1 1 0 0 1-.2 1.1L6.6 10.8Z" {...common} />
      )}
      {name === 'message' && (
        <Path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6A8.4 8.4 0 0 1 12.5 3h.5a8.48 8.48 0 0 1 8 8v.5Z" {...common} />
      )}
      {name === 'edit' && (
        <>
          <Path d="M12 20h9" {...common} />
          <Path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" {...common} />
        </>
      )}
      {name === 'copy' && (
        <>
          <Rect x="9" y="9" width="11" height="11" rx="2" {...common} />
          <Path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" {...common} />
        </>
      )}
      {name === 'video' && (
        <Path d="M17 10.5V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3.5l4 3.5v-11l-4 3.5Z" {...common} strokeLinejoin="round" />
      )}
      {name === 'whatsapp' && (
        <>
          <Path d="M12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.5 1.3 5L2 22l5.2-1.3c1.4.8 3.1 1.3 4.8 1.3 5.5 0 10-4.5 10-10S17.5 2 12 2Z" fill="#25D366" stroke="none" />
          <Path d="M8.7 7.5c.3-.6.6-.6.9-.6.2 0 .4 0 .6.5.2.5.8 1.9.8 2 .1.1.1.3 0 .5l-.4.5c-.1.2-.3.3-.1.6.2.3 1 1.6 2.1 2.5 1.4 1.2 2.5 1.6 2.9 1.8.3.2.5.1.7-.1.2-.3.7-.8 1-1.1.2-.3.4-.2.7-.1.2.1 1.6.8 1.9.9.3.2.5.2.6.4 0 .2 0 1.1-.4 1.6-.4.6-1.9 1.2-2.6 1.2-.7 0-1.6 0-3.5-.8-2.8-1.2-4.6-4-4.8-4.2-.2-.2-1.5-1.9-1.5-3.7 0-1.7.9-2.5 1.1-2.9Z" fill="#fff" stroke="none" />
        </>
      )}
      {name === 'plus' && (
        <>
          <Line x1="12" y1="5" x2="12" y2="19" {...common} />
          <Line x1="5" y1="12" x2="19" y2="12" {...common} />
        </>
      )}
      {name === 'chevronRight' && <Polyline points="9 18 15 12 9 6" {...common} />}
      {name === 'chevronLeft' && <Polyline points="15 18 9 12 15 6" {...common} />}
    </Svg>
  )
}
