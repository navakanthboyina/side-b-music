import fs from 'node:fs';import assert from 'node:assert/strict';
import {parseSongs} from '../ai-core.mjs';
const raw=fs.readFileSync(new URL('./fixtures/ambiguous-labels.json',import.meta.url),'utf8');
assert.throws(()=>parseSongs(raw,{feedback:[],recentSongs:[],language:'All languages'}),/Verified candidates/);
const profile={feedback:[],recentSongs:[],candidates:[{artist:'Singer',title:'Verified Song',language:'Telugu'}]};
const result=parseSongs('{"ids":[1],"language":"English"}',profile);
assert.equal(result[0].language,'Telugu');
