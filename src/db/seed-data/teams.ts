/**
 * The 30 franchises, used as site categories.
 * nbaTeamId is the stable NBA franchise id; it builds the CDN logo URL.
 */
export type SeedTeam = {
  slug: string;
  city: string;
  name: string;
  abbreviation: string;
  conference: "East" | "West";
  division: string;
  nbaTeamId: string;
  primaryColor: string;
};

export const SEED_TEAMS: SeedTeam[] = [
  // Eastern — Atlantic
  { slug: "boston-celtics", city: "Boston", name: "Celtics", abbreviation: "BOS", conference: "East", division: "Atlantic", nbaTeamId: "1610612738", primaryColor: "#007A33" },
  { slug: "brooklyn-nets", city: "Brooklyn", name: "Nets", abbreviation: "BKN", conference: "East", division: "Atlantic", nbaTeamId: "1610612751", primaryColor: "#000000" },
  { slug: "new-york-knicks", city: "New York", name: "Knicks", abbreviation: "NYK", conference: "East", division: "Atlantic", nbaTeamId: "1610612752", primaryColor: "#006BB6" },
  { slug: "philadelphia-76ers", city: "Philadelphia", name: "76ers", abbreviation: "PHI", conference: "East", division: "Atlantic", nbaTeamId: "1610612755", primaryColor: "#006BB6" },
  { slug: "toronto-raptors", city: "Toronto", name: "Raptors", abbreviation: "TOR", conference: "East", division: "Atlantic", nbaTeamId: "1610612761", primaryColor: "#CE1141" },
  // Eastern — Central
  { slug: "chicago-bulls", city: "Chicago", name: "Bulls", abbreviation: "CHI", conference: "East", division: "Central", nbaTeamId: "1610612741", primaryColor: "#CE1141" },
  { slug: "cleveland-cavaliers", city: "Cleveland", name: "Cavaliers", abbreviation: "CLE", conference: "East", division: "Central", nbaTeamId: "1610612739", primaryColor: "#860038" },
  { slug: "detroit-pistons", city: "Detroit", name: "Pistons", abbreviation: "DET", conference: "East", division: "Central", nbaTeamId: "1610612765", primaryColor: "#C8102E" },
  { slug: "indiana-pacers", city: "Indiana", name: "Pacers", abbreviation: "IND", conference: "East", division: "Central", nbaTeamId: "1610612754", primaryColor: "#002D62" },
  { slug: "milwaukee-bucks", city: "Milwaukee", name: "Bucks", abbreviation: "MIL", conference: "East", division: "Central", nbaTeamId: "1610612749", primaryColor: "#00471B" },
  // Eastern — Southeast
  { slug: "atlanta-hawks", city: "Atlanta", name: "Hawks", abbreviation: "ATL", conference: "East", division: "Southeast", nbaTeamId: "1610612737", primaryColor: "#E03A3E" },
  { slug: "charlotte-hornets", city: "Charlotte", name: "Hornets", abbreviation: "CHA", conference: "East", division: "Southeast", nbaTeamId: "1610612766", primaryColor: "#1D1160" },
  { slug: "miami-heat", city: "Miami", name: "Heat", abbreviation: "MIA", conference: "East", division: "Southeast", nbaTeamId: "1610612748", primaryColor: "#98002E" },
  { slug: "orlando-magic", city: "Orlando", name: "Magic", abbreviation: "ORL", conference: "East", division: "Southeast", nbaTeamId: "1610612753", primaryColor: "#0077C0" },
  { slug: "washington-wizards", city: "Washington", name: "Wizards", abbreviation: "WAS", conference: "East", division: "Southeast", nbaTeamId: "1610612764", primaryColor: "#002B5C" },
  // Western — Northwest
  { slug: "denver-nuggets", city: "Denver", name: "Nuggets", abbreviation: "DEN", conference: "West", division: "Northwest", nbaTeamId: "1610612743", primaryColor: "#0E2240" },
  { slug: "minnesota-timberwolves", city: "Minnesota", name: "Timberwolves", abbreviation: "MIN", conference: "West", division: "Northwest", nbaTeamId: "1610612750", primaryColor: "#0C2340" },
  { slug: "oklahoma-city-thunder", city: "Oklahoma City", name: "Thunder", abbreviation: "OKC", conference: "West", division: "Northwest", nbaTeamId: "1610612760", primaryColor: "#007AC1" },
  { slug: "portland-trail-blazers", city: "Portland", name: "Trail Blazers", abbreviation: "POR", conference: "West", division: "Northwest", nbaTeamId: "1610612757", primaryColor: "#E03A3E" },
  { slug: "utah-jazz", city: "Utah", name: "Jazz", abbreviation: "UTA", conference: "West", division: "Northwest", nbaTeamId: "1610612762", primaryColor: "#002B5C" },
  // Western — Pacific
  { slug: "golden-state-warriors", city: "Golden State", name: "Warriors", abbreviation: "GSW", conference: "West", division: "Pacific", nbaTeamId: "1610612744", primaryColor: "#1D428A" },
  { slug: "la-clippers", city: "LA", name: "Clippers", abbreviation: "LAC", conference: "West", division: "Pacific", nbaTeamId: "1610612746", primaryColor: "#C8102E" },
  { slug: "los-angeles-lakers", city: "Los Angeles", name: "Lakers", abbreviation: "LAL", conference: "West", division: "Pacific", nbaTeamId: "1610612747", primaryColor: "#552583" },
  { slug: "phoenix-suns", city: "Phoenix", name: "Suns", abbreviation: "PHX", conference: "West", division: "Pacific", nbaTeamId: "1610612756", primaryColor: "#1D1160" },
  { slug: "sacramento-kings", city: "Sacramento", name: "Kings", abbreviation: "SAC", conference: "West", division: "Pacific", nbaTeamId: "1610612758", primaryColor: "#5A2D81" },
  // Western — Southwest
  { slug: "dallas-mavericks", city: "Dallas", name: "Mavericks", abbreviation: "DAL", conference: "West", division: "Southwest", nbaTeamId: "1610612742", primaryColor: "#00538C" },
  { slug: "houston-rockets", city: "Houston", name: "Rockets", abbreviation: "HOU", conference: "West", division: "Southwest", nbaTeamId: "1610612745", primaryColor: "#CE1141" },
  { slug: "memphis-grizzlies", city: "Memphis", name: "Grizzlies", abbreviation: "MEM", conference: "West", division: "Southwest", nbaTeamId: "1610612763", primaryColor: "#5D76A9" },
  { slug: "new-orleans-pelicans", city: "New Orleans", name: "Pelicans", abbreviation: "NOP", conference: "West", division: "Southwest", nbaTeamId: "1610612740", primaryColor: "#0C2340" },
  { slug: "san-antonio-spurs", city: "San Antonio", name: "Spurs", abbreviation: "SAS", conference: "West", division: "Southwest", nbaTeamId: "1610612759", primaryColor: "#C4CED4" },
];

export const teamLogoUrl = (nbaTeamId: string) =>
  `https://cdn.nba.com/logos/nba/${nbaTeamId}/global/L/logo.svg`;
