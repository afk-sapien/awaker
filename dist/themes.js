// NFL palettes from ESPN's public teams feed, captured September 2026.
// https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams?limit=32
// Kept locally so changing themes needs no network request.
export const themes = [
  ['default', 'Awaker original', '#141d21', '#cafa5a'],
  ['ARI', 'Arizona Cardinals', '#a40227', '#ffffff'],
  ['ATL', 'Atlanta Falcons', '#a71930', '#000000'],
  ['BAL', 'Baltimore Ravens', '#29126f', '#000000'],
  ['BUF', 'Buffalo Bills', '#00338d', '#d50a0a'],
  ['CAR', 'Carolina Panthers', '#0085ca', '#000000'],
  ['CHI', 'Chicago Bears', '#0b1c3a', '#e64100'],
  ['CIN', 'Cincinnati Bengals', '#fb4f14', '#000000'],
  ['CLE', 'Cleveland Browns', '#472a08', '#ff3c00'],
  ['DAL', 'Dallas Cowboys', '#002a5c', '#b0b7bc'],
  ['DEN', 'Denver Broncos', '#0a2343', '#fc4c02'],
  ['DET', 'Detroit Lions', '#0076b6', '#bbbbbb'],
  ['GB', 'Green Bay Packers', '#204e32', '#ffb612'],
  ['HOU', 'Houston Texans', '#021018', '#eb0028'],
  ['IND', 'Indianapolis Colts', '#003b75', '#ffffff'],
  ['JAX', 'Jacksonville Jaguars', '#007487', '#d7a22a'],
  ['KC', 'Kansas City Chiefs', '#e31837', '#ffb612'],
  ['LV', 'Las Vegas Raiders', '#000000', '#a5acaf'],
  ['LAC', 'Los Angeles Chargers', '#0080c6', '#ffc20e'],
  ['LAR', 'Los Angeles Rams', '#003594', '#ffd100'],
  ['MIA', 'Miami Dolphins', '#008e97', '#fc4c02'],
  ['MIN', 'Minnesota Vikings', '#4f2683', '#ffc62f'],
  ['NE', 'New England Patriots', '#002a5c', '#c60c30'],
  ['NO', 'New Orleans Saints', '#d3bc8d', '#000000'],
  ['NYG', 'New York Giants', '#003c7f', '#c9243f'],
  ['NYJ', 'New York Jets', '#115740', '#ffffff'],
  ['PHI', 'Philadelphia Eagles', '#06424d', '#000000'],
  ['PIT', 'Pittsburgh Steelers', '#000000', '#ffb612'],
  ['SF', 'San Francisco 49ers', '#aa0000', '#b3995d'],
  ['SEA', 'Seattle Seahawks', '#002a5c', '#69be28'],
  ['TB', 'Tampa Bay Buccaneers', '#bd1c36', '#3e3a35'],
  ['TEN', 'Tennessee Titans', '#4495d2', '#001532'],
  ['WSH', 'Washington Commanders', '#5a1414', '#ffb612'],
].map(([id, name, primary, secondary]) => ({id, name, primary, secondary}));

export const getTheme = id => themes.find(theme => theme.id === id) || themes[0];
const channels = hex => hex.slice(1).match(/../g).map(value => parseInt(value, 16));
const luminance = hex => channels(hex).reduce((sum, value, i) => {
  const channel = value / 255;
  return sum + (channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i];
}, 0);
export const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
const foreground = color => contrast(color, '#ffffff') >= contrast(color, '#000000') ? '#ffffff' : '#000000';
const mix = (a, b, amount) => '#' + channels(a).map((v, i) => Math.round(v * (1 - amount) + channels(b)[i] * amount).toString(16).padStart(2, '0')).join('');
const darkenForWhite = color => {
  let result = color;
  while (contrast(result, '#ffffff') < 7) result = mix(result, '#000000', .1);
  return result;
};

export function themeTokens(id) {
  const theme = getTheme(id), original = theme.id === 'default';
  const sidebar = original ? theme.primary : darkenForWhite(theme.primary);
  return {
    '--dark': theme.primary,
    '--lime': theme.secondary,
    '--on-primary': foreground(theme.primary),
    '--on-accent': foreground(theme.secondary),
    '--sidebar': sidebar,
    '--sidebar-text': mix(sidebar, '#ffffff', .9),
    '--sidebar-muted': mix(sidebar, '#ffffff', .82),
    '--sidebar-hover': mix(sidebar, '#ffffff', .12),
    '--brand-accent': contrast(sidebar, theme.secondary) >= 4.5 ? theme.secondary : '#ffffff',
    '--focus': original ? '#668e1b' : darkenForWhite(theme.primary),
    '--theme-text': original ? '#34551d' : darkenForWhite(theme.primary),
    '--bg': original ? '#f3f5f5' : mix(theme.primary, '#ffffff', .96),
    '--theme-soft': original ? '#eff7e3' : mix(theme.primary, '#ffffff', .93),
    '--theme-line': original ? '#b9cf99' : mix(theme.primary, '#ffffff', .65),
  };
}

export function applyTheme(id, root = document.documentElement) {
  const theme = getTheme(id), tokens = themeTokens(theme.id);
  for (const [key, value] of Object.entries(tokens)) root.style.setProperty(key, value);
  root.dataset.theme = theme.id;
  root.ownerDocument.querySelector('meta[name="theme-color"]')?.setAttribute('content', tokens['--sidebar']);
  return theme;
}
