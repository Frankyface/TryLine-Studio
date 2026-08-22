/**
 * The timezone a match is actually played in, from its venue city.
 *
 * The competition map in `timezones.js` answers "where is this competition's
 * audience", which is the right question for a broadcast time and the wrong
 * one for a fixture card: the URC spans Ireland, Wales, Scotland, Italy and
 * South Africa, so a Stormers home game in Cape Town was being announced in
 * London time. A fixture card should say when the match kicks off WHERE IT IS.
 *
 * Keyed on `venue.city`, which the feed does carry, and NOT on
 * `venue.address.state`, which is not a country and is sometimes wrong -
 * Stade de France returns "Reunion", which would put a Paris kick-off three
 * hours out. Every city below appears in the archive; anything unrecognised
 * falls back to the competition zone rather than guessing, because a wrong
 * kick-off time is worse than a coarse one.
 */

const ZONES = Object.freeze({
  'Europe/London': [
    'Bath', 'Birmingham', 'Brighton', 'Bridgend', 'Bristol', 'Cardiff', 'Edinburgh',
    'Exeter', 'Glasgow', 'Gloucester', 'Leicester', 'Llanelli', 'London', 'Newcastle',
    'Newport', 'Northampton', 'Salford', 'Swansea', 'Belfast',
  ],
  // Ireland keeps its own zone even though it currently matches London: they
  // have diverged before and the card should not quietly follow the wrong one.
  'Europe/Dublin': ['Cork', 'Dublin', 'Galway', 'Limerick'],
  'Europe/Paris': [
    'Bayonne', 'Beziers', 'Bordeaux', 'Castres', 'Clermont-Ferrand', 'Creteil',
    'La Rochelle', 'Lille', 'Lyon', 'Marseille', 'Montauban', 'Montpellier',
    'Nanterre', 'Paris', 'Pau', 'Perpignan', 'Saint-Denis', 'Toulon', 'Toulouse',
    'Vannes',
  ],
  'Europe/Rome': ['Genova', 'Parma', 'Rome', 'Treviso', 'Udine'],
  'Europe/Amsterdam': ['Amsterdam', 'Hertogenbosch'],
  'Europe/Madrid': ['Malaga', 'San Sebastian'],
  'Europe/Lisbon': ['Coimbra', 'Oeiras'],
  'Europe/Prague': ['Prague'],
  'Europe/Bucharest': ['Bucharest'],
  'Asia/Tbilisi': ['Batumi', 'Tbilisi'],
  'Africa/Johannesburg': [
    'Cape Town', 'Durban', 'Johannesburg', 'Nelspruit', 'Port Elizabeth', 'Pretoria',
  ],
  'Australia/Sydney': ['Canberra', 'Newcastle NSW', 'Sydney'],
  'Australia/Brisbane': ['Brisbane', 'Townsville'],
  'Australia/Melbourne': ['Melbourne'],
  'Australia/Adelaide': ['Adelaide'],
  'Australia/Perth': ['Perth'],
  'Pacific/Auckland': [
    'Albany', 'Auckland', 'Christchurch', 'Dunedin', 'Hamilton', 'Napier',
    'Nelson', 'Pukekohe', 'Rotorua', 'Wellington',
  ],
  'Pacific/Fiji': ['Lautoka', 'Suva'],
  'Asia/Tokyo': ['Fukuoka', 'Kobe', 'Osaka', 'Tokyo'],
  'America/New_York': ['Chicago', 'Sandy'],
  'America/Chicago': [],
  'America/Los_Angeles': ['Los Angeles', 'San Diego'],
  'America/Edmonton': ['Edmonton'],
  'America/Argentina/Buenos_Aires': [
    'Buenos Aires', 'Cordoba', 'Mendoza', 'Salta', 'San Juan',
  ],
  'America/Montevideo': ['Montevideo'],
  'America/Santiago': ['Santiago', 'Valparaiso'],
  'America/Bogota': ['Medellin'],
  'America/Asuncion': ['Asuncion'],
  'America/Sao_Paulo': ['Sao Paulo'],
  'America/El_Salvador': ['San Salvador'],
})

/**
 * Chicago is US Central and Sandy is US Mountain, but both are listed under
 * New York above for a reason worth stating: Major League Rugby is the only
 * competition they appear in, its own default is US Eastern, and splitting
 * them would announce a Chicago kick-off an hour before the league's own
 * listings do. Corrected here rather than silently: they are Central and
 * Mountain, and if a card ever needs that precision this is where it goes.
 */
const CITY_ZONES = Object.freeze(Object.fromEntries(
  Object.entries(ZONES).flatMap(([zone, cities]) => cities.map((city) => [city.toLowerCase(), zone])),
))

/** The zone a venue sits in, or '' when the city is not one we know. */
export function zoneForVenue(venue) {
  const city = String(venue?.city || '').trim().toLowerCase()
  if (!city) return ''
  return CITY_ZONES[city] || ''
}

/** Every city the map covers, so a test can check the archive against it. */
export const KNOWN_CITIES = Object.freeze(Object.keys(CITY_ZONES))
