import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeSurroundings, buildingClass, mapRoofMaterial, osmXmlToElements, DATA_STATUS } from '../src/surroundings.mjs';

const bld = (building, extra = {}) => ({ type: 'way', tags: { building, ...extra } });

test('an apartment district suggests flat, with reasons a person can read', () => {
  const a = analyzeSurroundings({
    elements: [
      bld('apartments', { 'building:levels': '6', 'roof:material': 'concrete' }),
      bld('apartments', { 'building:levels': '4', 'roof:material': 'corrugated_iron' }),
      bld('apartments', { 'roof:material': 'corrugated_iron' }),
      bld('commercial'),
    ],
  });
  assert.equal(a.data_status, DATA_STATUS);
  assert.equal(a.buildings.count, 4);
  assert.equal(a.buildings.apartments, 3);
  assert.equal(a.suggestion.dwelling, 'flat');
  assert.equal(a.suggestion.roof_material, 'iron');
  assert.ok(a.suggestion.reasons.some((r) => r.startsWith('apartment_share')));
});

test('high-rise share alone flips the suggestion to flat even with mixed types', () => {
  const a = analyzeSurroundings({
    elements: [
      bld('yes', { 'building:levels': '8' }),
      bld('yes', { 'building:levels': '5' }),
      bld('house'),
    ],
  });
  assert.equal(a.suggestion.dwelling, 'flat');
  assert.equal(a.buildings.high_rise, 2);
});

test('a house neighbourhood suggests house and keeps thatch honest', () => {
  const a = analyzeSurroundings({
    elements: [bld('house', { 'roof:material': 'thatch' }), bld('house'), bld('hut', { 'roof:material': 'grass' })],
  });
  assert.equal(a.suggestion.dwelling, 'house');
  assert.equal(a.suggestion.roof_material, 'thatch');
});

test('no mapped buildings means no suggestion, and says so', () => {
  const a = analyzeSurroundings({ elements: [] });
  assert.equal(a.suggestion, null);
  assert.equal(a.buildings.count, 0);
  assert.match(a.caveat, /uneven/);
});

test('farmland and gardens are counted as land context, not buildings', () => {
  const a = analyzeSurroundings({
    elements: [
      bld('house'),
      { type: 'way', tags: { landuse: 'farmland' } },
      { type: 'way', tags: { landuse: 'orchard' } },
      { type: 'way', tags: { leisure: 'garden' } },
    ],
  });
  assert.equal(a.buildings.count, 1);
  assert.equal(a.land.farmland_ways, 2);
  assert.equal(a.land.garden_ways, 1);
  assert.equal(a.suggestion.farmland_nearby, true);
});

test('roof material tags map to the plan vocabulary, unknown maps to null', () => {
  assert.equal(mapRoofMaterial('corrugated_iron'), 'iron');
  assert.equal(mapRoofMaterial('metal sheet'), 'iron');
  assert.equal(mapRoofMaterial('tiles'), 'tiles');
  assert.equal(mapRoofMaterial('concrete slab'), 'tiles');
  assert.equal(mapRoofMaterial('thatch'), 'thatch');
  assert.equal(mapRoofMaterial('makuti'), 'thatch');
  assert.equal(mapRoofMaterial('asbestos'), null);
  assert.equal(mapRoofMaterial(''), null);
});

test('building classes stay inside the three-way split', () => {
  assert.equal(buildingClass('apartments'), 'apartment');
  assert.equal(buildingClass('residential'), 'apartment');
  assert.equal(buildingClass('semidetached_house'), 'house');
  assert.equal(buildingClass('church'), 'other');
  assert.equal(buildingClass('yes'), 'unknown');
});

test('a dense untagged city block with no houses reads as flat country', () => {
  // How African city centres are actually mapped: building=yes, no type, a few
  // with levels. 16 buildings, zero houses -> flat, with the reason stated.
  const elements = [];
  for (let i = 0; i < 13; i += 1) elements.push(bld('yes'));
  elements.push(bld('yes', { 'building:levels': '7' }));
  elements.push(bld('yes', { 'building:levels': '13' }));
  elements.push(bld('commercial'));
  const a = analyzeSurroundings({ elements });
  assert.equal(a.buildings.count, 16);
  assert.equal(a.suggestion.dwelling, 'flat');
  assert.ok(a.suggestion.reasons.some((r) => r.startsWith('dense_block_16')));
  assert.equal(a.suggestion.reasons.includes('high_rise_2'), true);
});

test('a sparse few untagged buildings do not trigger the dense-block rule', () => {
  const a = analyzeSurroundings({ elements: [bld('yes'), bld('yes'), bld('church')] });
  // Nothing to stand on: no dwelling call, no roof votes, no farmland.
  assert.equal(a.suggestion, null);
  assert.equal(a.buildings.count, 3);
});

test('OSM API XML converts to Overpass-shaped elements with distance filtering', () => {
  const xml = `<?xml version="1.0"?><osm>
    <node id="1" lat="-1.2924" lon="36.8147"><tag k="building" v="apartments"/><tag k="building:levels" v="7"/></node>
    <node id="2" lat="-1.3100" lon="36.8147"><tag k="building" v="house"/></node>
    <node id="10" lat="-1.2925" lon="36.8148"/>
    <node id="11" lat="-1.2923" lon="36.8148"/>
    <node id="12" lat="-1.2923" lon="36.8146"/>
    <node id="13" lat="-1.2925" lon="36.8146"/>
    <way id="100"><nd ref="10"/><nd ref="11"/><nd ref="12"/><nd ref="13"/><tag k="building" v="yes"/><tag k="roof:material" v="corrugated_iron"/></way>
    <way id="200"><nd ref="10"/><nd ref="11"/><tag k="landuse" v="farmland"/></way>
    <way id="300"><nd ref="10"/><tag k="highway" v="residential"/></way>
  </osm>`;
  const els = osmXmlToElements(xml, -1.2924, 36.8147);
  // The far node (id=2, ~2 km away) is filtered out; the untagged way 300 is ignored.
  const buildings = els.filter((e) => e.tags.building);
  assert.equal(buildings.length, 2);
  assert.ok(els.some((e) => e.tags.landuse === 'farmland'));
  assert.ok(!els.some((e) => e.tags.highway));
  const a = analyzeSurroundings({ elements: els });
  assert.equal(a.buildings.count, 2);
});

test('OSM XML conversion survives garbage and empty input', () => {
  assert.deepEqual(osmXmlToElements('', -1.29, 36.81), []);
  assert.deepEqual(osmXmlToElements(null, -1.29, 36.81), []);
  assert.deepEqual(osmXmlToElements('<osm/>', 'bad', 'worse'), []);
});

test('a Nominatim reverse address becomes a readable place', () => {
  const a = analyzeSurroundings({
    elements: [bld('apartments')],
    reverse: { address: { suburb: 'Upper Hill', city: 'Nairobi', county: 'Nairobi County', country: 'Kenya' } },
  });
  assert.deepEqual(a.place, { suburb: 'Upper Hill', town: 'Nairobi', county: 'Nairobi County', country: 'Kenya' });
});
