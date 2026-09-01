// the classic 11x8 space-invader "squid" sprite, built from a grid instead
// of hand-written <rect> tags so the pixel pattern itself stays readable
const PATTERN = [
  '..X.....X..',
  '...X...X...',
  '..XXXXXXX..',
  '.XX.XXX.XX.',
  'XXXXXXXXXXX',
  'X.XXXXXXX.X',
  'X.X.....X.X',
  '...XX.XX...',
];

const COLS = PATTERN[0].length;
const ROWS = PATTERN.length;

// used both as the clickable brand mark in TopBar/auth screens (three taps
// on it is the space invaders easter egg, see TopBar.jsx) and, exported
// statically as public/icon.svg, as the favicon/PWA icon.
export default function AlienLogo({ size = 28, color = 'var(--primary)' }) {
  const cells = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (PATTERN[row][col] === 'X') {
        cells.push(<rect key={`${row}-${col}`} x={col} y={row} width={1} height={1} fill={color} />);
      }
    }
  }

  return (
    <svg
      viewBox={`0 0 ${COLS} ${ROWS}`}
      width={size}
      height={(size * ROWS) / COLS}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {cells}
    </svg>
  );
}
