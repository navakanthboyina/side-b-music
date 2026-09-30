import assert from 'node:assert/strict';
import {parseSongs} from '../ai-core.mjs';
const profile={feedback:[],recentSongs:[],candidates:[{artist:'Singer',title:'Existing'}],privateMarker:'must-not-appear'};
try{parseSongs('{"ids":[999]}',profile);assert.fail('Expected rejection');}catch(e){assert.equal(e.diagnostics.rejected.invalidSelection,1);assert(!JSON.stringify(e.diagnostics).includes('must-not-appear'));}
assert.throws(()=>parseSongs('{"songs":[{"artist":"Singer","title":"Invented"}]}',{feedback:[],recentSongs:[]}),/Verified candidates/);
