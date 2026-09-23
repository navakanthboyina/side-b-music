import assert from 'node:assert/strict';
import {parseCandidatePicks,candidateMessages} from '../ai-core.mjs';
const profile={feedback:[{artist:'Artist A',title:'Rated song'}],recentSongs:[{artist:'Artist B',title:'Recent song'}],language:'All languages',mood:'Any mood',candidates:[{artist:'Artist A',title:'Rated song'},{artist:'Artist B',title:'Recent song'},{artist:'Artist A',title:'Unseen song',language:'Unspecified',mood:'Any mood',catalog:{trackName:'Unseen song'}}]};
const result=parseCandidatePicks('{"ids":[1,2,3,3,999]}',profile);
assert.equal(result.length,1);assert.equal(result[0].title,'Unseen song');assert.equal(result[0].catalog,profile.candidates[2].catalog);
assert.throws(()=>parseCandidatePicks('{"songs":[{"artist":"Artist A","title":"Rated song"}]}',profile),/valid candidate IDs/);
assert.throws(()=>parseCandidatePicks('{"ids":[1,2]}',profile),/valid candidate IDs/);
assert(!candidateMessages(profile)[1].content.includes('catalog'));
console.log('PASS: rated/recent tracks, duplicate IDs and invented IDs cannot become AI selections; returned metadata remains catalog-owned.');

const before=JSON.stringify(profile);
const objectReply='```json\n'+JSON.stringify([{artist:'Artist A',title:'Unseen song',rating:'replay',language:'Invented',reason:'Invented explanation'},{artist:'Artist A',title:'Rated song',rating:'replay'},{artist:'Unknown Artist',title:'Unlisted song',rating:'replay'}])+'\n```';
const objects=parseCandidatePicks(objectReply,profile);
assert.equal(objects.length,1);assert.equal(objects[0].title,'Unseen song');assert.equal(objects[0].rating,undefined);assert.equal(objects[0].language,'Unspecified');assert(!objects[0].reason.includes('Invented'));assert.equal(JSON.stringify(profile),before);
assert.equal(parseCandidatePicks('{"songs":[{"artist":"Artist A","title":"Unseen song"}]}',profile).length,1);
assert.throws(()=>parseCandidatePicks('[{"artist":"Unknown Artist","title":"Unseen song"}]',profile),e=>e.diagnostics.rejected.outsidePool===1);
assert.throws(()=>parseCandidatePicks('[{"artist":"Artist A","title":"Rated song"}]',profile),e=>e.diagnostics.rejected.alreadyRatedOrRecent===1);
console.log('PASS: fenced song arrays and song objects resolve only to eligible candidates; AI ratings and metadata are ignored.');
