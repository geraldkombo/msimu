import sitesJson from '../data/sites.json' with { type: 'json' };
import cropsJson from '../data/crops.json' with { type: 'json' };

export const sites = sitesJson;
export const crops = cropsJson.crops;

export function siteIds() {
  return Object.keys(sites).filter((k) => !k.startsWith('_'));
}

export function getSite(id) {
  const site = sites[id];
  if (!site) throw new Error(`unknown site "${id}". known: ${siteIds().join(', ')}`);
  return site;
}
