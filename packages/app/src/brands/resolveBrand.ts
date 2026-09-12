// Maps a dive computer's free-text model string (StoredDive.computerModel, e.g.
// "Shearwater Teric", "Perdix 2", "Descent Mk2i") to a manufacturer brand and
// its bundled logo assets. There is no structured vendor field on a dive, and
// the model string usually omits the manufacturer, so matching is heuristic:
// an ordered list of regexes over the lowercased model string, first match wins.
// Keep more specific / overlap-prone brands above the ones they collide with.

export interface Brand {
  id: string;
  name: string;
  /** Wide wordmark logo URL, or null when we have no usable asset for this brand. */
  wordmark: string | null;
  /** Square icon URL, or null when we have no usable asset for this brand. */
  favicon: string | null;
}

// Vite bundles each referenced file separately and returns its URL; only the
// brands actually rendered get fetched by the browser.
const logoUrls = import.meta.glob('../assets/brand-logos/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
const faviconUrls = import.meta.glob('../assets/brand-favicons/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function asset(map: Record<string, string>, id: string): string | null {
  const entry = Object.entries(map).find(([path]) => path.endsWith(`/${id}.png`));
  return entry ? entry[1] : null;
}

interface BrandDef {
  id: string;
  name: string;
  test: RegExp;
}

const BRAND_DEFS: BrandDef[] = [
  { id: 'shearwater', name: 'Shearwater', test: /shearwater|petrel|perdix|teric|peregrine|\bnerd\b|\btern\b|predator/ },
  { id: 'garmin', name: 'Garmin', test: /garmin|descent\s*mk|\bdescent\b/ },
  {
    id: 'suunto',
    name: 'Suunto',
    test: /suunto|\bzoop\b|\bvyper\b|vytec|\bcobra\b|\bgekko\b|mosquito|stinger|hel[o0]2|eon\s*(steel|core)|\bd[3456]i?\b|\bd9\b|\bdx\b/,
  },
  { id: 'scubapro', name: 'Scubapro', test: /scubapro|galileo|\baladin\b|\bg2\b|\bg3\b|\bluna\b|chromis|mantis|meridian/ },
  { id: 'uwatec', name: 'Uwatec', test: /uwatec/ },
  { id: 'mares', name: 'Mares', test: /mares|\bpuck\b|\bgenius\b|\bquad\b|\bnemo\b|icon\s*hd|\bhorizon\b|smart\s*air/ },
  { id: 'cressi', name: 'Cressi', test: /cressi|leonardo|giotto|newton|donatello|michelangelo|\bgoa\b|cartesio/ },
  { id: 'oceanic', name: 'Oceanic', test: /oceanic|pro\s*plus|\bvtx\b|\bvt3\b|\bveo\b|\boci\b|datamask|geo\s*[24]/ },
  { id: 'aeris', name: 'Aeris', test: /aeris|\ba300\b|\bxr-?[12]\b|\bepic\b|\bmanta\b|atmos\s*ai/ },
  { id: 'aqualung', name: 'Aqua Lung', test: /aqua\s*lung|\bi[0-9]{3}r?\b/ },
  { id: 'apeks', name: 'Apeks', test: /apeks|\bdsx\b/ },
  { id: 'hollis', name: 'Hollis', test: /hollis|\bdg0[1-4]\b|\btx1\b/ },
  { id: 'sherwood', name: 'Sherwood', test: /sherwood|wisdom|amphos|\bsage\b/ },
  { id: 'tusa', name: 'Tusa', test: /\btusa\b|\btalis\b|\biq-?\d{3}\b|dc\s*solar|dc\s*hunter/ },
  { id: 'zeagle', name: 'Zeagle', test: /zeagle|n2ition/ },
  { id: 'atomic-aquatics', name: 'Atomic Aquatics', test: /atomic|\bcobalt\b/ },
  { id: 'ratio', name: 'Ratio', test: /\bratio\b|ix3m|idive/ },
  { id: 'divesoft', name: 'Divesoft', test: /divesoft|\bfreedom\b/ },
  { id: 'deepblu', name: 'Deepblu', test: /deepblu|cosmiq/ },
  { id: 'oceans', name: 'Oceans', test: /\boceans\b/ },
  { id: 'halcyon', name: 'Halcyon', test: /halcyon|symbios/ },
  { id: 'heinrichs-weikamp', name: 'Heinrichs Weikamp', test: /heinrichs|weikamp|\bostc\b/ },
  { id: 'liquivision', name: 'Liquivision', test: /liquivision|\bxeo\b|\blynx\b|\bkaon\b/ },
  { id: 'cochran', name: 'Cochran', test: /cochran|\bemc-?\d+\b|\bgemini\b/ },
  { id: 'genesis', name: 'Genesis', test: /genesis|react\s*pro/ },
  { id: 'beuchat', name: 'Beuchat', test: /beuchat|mundial/ },
  { id: 'citizen', name: 'Citizen', test: /citizen|aqualand/ },
  { id: 'subgear', name: 'SubGear', test: /subgear|xp-?(10|air|3g)|black\s*diamond/ },
  { id: 'seemann', name: 'Seemann', test: /seemann|\bxp5\b/ },
  { id: 'dive-rite', name: 'Dive Rite', test: /dive\s*rite|nitek/ },
  { id: 'deep-six', name: 'Deep Six', test: /deep\s*six|excursion/ },
  { id: 'dive-system', name: 'DiveSystem', test: /divesystem|\borca\b/ },
  { id: 'reefnet', name: 'ReefNet', test: /reefnet|sensus/ },
  { id: 'scorpena', name: 'Scorpena', test: /scorpena/ },
  { id: 'sporasub', name: 'Sporasub', test: /sporasub/ },
  { id: 'tecdiving', name: 'TecDiving', test: /tec\s*diving/ },
  { id: 'mclean', name: 'McLean', test: /mclean/ },
  { id: 'crest', name: 'Crest', test: /\bcrest\b|\bcr-?[45]\b/ },
  { id: 'seac', name: 'Seac', test: /\bseac\b|\bguru\b/ },
];

/**
 * Resolves a brand (with logo asset URLs) for a dive computer model string, or
 * null when nothing matches. A matched brand can still have `wordmark`/`favicon`
 * of null when we recognise the make but ship no usable asset for it (e.g.
 * Garmin) -- callers fall back to a generic icon in that case.
 */
export function resolveBrand(computerModel: string | null | undefined): Brand | null {
  if (!computerModel) return null;
  const s = computerModel.toLowerCase();
  const def = BRAND_DEFS.find((d) => d.test.test(s));
  if (!def) return null;
  return {
    id: def.id,
    name: def.name,
    wordmark: asset(logoUrls, def.id),
    favicon: asset(faviconUrls, def.id),
  };
}
