import assert from 'node:assert/strict';
import {parseSongs} from '../ai-core.mjs';
const profile={feedback:[{artist:'Singer',title:'Known'}],recentSongs:[],language:'Telugu',mood:'Warm',privateMarker:'must-not-appear'};
const song={artist:'Singer',title:'New',language:'Telugu',mood:'Warm',reason:'Test'};
const raw=JSON.stringify({songs:[{...song,title:'Known'},{...song,language:'Telugu|Tamil'},{...song,language:'English'},{...song,mood:'Energetic'},{artist:'Singer'}]});
try{parseSongs(raw,profile);assert.fail('Expected rejection');}catch(e){assert.deepEqual(e.diagnostics.rejected,{invalidFields:1,invalidLabels:0,alreadyRatedOrRecent:1,duplicateOrArtistLimit:0,languageFilter:2,moodFilter:1});assert.equal(e.diagnostics.response,raw);assert(!JSON.stringify(e.diagnostics).includes('must-not-appear'));}
assert.equal(parseSongs(JSON.stringify({songs:[song]}),profile).length,1);
console.log('PASS: rejection causes are distinct; diagnostic output omits the taste profile.');
